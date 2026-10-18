# UI 设计

本文档描述 PCIE 工作区的界面结构、设计 token、组件清单与交互状态规范，作为前端视觉层修改与评审的统一基线。交互行为的实现细节见 [系统实现说明](./implementation.md)。

## 1. 设计原则

1. **工具型首页，而非营销长页**：首页只承担"进入工作区"一个动作，视觉重心收束到上传入口。
2. **本地优先的视觉语义**：Hero 直接展示 `Local-first by default` 与 `AI only when configured` 两个状态标签，让产品前提在首屏可见。
3. **单一主 CTA**：上传区提供明确的 `Choose files` 按钮，整卡拖拽作为辅助路径。
4. **暖中性色 + 单一强调色**：页面基底使用暖灰中性色，强调色只保留一种低饱和蓝，避免冷硬感。
5. **视觉层可重构，业务逻辑不动**：上传、拖拽、转换、排序等行为链路只允许换壳，不允许在视觉重构中改变行为（历史重构结论见 [重构档案 · UI 轮次](./refactor/refactor.md) 与 `ai/ui/ui-plan.md`）。

## 2. 首页结构

首页首屏由 [src/App.tsx](../src/App.tsx) 组合，自上而下分四层：

```
<div> 页面容器（max-w-[88rem]，bg-[var(--home-page-bg)]）
├── <HomeHero />                    顶部 Hero：产品前提 + 主标题 + 副文案
├── <section> 首屏入口工作台
│   ├── #workspace-upload-panel    Workspace Upload 上传面板（主 CTA）
│   └── <HomeCapabilityStrip />     capability strip：PDF / Image / Word 三条 workflow
├── <main> 工作区
│   ├── <ImageFilesSection />      图片区块
│   ├── <PdfFilesSection />        PDF 区块
│   └── <WordFilesSection />       Word 区块
└── 浮动下载栏（选中文件数 > 0 时滑入）
```

### 2.1 Hero（[src/components/HomeHero.tsx](../src/components/HomeHero.tsx)）

- 两个胶囊状态标签：`Local-first by default`（Lock 图标）、`AI only when configured`（Sparkles 图标）。
- 主标题 `PDF, Word, and Images in One Local-First Workspace`，使用 `clamp(1.8rem, 3vw, 2.5rem)` 响应式字号，宽屏单行（`sm:whitespace-nowrap`）。
- 两段副文案说明工作方式与 LLM 默认关闭语义。
- 背景为顶部 radial 暖色洗色 + 半透明白色卡片，圆角 `rounded-[2rem]`。

### 2.2 Workspace Upload 面板

- 由 [src/App.tsx](../src/App.tsx) 渲染，锚点 id 为 `workspace-upload-panel`。
- 隐藏 `<input type="file" multiple>`，`accept` 覆盖 `application/pdf`、`image/png`、`image/jpeg`、`image/jpg`、`.doc`、`.docx` 及对应 MIME。
- 面板中央展示上传图标、`Workspace Upload` 标签、三类格式胶囊（`PDF`、`DOC / DOCX`、`PNG / JPG / JPEG`）、主 CTA 按钮 `Choose files` 与次级提示 `or drag and drop files here`。
- 拖拽悬停时切换为高亮边框与投影（`isDragging` 状态），松开放下触发 `handleDrop`。
- 上传逻辑统一复用 `fileInputRef`、`openFilePicker()`、`processFiles()`、`handleFileInput()`，视觉修改不得改动这套链路。

### 2.3 Capability Strip

- 同样定义于 [src/components/HomeHero.tsx](../src/components/HomeHero.tsx) 的 `HomeCapabilityStrip`。
- 三条 workflow（PDF / Image / Word）共享同一个 ribbon 容器，`md:grid-cols-3` 分隔，避免三张独立白卡的堆叠感。
- 图标使用统一的自绘文件徽章 `DocumentGlyph`（PDF 玫红 / DOC 天蓝 / IMG 翠绿），不与其他图标体系混用。

## 3. 设计 Token

首页样式 token 集中在 [src/index.css](../src/index.css) 的 `:root`，修改首页视觉前应先检查是否可用现有 token 表达：

| Token | 值（示例） | 用途 |
|:---|:---|:---|
| `--home-page-bg` | `#f5efe7` | 页面基底暖灰 |
| `--home-surface-bg` / `--home-surface-border` | 半透明白 / 暖灰描边 | 首屏入口工作台容器 |
| `--home-ribbon-bg` / `--home-ribbon-border` | 半透明暖白 / 暖灰描边 | capability strip 容器 |
| `--home-title` | `#6689a8` | 标题色 |
| `--home-accent` / `--home-accent-hover` | `#2d5f7e` / `#244d67` | 唯一强调色（CTA、focus） |
| `--home-accent-soft` | 淡蓝 | 上传图标底色 |
| `--home-shell-shadow` / `--home-soft-shadow` / `--home-card-shadow` | 三级暖色投影 | 容器层级 |

