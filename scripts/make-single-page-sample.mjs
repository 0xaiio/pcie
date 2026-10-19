/**
 * 从真实学术论文 PDF 抽出第 1 页，生成单页测试样本。
 *
 * 单页路径与多页路径在服务端是同一段代码，但用户明确要求覆盖「单页 PDF 转换」，
 * 因此需要一份真正只有 1 页的 PDF。用 mupdf 的 PDFDocument 复制而非重新排版，
 * 保证样本仍是真实论文内容（含矢量文字），而不是人造的空白页。
 *
 * 幂等：样本已存在且仍为单页时直接跳过。
 *
 * 运行：node --experimental-strip-types scripts/make-single-page-sample.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mupdf from 'mupdf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const pdfDir = path.join(repoRoot, 'test', 'resources', 'pdf');
const sourceName = fs
  .readdirSync(pdfDir)
  .find((name) => name.toLowerCase().endsWith('.pdf') && name !== 'single-page-sample.pdf');

if (!sourceName) {
  console.error('test/resources/pdf 下没有可用的真实 PDF');
  process.exit(1);
}

const sourcePath = path.join(pdfDir, sourceName);
const targetPath = path.join(pdfDir, 'single-page-sample.pdf');

if (fs.existsSync(targetPath)) {
  const doc = mupdf.Document.openDocument(fs.readFileSync(targetPath), 'application/pdf');
  const count = doc.countPages();
  doc.destroy();
  if (count === 1) {
    console.log(`single-page-sample.pdf 已存在且为单页（${count} 页），跳过`);
    process.exit(0);
  }
  console.log(`已存在的样本有 ${count} 页，重新生成`);
}

const srcBytes = fs.readFileSync(sourcePath);
const srcDoc = mupdf.PDFDocument.openDocument(srcBytes, 'application/pdf');
const outDoc = new mupdf.PDFDocument();

// graftPage(to, srcDoc, srcPage) 把源文档的某一页原样移植到目标文档末尾，
// 内部自动处理对象/字体/资源的导入，能完整保留矢量内容。
// （copyPage 之类的 API 在此版本不存在；graftPage 才是正确入口。）
outDoc.graftPage(0, srcDoc, 0);

// saveToBuffer 返回的是 mupdf 自己的 Buffer 包装对象，不是 Node Buffer，
// 需要先 asUint8Array() 取出底层字节再转换。
const outBuf = outDoc.saveToBuffer();
const outBytes = Buffer.from(outBuf.asUint8Array());
outBuf.destroy();

fs.writeFileSync(targetPath, outBytes);

srcDoc.destroy();
outDoc.destroy();

const check = mupdf.Document.openDocument(fs.readFileSync(targetPath), 'application/pdf');
const pages = check.countPages();
check.destroy();

console.log(
  `已从「${sourceName}」生成 single-page-sample.pdf：`
  + `${pages} 页，${(outBytes.length / 1024).toFixed(0)} KB（源 ${(srcBytes.length / 1024).toFixed(0)} KB）`,
);

if (pages !== 1) {
  console.error(`期望 1 页，实际 ${pages} 页`);
  process.exit(1);
}
