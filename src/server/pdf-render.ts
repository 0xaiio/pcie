/**
 * PDF 渲染的服务端实现：mupdf 负责矢量与光栅化，sharp 负责 WebP / TIFF / GIF。
 *
 * 与 `pdf-render-shared.ts` 分离的原因：本文件含 `import('sharp')` 等 Node-only 依赖，
 * 浏览器端只应依赖共享契约模块，否则 Vite 打包会尝试解析原生模块。
 */
import {
  DEFAULT_RASTER_DPI,
  describeError,
  getPdfRenderProfile,
  type PdfRenderProfile,
} from './pdf-render-shared.ts';

export {
  DEFAULT_PDF_RENDER_FORMAT,
  DEFAULT_RASTER_DPI,
  describeError,
  getPdfRenderProfile,
  normalizePdfRenderFormat,
  PDF_RENDER_FORMATS,
  isPdfRenderFormat,
  listPdfRenderProfiles,
  type PdfRenderFormat,
  type PdfRenderProfile,
} from './pdf-render-shared.ts';

export async function renderPageToSvg(
  mupdf: typeof import('mupdf'),
  page: import('mupdf').PDFPage,
  bounds: [number, number, number, number],
): Promise<string> {
  const outData = new mupdf.Buffer();
  let writer: import('mupdf').DocumentWriter | null = null;
  let device: unknown = null;

  try {
    writer = new mupdf.DocumentWriter(outData, 'svg', '');
    device = writer.beginPage(bounds);
    page.run(device as never, mupdf.Matrix.identity);
    (device as { close(): void }).close();
    writer.endPage();
    writer.close();
    return Buffer.from(outData.asUint8Array()).toString('utf8');
  } finally {
    if (device) (device as { destroy(): void }).destroy();
    if (writer) writer.destroy();
    outData.destroy();
  }
}

/** mupdf 光栅化后取到的原始像素缓冲。 */
export interface RasterPixels {
  data: Uint8Array;
  width: number;
  height: number;
  /** 每个像素的通道数：RGB=3，RGBA=4。 */
  channels: number;
}

/**
 * 把一页光栅化为原始像素（紧密排列的 RGB）。
 *
 * 必须 alpha=false：mupdf 的 Node 绑定在 alpha=true 时 `getPixels()` 只会返回
 * 全 0 的缓冲区（alpha 通道未被回填），实测首行 612 像素全为 0。
 */
export function rasterizePage(
  mupdf: typeof import('mupdf'),
  page: import('mupdf').PDFPage,
  dpi: number = DEFAULT_RASTER_DPI,
): RasterPixels {
  const scale = dpi / 72;
  const matrix = mupdf.Matrix.scale(scale, scale);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);

  try {
    const width = pixmap.getWidth();
    const height = pixmap.getHeight();
    const stride = pixmap.getStride();
    const pixels = pixmap.getPixels();
    // alpha=false 时 pixmap 为紧密排列的 RGB，stride = width * 3
    const bytesPerPixel = 3;
    const rowBytes = width * bytesPerPixel;

    const data = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y += 1) {
      const srcStart = y * stride;
      const copyLength = Math.min(rowBytes, Math.max(0, pixels.length - srcStart));
      if (copyLength <= 0) break;
      data.set(pixels.subarray(srcStart, srcStart + copyLength), y * rowBytes);
    }

    return { data, width, height, channels: bytesPerPixel };
  } finally {
    pixmap.destroy();
  }
}

/**
 * 用 mupdf 直接编码 PNG / JPEG。
 *
 * 这两种格式 mupdf 原生支持，无需引入 sharp，可减少一次编解码开销。
 * 返回 `null` 表示该格式不走这条路，由调用方回退到通用编码器。
 */
export function encodeWithMupdf(
  mupdf: typeof import('mupdf'),
  page: import('mupdf').PDFPage,
  format: 'png' | 'jpeg',
  dpi: number = DEFAULT_RASTER_DPI,
): Uint8Array | null {
  // JPEG 不支持 alpha；PNG 保留 alpha 以支持透明背景。
  const withAlpha = format === 'png';
  const scale = dpi / 72;
  const matrix = mupdf.Matrix.scale(scale, scale);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, withAlpha, false);

  try {
    const bytes = format === 'png' ? pixmap.asPNG() : pixmap.asJPEG(90, false);
    return new Uint8Array(bytes);
  } catch (error) {
    console.error(`mupdf failed to encode ${format}:`, describeError(error));
    return null;
  } finally {
    pixmap.destroy();
  }
}

