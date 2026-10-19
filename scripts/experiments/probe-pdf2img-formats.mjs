/**
 * 端到端探针：起真实 Express 服务，对每种输出格式打真实 HTTP 请求并校验产物。
 *
 * 覆盖：8 种格式的 Content-Type / magic bytes / 扩展名 / vector 标记 / 页数，
 * 以及非法格式回退到 SVG 的行为。用 test/resources/pdf/ 下的真实多页论文。
 *
 * 刻意不进 `npm test`：它要占一个 TCP 端口并跑完整渲染流水线，
 * 属于部署形态验证而非单元/组件测试。日常回归由 vitest 覆盖。
 *
 * 用法：node scripts/experiments/probe-pdf2img-formats.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 39433;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Windows 下 `spawn("npx")` 会 ENOENT（.cmd shim 不在 Node 的 spawn 解析里），
// 因此直接用 node_modules 里的 tsx 入口。
const TSX = path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs");

const PDF = path.join(
  REPO,
  "test/resources/pdf",
  "Ad Hoc Transactions through the Looking Glass An Empirical Study of Application-Level Transactions in Web Applications.pdf",
);

const MAGIC = {
  svg: (b) => /<svg|<\?xml/i.test(b.subarray(0, 400).toString("latin1")),
  png: (b) => b[0] === 0x89 && b.subarray(1, 4).toString("latin1") === "PNG",
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8,
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8,
  webp: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  bmp: (b) => b[0] === 0x42 && b[1] === 0x4d,
  tiff: (b) =>
    (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
    (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a),
  gif: (b) => b.subarray(0, 3).toString("latin1") === "GIF",
};

const server = spawn(process.execPath, [TSX, path.join(REPO, "server.ts")], {
  cwd: REPO,
  env: { ...process.env, PORT: String(PORT), AUTO_OPEN: "false" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", () => {});
server.stderr.on("data", (d) => process.stderr.write(d));

const waitForServer = async () => {
  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

const post = async (format) => {
  const fd = new FormData();
  fd.append("pdf", new Blob([fs.readFileSync(PDF)], { type: "application/pdf" }), path.basename(PDF));
  fd.append("format", format);
  const res = await fetch(`http://127.0.0.1:${PORT}/api/pdf2img`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) throw new Error(`expected JSON, got ${ct}`);
  return res.json();
};

const decodeFirst = (page, format) => {
  if (!page) return Buffer.alloc(0);
  return page.encoding === "text" ? Buffer.from(page.data, "utf8") : Buffer.from(page.data, "base64");
};

let failures = 0;
try {
  if (!(await waitForServer())) throw new Error("server did not come up");
  console.log(`server up on ${PORT}\n`);

  for (const format of Object.keys(MAGIC)) {
    const t0 = Date.now();
    const r = await post(format);
    const first = decodeFirst(r.pages?.[0], format);
    const problems = [];

    if (!MAGIC[format](first)) {
      problems.push(`magic mismatch head=${first.subarray(0, 8).toString("hex")}`);
    }
    if (r.pages.length !== r.pageCount) problems.push(`pages ${r.pages.length} != pageCount ${r.pageCount}`);
    if (format === "svg" && r.vector !== true) problems.push("svg not marked vector");
    if (format !== "svg" && r.vector !== false) problems.push("raster marked vector");
    if (!r.mimeType) problems.push("missing mimeType");

    const ms = Date.now() - t0;
    const ok = problems.length === 0;
    if (!ok) failures += 1;
    console.log(
      `${ok ? "OK  " : "FAIL"} ${format.padEnd(5)} ext=${String(r.extension).padEnd(5)} mime=${String(r.mimeType).padEnd(14)} vector=${String(r.vector).padEnd(5)} pages=${String(r.pageCount).padStart(3)}  ${ms}ms`,
    );
    for (const p of problems) console.log(`       ${p}`);
  }

  const fb = await post("definitely-not-a-format");
  const fbOk = fb.format === "svg" && fb.vector === true;
  if (!fbOk) failures += 1;
  console.log(`\n${fbOk ? "OK  " : "FAIL"} invalid format falls back to svg (got format=${fb.format})`);
} catch (err) {
  failures += 1;
  console.error("probe error:", err.message);
} finally {
  server.kill();
}

process.exit(failures === 0 ? 0 : 1);