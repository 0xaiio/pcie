/**
 * 配套验证：把探针检出的图区真的裁剪出来，人工核对 bbox 是否覆盖了正确的图。
 *
 * 关键 API：PDFPage.setPageBox('CropBox', rect) 能把页面裁到任意矩形，
 * 再 toPixmap 即得该区域的光栅图——这是「区域光栅化」最短的实现路径，
 * 不需要自己算像素偏移。
 */
import fs from "node:fs";
import path from "node:path";

const mupdf = (await import("mupdf")).default;
const pdfPath = path.join(
  "test/resources/pdf",
  "Ad Hoc Transactions through the Looking Glass An Empirical Study of Application-Level Transactions in Web Applications.pdf",
);
const outDir = "C:/Users/hfwei/AppData/Local/Temp/figcrops";
fs.mkdirSync(outDir, { recursive: true });

// 探针检出的代表性图区（pt，原点左上）
const cases = [
  { page: 2, name: "fig1", rect: [111, 84, 540, 312] },
  { page: 13, name: "fig7", rect: [111, 250, 540, 677] },
];

const bytes = fs.readFileSync(pdfPath);
for (const c of cases) {
  const doc = mupdf.PDFDocument.openDocument(bytes, "application/pdf");
  const page = doc.loadPage(c.page - 1);
  const before = page.getBounds();
  page.setPageBox("CropBox", c.rect);
  const after = page.getBounds();

  const pm = page.toPixmap(
    mupdf.Matrix.scale(200 / 72, 200 / 72),
    mupdf.ColorSpace.DeviceRGB,
    false,
  );
  const file = path.join(outDir, `${c.name}-p${c.page}.png`);
  fs.writeFileSync(file, Buffer.from(pm.asPNG()));
  console.log(
    `${c.name}: page bounds ${before.map((v) => v.toFixed(0)).join(",")} -> crop ${after
      .map((v) => v.toFixed(0))
      .join(",")}  => ${pm.getWidth()}x${pm.getHeight()}px  ${file}`,
  );
  pm.destroy();
  page.destroy();
  doc.destroy();
}