/**
 * 用 sharp（libvips）把原始像素编码为 WebP / TIFF / GIF。
 *
 * sharp 不支持 BMP 输出，故 BMP 由 {@link encodeBmp} 处理。
 */
export async function encodeWithSharp(
  pixels: RasterPixels,
  format: 'webp' | 'tiff' | 'gif',
): Promise<Uint8Array> {
  const { default: sharp } = await import('sharp');

  let pipeline = sharp(Buffer.from(pixels.data), {
    raw: {
      width: pixels.width,
      height: pixels.height,
      channels: pixels.channels as 3 | 4,
    },
  }).toFormat(format);

  if (format === 'webp') {
    pipeline = pipeline.webp({ quality: 90 });
  } else if (format === 'gif') {
    pipeline = pipeline.gif({ effort: 4 });
  } else {
    pipeline = pipeline.tiff({ compression: 'deflate' });
  }

  const buffer = await pipeline.toBuffer();
  return new Uint8Array(buffer);
}

/**
 * 编码 8 位调色板索引的 BMP（`BI_RLE8`）。
 *
 * 采用 RLE8 压缩而非裸 `BI_RGB`：300 DPI 下 A4 一页约 2550×3300 px，
 * 未压缩索引数据每页接近 8.4 MB，39 页论文的 base64 响应会超出 V8 的单字符串上限。
 * 学术文档以文本和留白为主，RLE8 对连续同色区域（留白）的压缩比通常在数十倍量级。
 *
 * @param pixels 必须显式带上 `channels`：不能靠「缓冲区长度能否被 4 整除」反推通道数，
 *   因为 612×792 的 RGB 缓冲区长度恰好被 4 整除，纯白页面上启发式会误判成 RGBA 并整图错位。
 */
export function encodeBmp(pixels: RasterPixels): Uint8Array {
  const { data, width, height } = pixels;
  const indices = quantizeToPalette(data, pixels.channels);
  const rleData = encodeRle8(indices, width, height);

  const fileHeaderSize = 14;
  const infoHeaderSize = 40;
  const paletteEntries = 256;
  const paletteSize = paletteEntries * 4;
  const headerSize = fileHeaderSize + infoHeaderSize + paletteSize;
  const pixelDataSize = rleData.length;
  const fileSize = headerSize + pixelDataSize;

  const out = Buffer.alloc(fileSize);
  out.write('BM', 0, 'latin1');
  out.writeUInt32LE(fileSize, 2);
  out.writeUInt32LE(0, 6); // 保留字段
  out.writeUInt32LE(headerSize, 10);

  // BITMAPINFOHEADER
  out.writeUInt32LE(infoHeaderSize, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22); // 正数表示自下而上存储
  out.writeUInt16LE(1, 26); // 色平面数
  out.writeUInt16LE(8, 28); // 每像素位数：调色板索引
  out.writeUInt32LE(1, 30); // BI_RLE8
  out.writeUInt32LE(pixelDataSize, 34);
  out.writeInt32LE(2835, 38); // 水平分辨率 72 DPI
  out.writeInt32LE(2835, 42); // 垂直分辨率 72 DPI
  out.writeUInt32LE(paletteEntries, 46); // 调色板条目数
  out.writeUInt32LE(paletteEntries, 50); // 重要颜色数

  // 调色板：BGR + 保留字节，按量化得到的颜色写入
  for (let i = 0; i < paletteEntries; i += 1) {
    const base = fileHeaderSize + infoHeaderSize + i * 4;
    out[base] = PALETTE[i * 3 + 2];
    out[base + 1] = PALETTE[i * 3 + 1];
    out[base + 2] = PALETTE[i * 3];
    out[base + 3] = 0;
  }

  Buffer.from(rleData.buffer, rleData.byteOffset, rleData.byteLength).copy(
    out,
    headerSize,
  );

  return new Uint8Array(out);
}

