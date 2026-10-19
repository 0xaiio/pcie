/** @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getPdfRenderProfile, listPdfRenderProfiles, PDF_RENDER_FORMATS } from './pdf-render-shared';
import { encodeBmp, encodeWithSharp, rasterizePage, renderPage } from './pdf-render';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

/** 真实学术论文 PDF（LaTeX/pdfTeX 产物，39 页）。 */
const realPaperDir = path.join(repoRoot, 'test', 'resources', 'pdf');
const realPaperFile = fs
  .readdirSync(realPaperDir)
  .find((name) => name.toLowerCase().endsWith('.pdf') && name !== 'single-page-sample.pdf');
const realPaperPath = realPaperFile ? path.join(realPaperDir, realPaperFile) : null;

/** 单页样本：由 scripts/make-single-page-sample.mjs 从真实 PDF 抽出第 1 页生成。 */
const singlePagePath = path.join(realPaperDir, 'single-page-sample.pdf');

function ensureRealPaper() {
  expect(realPaperPath, 'test/resources/pdf 下必须有真实 PDF').not.toBeNull();
  return realPaperPath as string;
}

async function openDoc(pdfPath: string) {
  const mupdf = await import('mupdf');
  const bytes = fs.readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  return { mupdf, doc, pageCount: doc.countPages() };
}

/**
 * mupdf 的 `loadPage` 返回 `PDFPage | Page` 联合类型（取决于文档是否已知是 PDF），
 * 但对本项目只会喂真实 PDF 的场景，直接断言成 `PDFPage` 以便调用其专有方法。
 */
async function openDocWithPdfPages(pdfPath: string) {
  const { mupdf, doc, pageCount } = await openDoc(pdfPath);
  const loadPage = (index: number): import('mupdf').PDFPage =>
    doc.loadPage(index) as import('mupdf').PDFPage;
  return { mupdf, doc, pageCount, loadPage };
}

/** 各格式的 magic bytes 判定。只认文件头，不依赖任何解码库。 */
const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  svg: (b) => {
    const head = Buffer.from(b.subarray(0, 64)).toString('utf8').trimStart();
    return head.startsWith('<svg') || head.startsWith('<?xml');
  },
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9,
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9,
  webp: (b) =>
    Buffer.from(b.subarray(0, 4)).toString('latin1') === 'RIFF'
    && Buffer.from(b.subarray(8, 12)).toString('latin1') === 'WEBP',
  bmp: (b) => b[0] === 0x42 && b[1] === 0x4d, // 'BM'
  tiff: (b) => {
    // 小端 II*\0 或大端 MM\0*，两种字节序都合法
    const le = b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00;
    const be = b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a;
    return le || be;
  },
  gif: (b) => Buffer.from(b.subarray(0, 3)).toString('latin1') === 'GIF',
};

describe('真实 PDF 基本事实', () => {
  it('测试资源里确实有一份多页真实 PDF', async () => {
    const { doc, pageCount } = await openDoc(ensureRealPaper());
    expect(pageCount).toBeGreaterThan(1);
    doc.destroy();
  });

  it('存在由真实 PDF 派生的单页样本', () => {
    expect(fs.existsSync(singlePagePath), '缺少 single-page-sample.pdf，请先运行 scripts/make-single-page-sample.mjs').toBe(true);
  });
});

describe('每种格式都能渲染真实页面并产出合法文件', () => {
  for (const format of PDF_RENDER_FORMATS) {
    it(`${format} — 真实 PDF 首页产出合法 ${format} 字节`, async () => {
      const { mupdf, doc, loadPage } = await openDocWithPdfPages(ensureRealPaper());
      const page = loadPage(0);
      try {
        const rendered = await renderPage(mupdf, page, getPdfRenderProfile(format), 150);
        const bytes = typeof rendered === 'string' ? Buffer.from(rendered, 'utf8') : rendered;

        expect(bytes.length, `${format} 产出为空`).toBeGreaterThan(64);
        expect(MAGIC[format](bytes), `${format} magic bytes 不匹配`).toBe(true);
      } finally {
        page.destroy();
        doc.destroy();
      }
    });
  }
});

