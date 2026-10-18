# 安装手册

本手册面向首次在本机部署 PCIE 的用户与开发者，覆盖环境要求、依赖安装、本地 OCR 引导与安装期问题排查。安装完成后的启动方式见 [快速开始](./quick-start.md)。

## 1. 环境要求

| 依赖 | 版本要求 | 用途 | 是否必需 |
|:---|:---|:---|:---|
| Node.js | `v20.19+` 或 `v22.13+`（见 [package.json](../package.json) 的 `engines` 字段） | 开发服务器、构建与服务端运行时 | 必需 |
| npm | 随 Node.js 提供 | 依赖安装与脚本执行 | 必需 |
| Python | `3.9+` | 本地 PaddleOCR 运行时 | 图片 OCR 功能必需 |
| Ghostscript | 较新稳定版（`gs` 命令可调用） | PDF 压缩（`/api/compress/start`） | PDF 压缩功能必需 |
| Microsoft Word | Windows 桌面版 | Word 转 PDF 的最高保真链路 | 可选 |
| LibreOffice | 较新稳定版（`soffice` 可调用） | Word 转 PDF 的跨平台链路 | 可选 |

说明：

- Node.js 版本由 `npm install` 前的 `preinstall` 脚本（[scripts/check-node-version.mjs](../scripts/check-node-version.mjs)）强制校验，低于要求会直接终止安装。
- 未安装 Python 或 Ghostscript 时，项目仍可安装与启动，但图片 OCR 或 PDF 压缩功能不可用；界面会给出对应提示。
- Word 转 PDF 的三条链路与优先级见 [使用手册 · Word 转 PDF](./user-manual.md#2-word-转-pdf含-doc)。

## 2. 安装依赖

进入项目根目录后执行：

```bash
npm install
```

该命令会依次完成：

1. `preinstall`：校验 Node.js 版本。
2. 安装前端与服务端 npm 依赖（React 19、Vite 6、Express、pdf-lib、mupdf 等）。
3. `postinstall`：自动执行 `npm run setup:ocr`，引导本地 PaddleOCR 运行时（见第 3 节）。

> 如果 VS Code 的集成终端刚切换过 Node.js / nvm 版本，可能尚未刷新环境变量，可先执行 `. .\scripts\refresh-node-env.ps1`（PowerShell），或重启 VS Code。

## 3. 本地 OCR 运行时引导

`npm install` 的 `postinstall` 会自动执行 [scripts/bootstrap-local-ocr.mjs](../scripts/bootstrap-local-ocr.mjs)，流程为：

1. 探测本机可用的 Python `3.9+`；
2. 在项目内创建虚拟环境 `.local/paddleocr/venv`；
3. 安装 `paddlepaddle` CPU 版与 `paddleocr`；
4. 预热默认 OCR 模型，缓存写入 `.local/paddleocr/cache`。

`bootstrap` 完成后，安装状态写入 `.local/paddleocr/install-state.json`，服务端据此在 `/api/runtime-config` 中汇报本地 OCR 是否就绪。图片 OCR 不依赖任何云端 API key，可在断网状态下使用。

如果自动引导因 Python 缺失、网络限制或本地环境异常而中断，补齐环境后手动重跑：

```bash
npm run setup:ocr
```

快速验证本地 OCR 运行时本身是否可用：

```bash
npm run smoke:ocr
```

该命令会补齐 bootstrap、生成一张样例图片，并输出一次真实 OCR 请求的耗时与识别结果预览。遇到 OCR 相关报错时，优先执行这条命令定位问题。

## 4. 可选组件安装

### 4.1 Microsoft Word（Windows，可选）

安装 Microsoft Word 桌面版即可，无需额外配置。Word 转 PDF 会通过 PowerShell 调用 Word COM 自动化完成原生导出，是保真度最高的链路。

### 4.2 LibreOffice（跨平台，可选）

安装 LibreOffice 并确保 `soffice` 可执行文件存在。服务端按以下候选路径探测（Windows 额外读取 `ProgramFiles`、`ProgramFiles(x86)`、`LOCALAPPDATA` 环境变量）：

- `C:\Program Files\LibreOffice\program\soffice.exe`
- `C:\Program Files (x86)\LibreOffice\program\soffice.exe`
- `%LOCALAPPDATA%\Programs\LibreOffice\program\soffice.exe`
- `/usr/bin/soffice`
- `/usr/local/bin/soffice`

### 4.3 Ghostscript（可选）

安装 Ghostscript 并确保 `gs` 在系统 PATH 中。PDF 压缩功能依赖该命令，未安装时压缩入口不可用。

## 5. 安装期问题排查

| 现象 | 原因与处理 |
|:---|:---|
| `npm install` 提示 Unsupported Node.js | Node 版本低于 `v20.19` / `v22.13`。用 nvm / fnm 切换后重试，必要时执行 `. .\scripts\refresh-node-env.ps1` 或重启终端 |
| OCR bootstrap 中断，提示缺少 Python | 安装 Python `3.9+` 并确保在 PATH 中，然后重跑 `npm run setup:ocr` |
| OCR bootstrap 因网络中断 | 恢复网络后重跑 `npm run setup:ocr`；引导流程可重复执行，不会破坏已完成的部分 |
| `npm run smoke:ocr` 失败 | 按输出提示检查 `.local/paddleocr/venv` 与 `.local/paddleocr/cache` 是否存在，缺失时重跑 `npm run setup:ocr` |
| 端口相关启动问题 | 见 [常见问题](./faq.md#启动与端口) |

## 6. 安装验证

安装完成后，依次确认：

```bash
# 1. 依赖与 OCR 引导完成（无致命错误）
npm install

# 2. 本地 OCR 冒烟通过
npm run smoke:ocr

# 3. 类型检查通过
npm run lint
```

三项均通过后，进入 [快速开始](./quick-start.md) 启动工作区。

---

*运行时配置（AI key）见 [快速开始](./quick-start.md#3-配置-ai-key可选)；实现细节见 [系统实现说明](./implementation.md)。*
