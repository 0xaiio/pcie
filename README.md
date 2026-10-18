# PCIE · 多功能文件处理系统

PCIE 是一个**本地优先**的 Web 文档工作区：上传、排序、转换、提取、增强、导出，在同一界面内完成。工作区围绕 PDF、图片、Word 三类文件展开，核心处理在浏览器或本机服务进程中完成；AI 能力仅在配置 key 后按需启用。

首页初始状态如下（截图存放于 [docs/assets/homepage-initial-state.png](./docs/assets/homepage-initial-state.png)）：

![PCIE homepage initial state](./docs/assets/homepage-initial-state.png)

## 克隆项目（SSH）

```bash
git clone git@github.com:0xaiio/pcie.git
cd pcie
```

## 安装与启动

```bash
# 1. 安装依赖（postinstall 会自动执行 npm run setup:ocr，引导本地 PaddleOCR 运行时）
npm install

# 2. 启动开发服务器，默认访问 http://localhost:3000
npm run dev
```

- 依赖要求：Node.js `v20.19+` 或 `v22.13+`、Python `3.9–3.13`（本地 OCR，受 PaddlePaddle CPU wheel 支持范围约束）；PDF 压缩需要 Ghostscript。
- **端口自动顺延**：默认监听 `3000`（可用 `PORT` 覆盖）。端口被占用时自动探测下一个可用端口，并在终端明确输出最终采用的地址。
- **自动打开浏览器**：启动成功后自动在默认浏览器中打开应用页面；设置 `AUTO_OPEN=false` 可关闭（CI 环境下默认不打开）。
- 详细环境说明见 [安装手册](./docs/installation.md)；首次运行排错见 [快速开始](./docs/quick-start.md) 与 [常见问题](./docs/faq.md)。

## 文档索引

完整文档体系位于 `docs/` 目录，按用户篇与开发者篇组织。

### 用户篇

| 文档 | 说明 |
|:---|:---|
| [安装手册](./docs/installation.md) | 环境要求、依赖安装、本地 OCR 引导与安装期问题排查 |
| [快速开始](./docs/quick-start.md) | 从克隆到首次上传的最小路径，含 `.env` 配置与常用命令 |
| [使用手册](./docs/user-manual.md) | 各文件类型的工作区操作指南：导入、排序、转换、增强、AI 助手、导出 |
| [常见问题](./docs/faq.md) | 安装、启动、AI key、OCR、Word 转 PDF 等高频问题的定位与处理 |

### 开发者篇

| 文档 | 说明 |
|:---|:---|
| [需求分析](./docs/requirements.md) | 用户角色、功能需求、非功能需求与核心用例 |
| [系统设计：架构与数据模型](./docs/architecture.md) | 技术栈选型、模块划分、数据模型与架构视图 |
| [UI 设计](./docs/ui-design.md) | 首页结构、设计 token、组件清单与交互状态规范 |
| [4+1 架构视图](./docs/4plus1-views.md) | 逻辑 / 开发 / 进程 / 物理 / 场景五视图及 UML 源码索引 |
| [系统实现说明](./docs/implementation.md) | 状态编排、排序、Word 转 PDF 链路、图像增强、AI 与 OCR 的实现细节 |
| [接口说明](./docs/api.md) | 服务端 API 路由、请求响应契约与错误码 |
| [测试文档](./docs/testing.md) | 自动化测试分层、入口与人工回归清单 |
| [部署文档](./docs/deployment.md) | 生产构建、预览、云端部署与运行时配置 |
| [贡献守则](./docs/contributing.md) | 分支与提交规范、提交前验证、文档同步规则 |

### 其他资料

| 文档 | 说明 |
|:---|:---|
| [安全审计报告](./docs/safety-review.md) | 2026-05-31 全量源码静态安全审计结论与修复优先级 |
| [重构档案](./docs/refactor/refactor.md) | 历史重构决策记录，不作为现状说明 |
| [UML 源码目录](./docs/puml/) | 上述文档引用的 PlantUML 源码文件 |

## 常用命令速查

| 命令 | 用途 |
|:---|:---|
| `npm run dev` | 开发模式（Vite 中间件 + Express 同端口联调） |
| `npm run build` | 生产构建，输出 `dist/` |
| `npm run preview` | 生产预览（需先构建，启动完整 Express 服务） |
| `npm run preview:static` | 纯静态前端预览 |
| `npm test` | 自动化测试（`test:logic` + `test:app`） |
| `npm run lint` | TypeScript 类型检查（`tsc --noEmit`） |
| `npm run setup:ocr` | 手动补齐本地 PaddleOCR 运行时 |
| `npm run smoke:ocr` | 本地 OCR 冒烟验证 |

## 许可证

[MIT License](./LICENSE)，Copyright © 2026 0xaiio。