describe('默认 SVG 行为', () => {
  it('未指定格式时走 SVG 矢量路径，返回文本而非二进制', async () => {
    const { mupdf, doc, loadPage } = await openDocWithPdfPages(ensureRealPaper());
    const page = loadPage(0);
    try {
      const profile = getPdfRenderProfile(undefined);
      expect(profile.format).toBe('svg');

      const rendered = await renderPage(mupdf, page, profile, 150);
      expect(typeof rendered, 'SVG 必须以字符串返回').toBe('string');

      const text = rendered as string;
      expect(text).toContain('<svg');
      // 矢量输出的标志：包含真实的图元，而不是嵌入位图
      expect(text).toMatch(/<(path|text|image)\b/);
    } finally {
      page.destroy();
      doc.destroy();
    }
  });

  it('SVG 完全不经过 DPI 缩放（同页产出与 dpi 参数无关）', async () => {
    const { mupdf, doc, loadPage } = await openDocWithPdfPages(ensureRealPaper());
    const page = loadPage(0);
    try {
      const a = (await renderPage(mupdf, page, getPdfRenderProfile('svg'), 72)) as string;
      const b = (await renderPage(mupdf, page, getPdfRenderProfile('svg'), 300)) as string;
      // 矢量路径忽略 dpi：同一次调用产出完全一致的文本
      expect(b).toBe(a);
    } finally {
      page.destroy();
      doc.destroy();
    }
  });
});

describe('多页 PDF 每页都输出对应格式', () => {
  // 位图格式逐页渲染代价较高，这里只取前 3 页，足以证明「逐页」而非「只转首页」。
  const SAMPLE_PAGES = 3;

  for (const format of ['png', 'bmp'] as const) {
    it(`${format} — 多页 PDF 的每一页都产出合法字节`, async () => {
      const { mupdf, doc, pageCount, loadPage } = await openDocWithPdfPages(ensureRealPaper());
      try {
        const profile = getPdfRenderProfile(format);
        const outputs: Uint8Array[] = [];
        const pageTotal = Math.min(SAMPLE_PAGES, pageCount);

        for (let i = 0; i < pageTotal; i += 1) {
          const page = loadPage(i);
          try {
            const rendered = await renderPage(mupdf, page, profile, 150);
            const bytes = typeof rendered === 'string' ? Buffer.from(rendered, 'utf8') : rendered;
            expect(MAGIC[format](bytes), `第 ${i + 1} 页 ${format} 非法`).toBe(true);
            outputs.push(bytes);
          } finally {
            page.destroy();
          }
        }

        expect(outputs).toHaveLength(pageTotal);
        // 各页内容不同 -> 字节不应完全相同（否则说明只渲染了一页）
        expect(new Set(outputs.map((b) => b.length)).size).toBeGreaterThan(1);
      } finally {
        doc.destroy();
      }
    });
  }

  it('多页 SVG 每页都是独立且非空的矢量文档', async () => {
    const { mupdf, doc, pageCount, loadPage } = await openDocWithPdfPages(ensureRealPaper());
    try {
      const profile = getPdfRenderProfile('svg');
      const pageTotal = Math.min(SAMPLE_PAGES, pageCount);
      const seen = new Set<string>();

      for (let i = 0; i < pageTotal; i += 1) {
        const page = loadPage(i);
        try {
          const rendered = (await renderPage(mupdf, page, profile)) as string;
          expect(rendered).toContain('<svg');
          expect(rendered.length).toBeGreaterThan(200);
          seen.add(rendered);
        } finally {
          page.destroy();
        }
      }

      expect(seen.size, '不同页的 SVG 不应完全相同').toBe(pageTotal);
    } finally {
      doc.destroy();
    }
  });
});

describe('单页 PDF 转换', () => {
  it('真实 PDF 派生的单页文档按选定格式转换', async () => {
    const { mupdf, doc, pageCount, loadPage } = await openDocWithPdfPages(singlePagePath);
    try {
      expect(pageCount, '单页样本应恰好 1 页').toBe(1);
      const page = loadPage(0);
      try {
        const rendered = await renderPage(mupdf, page, getPdfRenderProfile('png'), 150);
        const bytes = typeof rendered === 'string' ? Buffer.from(rendered, 'utf8') : rendered;
        expect(MAGIC.png(bytes)).toBe(true);
        expect(bytes.length).toBeGreaterThan(64);
      } finally {
        page.destroy();
      }
    } finally {
      doc.destroy();
    }
  });

  it('单页文档也能输出 SVG 矢量', async () => {
    const { mupdf, doc, loadPage } = await openDocWithPdfPages(singlePagePath);
    try {
      const page = loadPage(0);
      const rendered = await renderPage(mupdf, page, getPdfRenderProfile('svg'));
      expect(typeof rendered).toBe('string');
      expect(rendered as string).toContain('<svg');
      page.destroy();
    } finally {
      doc.destroy();
    }
  });
});

