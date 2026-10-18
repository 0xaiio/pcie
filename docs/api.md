# 接口说明

本文档描述 [server.ts](../server.ts) 暴露的全部 HTTP 接口，供前端联调、二次开发与集成测试参考。请求 / 响应契约以 [src/lib/ai-types.ts](../src/lib/ai-types.ts) 与 [src/server/](../src/server/) 下的实现为准；错误分类与用户提示的关系见 [常见问题](./faq.md)。

所有接口均为本地单用户设计，无认证层；AI key 不会通过任何接口返回给浏览器。

## 1. 总览

| 方法与路径 | 用途 | 内容类型 |
|:---|:---|:---|
| `GET /api/health` | 健康检查 | JSON |
| `GET /api/runtime-config` | 运行时配置摘要（provider 与本地 OCR 就绪状态） | JSON |
| `POST /api/ai/chat` | AI 助手对话 gateway | JSON |
| `POST /api/ocr/image` | 本地 PaddleOCR 图片文字提取 | JSON |
| `POST /api/ai/ocr` | 同上，兼容别名 | JSON |
| `POST /api/word/extract-html` | 旧版 `.doc` 服务端文本提取 | multipart |
| `POST /api/word/convert-pdf` | 原生 Word → PDF 导出 | multipart |
| `POST /api/compress/start` | 提交 PDF 压缩作业 | multipart |
| `GET /api/compress/status/:jobId` | 查询压缩作业状态 | JSON |
| `GET /api/compress/download/:jobId` | 下载压缩产物 | PDF |
| `POST /api/pdf2img` | PDF 转 SVG / PNG（mupdf） | multipart |

约束：JSON 请求体上限 25 MB（`express.json({ limit: "25mb" })`）；上传临时文件写入 `uploads/` 并在请求结束后清理。

## 2. 运行时配置

### `GET /api/runtime-config`

返回 provider 配置摘要与本地 OCR 就绪状态，不包含原始 key：

```json
{
  "aiProviders": [
    { "id": "gemini", "label": "Google Gemini", "configured": true, "supportsVision": true },
    { "id": "openai", "label": "OpenAI / ChatGPT", "configured": false, "supportsVision": true },
    { "id": "deepseek", "label": "DeepSeek", "configured": false, "supportsVision": false }
  ],
  "localImageOcr": {
    "engine": "PaddleOCR",
    "available": true,
    "offlineReady": true,
    "detail": "Local PaddleOCR is installed and ready for offline image OCR."
  }
}
```

响应头带 `Cache-Control: no-store`。每次请求会重新读取 `.env`，因此运行中新增 key 无需重启服务。

## 3. AI 助手

### `POST /api/ai/chat`

请求体：

```json
{
  "prompt": "总结这些文件的共同点",
  "messages": [{ "role": "user", "text": "你好" }],
  "files": [
    { "name": "report.pdf", "mimeType": "application/pdf", "data": "<base64>" }
  ]
}
```

- `messages` 角色仅接受 `user` / `model`；`files` 为 base64 数据，PDF 在服务端抽取文本（每文件最多 20,000 字符、最多 20 页），图片以 data URL 传入支持视觉的 provider。
- 服务端按 `Gemini -> OpenAI / ChatGPT -> DeepSeek` 顺序选择首个可用 provider；DeepSeek 不支持图片输入，含图片的请求会跳过它。
- 成功响应：`{ "text": "..." }`。

错误响应（`{ "error": "...", "code": "..." }`）：

| HTTP | code | 含义 |
|:---|:---|:---|
| 400 | `ai-request-invalid` | 请求体字段缺失或类型错误 |
| 503 | `ai-not-configured` | 未配置任何 AI key |
| 503 | `ai-no-capable-provider` | 已配置的 provider 均不支持当前请求（如仅配置 DeepSeek 但提交图片） |
| 502 | `ai-all-providers-failed` | 所有已配置 provider 均失败，`error` 中含聚合归因（key / 配额 / 网络 / 模型 / 参数） |

Provider 与模型对应关系：Gemini `gemini-3.1-pro-preview`、OpenAI `gpt-4.1-mini`、DeepSeek `deepseek-chat`。

## 4. 本地图片 OCR

### `POST /api/ocr/image`（别名 `POST /api/ai/ocr`）

两条路径由同一处理器调度**本地 PaddleOCR**，不调用云端 AI。

请求体：

```json
{ "file": { "name": "scan.png", "mimeType": "image/png", "data": "<base64>" } }
```

- `file.mimeType` 必须以 `image/` 开头。
- 成功响应：`{ "text": "识别出的 Markdown 文本" }`。

错误响应（`{ "error": "...", "code": "..." }`）：

