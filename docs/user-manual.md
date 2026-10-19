# 使用手册

本手册面向终端用户，说明工作区内各文件类型的操作方式。环境安装见 [安装手册](./installation.md)，首次启动见 [快速开始](./quick-start.md)，问题定位见 [常见问题](./faq.md)。

系统提供可视化工作区，用于在浏览器中处理 PDF、图片与 Word 文档，并按需调用本地模型或云端 AI 能力。核心原则是：**同屏整理、本地优先、按需 AI、统一导出**。大部分文件处理在浏览器或本机服务进程中完成，仅在主动使用 AI 对话时才将必要内容发送至已配置的云端 AI provider。

系统不依赖远端云端数据库或云侧持久化存储，核心处理使用浏览器内置机能（如 TensorFlow.js、Web Workers）与本机服务进程完成，重要文档数据不离开本机。

### 产品命名：PCIE

PCIE 的四个字母对应四项核心能力，同时呼应 PCIe 总线高速、直连、按需扩展的特点：

- **P** — Privacy & PDF（隐私与 PDF 中枢）：本地优先为基石，文件不离开本机；所有处理围绕 PDF 展开，图片与 Word 均可转为 PDF，形成统一文档中枢。
- **C** — Convert, Compress, Combine（转换、压缩、合并）：图片转 PDF、Word 转 PDF、PDF 压缩、多 PDF 合并一站式完成。
- **I** — Image & Intelligence（图像增强与智能随选）：本地增强图片；图片 OCR 通过本地 PaddleOCR 离线完成，不依赖云端 key；AI 助手在需要总结、问答或多文档分析时按已配置的 provider 自动选择。
- **E** — Extract & Export（提取与统一导出）：提取页面、提取图像、提取文本，并将处理结果统一打包导出。

宣传语：

- 中文：本地优先，AI 自选。PCIE，为你的文档加速。
- 英文：Local-first, AI-optional. PCIE — Your documents, accelerated.

首页初始状态如下图所示，后文提到的首页说明、上传入口和功能区位置均以它为参照：

![首页初始状态截图](./assets/homepage-initial-state.png)

首页由三部分组成：顶部 Hero 说明 `Local-first by default` 与 `AI only when configured` 两个产品前提；中段 `Workspace Upload` 面板承接文件导入；下方 capability strip 用 PDF、Image、Word 三条 workflow 概括后续能力。上传入口支持 `PDF`、`DOC / DOCX`、`PNG / JPG / JPEG` 三类格式，通过 `Choose files` 按钮与拖拽提示进入工作区。

## 1. 文件导入、分类与操作

- **导入文件**：拖拽文件到上传区域，或点击上传按钮。系统会自动将文件分配到图片、PDF、Word 三个栏目。
- **排序与拖拽**：每个分组都提供名称、日期、大小排序按钮；名称排序采用自然排序，例如 `file2.pdf` 排在 `file10.pdf` 之前。列表同时支持拖拽重排。
- **行内顺序微调**：文件条目提供"上移"和"下移"按钮，适合精细调整顺序。手动调整后，该分组按人工顺序展示。
- **通用操作**：文件名右侧提供重命名、复制、预览、删除等常用入口，便于在工作区内连续处理文件。

## 2. Word 转 PDF（含 `.doc`）

- Word 转 PDF 采用质量优先顺序：`本地 Microsoft Word 原生导出 -> LibreOffice CLI -> 浏览器 HTML fallback`。
- `DOCX` 文档优先使用本机 Microsoft Word 或 LibreOffice 导出；当本地 Office 工具不可用时，系统使用浏览器 HTML 渲染链路生成 PDF。
- 旧版 `.doc` 文档通过本地服务端文本提取链路转换为 HTML，再参与 PDF 导出，因此不依赖云端转换服务。
- 批量 Word 转 PDF 时，Word 区块会显示进度卡片，包含百分比、进度条、`已完成/总数`、当前文件名、已用时长，以及正在使用的转换方式。
- 导出流程使用隐藏宿主容器承载 HTML 内容，使浏览器端 PDF 生成过程保持稳定布局。
- 如需最高保真度，请优先确保本机安装并可调用 Microsoft Word；如需跨平台自动化，可安装 LibreOffice。

