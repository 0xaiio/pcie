/** @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildImageFileName,
  buildNoImagesMessage,
  countPagesWithVectorInk,
  extractPdfImages,
  matchCaptionForImage,
  sanitizeCaptionFragment,
} from './pdf-images';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const fixturePath = path.join(repoRoot, 'test', 'resources', 'fixtures', 'image-extraction-fixture.pdf');

/** 真实学术论文 PDF（LaTeX/pdfTeX 产物，图均为矢量）。 */
const realPaperDir = path.join(repoRoot, 'test', 'resources', 'pdf');
const realPaperFile = fs
  .readdirSync(realPaperDir)
  .find((name) => name.toLowerCase().endsWith('.pdf') && name !== 'single-page-sample.pdf');
const realPaperPath = realPaperFile ? path.join(realPaperDir, realPaperFile) : null;

function readFixture() {
  expect(fs.existsSync(fixturePath), 'fixture 必须存在').toBe(true);
  return new Uint8Array(fs.readFileSync(fixturePath));
}

function isPng(bytes: Uint8Array) {
  return (
    bytes.length > 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
  );
}

describe('图注处理', () => {
  it('识别常见图注前缀并剥掉前缀用于文件名', () => {
    expect(sanitizeCaptionFragment('Figure 3. Spree uses an ad hoc transaction.')).toBe(
      'Spree-uses-an-ad-hoc-transaction',
    );
    expect(sanitizeCaptionFragment('Fig. 2. Two flavors of Redis-based locks')).toBe(
      'Two-flavors-of-Redis-based-locks',
    );
    // 句末的方括号引用整体剥掉（学术图注常见写法），只留正文
    expect(sanitizeCaptionFragment('Table 1. Comparison with Feral CC [8]')).toBe(
      'Comparison-with-Feral-CC',
    );
  });

  it('保留中文图注并剥掉文件名非法字符', () => {
    expect(sanitizeCaptionFragment('图 3. 事务协调流程图')).toBe('事务协调流程图');
    expect(sanitizeCaptionFragment('Figure 4. a/b:c*d?e"f<g>h|i')).toBe('a-b-c-d-e-f-g-h-i');
  });

  it('图注为空或撞上保留设备名时回退', () => {
    expect(sanitizeCaptionFragment('Figure 1. ...')).toBe('image');
    expect(sanitizeCaptionFragment('CON')).toBe('image');
    expect(sanitizeCaptionFragment('   ')).toBe('image');
  });

  it('超长图注被截断到 80 字符', () => {
    const long = `Figure 1. ${'x'.repeat(300)}`;
    expect(sanitizeCaptionFragment(long).length).toBeLessThanOrEqual(80);
  });

  it('在一段文本中定位图注', () => {
    const text = 'some body text\nFigure 2. The transaction coordinator\nmore text';
    expect(matchCaptionForImage(text)).toBe('The transaction coordinator');
    expect(matchCaptionForImage('no caption here')).toBeNull();
    expect(matchCaptionForImage('')).toBeNull();
  });

  it('支持中文图注定位', () => {
    expect(matchCaptionForImage('正文\n图 1. 系统架构')).toBe('系统架构');
    expect(matchCaptionForImage('正文\n表 2. 性能对比')).toBe('性能对比');
  });

  it('文件名带页码前缀，同页多图不冲突', () => {
    // 图注前缀在 sanitizeCaptionFragment 里已被剥掉
    expect(buildImageFileName(3, 'Figure 2. The coordinator', 'png')).toBe(
      'page-3-The-coordinator.png',
    );
    // 无图注时用序号区分同一页的多张图
    expect(buildImageFileName(3, null, 'png', 1)).toBe('page-3-image-1.png');
    expect(buildImageFileName(3, null, 'png', 2)).toBe('page-3-image-2.png');
  });
});

describe('多格式图片提取', () => {
  it('提取出 fixture 中全部格式的位图，而不只是 JPEG', async () => {
    const result = await extractPdfImages(readFixture(), 'fixture.pdf');

    expect(result.scannedPages).toBe(3);
    // fixture 第 1 页有 3 张（JPEG / Flate / CCITT），第 3 页有 1 张
    expect(result.images.length).toBeGreaterThanOrEqual(4);
    expect(result.decodeFailures).toBe(0);
  });

  it('每张提取出的图片都是可显示的 PNG 且尺寸正确', async () => {
    const result = await extractPdfImages(readFixture(), 'fixture.pdf');

    for (const image of result.images) {
      expect(isPng(image.bytes), `第 ${image.page} 页图片不是 PNG`).toBe(true);
      expect(image.mimeType).toBe('image/png');
      expect(image.width).toBeGreaterThan(0);
      expect(image.height).toBeGreaterThan(0);
      expect(image.bytes.length).toBeGreaterThan(64);
    }
  });

  it('按图注命名，未匹配时回退到页码 + 序号', async () => {
    const result = await extractPdfImages(readFixture(), 'fixture.pdf');

    for (const image of result.images) {
      expect(image.fileName).toMatch(/^page-\d+[-.a-zA-Z0-9]*\.png$/);
      expect(image.fileName.endsWith('.png')).toBe(true);
      expect(image.captionMatched).toBe(image.caption !== null);
    }
  });

  it('文件名在整份文档内唯一', async () => {
    const result = await extractPdfImages(readFixture(), 'fixture.pdf');
    const names = result.images.map((i) => i.fileName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('记录了每张图所在的页码', async () => {
    const result = await extractPdfImages(readFixture(), 'fixture.pdf');
    for (const image of result.images) {
      expect(image.page).toBeGreaterThanOrEqual(1);
      expect(image.page).toBeLessThanOrEqual(result.scannedPages);
    }
  });
});

describe('矢量文档的正确归因（不是功能故障）', () => {
  it('真实 LaTeX 论文提取不到位图时如实报告，不谎称只支持 JPEG', async () => {
    if (!realPaperPath) return;
    const bytes = new Uint8Array(fs.readFileSync(realPaperPath));

    const result = await extractPdfImages(bytes, 'paper.pdf');
    expect(result.scannedPages).toBe(39);

    // 这篇论文的图全是矢量绘制，因此「提取不到位图」是预期结果
    const { pageCount, pagesWithInk } = await countPagesWithVectorInk(bytes);
    expect(pageCount).toBe(39);
    expect(pagesWithInk).toBeGreaterThan(0);

    const message = await buildNoImagesMessage({ pageCount, pagesWithContent: pagesWithInk });
    expect(message).toContain(String(pageCount));
    // 必须给出可执行的下一步，而不是让用户以为功能坏了
    expect(message).toMatch(/PDF 转图片|SVG|PNG/);
    expect(message).not.toMatch(/only.*JPEG|只支持.*JPEG/i);
  });

  it('空文档给出不同的提示', async () => {
    const empty = await buildNoImagesMessage({ pageCount: 0, pagesWithContent: 0 });
    expect(empty).toContain('没有任何页面');

    const blank = await buildNoImagesMessage({ pageCount: 3, pagesWithContent: 0 });
    expect(blank).toContain('3');
  });
});