| HTTP | code | 含义 |
|:---|:---|:---|
| 400 | `local-ocr-invalid` | 请求体或 MIME 不合法 |
| 503 | `local-ocr-not-ready` | 本地 OCR 运行时未就绪（`detail` 含修复提示） |
| 500 | `local-ocr-launch-failed` | Python runner 启动失败 |
| 502 | `local-ocr-run-failed` / `local-ocr-invalid-output` | 识别过程异常或输出无法解析 |
| 504 | `local-ocr-startup-timeout` / `local-ocr-timeout` | worker 启动或单次识别超时（各 300 秒） |

运行时可用性判断依据 `.local/paddleocr/install-state.json` 与 venv / runner 文件是否存在，详见 [安装手册 · 本地 OCR 运行时引导](./installation.md#3-本地-ocr-运行时引导)。

## 5. Word 文档链路

### `POST /api/word/extract-html`

`multipart/form-data`，文件字段名 `word`。用于旧版 `.doc`：上传后由 `word-extractor` 提取正文、页眉页脚、脚注、批注与文本框文本，经 HTML 转义与结构化包装后返回 `{ "html": "..." }`。

- 400：未收到文件（`{ "error": "No Word file uploaded" }`）。
- 500：提取失败，`error` 为原始错误信息。

### `POST /api/word/convert-pdf`

`multipart/form-data`，文件字段名 `word`；可选查询参数 `?backend=word-com` 或 `?backend=libreoffice-cli` 指定原生后端。

- 成功：返回 `application/pdf` 字节流，响应头 `X-Word-Pdf-Backend` 标示实际使用的后端（`word-com` 或 `libreoffice-cli`）。
- 400：请求了不受支持的 backend。
- 503：无可用原生后端，`code: native-backend-unavailable`，`fallbackAvailable: true`（前端应回退浏览器 HTML 链路）。
- 500：`code: native-conversion-failed`，`fallbackAvailable: true`。

后端探测顺序：Windows 且 Word COM 可用 → `word-com`；否则 LibreOffice CLI（候选路径见 [安装手册 · 可选组件安装](./installation.md#4-可选组件安装)）。

## 6. PDF 压缩

### `POST /api/compress/start`

`multipart/form-data`，文件字段名 `pdf`，表单字段 `level` 取值 `low` / `medium` / `high`（缺省 `medium`）。映射到 Ghostscript `-dPDFSETTINGS`：`low → /screen`、`medium → /ebook`、`high → /printer`。

- 成功：`{ "jobId": "<timestamp-random>" }`，作业转后台执行。
- 400：未收到文件。

### `GET /api/compress/status/:jobId`

- 成功：`{ "status": "processing" | "done" | "error", "error": "..." }`。
- 404：`{ "error": "Job not found" }`。

### `GET /api/compress/download/:jobId`

- 成功：`application/pdf` 附件流（`compressed.pdf`），下载完成后服务端清理输入输出文件并删除作业记录。
- 400：`{ "error": "Job not ready or failed" }`。

作业状态保存在进程内 `Map`，服务重启即丢失，适合短生命周期任务。

## 7. PDF 转图片

### `POST /api/pdf2img`

`multipart/form-data`，文件字段名 `pdf`，表单字段 `format` 取值 `svg`（默认）或 `png`。使用 mupdf 逐页转换并以流式 JSON 返回：

```json
{ "format": "svg", "pages": ["<svg string>", "..."] }
```

`png` 模式下 `pages` 元素为 base64 字符串（按 300 DPI 缩放）。单页失败会记录并跳过，不影响其余页面；整体失败返回纯文本 500 响应。

## 8. 使用示例

```bash
# 健康检查
curl http://localhost:3000/api/health

# 运行时配置摘要
curl http://localhost:3000/api/runtime-config

# 本地 OCR（需先完成 npm run setup:ocr）
curl -X POST http://localhost:3000/api/ocr/image \
  -H "Content-Type: application/json" \
  -d '{"file":{"name":"scan.png","mimeType":"image/png","data":"<base64>"}}'

# 旧版 .doc 提取 HTML
curl -X POST http://localhost:3000/api/word/extract-html \
  -F "word=@./legacy.doc"

# 提交 PDF 压缩并轮询状态
curl -X POST http://localhost:3000/api/compress/start -F "pdf=@./input.pdf" -F "level=medium"
curl http://localhost:3000/api/compress/status/<jobId>
curl -O http://localhost:3000/api/compress/download/<jobId>
```

## 9. 相关文档

- 调用方（浏览器端）封装见 [系统实现说明 · AI 助手与本地 OCR](./implementation.md#6-ai-助手与本地-ocr)
- 服务端模块边界见 [架构设计 · 服务端辅助模块](./architecture.md#23-服务端辅助模块)
- 安全边界与已知风险见 [安全审计报告](./safety-review.md)
