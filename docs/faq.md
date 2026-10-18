# 常见问题（FAQ）

本手册收录安装、启动、AI key、本地 OCR、Word 转 PDF 与导出环节的高频问题。按章节标题可直接定位。

## 安装与启动

### `npm install` 提示 Node.js 版本不受支持

本项目要求 Node.js `v20.19+` 或 `v22.13+`（`package.json` 的 `engines` 字段，由 `preinstall` 脚本强制校验）。用 nvm / fnm 切换到受支持版本后重试；若终端仍识别旧版本，在 PowerShell 中执行 `. .\scripts\refresh-node-env.ps1` 或重启终端与 IDE。

### 终端提示 `node` / `npm` 无法识别

通常是切换 Node 版本后 IDE 集成终端未刷新环境变量。先执行 `. .\scripts\refresh-node-env.ps1`，无效则重启 VS Code。

### 启动后页面空白或无法访问

1. 确认终端输出的实际地址（端口被占用时会自动 +1）；
2. 确认访问的是 `http://localhost:<端口>` 而非其他主机名；
3. 生产预览前必须先执行 `npm run build`，`npm run preview` 需要 `dist/` 产物存在。

### 启动与端口

`npm run dev` 默认监听 `3000`（可用 `PORT` 环境变量覆盖）。端口被占用时自动选择下一个可用端口，并在终端打印 `Port 3000 is busy, using http://localhost:<实际端口> instead.` 警告。这是预期行为，按终端输出地址访问即可。

## AI 助手

### 未配置任何 key 时 AI 助手不可用

这是预期行为：未配置 `GEMINI_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` 时，基础文件处理与本地 OCR 仍可正常使用。按 [快速开始 · 配置 AI key](./quick-start.md#3-配置-ai-key可选) 补齐后，刷新页面或重新打开 AI 助手即可。

### 项目从 Google AI Studio 导出，为什么还要自己配 key

AI Studio 托管环境通常只会替其 Gemini 能力注入密钥。本地运行时如果没有在项目根目录配置可用的 `.env`，仍需自行提供 `GEMINI_API_KEY`、`OPENAI_API_KEY` 或 `DEEPSEEK_API_KEY` 中的一个或多个，配置方法见 [快速开始](./quick-start.md#3-配置-ai-key可选)。

### AI 请求报错如何分类排查

服务端会区分的失败类型与处理顺序：

1. **API key 被拒绝**（401 / 403）：key 错误、过期或权限不足，检查 `.env` 或平台环境变量；
2. **配额 / 速率限制**（429）：等待恢复或检查账号额度；
3. **网络不可达**：检查本机出站 HTTPS、防火墙、代理、VPN、DNS 或区域访问限制；
4. **模型不可用**（404）：检查 provider 账号的模型权限；
5. **请求参数不合法**（400）：检查提交的文件与请求结构。

界面提示文案由服务端聚合生成，通常已指明上述类别；更细的实现见 [系统实现说明 · AI 助手](./implementation.md#6-ai-助手与本地-ocr)。

### 配置了多个 key，如何选择 provider

按固定顺序 `Gemini -> OpenAI / ChatGPT -> DeepSeek` 尝试，首个可完成当前任务的 provider 获胜，无需手动切换。图片输入会跳过不支持视觉的 DeepSeek。

### 启动后新增 `.env` 是否需要重启

不需要。`/api/runtime-config` 会在后续 AI 请求时重新读取 `.env`；刷新页面或重新打开 AI 助手即可生效。

## 本地图片 OCR

### 图片 OCR 提示运行时未就绪

按顺序检查：

1. 本机是否安装 Python `3.9+` 且在 PATH 中；
2. `.local/paddleocr/venv` 与 `.local/paddleocr/cache` 是否存在；
3. 缺失或异常时重跑 `npm run setup:ocr`；
4. 执行 `npm run smoke:ocr` 验证链路。

### OCR 报错区分哪些类型

本地 OCR 报错会区分：Python / PaddleOCR 未安装（`local-ocr-not-ready`）、worker 启动异常（`local-ocr-launch-failed` / `local-ocr-startup-timeout`）、识别过程异常（`local-ocr-run-failed` / `local-ocr-timeout`）。按提示执行 `npm run setup:ocr` 或 `npm run smoke:ocr` 即可覆盖大多数场景。

### OCR 与 AI key 的关系

图片 OCR 走本地 PaddleOCR 链路（`/api/ocr/image`），不消耗也不读取任何云端 AI key，可离线使用。

## Word 转 PDF

### 三条转换链路的优先级是什么

`本地 Microsoft Word 原生导出 -> LibreOffice CLI -> 浏览器 HTML fallback`。系统按此顺序自动探测与回退，进度卡会显示当前使用的方式（如 `Method: LibreOffice CLI export`）。

### 转换结果保真度不理想

- 追求最高保真度：确保本机安装并可调用 Microsoft Word（仅 Windows）；
-  跨平台或批处理：安装 LibreOffice；
- 两者都不可用时回退到浏览器 HTML 渲染链路，正文可读但版式可能丢失，属预期行为。

### 旧版 `.doc` 如何处理

`.doc` 不上传到云端：文件经 `/api/word/extract-html` 由服务端 `word-extractor` 提取正文文本，转义包装为 HTML 后，再进入浏览器端 PDF 生成链路。

## 导出与其他

### 导出的 Zip 中文件重名怎么办

系统会自动处理 Zip 条目重名（追加序号等策略），保证包内文件名唯一。实现见 [系统实现说明](./implementation.md#1-核心状态与共享类型)。

### 预览恶意 DOCX 是否安全

FilePreview 渲染 mammoth 输出的 HTML。历史上安全审计报告（[safety-review.md](./safety-review.md) 的 H2 项）指出该路径存在 XSS 风险，建议预览前确认文件来源可信。

### 批量处理时浏览器卡顿

图像增强等重计算在浏览器本地执行，耗时与图片尺寸、设备性能相关；大图建议分批处理。批量转 PDF 的进度卡片会显示已完成数量与当前文件名，可据此判断任务仍在推进。

---

*未覆盖的问题请查看 [使用手册](./user-manual.md)、[部署文档](./deployment.md) 或提交 Issue。*
