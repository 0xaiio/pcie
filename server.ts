import express from "express";
import compression from "compression";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import { createServer as createHttpServer, type Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  buildGhostscriptCompressionCommand,
  createCompressionJobId,
  resolvePdfCompressionSettings,
} from "./src/server/compression.ts";
import { isAiRequestError, runAiChatRequest } from "./src/server/ai.ts";
import { isLocalOcrRequestError, runLocalImageOcrRequest } from "./src/server/local-ocr.ts";
import { readRuntimeConfig } from "./src/server/runtime-config.ts";
import { openAppInBrowserAfterStart } from "./src/server/auto-open.ts";
import { extractLegacyWordHtml } from "./src/server/word-conversion.ts";
import { getPdfRenderProfile, renderPage } from "./src/server/pdf-render.ts";
import {
  buildNoImagesMessage,
  countPagesWithVectorInk,
  extractPdfImages,
} from "./src/server/pdf-images.ts";
import {
  buildNativeWordPdfUnavailableMessage,
  convertWordDocumentToPdf,
  isNativeWordPdfBackend,
  NativeWordPdfUnavailableError,
} from "./src/server/word-pdf-native.ts";

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

const DEFAULT_PORT = 3000;
const PORT_SEARCH_LIMIT = 100;

function resolvePreferredPort(): number {
  const raw = (process.env.PORT || "").trim();
  if (raw === "") {
    return DEFAULT_PORT;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    console.warn(`Ignoring invalid PORT="${raw}"; falling back to port ${DEFAULT_PORT}.`);
    return DEFAULT_PORT;
  }

  return parsed;
}

/**
 * Binds the HTTP server to `preferredPort`, transparently moving to the next
 * port while EADDRINUSE is reported. Returns the port that was actually bound.
 */