describe('光栅化', () => {
  it('DPI 正确换算尺寸', async () => {
    const { mupdf, doc, loadPage } = await openDocWithPdfPages(ensureRealPaper());
    const page = loadPage(0);
    try {
      const at72 = rasterizePage(mupdf, page, 72);
      const at150 = rasterizePage(mupdf, page, 150);
      const at300 = rasterizePage(mupdf, page, 300);

      expect(at72.width).toBe(612);
      expect(at72.height).toBe(792);
      expect(at150.width).toBe(Math.round(612 * (150 / 72)));
      expect(at300.width).toBeGreaterThan(at150.width);
      expect(at300.height).toBeGreaterThan(at150.height);
    } finally {
      page.destroy();
      doc.destroy();
    }
  });

  it('输出紧密排列的 RGB（3 通道），且内容非全黑', async () => {
    const { mupdf, doc, loadPage } = await openDocWithPdfPages(ensureRealPaper());
    const page = loadPage(0);
    try {
      const pixels = rasterizePage(mupdf, page, 72);
      expect(pixels.channels).toBe(3);
      expect(pixels.data.length).toBe(pixels.width * pixels.height * 3);

      let nonZero = 0;
      for (let i = 0; i < pixels.data.length; i += 997) {
        if (pixels.data[i] !== 0) nonZero += 1;
      }
      expect(nonZero, '页面不应是全黑').toBeGreaterThan(0);
    } finally {
      page.destroy();
      doc.destroy();
    }
  });
});

