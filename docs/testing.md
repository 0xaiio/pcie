# 测试文档

本文档说明本项目的自动化测试边界与人工回归清单，用于保障文件处理、AI gateway、本地 OCR 与核心交互流程的稳定性。提交前的验证要求见 [贡献守则](./contributing.md#3-提交前验证)。

## 1. 测试策略

测试分为四层：

1. **纯逻辑回归**：覆盖文件分类、选择、排序、重命名、复制、批量删除与 Zip 命名冲突处理
2. **应用层回归**：覆盖文件列表组件、PDF 编辑流程、运行时配置加载、AI gateway 与本地 OCR 服务端模块
3. **人工集成验证**：验证跨模块文件流转、浏览器交互与宿主机依赖链路
4. **实验 / 诊断脚本**：用于环境探测与手工联调，不并入默认自动化测试入口

### 1.1 自动化测试入口

```bash
npm test
```

该命令会顺序执行：

```bash
npm run test:logic
npm run test:app
```

- `npm run test:logic`：运行 `src/features/files/file-utils.test.ts`
- `npm run test:app`：运行 Vitest 应用层测试，覆盖文件列表交互、排序与行内移动、图片 / Word 转 PDF 进度、`PdfEditor` 页操作、前端运行时配置加载、服务端 AI provider 顺序回退、本地 OCR 调度、PDF 压缩辅助逻辑、旧版 `.doc` 提取辅助逻辑、**PDF 多格式渲染（转图片）与格式选择下拉控件**（`src/server/pdf-render*.app.test.ts`、`src/features/files/components/ConvertToImageMenu.ui.test.tsx`）、**PDF 多格式图片提取与 caption 命名**（`src/server/pdf-images.app.test.ts`）与浏览器自动打开策略（`src/server/auto-open.app.test.ts`）

兼容性说明：`npm run test:ui` 保留为 `npm run test:app` 的别名。

测试规模：**15 个测试文件、144 个用例**，`tsc --noEmit` 与 `npm test` 全绿。

### 1.2 PDF 转图片（多格式渲染）

`src/server/pdf-render-shared.app.test.ts`（纯契约，无 I/O）与 `src/server/pdf-render.app.test.ts`（真实 PDF）覆盖：

| 覆盖点 | 说明 |
|:---|:---|
| 格式注册表 | 至少含 PNG / JPG / JPEG / SVG，并含 WebP / BMP / TIFF / GIF；每个格式都有扩展名、MIME 与展示名，扩展名不重复 |
| 默认 SVG 行为 | 未指定格式时回退 `svg`，返回**文本**而非二进制；内容含真实矢量图元 |
| 矢量与 DPI 解耦 | 断言 SVG 产出与 dpi 参数完全无关（矢量路径不经过光栅化矩阵） |
| 单页转换 | 用 `test/resources/pdf/single-page-sample.pdf`（由真实论文派生）跑通 PNG 与 SVG |
| 多页逐页输出 | 真实 39 页论文的前 3 页逐页渲染，断言各页字节均可识别且互不相同（证明不是只转首页） |
| 格式合法性 | 每种格式都用 magic bytes 独立校验（PNG `89 50 4E 47`、JPEG `FF D8 … FF D9`、WebP `RIFF…WEBP`、BMP `BM`、TIFF `II*` / `MM\`、GIF `GIF`、SVG `<svg`），不依赖任何解码库 |
| 格式别名 | `tif`→`tiff`、`jpe`/`jfif`→`jpeg`、`dib`→`bmp`、`.png`→`png`；大小写与空格不敏感 |
| 非法格式回退 | 未知格式回退 SVG 而非抛错，且不污染注册表 |
| DPI 换算 | 72 DPI → 612×792，150 / 300 DPI 尺寸按比例放大 |
| 像素缓冲 | 输出为紧密排列的 RGB（3 通道），内容非全黑 |

#### BMP RLE8 编码器的三层交叉验证

BMP 无第三方库可用（sharp 也不支持 BMP 输出），因此编码器由本仓库自研，测试用三种独立方式验证：

1. **纯规范参考解码器**（写在测试文件里，只依赖 BMP 格式定义，不 import 任何解码库）——逐索引比对真实 PDF 页面的调色板索引，要求 **0 失配**。
2. **magic bytes 与结构断言** —— BITMAPINFOHEADER、压缩方式、像素数据 4 字节对齐、每行写满、行数与 EOB 完整。
3. **能力边界断言** —— 检查 `sharp.format.bmp.output` 为假，若将来 sharp 支持 BMP 输出则测试会失败并提示可移除自研编码器。

测试还显式钉死了两个真实踩过的坑：

- **绝不产生 DELTA**：`00 02` 在 RLE8 里是 DELTA 转义码，不是「2 像素绝对段」。测试扫描整个 RLE 流断言 DELTA 段数为 0——一旦回归写 `00 02`，解码器会整体错位。
- **通道数不靠启发式**：`612×792×3 = 1455552` 恰好能被 4 整除，纯白页面上「每隔 4 字节取一个」恒为 255，两种启发式都会把 RGB 误判成 RGBA。测试用纯白缓冲区断言通道数由调用方显式指定。

另外覆盖四种极端图案（全白 / 全黑 / 逐像素全异 / 黑白交替）的往返一致性，以及 RLE8 压缩率优于未压缩索引数据。

### 1.3 格式选择下拉控件

`src/features/files/components/ConvertToImageMenu.ui.test.tsx`（22 个用例）与 `PdfFilesSection.ui.test.tsx` 的集成用例覆盖：

| 覆盖点 | 说明 |
|:---|:---|
| 双按钮结构 | 主按钮（默认 SVG）与右下角下拉三角在同一按钮组内；三角带 `aria-haspopup="menu"` |
| 默认收起 | 初始不渲染菜单 |
| 主按钮行为 | 点击回调 `'svg'`，与旧版行为一致 |
| 菜单内容 | 列出全部注册格式；SVG 项标注 `default` 且仅此一项有该标注 |
| 逐格式选择 | 参数化地对每个格式断言回调值，并验证选择后菜单收起 |
| 非默认不误触 | 选 PNG 时断言从未回调 `'svg'` |
| 关闭交互 | 点击外部、按 `Esc` 均关闭；关闭不触发回调 |
| 事件隔离 | 主按钮与菜单项点击都不冒泡到行容器（避免误触发行选择） |
| 禁用态 | 转换中该行两按钮禁用，其他行不受影响 |
| 行级隔离 | 在第二行展开选格式只回调第二行文件 |

### 1.4 PDF 图片提取

`src/server/pdf-images.app.test.ts` 覆盖以下场景，基于合成夹具与真实 PDF 运行：

| 覆盖点 | 说明 |
|:---|:---|
| 多格式提取 | 夹具同时包含 DCTDecode(JPEG)、FlateDecode、CCITTFaxDecode 三类 XObject，断言全部提取成功且 `decodeFailures` 为 0 |
| 输出合法性 | 每张提取结果都是可显示的 PNG、MIME 为 `image/png`、宽高为正 |
| caption 命名 | 文件名形如 `page-3-The-coordinator.png`（图注前缀已剥离），未匹配时回退 `page-N-image-M.png` |
| 命名安全 | 覆盖文件系统非法字符剔除、中日韩保留、Windows 保留设备名、长度上限、句末方括号引用剥离 |
| 唯一性 | 断言整份文档内文件名不重复 |
| 题注定位 | 支持 `Figure` / `Fig.` / `Table` 与 `图` / `表` 等中英文写法；无题注时返回 null |
| 矢量归因 | 对真实 39 页 LaTeX 论文断言「图为矢量、无位图」，且提示里**必须**含可执行的下一步（`PDF 转图片`），且**不得**出现 `only JPEG` / `只支持 JPEG` 之类的误导性措辞 |
| 空文档 | 分别覆盖 0 页与无内容的提示差异 |

夹具由脚本生成，不手工维护：

```bash
node scripts/fixtures/build-image-extraction-fixture.mjs
```

单页样本同样由脚本从真实论文派生（`mupdf` 的 `graftPage` 移植第 1 页，保留真实矢量内容而非人造空白页）：

```bash
node --experimental-strip-types scripts/make-single-page-sample.mjs
```

> `scripts/fixtures/` 与 `scripts/make-single-page-sample.mjs` 属于测试资源构建工具，不属于 `scripts/experiments/`（后者刻意不纳入 `npm test`）。
> 生成脚本幂等：样本已是目标页数时直接跳过。

### 1.5 实验脚本的边界

`scripts/experiments/` 按用途拆分为：

- `diagnostics/`：环境、CLI 与第三方库能力探测
- `manual/`：需要本地服务或人工观察结果的联调脚本
- `spikes/`：一次性技术验证与可行性试验

这些脚本属于开发期验证工具，不纳入 `npm test`。

本地 OCR 诊断有一个固定 smoke 入口：

```bash
npm run smoke:ocr
```

该命令会确保 `.local/paddleocr/` bootstrap 可用，生成一张样例图片，并通过真实的 `runLocalImageOcrRequest` 路径输出耗时与 OCR 结果预览。遇到 `LocalOcrRequestError`、Python 环境异常或模型预热问题时，优先执行这条命令。

## 2. 人工回归清单

### 模块一：全局文件组织（拖拽与排序）
| 用例编号 | 用例名称 | 操作动作 | 预期结果 | 状态 |
|----------|----------|----------|----------|------|
| TC-01 | 类型混合导入 | 同时拖入一个 PDF、一个 `jpg`、一个 `docx` | 文件被分发到 Image、PDF、Word 三个区块，并显示对应状态 | [ ] |
| TC-02 | 跨文件删除 | 在不同分类中选中若干文件后执行删除 | 只有被选中的文件消失，其余文件保持不变 | [ ] |
| TC-03 | 名称自然排序 | 上传 `file1.pdf`、`file2.pdf`、`file10.pdf` 后点击 `NAME` 排序 | 顺序应为 `file1`、`file2`、`file10` | [ ] |
| TC-04 | 行内顺序微调 | 在任意分组中连续点击“上移 / 下移” | 文件与相邻项交换位置，分组回到手动顺序 | [ ] |
| TC-05 | 排序控件可发现性 | 首次进入页面，观察 `NAME / DATE / SIZE` 区域 | 排序区域应呈现为带图标的胶囊按钮组 | [ ] |
| TC-06 | 排序方向切换 | 点击 `SIZE` 排序按钮两次 | 顺序方向发生切换，方向图标同步更新 | [ ] |

### 模块二：图像增强与图片转 PDF
| 用例编号 | 用例名称 | 操作动作 | 预期结果 | 状态 |
|----------|----------|----------|----------|------|
| TC-07 | 大图增强载入 | 上传 4K 以上或 5MB 以上图片并执行增强 | 处理可能耗时较长，但浏览器不应崩溃或白屏 | [ ] |
| TC-08 | 对比滑块边界 | 在增强结果中将滑块拖到左右边界 | 左侧显示原图，右侧显示增强图，布局保持稳定 | [ ] |
| TC-09 | 增强中断 | 模型加载中立刻取消增强窗口 | 模态框正常关闭，页面不出现假死 | [ ] |
| TC-10 | 图片转 PDF 进度 | 选中 3 张以上图片后执行 **Convert to PDF** | 显示百分比、进度条、`已完成/总数` 与当前文件名，进度逐张推进 | [ ] |

### 模块三：Word 转 PDF（含旧版 `.doc`）

验证顺序按 `local Microsoft Word -> LibreOffice CLI -> browser HTML fallback` 执行。

| 用例编号 | 用例名称 | 操作动作 | 预期结果 | 状态 |
|----------|----------|----------|----------|------|
| TC-11 | Word 转 PDF 进度 | 选中 3 份以上 Word 文档后执行 **To PDF** | 显示绿色进度卡片，包含百分比、进度条、`已完成/总数`、当前文件名与已用时长 | [ ] |
| TC-11A | Word 完成态收尾 | 等待多份 Word 转换全部完成 | 进度卡先显示 `100%` 收尾状态，再自动消失；不出现阻塞式成功对话框 | [ ] |
| TC-11B | Word 方式提示 | 执行 **To PDF** 并观察进度卡 | 进度卡显示当前转换方式，如 `LibreOffice CLI export`、`local Microsoft Word export` 或 `browser HTML fallback` | [ ] |
| TC-11C | Word 回退链 | 在不同宿主机条件下重复执行 **To PDF** | 系统按 Word、LibreOffice、HTML 的顺序依次回退，界面方式提示同步变化 | [ ] |
| TC-12 | `.doc` 转 PDF | 上传一份旧版 `.doc` 并执行 **To PDF** | 成功生成 PDF；即使版式无法完全恢复，正文文本应可读 | [ ] |
| TC-13 | Word 导出非空白页 | 分别将 `.docx` 与 `.doc` 转成 PDF 后打开结果 | 输出 PDF 不应为空白页 | [ ] |

### 模块四：PDF 工作台
| 用例编号 | 用例名称 | 操作动作 | 预期结果 | 状态 |
|----------|----------|----------|----------|------|
| TC-14 | PDF 单页删除 | 打开 PDF 编辑器并删除指定页面 | 缩略图与页码即时更新，导出的 PDF 仅保留剩余页面 | [ ] |
| TC-14A | 多格式图片提取 | 对含位图的 PDF 点击 **Extract Embedded Images** | 图片按页加入 Images 区块，全部为可打开的 PNG | [ ] |
| TC-14B | caption 命名 | 观察提取出的图片文件名 | 文件名取自图中标题（如 `...-p2.png`），而非 `img-1.jpg` 这类序号名 | [ ] |
| TC-14C | 纯矢量论文提示 | 对插图由矢量绘制而成的 LaTeX 论文执行提取 | 提示"文档不含位图、图形为矢量绘制"，并指引改用 **Convert Pages to Vector (SVG)**；不再出现 `No extractable JPEG images found` | [ ] |

### 模块五：导出与打包
| 用例编号 | 用例名称 | 操作动作 | 预期结果 | 状态 |
|----------|----------|----------|----------|------|
| TC-15 | 复合文件打包 | 勾选增强后的图片副本、拆分后的 PDF 与 Word 文件并导出 Zip | 压缩包生成成功，解包后文件可正常打开 | [ ] |

### 模块六：运行时与环境回归
| 用例编号 | 用例名称 | 操作动作 | 预期结果 | 状态 |
|----------|----------|----------|----------|------|
| TC-16 | 开发端口自动回退 | 占用 `3000` 后再次执行 `npm run dev` | 新实例自动选择新的可用端口，终端输出 `Port 3000 is busy, using http://localhost:<实际端口> instead.` 与 `Server running on http://localhost:<实际端口>` | [ ] |
| TC-16A | 启动后自动打开浏览器 | 执行 `npm run dev` 并观察终端与桌面 | 启动成功后默认浏览器自动打开 `http://localhost:<最终端口>`，终端打印 `Opening <url> in your default browser...` | [ ] |
| TC-16B | 关闭自动打开浏览器 | 以 `AUTO_OPEN=false npm run dev` 启动 | 不弹出浏览器，终端打印 `Browser auto-open is disabled. Visit <url> manually.`，服务正常启动 | [ ] |
| TC-17 | 缺失 AI Key 启动 | 删除或临时重命名 `.env` 后执行 `npm run dev` | 首页与基础文件处理功能正常，AI 助手提示需要配置 key，本地 OCR 仍可用 | [ ] |
| TC-17A | 本地 OCR bootstrap 缺失 | 删除或临时重命名 `.local/paddleocr/` 后执行图片 OCR | 界面提示安装 Python `3.9–3.13` 并重跑 `npm install` 或 `npm run setup:ocr` | [ ] |
| TC-17B | 不受支持的 Python 版本 | 仅存在 Python 3.14+ 时执行 `npm run setup:ocr` | 引导脚本直接报错并提示 PaddlePaddle CPU wheel 支持 `3.9–3.13`，建议使用 `PCIE_PYTHON` 指定解释器；不进入 pip 安装阶段 | [ ] |
| TC-18 | 生产环境运行时注入 | 在构建产物上设置 AI key 后通过 `npm run start` 启动并访问 `/api/runtime-config` | 服务返回 provider 与本地 OCR readiness 摘要，而不是原始 key | [ ] |
| TC-19 | 多 provider 顺序回退 | 同时配置多个 AI key，并让首个 provider 故意失败 | 系统自动回退到后续可用 provider，界面无需手动切换模型 | [ ] |

## 3. 相关文档

- 测试分层对应的实现细节见 [系统实现说明](./implementation.md)
- 接口行为契约见 [接口说明](./api.md)
- 提交前验证流程见 [贡献守则](./contributing.md)
- 图片提取修复的根因分析见 [变更记录](./changelog.md)