/**
 * 固定 6×6×6 颜色立方体量化。
 *
 * BMP 的调色板索引是 8 位。216 色立方体（6 级 × 3 通道）可用 `index = 36r + 6g + b`
 * 直接查表映射任意 RGB，无需逐像素最近邻搜索——这让量化在大图上比 k-d 树 / 中位切
 * 快几个数量级。216 < 256，多出的槽位留作占位。
 */
const CUBE_STEPS = 6;
const CUBE_MAX = CUBE_STEPS - 1;

function buildPalette(): Uint8Array {
  const palette = new Uint8Array(256 * 3);
  const toByte = (v: number) => Math.round((v * 255) / CUBE_MAX);
  for (let r = 0; r < CUBE_STEPS; r += 1) {
    for (let g = 0; g < CUBE_STEPS; g += 1) {
      for (let b = 0; b < CUBE_STEPS; b += 1) {
        const index = r * CUBE_STEPS * CUBE_STEPS + g * CUBE_STEPS + b;
        palette[index * 3] = toByte(r);
        palette[index * 3 + 1] = toByte(g);
        palette[index * 3 + 2] = toByte(b);
      }
    }
  }
  return palette;
}

/** 量化调色表（BGR，每 3 字节一色）。模块加载时构建一次，之后只读。 */
const PALETTE: Uint8Array = buildPalette();

/**
 * 把 RGB(A) 像素量化成 8 位调色板索引。
 *
 * 用整数四舍五入代替移位：`255 >> 6` 只映射到 4 级而丢掉 6 级色深。
 *
 * 通道数必须由调用方显式传入。这里刻意**不做**启发式探测（如「长度能否被 4 整除」
 * 或「每隔 4 字节是否恒为 255」）：612×792×3 = 1455552 能被 4 整除，而学术论文
 * 页面大片留白（255,255,255）会让「每隔 4 字节」恒等于 255，两种启发式都会把纯 RGB
 * 缓冲区误判成 RGBA，导致整幅图像错位。
 */
function quantizeToPalette(rgba: Uint8Array, channels: number): Uint8Array {
  const count = Math.floor(rgba.length / channels);
  const indices = new Uint8Array(count);

  for (let i = 0; i < count; i += 1) {
    const p = i * channels;
    const r = Math.min(CUBE_MAX, ((rgba[p] * CUBE_MAX + 127) / 255) | 0);
    const g = Math.min(CUBE_MAX, ((rgba[p + 1] * CUBE_MAX + 127) / 255) | 0);
    const b = Math.min(CUBE_MAX, ((rgba[p + 2] * CUBE_MAX + 127) / 255) | 0);
    indices[i] = r * CUBE_STEPS * CUBE_STEPS + g * CUBE_STEPS + b;
  }

  return indices;
}

/**
 * BMP RLE8 编码。
 *
 * 编码规则：`(count>0, value)` 表示 count 个连续相同像素；`count === 0` 为转义序列，
 * 其中 `(0, 0)` = 行结束、`(0, 1)` = 位图结束、`(0, 2, dx, dy)` = 跳过 dx 列 dy 行，
 * `n >= 3` 时为绝对模式（后跟 n 个字面像素字节）。
 *
 * 关键约束：`0/1/2` 三个转义值都是保留码，绝对模式最小长度为 4（见 {@link pushAbsolute}）。
 * 每行编码后按 2 字节对齐，整块按 4 字节对齐。
 */
