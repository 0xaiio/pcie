/**
 * PDF → 图片渲染：按目标格式输出矢量 SVG 或位图。
 *
 * 本模块是**纯数据契约**，浏览器端与服务端共用。
 * 渲染实现（mupdf / sharp / 自研 BMP 编码）放在 `pdf-render.ts`，
 * 因为那个文件含 Node-only 依赖，浏览器端不能 import。
 *
 * 格式能力边界（实测，勿凭猜测改动）：
 * - mupdf `DocumentWriter` 仅支持 svg / png / pam / pnm / pbm / pgm / ppm / jpeg，
 *   **不支持** webp / bmp / tiff / gif；`Pixmap` 也只有 asPNG / asJPEG / asPAM / asPSD。
 * - 因此 WebP / TIFF / GIF 交给 sharp（libvips）编码；BMP 由服务端自研 RLE8 编码器处理。
 *
 * SVG 必须走 `DocumentWriter` 的矢量路径，不能先光栅化再转换，否则会丢失矢量特性。
 */

export type PdfRenderFormat =
  | 'svg'
  | 'png'
  | 'jpg'
  | 'jpeg'
  | 'webp'
  | 'bmp'
  | 'tiff'
  | 'gif';

export interface PdfRenderProfile {
  /** 规范化后的格式标识。 */
  format: PdfRenderFormat;
  /** 落盘扩展名（不含点）。 */
  extension: string;
  /** 浏览器端构造 Blob 使用的 MIME。 */
  mimeType: string;
  /** 是否为矢量输出；矢量格式不经过光栅化。 */
  vector: boolean;
  /** 下拉菜单中的展示名。 */
  label: string;
}

/** 支持的目标格式。SVG 排在首位，且是默认行为。 */
export const PDF_RENDER_FORMATS: readonly PdfRenderFormat[] = [
  'svg',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'bmp',
  'tiff',
  'gif',
] as const;

/** 默认格式：保留既有的多页 PDF → SVG 矢量行为。 */
export const DEFAULT_PDF_RENDER_FORMAT: PdfRenderFormat = 'svg';

const PROFILES: Record<PdfRenderFormat, PdfRenderProfile> = {
  svg: {
    format: 'svg',
    extension: 'svg',
    mimeType: 'image/svg+xml',
    vector: true,
    label: 'SVG (vector)',
  },
  png: {
    format: 'png',
    extension: 'png',
    mimeType: 'image/png',
    vector: false,
    label: 'PNG',
  },
  jpg: {
    format: 'jpg',
    extension: 'jpg',
    mimeType: 'image/jpeg',
    vector: false,
    label: 'JPG',
  },
  jpeg: {
    format: 'jpeg',
    extension: 'jpeg',
    mimeType: 'image/jpeg',
    vector: false,
    label: 'JPEG',
  },
  webp: {
    format: 'webp',
    extension: 'webp',
    mimeType: 'image/webp',
    vector: false,
    label: 'WebP',
  },
  bmp: {
    format: 'bmp',
    extension: 'bmp',
    mimeType: 'image/bmp',
    vector: false,
    label: 'BMP',
  },
  tiff: {
    format: 'tiff',
    extension: 'tif',
    mimeType: 'image/tiff',
    vector: false,
    label: 'TIFF',
  },
  gif: {
    format: 'gif',
    extension: 'gif',
    mimeType: 'image/gif',
    vector: false,
    label: 'GIF',
  },
};

/** 供 UI 渲染下拉菜单使用。 */
export function listPdfRenderProfiles(): PdfRenderProfile[] {
  return PDF_RENDER_FORMATS.map((format) => PROFILES[format]);
}

/** 判断一个字符串是否是受支持的格式（大小写不敏感，允许 `tif` 等常见别名）。 */
export function isPdfRenderFormat(value: unknown): value is PdfRenderFormat {
  return typeof value === 'string' && normalizePdfRenderFormat(value) !== null;
}

const ALIASES: Record<string, PdfRenderFormat> = {
  svg: 'svg',
  svgz: 'svg',
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpeg',
  jpe: 'jpeg',
  jfif: 'jpeg',
  webp: 'webp',
  bmp: 'bmp',
  dib: 'bmp',
  tiff: 'tiff',
  tif: 'tiff',
  gif: 'gif',
};

/**
 * 把用户输入规范化成受支持的格式；无法识别时返回 `null`。
 *
 * 服务端不可用别名收敛到同一个规范格式（如 `tif` → `tiff`），
 * 但 `jpg` 与 `jpeg` 保持区分——它们是用户可见的两个独立选项。
 */
export function normalizePdfRenderFormat(value: unknown): PdfRenderFormat | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/^\./, '');
  if (!key) return null;
  return ALIASES[key] ?? null;
}

/** 取格式档案；未知格式回退到默认 SVG，避免转换中断。 */
export function getPdfRenderProfile(value: unknown): PdfRenderProfile {
  return PROFILES[normalizePdfRenderFormat(value) ?? DEFAULT_PDF_RENDER_FORMAT];
}

/** 光栅化 DPI；300 与既有 PNG 路径保持一致，足以打印级输出。 */
export const DEFAULT_RASTER_DPI = 300;

/** 把任意异常转成可读字符串，供日志与错误提示使用。 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
