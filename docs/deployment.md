# 部署文档

本文档说明 PCIE 的生产构建、预览与云端部署方式。本地开发环境搭建见 [安装手册](./installation.md) 与 [快速开始](./quick-start.md)。

## 1. 部署形态

PCIE 是单进程 Node 应用：`server.ts` 同时承担 Express API 与前端产物服务（生产模式下服务 `dist/` 并回退 SPA 路由），无外部数据库依赖。部署单元即"一个 Node 进程 + 本地 OCR 运行时"。

| 组件 | 运行时依赖 | 说明 |
|:---|:---|:---|
| Node 服务（API + 静态资源） | Node.js `v20.19+` / `v22.13+` | `npm run start` 启动 |
| 前端产物 | `dist/`（由 `npm run build` 生成） | 生产模式下由 Express 静态服务 |
| 本地 OCR 运行时 | Python `3.9–3.13` + `.local/paddleocr/` | 图片 OCR 必需，可用 `npm run setup:ocr` 安装 |
| Ghostscript | `gs` 命令 | PDF 压缩功能 |
| Word / LibreOffice | 宿主机组件 | Word 转 PDF 原生链路，缺失时自动回退浏览器 HTML 链路 |

## 2. 生产构建

```bash
npm install
npm run build
```

构建输出 `dist/`。前端采用按需加载：`PdfEditor`、`AiAssistant`、`ImageEnhanceModal`、`FilePreview` 经 `React.lazy()` 拆分，`pdf-lib`、`pdfjs-dist`、`mammoth`、`html2canvas`、`@tensorflow/*`、`upscaler` 等拆为独立 vendor chunk（`chunkSizeWarningLimit: 900`）。AI key 不会进入前端产物。

## 3. 启动方式

### 3.1 完整服务（推荐）

```bash
npm run start
```

以 `NODE_ENV=production` 启动 `server.ts`：API 路由 + `dist/` 静态服务 + SPA 回退。默认端口 `3000`，可用 `PORT` 环境变量覆盖（非法值回退 `3000` 并打印警告）；端口被占用时自动探测下一个可用端口并在终端打印实际地址。启动成功后还会尝试在默认浏览器中打开页面，可用 `AUTO_OPEN=false` 关闭（CI 环境默认不打开）。

> `npm run start` 与 `npm run preview` 通过 `tsx`（devDependencies）运行 `server.ts`，以保证 TypeScript 链路在各 Node 版本一致解析。生产镜像请执行完整 `npm install`（不要使用 `--omit=dev`），否则启动命令会因缺少 `tsx` 而失败。

### 3.2 生产预览（部署前验证）

```bash
npm run preview
```

该命令要求 `dist/` 已存在（否则退出并提示先构建），随后以生产模式启动完整服务，行为与 `npm run start` 一致，适合验证 `.doc` 转 PDF、PDF 压缩、AI gateway、本地 OCR 等依赖 Express 路由的功能。

### 3.3 纯静态预览

```bash
npm run preview:static
```

仅用 Vite 预览 `dist/`，**不加载服务端 API**，只适合检查静态页面与路由，不能验证 AI / OCR / 转换链路。

### 3.4 健康检查

```bash
curl http://<host>:<port>/api/health
# {"status":"ok"}
```

## 4. 运行时环境变量

AI 助手通过环境变量注入 key，服务端读取，不暴露给浏览器：

| 变量 | 必需 | 说明 |
|:---|:---|:---|
| `GEMINI_API_KEY` | 可选 | Google Gemini key |
| `OPENAI_API_KEY` | 可选 | OpenAI key |
| `DEEPSEEK_API_KEY` | 可选 | DeepSeek key |
| `PORT` | 可选 | 监听端口，默认 `3000`；非法值回退 `3000`；被占用时自动顺延 |
| `AUTO_OPEN` | 可选 | 启动成功后是否自动打开浏览器，默认开启；`false` / `0` / `no` / `off` 关闭；CI 环境默认关闭 |

规则与本地开发一致：至少配置一个 key 即可启用 AI 助手；provider 顺序 `Gemini -> OpenAI / ChatGPT -> DeepSeek`；未配置时基础文件处理与本地 OCR 不受影响。本地 `.env` 文件格式见 [.env.example](../.env.example)。

云端平台（Cloud Run、VPS、容器等）在环境变量面板配置同名 key即可，无需改前端代码。配置后访问 `/api/runtime-config` 应返回对应 provider `configured: true`，且不出现原始 key。

## 5. 云端部署步骤

1. **构建 / 镜像初始化阶段**：执行 `npm install`（自动触发 OCR bootstrap）与 `npm run build`。
2. **确认本地 OCR 运行时**：若平台未自动完成 bootstrap，在镜像内执行 `npm run setup:ocr`，并确认 `.local/paddleocr/install-state.json` 生成。镜像内的 Python 需为 `3.9–3.13`（PaddlePaddle CPU wheel 支持范围），可用 `PCIE_PYTHON=<解释器路径>` 显式指定。
3. **配置环境变量**：按需设置 AI key 与 `PORT`；容器 / 无桌面环境建议设置 `AUTO_OPEN=false`。
4. **运行阶段**：`npm run start`。
5. **验证**：`/api/health`、`/api/runtime-config`，以及 AI 对话、图片 OCR、Word 转 PDF、PDF 压缩各跑一次。

## 6. 部署注意事项

- **网络暴露面**：服务默认绑定 `0.0.0.0`。面向公网或多用户环境部署前，建议评估绑定地址与访问控制（见 [安全审计报告](./safety-review.md) 的 H1 / L1 / L2 项）；个人本地使用保持默认即可。
- **磁盘**：上传临时文件写入 `uploads/` 并在请求结束后清理，但需为平台预留临时磁盘空间；PDF 压缩作业状态仅存于进程内存，重启即丢失。
- **Python 可用性**：镜像或实例需包含 Python `3.9–3.13`，否则 `setup:ocr` 与图片 OCR 不可用（PaddlePaddle CPU wheel 不覆盖 3.14+）。
- **无内置 CI/CD**：仓库未提供流水线配置，上述步骤需在目标平台手动或借助平台自身能力完成。

## 7. 部署后验证清单

| 检查项 | 方法 | 预期 |
|:---|:---|:---|
| 服务存活 | `curl /api/health` | `{"status":"ok"}` |
| 运行时摘要 | `curl /api/runtime-config` | provider `configured` 状态正确，无原始 key |
| AI 助手 | 页面勾选文件后发起对话 | 正常返回；归因错误按 [FAQ](./faq.md#ai-助手) 排查 |
| 图片 OCR | 对一张图片执行"扫描文字" | 返回 Markdown 文本；未就绪时按提示重跑 `npm run setup:ocr` |
| Word 转 PDF | 上传 `.docx` / `.doc` 执行 To PDF | 按后端优先级导出，进度卡显示当前方式 |
| PDF 压缩 | 对 PDF 执行压缩并下载 | 作业状态推进到 `done`，产物可打开 |

---

*相关文档：[接口说明](./api.md)、[测试文档](./testing.md)、[安全审计报告](./safety-review.md)。*
