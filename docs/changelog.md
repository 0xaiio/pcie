# 变更记录

本文件记录 PCRE 的用户可见变更。新版本条目置于最前。

## 未发布

### 特性：PDF 转图片支持选择目标格式（SVG / PNG / JPG / JPEG / WebP / BMP / TIFF / GIF）

**变更内容**

既有的 **Convert Pages to Vector (SVG)** 图标保留为**主按钮**，直接点击仍按页导出 SVG 矢量图，
行为与旧版完全一致。在此基础上，该图标的**右下角新增一个下拉三角按钮**，点击后可选择目标格式：

| 格式 | 扩展名 | MIME | 编码路径 |
|:---|:---|:---|:---|
| SVG（默认，矢量） | `svg` | `image/svg+xml` | mupdf `DocumentWriter` |
| PNG | `png` | `image/png` | mupdf `Pixmap.asPNG` |
| JPG / JPEG | `jpg` / `jpeg` | `image/jpeg` | mupdf `Pixmap.asJPEG` |
| WebP | `webp` | `image/webp` | sharp |
| BMP | `bmp` | `image/bmp` | 自研 RLE8 编码器 |
| TIFF | `tif` | `image/tiff` | sharp |
| GIF | `gif` | `image/gif` | sharp |

选定格式后，**多页 PDF 的每一页**都输出为该格式，文件名形如 `<原文件名>_page_001.png`。
菜单里的 SVG 项标注 `default`；点击页面其他位置或按 `Esc` 关闭；转换中该行按钮禁用而其他行不受影响。

**实现要点**

- 新增共享契约模块 [src/server/pdf-render-shared.ts](../src/server/pdf-render-shared.ts)：
  格式注册表、扩展名 / MIME 映射、别名归一化、未知格式回退 SVG。前后端共用同一份定义，
  杜绝「前端显示一种格式、后端按另一种导出」的错位。
- 新增服务端渲染模块 [src/server/pdf-render.ts](../src/server/pdf-render.ts)：
  SVG 走 mupdf 矢量路径（**不**先光栅化再转换，否则丢失矢量特性）；
  PNG / JPEG 走 mupdf 原生编码以省一次编解码；WebP / TIFF / GIF 交给 sharp。
- BMP 无可用编码器（mupdf 与 sharp 都不支持 BMP 输出），因此实现了 8 位调色板索引 +
  `BI_RLE8` 的自研编码器。选 RLE8 而非裸 `BI_RGB` 是因为 300 DPI 下 A4 一页未压缩索引数据
  约 8.4 MB，39 页论文的 base64 响应会超出 V8 单字符串上限。

**BMP 编码器的两个关键坑（已在测试中钉死）**

1. `00 02` 在 RLE8 里是 **DELTA 转义码**，不是「2 像素绝对段」。写 `00 02` 表示两个字面像素时，
   解码器一律按 DELTA 跳过 4 字节，整条流从该处起全部错位。绝对模式的最小长度因此是 **4**
   （`0` / `1` / `2` 三个转义值均为保留码）。
2. 调色板量化的通道数必须由调用方显式传入，不能靠「缓冲区长度能否被 4 整除」反推：
   `612×792×3 = 1455552` 恰好被 4 整除，而学术论文页面大片留白会让「每隔 4 字节取一个」恒为 255，
   两种启发式都会把纯 RGB 误判成 RGBA 并导致整图错位。

**影响范围**

- `POST /api/pdf2img` 新增 `format` 表单字段的取值范围（原先仅 `svg` / `png`）；
  响应新增 `extension` / `mimeType` / `vector` / `pageCount` 元数据，`pages[]` 元素改为
  `{ page, data, encoding }` 对象（`encoding` 为 `text` 或 `base64`）。
- 前端 `handleConvertToVector` 增加可选的格式参数；`PdfFilesSection` 的
  `onConvertToVector` 回调签名由 `(file)` 扩展为 `(file, format?)`。
- 新增运行时依赖 `sharp`（WebP / TIFF / GIF 编码）。

**验证**

新增 4 个测试文件、共 63 条用例，全部使用 `test/resources/pdf/` 下的真实 39 页论文与由其派生的
单页样本运行：格式注册表与别名、默认 SVG 行为、单页 / 多页逐页输出、每种格式的 magic bytes
合法性、BMP 的三层交叉验证（纯规范参考解码器逐索引 0 失配 + 结构断言 + sharp 能力边界断言）、
下拉控件交互与行级隔离。

