/** @vitest-environment node */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PDF_RENDER_FORMAT,
  DEFAULT_RASTER_DPI,
  getPdfRenderProfile,
  isPdfRenderFormat,
  listPdfRenderProfiles,
  normalizePdfRenderFormat,
  PDF_RENDER_FORMATS,
} from './pdf-render-shared';

describe('PDF 渲染格式注册表', () => {
  it('默认格式是 SVG，保留既有的多页 PDF → 矢量图行为', () => {
    expect(DEFAULT_PDF_RENDER_FORMAT).toBe('svg');
    expect(PDF_RENDER_FORMATS[0]).toBe('svg');
    expect(getPdfRenderProfile(undefined).format).toBe('svg');
    expect(getPdfRenderProfile('').format).toBe('svg');
  });

  it('至少覆盖 PNG / JPG / JPEG / SVG，并补齐常见位图格式', () => {
    // 任务明确要求的四种
    for (const required of ['svg', 'png', 'jpg', 'jpeg'] as const) {
      expect(PDF_RENDER_FORMATS).toContain(required);
    }
    // 任务点名「补充其他最常见图片格式」
    for (const extra of ['webp', 'bmp', 'tiff', 'gif'] as const) {
      expect(PDF_RENDER_FORMATS).toContain(extra);
    }
  });

  it('每个格式都有可用的扩展名与 MIME，且扩展名不重复', () => {
    const seenExtensions = new Set<string>();
    for (const profile of listPdfRenderProfiles()) {
      expect(profile.extension, `${profile.format} 缺少扩展名`).toBeTruthy();
      expect(profile.mimeType, `${profile.format} 缺少 MIME`).toBeTruthy();
      expect(profile.label, `${profile.format} 缺少展示名`).toBeTruthy();
      expect(profile.extension).not.toMatch(/^\./);
      expect(seenExtensions.has(profile.extension), `${profile.format} 扩展名重复`).toBe(false);
      seenExtensions.add(profile.extension);
    }
  });

  it('JPG 与 JPEG 共用 image/jpeg 但保留各自扩展名', () => {
    const jpg = getPdfRenderProfile('jpg');
    const jpeg = getPdfRenderProfile('jpeg');
    expect(jpg.mimeType).toBe('image/jpeg');
    expect(jpeg.mimeType).toBe('image/jpeg');
    expect(jpg.extension).toBe('jpg');
    expect(jpeg.extension).toBe('jpeg');
  });

  it('TIFF 落盘扩展名为 tif，MIME 为 image/tiff', () => {
    const tiff = getPdfRenderProfile('tiff');
    expect(tiff.extension).toBe('tif');
    expect(tiff.mimeType).toBe('image/tiff');
  });

  it('只有 SVG 标记为矢量输出', () => {
    const vector = listPdfRenderProfiles().filter((p) => p.vector).map((p) => p.format);
    expect(vector).toEqual(['svg']);
  });
});

describe('格式名规范化', () => {
  it('大小写与前后空格不敏感', () => {
    expect(normalizePdfRenderFormat('  PNG ')).toBe('png');
    expect(normalizePdfRenderFormat('JpEg')).toBe('jpeg');
    expect(normalizePdfRenderFormat('SVG')).toBe('svg');
  });

  it('接受常见别名', () => {
    expect(normalizePdfRenderFormat('tif')).toBe('tiff');
    expect(normalizePdfRenderFormat('TIF')).toBe('tiff');
    expect(normalizePdfRenderFormat('jpe')).toBe('jpeg');
    expect(normalizePdfRenderFormat('jfif')).toBe('jpeg');
    expect(normalizePdfRenderFormat('dib')).toBe('bmp');
  });

  it('接受带前导点的写法（从文件名推断格式时会带入）', () => {
    expect(normalizePdfRenderFormat('.png')).toBe('png');
    expect(normalizePdfRenderFormat('.tiff')).toBe('tiff');
  });

  it('无法识别时返回 null', () => {
    expect(normalizePdfRenderFormat('tga')).toBeNull();
    expect(normalizePdfRenderFormat('not-a-format')).toBeNull();
    expect(normalizePdfRenderFormat('')).toBeNull();
    expect(normalizePdfRenderFormat('   ')).toBeNull();
    expect(normalizePdfRenderFormat(undefined)).toBeNull();
    expect(normalizePdfRenderFormat(null)).toBeNull();
    expect(normalizePdfRenderFormat(42)).toBeNull();
    expect(normalizePdfRenderFormat({})).toBeNull();
  });

  it('isPdfRenderFormat 与 normalize 结果一致', () => {
    expect(isPdfRenderFormat('png')).toBe(true);
    expect(isPdfRenderFormat('TIF')).toBe(true);
    expect(isPdfRenderFormat('.gif')).toBe(true);
    expect(isPdfRenderFormat('tga')).toBe(false);
    expect(isPdfRenderFormat(undefined)).toBe(false);
  });
});

describe('未知格式的回退策略', () => {
  it('回退到 SVG 而不是抛错，保证转换流程不中断', () => {
    for (const bad of ['tga', 'nope', '', '   ', null, undefined, 0, {}]) {
      const profile = getPdfRenderProfile(bad);
      expect(profile.format, `${String(bad)} 应回退到 svg`).toBe('svg');
      expect(profile.vector).toBe(true);
      expect(profile.mimeType).toBe('image/svg+xml');
    }
  });

  it('回退不会修改调用方传入的注册表', () => {
    const before = [...PDF_RENDER_FORMATS];
    getPdfRenderProfile('garbage');
    expect(PDF_RENDER_FORMATS).toEqual(before);
  });
});

describe('光栅化参数', () => {
  it('默认 300 DPI，打印级输出', () => {
    expect(DEFAULT_RASTER_DPI).toBe(300);
  });
});