正文文字使用 `zinc` 中性阶梯（标题 `zinc-950`、次级 `zinc-500/600`），字体沿用系统 sans（`Aptos` / `Segoe UI Variable Text` / `Segoe UI`），不引入额外字体下载。

## 4. 组件清单

### 4.1 常驻组件

| 组件 | 文件 | 职责 |
|:---|:---|:---|
| `App` | [src/App.tsx](../src/App.tsx) | 状态编排、首屏组合、工作区与浮动下载栏 |
| `HomeHero` / `HomeCapabilityStrip` | [src/components/HomeHero.tsx](../src/components/HomeHero.tsx) | 首页 Hero 与能力摘要带 |
| `ImageFilesSection` | [src/features/files/components/ImageFilesSection.tsx](../src/features/files/components/ImageFilesSection.tsx) | 图片区块列表与批量操作 |
| `PdfFilesSection` | [src/features/files/components/PdfFilesSection.tsx](../src/features/files/components/PdfFilesSection.tsx) | PDF 区块列表与批量操作 |
| `WordFilesSection` | [src/features/files/components/WordFilesSection.tsx](../src/features/files/components/WordFilesSection.tsx) | Word 区块列表与批量操作 |
| `FileSectionHeader` | [src/features/files/components/FileSectionHeader.tsx](../src/features/files/components/FileSectionHeader.tsx) | 区头与 `NAME / DATE / SIZE` 排序胶囊 |
| `EditableFileNameCell` | [src/features/files/components/EditableFileNameCell.tsx](../src/features/files/components/EditableFileNameCell.tsx) | 行内重命名 |
| `MoveFileButtons` | [src/features/files/components/MoveFileButtons.tsx](../src/features/files/components/MoveFileButtons.tsx) | 行内上移 / 下移 |
| `ConversionProgressCard` | [src/features/files/components/ConversionProgressCard.tsx](../src/features/files/components/ConversionProgressCard.tsx) | 图片 / Word 批量转 PDF 进度卡片 |

### 4.2 按需加载模态框

`PdfEditor`、`AiAssistant`、`ImageEnhanceModal`、`FilePreview` 通过 `React.lazy()` 拆包，挂载时展示 `ModalLoadingFallback`（居中旋转图标 + `Loading workspace tool...`），加载策略见 [系统实现说明 · 首页结构与加载策略](./implementation.md#3-首页结构与加载策略)。

## 5. 交互状态规范

| 状态 | 表现 | 代码位置 |
|:---|:---|:---|
| 拖拽悬停 | 上传面板高亮边框 + 投影增强 | `isDragging` 分支样式（App.tsx） |
| 模态框加载 | 全屏遮罩 + 旋转 Loader + 文案 | `ModalLoadingFallback` |
| 批量转换中 | 环形百分比 + 进度条 + `x/y` + 当前文件名；Word 额外显示已用时长与转换方式标签 | `ConversionProgressCard` |
| 转换失败 | 顶部红色左边框错误条，展示错误详情 | `conversionError` 渲染块（App.tsx） |
| 存在选中 | 底部浮动下载栏滑入，显示选中数量与下载按钮 | 浮动 Download Bar（App.tsx） |
| 键盘可达 | 上传面板支持键盘触发；CTA 有 `focus-visible` 环 | `handleUploadZoneKeyDown` 等 |

## 6. 响应式与可访问性

- 断点使用 Tailwind 默认 `sm` / `md` / `lg`；标题用 `clamp()` 流式缩放，宽屏对关键文案使用 `sm:whitespace-nowrap` 防折行，窄屏自动回退多行。
- capability strip 在 `md` 以下纵向堆叠、以上三列分隔。
- 图标体系统一为 `lucide-react` + 自绘文件徽章两类已知来源，新增图标需说明归属。
- 交互元素（上传面板、CTA、模态框）需保留键盘可达与可见焦点态。

## 7. 维护规则

1. 视觉层重构允许调整布局、间距、配色与图标，但不得修改 `processFiles()`、拖拽事件、键盘事件与 `fileInputRef` 复用关系。
2. 新增首页级样式优先复用 [src/index.css](../src/index.css) 现有 token；确需新增时在本文档登记。
3. 首页结构、上传入口或 capability strip 发生变化时，同步更新 [README.md](../README.md) 截图、[使用手册](./user-manual.md) 的首屏描述与 [系统实现说明](./implementation.md) 的对应章节。