function encodeRle8(indices: Uint8Array, width: number, height: number): Uint8Array {
  const out: number[] = [];

  /** 写一个游程段：`(count, value)`，count 上限 255。 */
  const pushRun = (count: number, value: number) => {
    let remaining = count;
    while (remaining > 0) {
      const chunk = Math.min(remaining, 255);
      out.push(chunk, value);
      remaining -= chunk;
    }
  };

  /**
   * 写一个绝对模式段，编码为 `0x00, n, <n 个像素字节>`。
   *
   * 三个必须遵守的约束：
   *
   * 1. **n 必须为偶数**。RLE8 要求每段结束在 WORD（2 字节）边界上，段总长为
   *    `n + 2`，所以奇数 n 要补一个填充字节。为什么不按规范补填充：不同解码器
   *    对填充的判定基准不一致——部分按 RLE 流起点算，部分按文件内绝对偏移算，
   *    还存在「读完数据后再补」的顺序差异。实测 Pillow 采用后者，会在奇数 n 的
   *    段后多跳过一个字节，把下一段头读成 EOB。令 n 恒为偶数使两种解释完全一致。
   *
   * 2. **n 不能是 0、1、2**。`00 00` = EOL、`00 01` = EOB、`00 02 dx dy` = DELTA，
   *    三者都是保留转义码。绝对模式只在 `n >= 3` 时成立；叠加偶数约束后，
   *    **最小可用长度是 4**。（这条是真实踩过的坑：写 `00 02` 表示 2 个字面像素时，
   *    解码器一律当成 DELTA 并跳过 4 字节，整条流从该处起全部错位。）
   *
   * 3. **n 上限 254**，留 255 不用以免与「奇数需补齐」的边界纠缠。
   *
   * 长度不足 4 的尾巴用游程表示：`count=1, value` 占 2 字节，与绝对模式等价
   * 且不占用任何保留码。
   */
  const pushAbsolute = (rowStart: number, start: number, length: number) => {
    let done = 0;

    while (length - done >= 4) {
      const remaining = length - done;
      // 取不超过 remaining 的最大偶数，且 <= 254
      let chunk = remaining >= 254 ? 254 : remaining - (remaining % 2);
      // 截断到 254 后若只剩 1~3 个像素（不足绝对模式最小长度），退回 2 像素，
      // 让尾巴全部由下方的游程兜底
      if (chunk > 0 && remaining - chunk > 0 && remaining - chunk < 4) chunk -= 2;

      if (chunk < 4) break;

      out.push(0, chunk);
      for (let i = 0; i < chunk; i += 1) {
        out.push(indices[rowStart + start + done + i]);
      }
      done += chunk;
    }

    // 尾部剩下的 0~3 个像素用游程表示（count=1 占 2 字节，与绝对模式等价）
    while (done < length) {
      out.push(1, indices[rowStart + start + done]);
      done += 1;
    }
  };

  // BMP 图像自下而上存储，逐行倒序写出
  for (let y = height - 1; y >= 0; y -= 1) {
    const rowStart = y * width;
    let x = 0;

    while (x < width) {
      const value = indices[rowStart + x];
      let runLength = 1;
      while (x + runLength < width && indices[rowStart + x + runLength] === value) {
        runLength += 1;
      }

      if (runLength >= 3) {
        pushRun(runLength, value);
        x += runLength;
        continue;
      }

      // 绝对模式：吞掉后续所有长度不足 3 的短段
      const absoluteStart = x;
      while (x < width) {
        const current = indices[rowStart + x];
        let run = 1;
        while (x + run < width && indices[rowStart + x + run] === current) {
          run += 1;
        }
        if (run >= 3) break;
        x += run;
      }
      pushAbsolute(rowStart, absoluteStart, x - absoluteStart);
    }

    out.push(0, 0); // EOL：行结束
  }

  out.push(0, 1); // EOB：位图结束

  // RLE 数据块整体需按 4 字节对齐
  while (out.length % 4 !== 0) out.push(0);

  return new Uint8Array(out);
}

/**
 * 按目标格式把一页渲染为字节数据。
 *
 * SVG 返回 UTF-8 文本；其余格式返回二进制字节。
 */
export async function renderPage(
  mupdf: typeof import('mupdf'),
  page: import('mupdf').PDFPage,
  profile: PdfRenderProfile,
  dpi: number = DEFAULT_RASTER_DPI,
): Promise<Uint8Array | string> {
  if (profile.vector) {
    const bounds = page.getBounds();
    const safeBounds: [number, number, number, number] = Array.isArray(bounds) && bounds.length === 4
      ? (bounds as [number, number, number, number])
      : [0, 0, 595, 842];
    return renderPageToSvg(mupdf, page, safeBounds);
  }

  if (profile.format === 'png' || profile.format === 'jpeg' || profile.format === 'jpg') {
    const native = encodeWithMupdf(mupdf, page, profile.format === 'png' ? 'png' : 'jpeg', dpi);
    if (native) return native;
  }

  const pixels = rasterizePage(mupdf, page, dpi);

  if (profile.format === 'bmp') {
    return encodeBmp(pixels);
  }

  if (profile.format === 'webp' || profile.format === 'tiff' || profile.format === 'gif') {
    return encodeWithSharp(pixels, profile.format);
  }

  throw new Error(`Unsupported render format: ${profile.format}`);
}