describe('BMP 编码器（自研 RLE8）', () => {
  /** 纯规范 RLE8 解码器，用于交叉验证编码产物。只依赖 BMP 格式定义。 */
  function decodeRle8(file: Uint8Array) {
    const buf = Buffer.from(file);
    expect(buf.subarray(0, 2).toString('latin1')).toBe('BM');

    const dataOffset = buf.readUInt32LE(10);
    const headerSize = buf.readUInt32LE(14);
    const width = buf.readInt32LE(18);
    const height = buf.readInt32LE(22);
    const bitCount = buf.readUInt16LE(28);
    const compression = buf.readUInt32LE(30);
    const imageSize = buf.readUInt32LE(34);

    expect(bitCount).toBe(8);
    expect(compression).toBe(1); // BI_RLE8
    expect(headerSize).toBe(40); // BITMAPINFOHEADER
    expect(dataOffset + imageSize).toBe(buf.length);
    expect(imageSize % 4).toBe(0); // 像素数据按 4 字节对齐

    const bottomUp = height > 0;
    const rows = Math.abs(height);
    const stream = buf.subarray(dataOffset, dataOffset + imageSize);

    const out = new Uint8Array(width * rows);
    let pos = 0;
    let row = 0;
    let col = 0;
    let sawEob = false;

    while (pos < stream.length && !sawEob) {
      const n = stream[pos];
      const v = stream[pos + 1];
      expect(v, `RLE 流在 ${pos} 处截断`).toBeDefined();

      if (n > 0) {
        // 游程 (count, value)
        for (let k = 0; k < n; k += 1) {
          expect(col + k, '游程越过行宽').toBeLessThan(width);
          out[(bottomUp ? rows - 1 - row : row) * width + col + k] = v;
        }
        col += n;
        pos += 2;
      } else if (v === 0) {
        // EOL：整行必须写满
        expect(col, `第 ${row} 行只写了 ${col}/${width} 像素`).toBe(width);
        row += 1;
        col = 0;
        pos += 2;
      } else if (v === 1) {
        sawEob = true;
        pos += 2;
      } else if (v === 2) {
        pos += 4; // DELTA
      } else {
        // 绝对模式：0/1/2 是保留转义码，n >= 3；本编码器令 n 恒为偶数以消除填充歧义
        expect(v % 2, `绝对模式 n=${v} 应为偶数`).toBe(0);
        expect(v, '绝对模式 n 不得占用保留码 0/1/2').toBeGreaterThanOrEqual(4);
        for (let k = 0; k < v; k += 1) {
          expect(col + k, '绝对段越过行宽').toBeLessThan(width);
          out[(bottomUp ? rows - 1 - row : row) * width + col + k] = stream[pos + 2 + k];
        }
        col += v;
        pos += 2 + v;
      }
    }

    expect(sawEob, 'RLE 流缺少 EOB').toBe(true);
    expect(row, `只解码出 ${row} 行`).toBe(rows);
    return { width, height: rows, indices: out };
  }

  /** 与编码器一致的 6×6×6 量化公式。 */
  const quantize = (v: number) => Math.min(5, ((v * 5 + 127) / 255) | 0);
  const toIndex = (r: number, g: number, b: number) => quantize(r) * 36 + quantize(g) * 6 + quantize(b);

  it('真实 PDF 页面的 BMP 能被规范解码器逐索引还原', async () => {
    const { mupdf, doc, loadPage } = await openDocWithPdfPages(ensureRealPaper());
    const page = loadPage(0);
    try {
      const pixels = rasterizePage(mupdf, page, 72);
      const bmp = encodeBmp(pixels);
      const { width, height, indices } = decodeRle8(bmp);

      expect(width).toBe(pixels.width);
      expect(height).toBe(pixels.height);

      const data = pixels.data;
      const ch = pixels.channels;
      let mismatch = 0;
      let firstBad: string | null = null;
      for (let i = 0; i < width * height; i += 1) {
        const p = i * ch;
        const expected = toIndex(data[p], data[p + 1], data[p + 2]);
        if (indices[i] !== expected) {
          mismatch += 1;
          if (!firstBad) {
            firstBad = `(x=${i % width}, y=${Math.floor(i / width)}): got=${indices[i]} expected=${expected}`;
          }
        }
      }

      expect(firstBad, `首个失配 ${firstBad}`).toBeNull();
      expect(mismatch).toBe(0);
    } finally {
      page.destroy();
      doc.destroy();
    }
  });

  it('全白 / 全黑 / 全异 / 交替四种极端图案都能正确往返', () => {
    const cases: Array<{ name: string; data: Uint8Array; width: number; height: number }> = [
      { name: '全白', width: 37, height: 5, data: new Uint8Array(37 * 5 * 3).fill(255) },
      { name: '全黑', width: 37, height: 5, data: new Uint8Array(37 * 5 * 3) },
      {
        name: '逐像素全异（强制绝对模式）',
        width: 61,
        height: 4,
        data: Uint8Array.from({ length: 61 * 4 * 3 }, (_, i) => (i * 37) % 256),
      },
      {
        name: '黑白交替（游程长度恒为 1）',
        width: 64,
        height: 3,
        data: Uint8Array.from({ length: 64 * 3 * 3 }, (_, i) => (Math.floor(i / 3) % 2) * 255),
      },
    ];

    for (const testCase of cases) {
      const bmp = encodeBmp({
        data: testCase.data,
        width: testCase.width,
        height: testCase.height,
        channels: 3,
      });
      const { width, height, indices } = decodeRle8(bmp);
      expect(width, testCase.name).toBe(testCase.width);
      expect(height, testCase.name).toBe(testCase.height);

      for (let i = 0; i < testCase.width * testCase.height; i += 1) {
        const p = i * 3;
        const expected = toIndex(testCase.data[p], testCase.data[p + 1], testCase.data[p + 2]);
        expect(indices[i], `${testCase.name} 像素 ${i}`).toBe(expected);
      }
    }
  });

  it('RLE8 绝不产生 DELTA（00 02）—— 该码会被解码器当成转义而非 2 像素绝对段', async () => {
    const { mupdf, doc, loadPage } = await openDocWithPdfPages(ensureRealPaper());
    const page = loadPage(0);
    try {
      // 真实页面含大量短游程交替，最容易触发 2 像素绝对段的边界情况
      const pixels = rasterizePage(mupdf, page, 72);
      const bmp = encodeBmp(pixels);
      const buf = Buffer.from(bmp);
      const dataOffset = buf.readUInt32LE(10);
      const imageSize = buf.readUInt32LE(34);
      const stream = buf.subarray(dataOffset, dataOffset + imageSize);

      let pos = 0;
      let deltas = 0;
      while (pos < stream.length) {
        const n = stream[pos];
        const v = stream[pos + 1];
        if (n === 0) {
          if (v === 0 || v === 1) pos += 2;
          else if (v === 2) { deltas += 1; pos += 4; }
          else pos += 2 + v;
        } else {
          pos += 2;
        }
      }
      expect(deltas, `发现 ${deltas} 个 DELTA 段（会让解码器整体错位）`).toBe(0);

      // 结构完整性：解码器会断言每行写满、行数正确、存在 EOB
      expect(() => decodeRle8(bmp), 'RLE 结构损坏').not.toThrow();
    } finally {
      page.destroy();
      doc.destroy();
    }
  });

  it('量化通道数由调用方显式指定，不靠缓冲区长度启发式', () => {
    // 612*792*3 = 1455552 可被 4 整除；若按「长度能否被 4 整除」猜通道，
    // 纯白页面会被误判成 RGBA 而整图错位。
    const width = 8;
    const height = 2;
    const rgb = new Uint8Array(width * height * 3).fill(255);
    expect(rgb.length % 4).toBe(0);

    const { indices } = decodeRle8(encodeBmp({ data: rgb, width, height, channels: 3 }));
    const white = toIndex(255, 255, 255);
    for (let i = 0; i < indices.length; i += 1) expect(indices[i]).toBe(white);
  });

  it('RLE8 输出体积远小于未压缩索引数据', async () => {
    const { mupdf, doc, loadPage } = await openDocWithPdfPages(ensureRealPaper());
    const page = loadPage(0);
    try {
      const pixels = rasterizePage(mupdf, page, 72);
      const bmp = encodeBmp(pixels);
      const rawSize = pixels.width * pixels.height;
      expect(bmp.length, '学术文档以留白为主，RLE8 应显著压缩').toBeLessThan(rawSize);
    } finally {
      page.destroy();
      doc.destroy();
    }
  });
});

