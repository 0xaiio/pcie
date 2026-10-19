/**
 * 一次性可行性探针（不进 npm test）：
 * 量化「按页面区域光栅化裁剪」对真实 LaTeX 论文的可行性。
 *
 * 已排除的三条更优雅路径（实测不可用，勿再尝试）：
 *  1. StructuredTextWalker.onVector —— 对该论文回调 0 次；
 *  2. Device.fillPath/strokePath 子类 —— 该 mupdf 构建不支持 JS 覆写原生方法，恒为 0；
 *  3. DisplayList —— 不暴露 item 级 bbox。
 * 因此唯一可行路径是像素分析 + 版式约定。
 *
 * 两个必须知道的坑：
 *  A. StructuredTextWalker.beginLine **每个 span 触发一次**（该页 200 次对应 3456 字符），
 *     不是每行一次。要拿完整行文本必须用 StructuredText.asJSON()。
 *  B. caption 与图形之间的空白可以很大（实测 Fig. 1 有 27 行 ≈ 13pt 全白），
 *     不能用「紧贴几行没墨就判定无图」。
 *
 * 算法：caption 行锚定 + 向上合并墨迹带（段间空白 <= MAX_GAP）。
 */
import fs from "node:fs";
import path from "node:path";

const mupdf = (await import("mupdf")).default;

const pdfPath =
  process.argv[2] ??
  path.join(
    "test/resources/pdf",
    "Ad Hoc Transactions through the Looking Glass An Empirical Study of Application-Level Transactions in Web Applications.pdf",
  );

const DPI = 150;
const INK = 200;
const MAX_GAP = 40;   // 段间空白容忍（px）
const MIN_FIG_PT = 60; // 图区最小高度，排除「只有 caption 那一行」

const doc = mupdf.PDFDocument.openDocument(fs.readFileSync(pdfPath), "application/pdf");
const pageCount = doc.countPages();
const regions = [];
let captionsTotal = 0;

for (let i = 0; i < pageCount; i += 1) {
  const page = doc.loadPage(i);
  try {
    const bounds = page.getBounds();
    const w = Math.round((bounds[2] - bounds[0]) * (DPI / 72));
    const h = Math.round((bounds[3] - bounds[1]) * (DPI / 72));

    const pm = page.toPixmap(
      mupdf.Matrix.scale(DPI / 72, DPI / 72),
      mupdf.ColorSpace.DeviceGray,
      false,
    );
    const stride = pm.getStride();
    const comps = pm.getNumberOfComponents();
    const src = pm.getPixels();
    const inkRows = [];
    for (let y = 0; y < h; y += 1) {
      let n = 0;
      const base = y * stride;
      for (let x = 0; x < w; x += 1) if (src[base + x * comps] < INK) n += 1;
      inkRows.push(n / w > 0.003);
    }

    // 完整文字行——必须走 asJSON，walker 的 beginLine 是按 span 触发的
    const st = page.toStructuredText("preserve-whitespace,preserve-spans");
    const json = JSON.parse(st.asJSON());
    st.destroy();

    const captions = [];
    for (const block of json.blocks || []) {
      for (const line of block.lines || []) {
        if (/^\s*(Figure|Fig\.|Table|Algorithm|Listing)\s*\d+\s*[.:：]/.test(line.text || "")) {
          captions.push({
            y0: Math.round((line.bbox.y - bounds[1]) * (DPI / 72)),
            y1: Math.round((line.bbox.y + line.bbox.h - bounds[1]) * (DPI / 72)),
            text: (line.text || "").trim(),
          });
        }
      }
    }
    captionsTotal += captions.length;

    for (const cap of captions) {
      // 从 caption 顶缘向上吞并墨迹带；空白超过 MAX_GAP 才停。
      // 扫描方向是 y 递减，所以每次遇到墨都要刷新 top（它要的是最靠上的那一带）。
      let top = null;
      let gap = 0;
      for (let y = cap.y0 - 1; y >= 0; y -= 1) {
        if (inkRows[y]) {
          top = y;
          gap = 0;
        } else {
          gap += 1;
          if (gap > MAX_GAP) break;
        }
      }
      if (top === null) continue;

      // 若吞到的只是 caption 紧邻的一两行正文，高度会远小于 MIN_FIG_PT
      const heightPt = ((cap.y1 - top) / DPI) * 72;
      if (heightPt < MIN_FIG_PT) continue;

      let x0 = Infinity;
      let x1 = -Infinity;
      for (let yy = top; yy <= cap.y1; yy += 1) {
        const base = yy * stride;
        for (let x = 0; x < w; x += 1) {
          if (src[base + x * comps] < INK) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
          }
        }
      }
      if (x0 === Infinity) continue;

      regions.push({
        page: i + 1,
        wPt: Math.round(((x1 - x0 + 1) / DPI) * 72),
        hPt: Math.round(heightPt),
        cap: cap.text.slice(0, 42),
      });
    }
    pm.destroy();
  } finally {
    page.destroy();
  }
}
doc.destroy();

const figures = regions.filter((r) => /^fig/i.test(r.cap));
const tables = regions.filter((r) => /^table/i.test(r.cap));
console.log(`论文：${path.basename(pdfPath)}  ${pageCount} 页`);
console.log(`caption 总数 ${captionsTotal}；检出图区 ${regions.length} 个（图 ${figures.length} / 表 ${tables.length}）`);
console.log(`检出页数：${new Set(regions.map((r) => r.page)).size}`);
console.log();
for (const r of regions) {
  console.log(
    `  p${String(r.page).padStart(2)}  ${String(r.wPt).padStart(4)} x ${String(r.hPt).padStart(4)} pt  ${r.cap}`,
  );
}