端到端探针 `scripts/experiments/probe-pdf2img-formats.mjs` 打真实 HTTP 验证 8 种格式 +
非法格式回退，全部通过。明细见 [测试指南 · PDF 转图片](./testing.md#12-pdf-转图片)。

### 修复：Extract Images 无法提取 LaTeX 论文中的图片

**问题现象**

对由 LaTeX / pdfTeX 编译的学术论文 PDF 点击 **Extract Embedded Images**，始终弹出
`No extractable JPEG images found in this PDF`，即使论文中确有插图。

**根因**

原实现在**前端**用 pdf-lib 遍历 PDF 的间接对象，且仅接受 `/Filter == /DCTDecode` 的图像流：

```ts
// 修复前的逻辑（src/App.tsx）
if (filter === PDFName.of('DCTDecode')) { /* 仅提取 JPEG */ }
```

该筛选条件存在两个问题：

1. **覆盖面窄**。学术论文中的位图大量使用 `FlateDecode`、`CCITTFaxDecode`、`JBIG2Decode`、
   `JPXDecode` 等编码，一律被跳过。
2. **漏掉内联图像**。写在内容流里、用 `BI` / `ID` / `EI` 序列表示的图像**不是间接对象**，
   按对象遍历永远扫不到。

**修复内容**

- 新增服务端模块 [src/server/pdf-images.ts](../src/server/pdf-images.ts)，遍历每页资源字典的
  `/XObject`，用 `PDFDocument.loadImage` 解码——它按 `/Filter` 自动选择解码器，
  DCTDecode、FlateDecode、CCITTFaxDecode 等编码都能处理。
- 不按 `/Subtype` 预过滤：历史遗留文档里 FlateDecode 包装的位图其 `/Subtype` 常被写成 `/Form`，
  判据统一为「能否解出像素」。
- 所有图像统一重编码为 **PNG**，避免 JPEG 二次压缩造成画质劣化。
- 图片以**图中标题（caption）**命名。题注前缀支持 `Figure` / `Fig.` / `Table` 与
  `图` / `表`；文件名经跨平台安全清洗（剔除 `\ / : * ? " < > |`，保留中日韩字符，
  规避 Windows 保留设备名，去掉句末方括号引用），并追加页码。
- 题注按页内出现顺序与该页图片依次配对，一条题注只归属一张图；未命中时回退为
  `page-<页码>-image-<序号>.png`。
- 新增端点 `POST /api/pdf/extract-images`（见 [接口说明 · PDF 转图片](./api.md#7-pdf-转图片)）。
- 前端 `handleExtractImages` 改为调用该端点，base64 解码为 `File` 后并入 Images 区块。

**关于"论文无位图"的准确提示**

对测试用的真实论文 `Ad Hoc Transactions through the Looking Glass An Empirical Study of
Application-Level Transactions in Web Applications.pdf`（39 页）实测：

| 观测项 | 结果 |
|:---|:---|
| PDF 页数 | 39 |
| 含位图 XObject 的页数 | **0** |
| 含图形 / 文字内容的页数 | 多数 |

即该论文的插图全部由矢量路径绘制（pdfTeX 的典型产物），**本身不含任何位图**。因此修复后
对该文件点击提取，仍不会产出图片——这是文档的客观属性，不是提取失败。

为避免旧提示把排查方向带偏，无位图时改为返回明确诊断：说明文档不含位图、指出图形为矢量
绘制，并指引改用 **Convert Pages to Vector (SVG)** 按页导出。提示中**不含**任何
`only JPEG` / `只支持 JPEG` 之类的误导性措辞——这一约束由测试断言保证。

**影响范围**

- 接口新增 `POST /api/pdf/extract-images`。
- 前端按钮 title 由 `Extract Images` 改为 `Extract Embedded Images (all formats, named by caption)`。
- 图片提取由纯前端 pdf-lib 扫描改为服务端 mupdf 解码。这与项目其余能力一致：
  PDF 转图片、Word 转 PDF、PDF 压缩、OCR、AI 对话均已依赖服务端（见
  [部署文档 · 部署形态](./deployment.md#1-部署形态)——PCIE 是单进程 Node 应用，
  `server.ts` 同时承担 API 与静态资源服务，不存在「无服务端」的部署形态）。
  `npm run preview:static` 仅用于检查静态页面与路由，官方明确其不能验证转换链路。

**验证**

`src/server/pdf-images.app.test.ts` 共 14 条用例，覆盖多格式提取、输出 PNG 合法性、
caption 命名与回退、命名安全性、题注定位（中英文）、文件名唯一性，以及真实 39 页论文的
全页扫描与矢量归因。全部基于合成夹具与真实 PDF 运行。

夹具 `test/resources/fixtures/image-extraction-fixture.pdf` 由
`scripts/fixtures/build-image-extraction-fixture.mjs` 生成，同时覆盖三类 XObject 编码。