三条链路的探测顺序与实现细节见 [系统实现说明 · Word 转 PDF 实现路线](./implementation.md#4-word-转-pdf-实现路线)。

## 3. 图像增强（AI Upscaler）

- 在图片条目上点击 **Enhance Image** 图标，会打开 [AI 图像增强窗口](./implementation.md#ai-image-enhancement)。
- 系统会在本地加载模型并进行超分辨率推理。处理耗时与图片尺寸、设备性能有关。
- 处理完成后，可以通过中间滑块对比原图与增强结果，并将增强后的图片保存为独立副本。

## 4. PDF 拆分、合并与编辑

- 点击 PDF 文件条目上的 **Preview & Edit Pages** 图标进入 PDF 工作台。
- 工作台支持删除页面、抽取页面、组合文件等操作。
- PDF 编辑功能由本地 [pdf-lib](./architecture.md#12-核心业务依赖) 完成，不依赖外部在线工具。
- 条目上的 **Extract Embedded Images** 图标可提取 PDF 内嵌图片。提取由服务端的 mupdf 渲染链路完成，覆盖全部常见编码路径（JPEG / DCTDecode、FlateDecode、CCITTFaxDecode、JBIG2Decode、JPXDecode、RunLengthDecode），以及直接写在内容流里的**内联图像**（`BI` / `ID` / `EI`）；输出统一为 PNG，避免二次有损压缩。
- 提取出的图片以**图中标题（caption）命名**，例如 `Figure 2. Lossless gradient stored with FlateDecode.` 会导出为 `Lossless-gradient-stored-with-FlateDecode-p1.png`（`-p1` 为页码）。题注识别支持 `Figure` / `Fig.` / `Table` / `Algorithm` / `Listing` 与 `图` / `表` 等中英文写法；找不到对应题注时回退为 `<文件名>-p<页码>-img<序号>.png`。
- 若文档里**没有位图**（例如 LaTeX / pdfTeX 论文常把插图直接画成矢量线条），点击会给出准确提示而不是笼统报错，此时应改用 **Convert Pages to Vector (SVG)** 图标按页导出。
- **Convert Pages to Vector (SVG)** 图标通过服务端 mupdf 链路把页面转为 SVG。该图标的**右下角带一个下拉三角按钮**，点击后可选择其他目标格式：
  - 可选格式：**SVG（默认，矢量）**、PNG、JPG、JPEG、WebP、BMP、TIFF、GIF。
  - 主按钮保持原行为——直接点击即按页导出 SVG 矢量图，与旧版一致；菜单里的 SVG 项标注为 `default`。
  - 选定格式后，**多页 PDF 的每一页**都会输出为该格式，文件名形如 `<原文件名>_page_001.png`。
  - 位图格式按 300 DPI 渲染，足以打印级输出；SVG 为矢量输出，不经过光栅化，放大不失真。
  - 菜单点击页面其他位置或按 `Esc` 即可关闭；转换进行中该行的两个按钮都会禁用，其他行不受影响。
  - JPEG 不支持透明通道；BMP 输出为 8 位调色板索引（`BI_RLE8`）以控制体积，适合需要被老旧软件读取的场景。

## 5. AI 助手（AI Chat）

- 勾选文件后，点击文件条目上的 **AI Assistant** 图标（分析单个文件），或区块工具栏中的 **Ask AI** 按钮（分析当前选中的一组文件）。
- 助手可以围绕选中文件执行总结、翻译、问答与分析。
- 启用 AI 助手需要在项目根目录的 `.env` 中配置至少一个 key（`GEMINI_API_KEY`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`），配置方法见 [快速开始 · 配置 AI key](./quick-start.md#3-配置-ai-key可选)。
- 如果同时配置多个 key，系统按 `Gemini -> OpenAI / ChatGPT -> DeepSeek` 的顺序自动选择首个可用 provider。
- 开发服务器运行后新增 `.env` 时，刷新页面或重新打开 AI 助手即可触发新的运行时配置探测。
- 如果 AI 助手报错，可根据界面提示区分密钥、网络、模型权限或配额问题，详见 [常见问题 · AI 助手](./faq.md#ai-助手)。

## 6. 图片文字提取（本地 PaddleOCR）

- 在图片条目上点击 **Extract Text (OCR)** 图标，系统会把图片中的文本提取为 Markdown 文件并下载到本地。
- 图片 OCR 通过本地 PaddleOCR runtime 执行，不依赖 `GEMINI_API_KEY`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`。
- `npm install` 会自动执行本地 OCR bootstrap：创建项目内 Python 虚拟环境、安装 PaddlePaddle / PaddleOCR，并预热离线模型。安装完成后，图片 OCR 可以在断网状态下使用。
- 如果本地 OCR 运行时未就绪，点击图标会弹出安装指引；按提示补齐 Python `3.9–3.13` 并重跑 `npm install` 或 `npm run setup:ocr`，步骤见 [安装手册 · 本地 OCR 运行时引导](./installation.md#3-本地-ocr-运行时引导)。
- OCR 失败提示会区分运行时未就绪、OCR runner 启动异常或识别过程异常，便于定位问题。

## 7. 图片批量转 PDF

- 选择多张图片并点击 **Convert to PDF** 后，图片区块底部会显示进度卡片。
- 进度卡片展示百分比、进度条、`已完成/总数` 数字与当前文件名，方便确认任务推进状态。
- 若某张图片转换失败，界面会提示对应的文件名与错误原因。

## 8. 打包下载

- 勾选所需文件后点击 **导出选中的内容 (Zip)**，系统会将结果归档为一个 ZIP 文件并下载到本地。

---

*设计目标与功能边界见 [需求分析文档](./requirements.md)；实现细节见 [系统实现说明](./implementation.md)；页面结构规范见 [UI 设计](./ui-design.md)。*
