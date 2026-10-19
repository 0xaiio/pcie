# 测试用 PDF 资源

本目录存放测试依赖的 PDF 文件。**不要**在此放置任何保密文档或含个人敏感信息的扫描件。

## `pdf/`：真实学术论文

| 文件 | 来源 | 说明 |
|:---|:---|:---|
| `Ad Hoc Transactions through the Looking Glass...pdf` | K. Bruni 等，*Ad Hoc Transactions through the Looking Glass: An Empirical Study of Application-Level Transactions in Web Applications*，ECOOP 2013 | 39 页，LaTeX/pdfTeX 产物。**用作测试夹具的公开论文**，作者已公开发表该文。 |
| `single-page-sample.pdf` | 由上一行文件派生 | 第 1 页单页样本。生成方式见 `scripts/make-single-page-sample.mjs`。 |

### 为什么需要这份真实论文

项目的 PDF 功能测试**不能**只用自造夹具，因为要覆盖的行为恰好是自造夹具模拟不出来的：

- **矢量插图**：LaTeX 论文里的图全部由路径指令绘制，`/XObject` 下**一个位图都没有**。
  这正是「Extract Embedded Images」早期实现误报 `No extractable JPEG images found` 的真实场景。
  自造的 pdf-lib 夹具反而总会写入位图 XObject，反而测不到这条路径。
- **真实的版面结构**：双栏排版、宽窄不一的留白、跨页的图与表，都是像素带分析算法
  （`src/server/pdf-regions.ts`）的输入条件。合成页面没有这些干扰。
- **真实的字体与编码**：嵌入 Type1 子集、PDF 引用等，合成夹具不会产生这类边缘情况。

### 版权

该论文由作者公开发表，此处仅作为**自动化测试夹具**随仓库分发，用于验证本项目的 PDF 处理链路，
不用于任何产品功能演示。若需要替换成其他样本，保持上述「LaTeX 论文 + 矢量插图 + 无位图」这三个特征即可。

## `fixtures/`：自造夹具

| 文件 | 生成脚本 | 覆盖点 |
|:---|:---|:---|
| `image-extraction-fixture.pdf` | `scripts/fixtures/build-image-extraction-fixture.mjs` | DCTDecode（JPEG）、FlateDecode（无损位图）、CCITTFaxDecode（传真图）与内联图像四种编码 |

自造夹具由脚本生成、**可随时重建**，因此不承担第三方版权问题；
改动提取逻辑后若需更新，跑一次对应脚本即可。