async function listenOnFirstAvailablePort(
  httpServer: HttpServer,
  preferredPort: number,
): Promise<number> {
  let activePort = preferredPort;

  for (let attempt = 0; attempt < PORT_SEARCH_LIMIT; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        const handleListening = () => {
          httpServer.off("error", handleError);
          resolve();
        };

        const handleError = (error: NodeJS.ErrnoException) => {
          httpServer.off("listening", handleListening);
          reject(error);
        };

        httpServer.once("listening", handleListening);
        httpServer.once("error", handleError);
        httpServer.listen(activePort, "0.0.0.0");
      });

      return activePort;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") {
        throw error;
      }

      activePort += 1;
    }
  }

  throw new Error(
    `No available port found in range ${preferredPort}-${preferredPort + PORT_SEARCH_LIMIT - 1}.`
    + " Set PORT to a free port and retry.",
  );
}

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  app.use(compression());
  app.use(express.json({ limit: "25mb" }));
  const preferredPort = resolvePreferredPort();

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/runtime-config", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(readRuntimeConfig());
  });

  app.post("/api/ai/chat", async (req, res) => {
    try {
      const response = await runAiChatRequest(req.body);
      res.setHeader("Cache-Control", "no-store");
      res.json(response);
    } catch (error) {
      console.error("AI chat error:", error);
      if (isAiRequestError(error)) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }

      res.status(500).json({ error: "AI assistant request failed." });
    }
  });

  const handleImageOcrRequest = async (req: express.Request, res: express.Response) => {
    try {
      const response = await runLocalImageOcrRequest(req.body);
      res.setHeader("Cache-Control", "no-store");
      res.json(response);
    } catch (error) {
      console.error("Image OCR error:", error);
      if (isLocalOcrRequestError(error)) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }

      res.status(500).json({ error: "Image OCR request failed." });
    }
  };

  app.post("/api/ocr/image", handleImageOcrRequest);
  app.post("/api/ai/ocr", handleImageOcrRequest);

  app.post("/api/word/extract-html", upload.single("word"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No Word file uploaded" });
    }

    const inputPath = req.file.path;

    try {
      const documentBuffer = fs.readFileSync(inputPath);
      const html = await extractLegacyWordHtml(documentBuffer);
      res.setHeader("Cache-Control", "no-store");
      res.json({ html });
    } catch (error) {
      console.error("Legacy Word extraction error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      } catch (cleanupError) {}
    }
  });

  app.post("/api/word/convert-pdf", upload.single("word"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No Word file uploaded" });
    }

    const requestedBackendQuery = typeof req.query.backend === 'string'
      ? req.query.backend
      : undefined;

    if (requestedBackendQuery && !isNativeWordPdfBackend(requestedBackendQuery)) {
      return res.status(400).json({ error: 'Unsupported native Word PDF backend requested.' });
    }

    const requestedBackend = requestedBackendQuery && isNativeWordPdfBackend(requestedBackendQuery)
      ? requestedBackendQuery
      : undefined;

    const originalExtension = path.extname(req.file.originalname) || '.docx';
    const inputPath = path.join(uploadDir, `${req.file.filename}${originalExtension}`);
    const outputPath = path.join(uploadDir, `${req.file.filename}.pdf`);

    try {
      fs.renameSync(req.file.path, inputPath);

      const backend = await convertWordDocumentToPdf(inputPath, outputPath, {
        preferredBackend: requestedBackend,
      });
      const pdfBuffer = fs.readFileSync(outputPath);

      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("X-Word-Pdf-Backend", backend);
      res.send(pdfBuffer);
    } catch (error) {
      if (error instanceof NativeWordPdfUnavailableError) {
        return res.status(503).json({
          error: buildNativeWordPdfUnavailableMessage(),
          code: error.code,
          fallbackAvailable: true,
        });
      }

      console.error("Native Word PDF conversion error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
        code: 'native-conversion-failed',
        fallbackAvailable: true,
      });
    } finally {
      for (const targetPath of [req.file.path, inputPath, outputPath]) {
        try {
          if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
          }
        } catch {
          // Best-effort cleanup only.
        }
      }
    }
  });

  const jobs = new Map<string, { status: string, outputPath: string, inputPath: string, error?: string }>();

  app.post("/api/compress/start", upload.single("pdf"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded" });
    }

    const pdfSettings = resolvePdfCompressionSettings(req.body.level);

    const inputPath = req.file.path;
    const jobId = createCompressionJobId();
    const outputPath = path.join(uploadDir, `compressed-${jobId}.pdf`);

    jobs.set(jobId, { status: "processing", inputPath, outputPath });
    res.json({ jobId });

    // Process in background
    (async () => {
      try {
        // Run Ghostscript to compress the PDF
        // Subsample downsampling is much faster than default Bicubic
        const command = buildGhostscriptCompressionCommand({
          inputPath,
          outputPath,
          pdfSettings,
        });
        
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);
        
        await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });
        
        const job = jobs.get(jobId);
        if (job) job.status = "done";
      } catch (error: any) {
        console.error("Compression error:", error);
        const job = jobs.get(jobId);
        if (job) {
          job.status = "error";
          job.error = error.message;
        }
      }
    })();
  });

  app.get("/api/compress/status/:jobId", (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    res.json({ status: job.status, error: job.error });
  });

  app.get("/api/compress/download/:jobId", (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job || job.status !== "done") {
      return res.status(400).json({ error: "Job not ready or failed" });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="compressed.pdf"`);
    
    const stream = fs.createReadStream(job.outputPath);
    stream.pipe(res);
    
    stream.on("end", () => {
      try {
        if (fs.existsSync(job.inputPath)) fs.unlinkSync(job.inputPath);
        if (fs.existsSync(job.outputPath)) fs.unlinkSync(job.outputPath);
        jobs.delete(req.params.jobId);
      } catch (cleanupError) {}
    });
    
    stream.on("error", (err) => {
      console.error("Stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to download file" });
      }
    });
  });

  app.post("/api/pdf/extract-images", upload.single("pdf"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No PDF file uploaded" });

    const inputPath = req.file.path;
    const sourceName = typeof req.file.originalname === "string"
      ? req.file.originalname
      : "document.pdf";

    try {
      const pdfBytes = new Uint8Array(fs.readFileSync(inputPath));
      const result = await extractPdfImages(pdfBytes, sourceName, { yieldEveryMs: 10 });

      if (result.images.length === 0) {
        // 区分「文档无位图」与「图是矢量」，给用户可执行的结论而非误导性报错
        const { pageCount, pagesWithInk } = await countPagesWithVectorInk(pdfBytes);
        const message = await buildNoImagesMessage({
          pageCount,
          pagesWithContent: pagesWithInk,
        });
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json({
          images: [],
          scannedPages: result.scannedPages,
          decodeFailures: result.decodeFailures,
          vectorPages: pagesWithInk,
          message,
        });
      }

      res.setHeader("Cache-Control", "no-store");
      res.json({
        images: result.images.map((image) => ({
          page: image.page,
          fileName: image.fileName,
          caption: image.caption,
          captionMatched: image.captionMatched,
          width: image.width,
          height: image.height,
          format: image.format,
          mimeType: image.mimeType,
          bytes: Buffer.from(image.bytes).toString("base64"),
        })),
        scannedPages: result.scannedPages,
        decodeFailures: result.decodeFailures,
      });
    } catch (error) {
      console.error("Image extraction error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      } catch {
        // Best-effort cleanup only.
      }
    }
  });

  app.post("/api/pdf2img", upload.single("pdf"), async (req, res) => {
    if (!req.file) return res.status(400).send("No PDF file uploaded");

    const profile = getPdfRenderProfile(req.body.format);
    const inputPath = req.file.path;

    try {
      const mupdf = await import("mupdf");
      let pdfBytes;
      try {
        pdfBytes = fs.readFileSync(inputPath);
      } catch (e) {
        throw new Error("Failed to read uploaded file: " + String(e));
      }

      let doc;
      try {
        doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
      } catch (e) {
        throw new Error("mupdf failed to open document: " + String(e));
      }

      const count = doc.countPages();
      if (count === 0) {
        throw new Error("The PDF document contains 0 pages according to mupdf.");
      }

      res.setHeader("Content-Type", "application/json");
      // 逐页流式写出，避免大文档把整份结果堆在内存里
      res.write(
        JSON.stringify({
          format: profile.format,
          extension: profile.extension,
          mimeType: profile.mimeType,
          vector: profile.vector,
          pageCount: count,
        }).slice(0, -1) + ',"pages":['
      );

      let lastError;
      let streamedCount = 0;

      try {
        for (let i = 0; i < count; i++) {
          // Yield the event loop so the server doesn't freeze and fail health checks
          await new Promise(resolve => setTimeout(resolve, 10));

          let page;
          try {
            page = doc.loadPage(i);
            const rendered = await renderPage(mupdf, page, profile);

            // 矢量格式按文本下发，其余按 base64 二进制下发
            const payload = typeof rendered === "string"
              ? rendered
              : Buffer.from(rendered).toString("base64");

            if (streamedCount > 0) res.write(",");
            res.write(JSON.stringify({
              page: i + 1,
              data: payload,
              encoding: typeof rendered === "string" ? "text" : "base64",
            }));
            streamedCount++;
          } catch (pageErr) {
            lastError = pageErr;
            console.error(`Error processing page ${i}:`, pageErr);
          } finally {
            if (page) page.destroy();
          }
        }
      } finally {
        if (doc) doc.destroy();
      }

      if (streamedCount === 0 && lastError) {
        throw lastError;
      }

      res.write("]}");
      res.end();
    } catch (error) {
      console.error("Conversion error:", error);
      res.status(500).send(String(error instanceof Error ? error.message : error));
    } finally {
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      } catch(e) {}
    }
  });

// Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: { server: httpServer },
        hmr: process.env.DISABLE_HMR === "true" ? false : { server: httpServer },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const activePort = await listenOnFirstAvailablePort(httpServer, preferredPort);

  const address = httpServer.address() as AddressInfo | null;
  const boundPort = address?.port ?? activePort;

  if (preferredPort !== 0 && boundPort !== preferredPort) {
    console.warn(`Port ${preferredPort} is busy, using http://localhost:${boundPort} instead.`);
  }

  const localUrl = `http://localhost:${boundPort}`;
  console.log(`Server running on ${localUrl}`);

  await openAppInBrowserAfterStart(localUrl);
}

startServer();
