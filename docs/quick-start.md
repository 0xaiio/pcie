# 快速开始

本手册提供从零到首次使用的最小路径。环境要求与安装期排错见 [安装手册](./installation.md)；各功能的详细操作见 [使用手册](./user-manual.md)。

## 1. 克隆仓库

```bash
git clone git@github.com:0xaiio/pcie.git
cd pcie
```

## 2. 安装依赖

```bash
npm install
```

`postinstall` 会自动引导本地 PaddleOCR 运行时（创建 `.local/paddleocr/venv`、安装依赖并预热离线模型）。此步骤需要本机已安装 Python `3.9–3.13`（PaddlePaddle CPU wheel 的支持范围，可用 `PCIE_PYTHON` 指定解释器）；若中断，按 [安装手册 · 安装期问题排查](./installation.md#5-安装期问题排查) 处理。

## 3. 配置 AI key（可选）

AI 助手需要至少一个 provider key；图片 OCR 与基础文件处理**不需要**任何 key。

```bash
# 复制示例文件
cp .env.example .env
```

编辑 `.env`，填入一个或多个 key：

```text
GEMINI_API_KEY=your_gemini_key_here
OPENAI_API_KEY=your_openai_key_here
DEEPSEEK_API_KEY=your_deepseek_key_here
```

- 默认尝试顺序：`Gemini -> OpenAI / ChatGPT -> DeepSeek`，首个可用 provider 获胜。
- key 申请入口：Gemini <https://aistudio.google.com/app/apikey>；OpenAI <https://platform.openai.com/api-keys>；DeepSeek <https://platform.deepseek.com/api_keys>。
- 未配置任何 key 时，工作区的基础文件处理与本地 OCR 仍可正常使用。
- `.env` 已被 `.gitignore` 排除，切勿把真实 key 提交到仓库。

## 4. 启动开发服务器

```bash
npm run dev
```

默认访问 <http://localhost:3000>（可用 `PORT` 环境变量覆盖）。若端口被占用，服务会自动探测并使用下一个可用端口，并在终端打印最终采用的地址。启动成功后会自动在默认浏览器中打开该地址；如未弹出浏览器（或被 `AUTO_OPEN=false` 关闭），按终端输出的地址手动访问即可：

1. 浏览器打开终端输出的地址，应看到首页 Hero（`Local-first by default` / `AI only when configured`）与 `Workspace Upload` 面板；
2. 点击 **Choose files** 或直接拖入文件，支持 `PDF`、`DOC / DOCX`、`PNG / JPG / JPEG`；
3. 文件会按类型进入 Image / PDF / Word 三个区块，即可开始处理。

> 启动相关行为说明：
> - 端口顺延日志形如 `Port 3000 is busy, using http://localhost:3001 instead.`，随后输出 `Server running on http://localhost:<最终端口>`；
> - 自动开浏览器可用 `AUTO_OPEN=false` 关闭（CI 环境默认不打开），关闭时终端会提示手动访问的地址；
> - `npm run preview:static` 同样会在预览启动后自动打开浏览器。
>
> 端口绑定与自动打开的完整实现见 [系统实现说明 · 启动行为](./implementation.md#8-启动行为端口绑定与浏览器自动打开)。

> 如果先启动 `npm run dev`、之后才创建 `.env`，无需重启：`/api/runtime-config` 会在后续 AI 请求时重新读取该文件，刷新页面或重新打开 AI 助手即可。

## 5. 常用命令

| 命令 | 用途 |
|:---|:---|
| `npm run dev` | 开发模式，Vite 中间件与 Express 同端口联调，支持 HMR |
| `npm run build` | 生产构建，输出 `dist/` |
| `npm run preview` | 生产预览（需先 `npm run build`），启动完整 Express 服务 |
| `npm run preview:static` | 纯静态前端预览（不加载服务端 API） |
| `npm test` | 自动化测试（`test:logic` + `test:app`） |
| `npm run lint` | TypeScript 类型检查 |
| `npm run setup:ocr` | 手动补齐本地 PaddleOCR 运行时 |
| `npm run smoke:ocr` | 本地 OCR 冒烟验证 |

## 6. 下一步

- 功能操作：[使用手册](./user-manual.md)
- 问题定位：[常见问题](./faq.md)
- 生产部署：[部署文档](./deployment.md)
- 参与开发：[贡献守则](./contributing.md)