describe('sharp 编码路径（WebP / TIFF / GIF）', () => {
  it('三种格式都接受 3 通道原始像素并产出合法字节', async () => {
    const { mupdf, doc, loadPage } = await openDocWithPdfPages(ensureRealPaper());
    const page = loadPage(0);
    try {
      const pixels = rasterizePage(mupdf, page, 72);
      for (const format of ['webp', 'tiff', 'gif'] as const) {
        const bytes = await encodeWithSharp(pixels, format);
        expect(bytes.length, format).toBeGreaterThan(64);
        expect(MAGIC[format](bytes), `${format} magic 不匹配`).toBe(true);
      }
    } finally {
      page.destroy();
      doc.destroy();
    }
  });

  it('sharp 不支持 BMP 输出，因此 BMP 必须走自研编码器', async () => {
    // 能力边界的显式记录：sharp 若将来支持 BMP 输出，可移除自研 RLE8 编码器。
    // 用索引访问是因为 sharp 的 FormatEnum 类型里没有 bmp 键（这正是断言的前提）。
    const sharp = (await import('sharp')).default;
    const formats = sharp.format as unknown as Record<string, { output?: { buffer?: boolean } }>;
    expect(formats.bmp?.output?.buffer, 'sharp 已支持 BMP 输出，可考虑改用 sharp').toBeFalsy();
  });
});

describe('格式档案与渲染实现一一对应', () => {
  it('注册表中每个格式都能真的渲染出对应字节', async () => {
    const { mupdf, doc, loadPage } = await openDocWithPdfPages(ensureRealPaper());
    const page = loadPage(0);
    try {
      for (const profile of listPdfRenderProfiles()) {
        const rendered = await renderPage(mupdf, page, profile, 72);
        const bytes = typeof rendered === 'string' ? Buffer.from(rendered, 'utf8') : rendered;
        expect(
          MAGIC[profile.format](bytes),
          `${profile.format}（扩展名 ${profile.extension}）渲染结果与格式不符`,
        ).toBe(true);
      }
    } finally {
      page.destroy();
      doc.destroy();
    }
  });
});
