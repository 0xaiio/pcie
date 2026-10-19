/**
 * 生成用于「多格式图片提取」测试的 PDF 夹具。
 *
 * 夹具覆盖以下真实编码路径：
 *  - DCTDecode       : JPEG 直接嵌入（原样保留字节，最常见的学术论文插图路径）
 *  - FlateDecode     : 无损压缩的 DeviceRGB 位图（LaTeX/pgf 输出常见）
 *  - CCITTFaxDecode  : 传真黑白位图（扫描件类论文常见）
 *  - 内联图像 (BI/ID/EI) : 不走 XObject，直接躺在内容流里
 *
 * 每幅图下方紧跟一行 "Figure N. ..." 题注，用于验证 caption 命名。
 *
 * 内容流为手写原始流（不经过 pdf-lib 运算符封装），以便精确控制 BI/ID/EI
 * 内联图像与 XObject 绘制指令的排布。
 *
 * 运行：node scripts/fixtures/build-image-extraction-fixture.mjs
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(repoRoot, 'test', 'resources', 'fixtures');
const outPath = path.join(outDir, 'image-extraction-fixture.pdf');

const IMAGE_WIDTH = 64;
const IMAGE_HEIGHT = 48;

/** PDF 字符串字面量转义（仅覆盖 WinAnsi 基本可打印范围）。 */
function pdfString(text) {
  return `(${text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

/** 生成带渐变的 RGB 位图原始数据。 */
function makeRgbBitmap(width, height) {
  const bytes = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      bytes[offset] = Math.floor((x / Math.max(width - 1, 1)) * 255);
      bytes[offset + 1] = Math.floor((y / Math.max(height - 1, 1)) * 255);
      bytes[offset + 2] = 128;
    }
  }
  return bytes;
}

/** 生成 1 位黑白位图（CCITT 编码的前提）。 */
function makeOneBitBitmap(width, height) {
  const rowBytes = Math.ceil(width / 8);
  const bytes = Buffer.alloc(rowBytes * height, 0x00);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // 棋盘格，确保不是全白常量块，便于断言尺寸与解码成功
      if ((x + y) % 2 === 0) {
        bytes[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return bytes;
}

/**
 * 生成一张**真实合法**的 baseline JPEG。
 * 手拼 JPEG 容易出现非法标记，改为用 mupdf 从位图编码，保证夹具可被解码器无警告消费。
 */
async function makeRealJpeg(width, height) {
  const mupdf = await import('mupdf');
  const rgbBytes = makeRgbBitmap(width, height);
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false);
  try {
    const pixels = pixmap.getPixels();
    for (let i = 0; i < width * height; i += 1) {
      pixels[i * 3 + 0] = rgbBytes[i * 3 + 0];
      pixels[i * 3 + 1] = rgbBytes[i * 3 + 1];
      pixels[i * 3 + 2] = rgbBytes[i * 3 + 2];
    }
    return Buffer.from(pixmap.asJPEG(85));
  } finally {
    pixmap.destroy();
  }
}

/** 生成可被 zlib 有效压缩的 RGB 位图（用于需要 deflate 长度收敛的内联图像）。 */
function makeCompressibleRgbBitmap(width, height) {
  const bytes = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const band = ((x >> 3) + (y >> 3)) % 2 === 0 ? 220 : 40;
      bytes[offset] = band;
      bytes[offset + 1] = band;
      bytes[offset + 2] = band;
    }
  }
  return bytes;
}

/** 构造带指定 /Filter 与原始字节的图像流。 */
function addRawImageStream(pdfDoc, dict, rawBytes) {
  return pdfDoc.context.register(PDFRawStream.of(pdfDoc.context.obj(dict), rawBytes));
}

/** 标准 14 号字体资源，供内容流中的 Tj 使用。 */
function baseFontResources() {
  return {
    F1: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' },
    F2: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica-Bold', Encoding: 'WinAnsiEncoding' },
  };
}

/** 用原始内容流覆写页面，返回该页。content 支持字符串或 Buffer。 */
function writeRawPage(pdfDoc, content, resources) {
  const page = pdfDoc.addPage([595, 842]);
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'latin1');
  const streamRef = pdfDoc.context.register(PDFRawStream.of(pdfDoc.context.obj({}), body));
  page.node.set(PDFName.of('Contents'), pdfDoc.context.obj([streamRef]));
  page.node.set(PDFName.of('Resources'), pdfDoc.context.obj(resources));
  return page;
}

function textOp(font, size, x, y, text) {
  return `BT /${font} ${size} Tf ${x} ${y} Td ${pdfString(text)} Tj ET\n`;
}

function drawXObjectOp(name, x, y, width, height) {
  return `q ${width} 0 0 ${height} ${x} ${y} cm /${name} Do Q\n`;
}

async function build() {
  fs.mkdirSync(outDir, { recursive: true });

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle('Image extraction fixture');
  pdfDoc.setProducer('pcie-test-fixtures');
  // 关闭对象流，保证图像字典在文件里是裸字典，便于断言与排查
  pdfDoc.catalog.context.delete(PDFName.of('ObjStmCompressed'));

  // ---- 1. DCTDecode：JPEG 原样嵌入 ----
  const jpegRef = addRawImageStream(
    pdfDoc,
    {
      Type: 'XObject',
      Subtype: 'Image',
      Width: IMAGE_WIDTH,
      Height: IMAGE_HEIGHT,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
      Filter: 'DCTDecode',
    },
    await makeRealJpeg(IMAGE_WIDTH, IMAGE_HEIGHT),
  );

  // ---- 2. FlateDecode：DeviceRGB 位图 ----
  const flateRef = addRawImageStream(
    pdfDoc,
    {
      Type: 'XObject',
      Subtype: 'Image',
      Width: IMAGE_WIDTH,
      Height: IMAGE_HEIGHT,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
      Filter: 'FlateDecode',
    },
    zlib.deflateSync(makeRgbBitmap(IMAGE_WIDTH, IMAGE_HEIGHT)),
  );

  // ---- 3. CCITTFaxDecode：1 位黑白位图 ----
  const ccittRef = addRawImageStream(
    pdfDoc,
    {
      Type: 'XObject',
      Subtype: 'Image',
      Width: IMAGE_WIDTH,
      Height: IMAGE_HEIGHT,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 1,
      Filter: 'CCITTFaxDecode',
      DecodeParms: { K: -1, Columns: IMAGE_WIDTH, Rows: IMAGE_HEIGHT, BlackIs1: true },
    },
    makeOneBitBitmap(IMAGE_WIDTH, IMAGE_HEIGHT),
  );

  // ---- 第 1 页：三种滤镜的 XObject，各自带 caption ----
  writeRawPage(
    pdfDoc,
    textOp('F2', 18, 72, 800, 'Multi-format image fixture')
      + drawXObjectOp('ImJpeg', 72, 740, IMAGE_WIDTH, IMAGE_HEIGHT)
      + textOp('F1', 10, 72, 715, 'Figure 1. JPEG encoded chart embedded with DCTDecode.')
      + drawXObjectOp('ImFlate', 72, 620, IMAGE_WIDTH, IMAGE_HEIGHT)
      + textOp('F1', 10, 72, 595, 'Figure 2. Lossless gradient stored with FlateDecode.')
      + drawXObjectOp('ImCcitt', 72, 500, IMAGE_WIDTH, IMAGE_HEIGHT)
      + textOp('F1', 10, 72, 475, 'Figure 3. Checkerboard scan stored with CCITTFaxDecode.'),
    {
      Font: baseFontResources(),
      XObject: { ImJpeg: jpegRef, ImFlate: flateRef, ImCcitt: ccittRef },
    },
  );

  // ---- 第 2 页：内联图像（BI/ID/EI，直接位于内容流） ----
  // 使用无滤镜的原始字节内联图：mupdf 的 AHx 十六进制解码器对本长度不敏感，
  // 原始字节路径能精确产出 /W /H 声明的像素数，也更贴近 LaTeX 的实际产物
  const inlineRaw = makeCompressibleRgbBitmap(32, 24);
  const inlineHead = Buffer.from(
    'q 64 0 0 48 72 700 cm\n'
    + 'BI /W 32 /H 24 /CS /RGB /BPC 8 ID\n',
    'latin1',
  );
  const inlineTail = Buffer.from(
    '\nEI\nQ\n'
    + textOp('F2', 18, 72, 800, 'Inline image fixture')
    + textOp('F1', 10, 72, 675, 'Figure 4. Inline image written with BI and ID operators.'),
    'latin1',
  );
  writeRawPage(
    pdfDoc,
    Buffer.concat([inlineHead, inlineRaw, inlineTail]),
    { Font: baseFontResources() },
  );

  // ---- 第 3 页：一幅无 caption 的图 + 普通正文，验证回退命名 ----
  writeRawPage(
    pdfDoc,
    textOp('F2', 18, 72, 800, 'Uncaptioned image fixture')
      + drawXObjectOp('ImFlate', 72, 700, IMAGE_WIDTH, IMAGE_HEIGHT)
      + textOp('F1', 10, 72, 660, 'This paragraph is ordinary body text, not a caption line.'),
    {
      Font: baseFontResources(),
      XObject: { ImFlate: flateRef },
    },
  );

  const bytes = await pdfDoc.save({ useObjectStreams: false });
  fs.writeFileSync(outPath, bytes);
  console.log(`wrote ${outPath} (${bytes.length} bytes)`);
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
