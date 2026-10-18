# 贡献守则

本守则说明 PCIE 的开发流程、代码规范、提交前验证与文档同步规则。适用于所有向本仓库提交代码与文档的贡献者。

## 1. 开发流程

1. 从 `main` 创建特性分支：`git checkout -b feat/<topic>` 或 `fix/<topic>`。
2. 按 [架构设计](./architecture.md) 与 [UI 设计](./ui-design.md) 的边界实施改动；涉及上传、拖拽、转换链路的行为修改需在 PR 中显式说明。
3. 本地完成 [提交前验证](#3-提交前验证)。
4. 提交信息遵循 Conventional Commits 风格（如 `docs: ...`、`fix: ...`、`feat: ...`），与仓库现有历史保持一致。
5. 发起 Pull Request，按 [PR 清单](#5-pr-清单) 自查。

## 2. 代码规范

- **类型安全**：项目以 `tsc --noEmit`（`npm run lint`）作为类型门禁，不允许为绕过检查而放宽 `tsconfig.json`。
- **样式**：新增 React 组件保持现有 Tailwind CSS utility class 风格；首页级样式优先复用 [src/index.css](../src/index.css) 中的 `--home-*` token，新增 token 需在 [UI 设计](./ui-design.md#3-设计-token) 登记。
- **模块归属**：可复用的纯逻辑放入 `src/features/files/`（文件领域）或 `src/server/`（服务端）；UI 编排集中在 [src/App.tsx](../src/App.tsx) 与 `src/features/files/components/`，不要在组件间复制逻辑。
- **重型依赖按需加载**：新增体积较大的依赖时，评估是否需要 `React.lazy()` / 运行时 `import()`，并同步 [vite.config.ts](../vite.config.ts) 的 `manualChunks` 清单。
- **不改行为只换壳**：视觉层重构不得修改上传、拖拽、排序、转换等业务链路（见 [UI 设计 · 设计原则](./ui-design.md#1-设计原则)）。
- **实验脚本**：`scripts/experiments/` 下的脚本属于开发期诊断工具，不进入 `npm test`，也不得被生产代码引用。

## 3. 提交前验证

提交代码前至少执行：

```bash
npm run lint    # tsc --noEmit
npm test        # test:logic + test:app
npm run build   # 生产构建
```

如果改动涉及 PDF 编辑、AI 增强、OCR / AI 对话、Word HTML fallback 等按需加载功能，还应在构建后手动打开这些入口，确认惰性 chunk 可以正常加载。改动涉及本地 OCR 链路时，执行 `npm run smoke:ocr` 验证。

## 4. 文档同步规则

文档体系位于 `docs/`，根目录 [README.md](../README.md) 仅作索引。维护时必须遵守：

1. **DRY**：同一知识点只在一个文档展开，其他文档用相对链接引用，例如"图像增强原理"只存在于 [系统实现说明](./implementation.md)，[使用手册](./user-manual.md) 仅链接指代。
2. **文档网络**：文档间使用相对链接互联（如 `[架构设计](./architecture.md)`）；引用源码使用相对路径（如 `[src/App.tsx](../src/App.tsx)`）；引用锚点需与实际标题一致。
3. **4+1 视图**：涉及前后端边界、运行时部署、核心流程、目录结构或关键用例变化时，必须同步更新 [4plus1-views.md](./4plus1-views.md) 与 `docs/puml/` 下对应 `.puml`；不影响视图时也需在 PR 中标注"4+1 视图无需更新"。
4. **重构档案**：每次重构须在 [重构档案](./refactor/refactor.md) 记录理由、备选方案、最终方案与验证结果。
5. **README 索引**：新增 / 删除 `docs/` 文档时，同步更新 [README.md](../README.md) 的文档索引表。

## 5. PR 清单

- [ ] `npm run lint`、`npm test`、`npm run build` 全部通过
- [ ] 涉及按需加载功能时已手动验证入口
- [ ] 涉及本地 OCR 时已执行 `npm run smoke:ocr`
- [ ] 文档已按第 4 节同步，锚点与相对链接有效
- [ ] 4+1 视图影响已标注（`已更新` / `无需更新`）
- [ ] 未提交 `.env`、密钥、PII 或任何计费凭证
- [ ] UI 改动未破坏上传 / 拖拽 / 转换业务链路

## 6. 安全与合规

- `.env` 已在 `.gitignore` 中排除，**严禁**提交真实 API key；示例值只放在 [.env.example](../.env.example)。
- 新增第三方依赖前评估供应链风险；定期执行 `npm audit`。
- 已知安全边界与未修复项记录在 [安全审计报告](./safety-review.md)，修复后同步更新该报告。

## 7. 相关文档

- 测试分层与回归清单：[测试文档](./testing.md)
- 接口契约：[接口说明](./api.md)
- 部署与运行时配置：[部署文档](./deployment.md)
