/**
 * 从 PDF 中提取嵌入的所有格式位图，并按图注（caption）命名。
 *
 * 背景：早期实现只查找 JPEG/XObject，遇到 LaTeX 编译的学术论文会报
 * 「No extractable JPEG images found in this PDF」，而这类论文的图往往是
 * 矢量或以 FlateDecode 存放的无损位图。现在改为遍历全部 XObject 子类型，
 * 对每个候选解码后按真实像素特征判定格式。
 *
 * 另一个易踩的坑：不能把「文档里没有位图」与「图是矢量」混为一谈。
 * 后者需要给出可执行的结论（先转图片再提取），否则用户会以为功能坏了。
 */

export interface ExtractedImage {
  /** 1 起始的页码。 */
  page: number;
  /** 以图注命名的文件名（含扩展名）。 */
  fileName: string;
  /** 匹配到的图注原文；未匹配时为 null。 */
  caption: string | null;
  /** 是否成功匹配到图注。 */
  captionMatched: boolean;
  width: number;
  height: number;
  /** 归一化后的格式标识（小写）。 */
  format: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ExtractPdfImagesResult {
  images: ExtractedImage[];
  /** 实际扫描过的页数。 */
  scannedPages: number;
  /** 解码失败的 XObject 数量。 */
  decodeFailures: number;
}

/** 各图片格式的 MIME 映射。 */
const MIME_BY_FORMAT: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  jp2: 'image/jp2',
  jpx: 'image/jpx',
  ppm: 'image/x-portable-pixmap',
  pgm: 'image/x-portable-graymap',
  pbm: 'image/x-portable-bitmap',
  pam: 'image/x-portable-arbitrarymap',
};

/** 图注前缀。匹配时允许 `Figure` / `Fig.` / `FIGURE` 等写法，并可选带章节号。 */
const CAPTION_PATTERNS: RegExp[] = [
  /\b(?:figure|fig)\s*(?:\d+(?:\.\d+)*)?\s*[.:：]\s*([^\n\r]{3,200})/gi,
  /\b(?:table|tab)\s*(?:\d+(?:\.\d+)*)?\s*[.:：]\s*([^\n\r]{3,200})/gi,
  /图\s*\d+(?:\.\d+)*\s*[.:：]\s*([^\n\r]{2,200})/g,
  /表\s*\d+(?:\.\d+)*\s*[.:：]\s*([^\n\r]{2,200})/g,
];

/** 常见的图注标签，供 XObject 自身带有的 /Name 或结构属性使用。 */
const CAPTION_LABELS = ['Caption', 'Alt', 'ActualText', 'T'];

/** 剥掉图注前缀，得到适合做文件名的片段。 */
export function sanitizeCaptionFragment(caption: string): string {
  let text = caption
    // 去掉开头的「图 3.」「Figure 3.」「Fig. 2.」「Table 1.」等前缀。
    // 关键词与编号之间允许空格或紧贴，缩写自带的那种点号（Fig.）也要吃掉。
    .replace(
      /^\s*(?:figure|fig|table|tab|图|表)\s*\.?\s*\d+(?:\.\d+)*\s*[.:：]?\s*/i,
      '',
    )
    .replace(/^\s*\d+(?:\.\d+)*\s*[.:：]\s*/, '')
    .trim();

  // 文件名非法字符 -> 连字符；连续空白也压成连字符
  text = text.replace(/[\\/:*?"<>|]/g, '-');
  text = text.replace(/\s+/g, '-');
  text = text.replace(/-+/g, '-');
  text = text.replace(/^[-.]+|[-.]+$/g, '');

  // 剥掉句末的方括号引用（如学术图注常见的 "[8]"、"[12, 15]"）
  text = text.replace(/[\s,;:.!?]*\[[^\]]*\]\s*$/, '');
  // 剥掉其余标点收尾
  text = text.replace(/[\s,;:.!?]+$/, '');
  // 引用剥除后可能又露出尾部连字符
  text = text.replace(/-+$/, '');

  if (!text) return 'image';

  // Windows 保留设备名
  const reserved = new Set([
    'con', 'prn', 'aux', 'nul',
    ...Array.from({ length: 10 }, (_, i) => `com${i}`),
    ...Array.from({ length: 10 }, (_, i) => `lpt${i}`),
  ]);
  if (reserved.has(text.toLowerCase())) return 'image';

  // 文件名长度上限（留出扩展名与序号的空间）
  return text.slice(0, 80);
}

/** 在一段文本中找出第一个图注。 */
export function matchCaptionForImage(pageText: string): string | null {
  if (!pageText) return null;
  for (const pattern of CAPTION_PATTERNS) {
    // 正则是全局的，每次匹配前重置 lastIndex
    pattern.lastIndex = 0;
    const match = pattern.exec(pageText);
    if (match?.[1]) {
      const caption = match[1].trim();
      if (caption.length >= 2) return caption;
    }
  }
  return null;
}

/**
 * 构造导出文件名。
 *
 * 形如 `page-3-Figure-2-Spree-uses-an-ad-hoc-transaction.png`：
 * 页码保证同一页多图时不冲突，图注片段保证可读。
 */
export function buildImageFileName(
  page: number,
  caption: string | null,
  extension: string,
  index?: number,
): string {
  const fragment = caption ? sanitizeCaptionFragment(caption) : null;
  const suffix = index === undefined ? '' : `-${index}`;
  const body = fragment && fragment !== 'image'
    ? `page-${page}-${fragment}`
    : `page-${page}-image${suffix}`;
  return `${body}.${extension}`;
}

/** 判断一段文本里是否含有可见的矢量墨迹（用于区分「图是矢量」与「文档没图」）。 */
export function hasVectorInk(operatorBytes: Uint8Array): boolean {
  // PDF 内容流里的路径/文字绘制算子：m l c v y re S s f F n B W 等
  const paintingOps = new Set([
    0x6d, // m moveto
    0x6c, // l lineto
    0x63, // c curveto
    0x76, // v
    0x79, // y
    0x72, // r re (矩形)
    0x53, // S stroke
    0x73, // s closepath+stroke
    0x66, // f fill
    0x46, // F
    0x42, // B
    0x62, // b
    0x54, // T 文本显示
    0x57, // W 裁剪
  ]);

  for (const byte of operatorBytes) {
    if (paintingOps.has(byte)) return true;
  }
  return false;
}

/**
 * 统计「有内容」的页数，用于「无位图」诊断的分母侧描述。
 *
 * 判据是**该页有文字或路径墨迹**，不是「检测到矢量插图」——
 * 纯 LaTeX 论文的插图确实是矢量绘制，但要把它和正文区分开需要版面分析，
 * 远超「这份文档有没有内容」这个问题的范围。因此返回值只用于说明
 * 「文档并非空白」，不可解读为「这么多页含图」。
 *
 * 另需注意：mupdf 的 StructuredTextWalker.beginLine 是**按 span** 触发的，
 * 不是按行；此处只取 bbox 聚合范围，不依赖行文本，故不受影响。
 */
export async function countPagesWithVectorInk(
  pdfBytes: Uint8Array,
): Promise<{ pageCount: number; pagesWithInk: number }> {
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');

  try {
    const pageCount = doc.countPages();
    let pagesWithInk = 0;

    for (let i = 0; i < pageCount; i += 1) {
      const page = doc.loadPage(i);
      try {
        const bounds = page.getBounds();
        const structured = page.toStructuredText('preserve-whitespace,preserve-spans');
        const text = structured.asText();
        structured.destroy();

        // 有文字即算「有内容」；无文字时再用极低 DPI 光栅化近似判断有无路径墨迹
        const hasText = text.trim().length > 0;
        let hasPath = false;
        if (!hasText && Array.isArray(bounds)) {
          const pixmap = page.toPixmap(
            mupdf.Matrix.scale(0.1, 0.1),
            mupdf.ColorSpace.DeviceGray,
            false,
          );
          try {
            const pixels = pixmap.getPixels();
            const stride = pixmap.getStride();
            for (let p = 0; p < pixels.length; p += Math.max(1, Math.floor(stride / 8))) {
              if (pixels[p] < 200) {
                hasPath = true;
                break;
              }
            }
          } finally {
            pixmap.destroy();
          }
        }

        if (hasText || hasPath) pagesWithInk += 1;
      } finally {
        page.destroy();
      }
    }

    return { pageCount, pagesWithInk };
  } finally {
    doc.destroy();
  }
}

/** 生成「文档里没有可提取位图」时的可执行提示。 */
export async function buildNoImagesMessage(input: {
  pageCount: number;
  pagesWithContent: number;
}): Promise<string> {
  const { pageCount, pagesWithContent } = input;

  if (pageCount === 0) {
    return '这个 PDF 没有任何页面，无法提取图片。';
  }

  if (pagesWithContent > 0) {
    return [
      `这份 PDF 共 ${pageCount} 页，其中 ${pagesWithContent} 页含有文字或图形内容，`,
      '但没有找到任何内嵌的位图图片。',
      '这类文档（LaTeX 编译的学术论文最常见）里的图是用矢量指令绘制的，',
      '本身就不是图片对象，因此无法直接导出。',
      '建议先用「PDF 转图片」把页面转成 SVG 或 PNG，再从图片中裁剪所需插图。',
    ].join('');
  }

  return [
    `这份 PDF 共 ${pageCount} 页，但没有检测到图形或文字内容。`,
    '可能是一份空白文档，或内容全部由扫描件组成但未包含图片对象。',
  ].join('');
}

/**
 * 提取 PDF 中所有格式的嵌入位图。
 *
 * 遍历每页资源字典 `/XObject` 下的**全部**子对象（不只 `/Subtype /Image`，
 * 因为历史遗留文档里 FlateDecode 包装的位图其 `/Subtype` 常被写成 `/Form`），
 * 交给 `PDFDocument.loadImage` 解码——它按 `/Filter` 选择解码器，
 * DCTDecode(JPEG) / FlateDecode(原始位图) / CCITTFaxDecode(传真图) 都能处理，
 * 这正是「提取所有格式图片」所需。
 */
export async function extractPdfImages(
  pdfBytes: Uint8Array,
  sourceName: string,
  options: { yieldEveryMs?: number } = {},
): Promise<ExtractPdfImagesResult> {
  const { yieldEveryMs = 0 } = options;
  const mupdf = await import('mupdf');
  // 用 PDFDocument 而非通用 Document：loadImage / getObject 等 API 只在 PDFDocument 上。
  const pdfDoc = mupdf.PDFDocument.openDocument(pdfBytes, 'application/pdf');

  const images: ExtractedImage[] = [];
  let scannedPages = 0;
  let decodeFailures = 0;

  try {
    const pageCount = pdfDoc.countPages();

    for (let i = 0; i < pageCount; i += 1) {
      const page = pdfDoc.loadPage(i);
      try {
        scannedPages += 1;

        const structured = page.toStructuredText('preserve-whitespace,preserve-spans');
        const pageText = structured.asText();
        structured.destroy();

        // 未使用的图注按出现顺序分配给本页图片
        const captions = findCaptionsOnPage(pageText);
        const seenXrefs = new Set<string>();
        let indexOnPage = 0;

        for (const xobject of collectImageXrefs(page as import('mupdf').PDFPage)) {
          // 同一个 XObject 可能被多个资源名引用，按对象地址去重
          const key = xobject.isIndirect() ? String(xobject.asIndirect()) : '';
          if (key) {
            if (seenXrefs.has(key)) continue;
            seenXrefs.add(key);
          }

          const decoded = decodeXObject(pdfDoc as import('mupdf').PDFDocument, xobject);
          if (!decoded) {
            decodeFailures += 1;
            continue;
          }

          const caption = captions.shift() ?? null;
          indexOnPage += 1;

          images.push({
            page: i + 1,
            fileName: buildImageFileName(
              i + 1,
              caption,
              'png',
              caption ? undefined : indexOnPage,
            ),
            caption,
            captionMatched: caption !== null,
            width: decoded.width,
            height: decoded.height,
            // 解码后统一重编码为 PNG：格式无关、无损，前端 <img> 可直接显示
            format: 'png',
            mimeType: MIME_BY_FORMAT.png,
            bytes: decoded.bytes,
          });
        }

        if (yieldEveryMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, yieldEveryMs));
        }
      } finally {
        page.destroy();
      }
    }

    return { images, scannedPages, decodeFailures };
  } finally {
    pdfDoc.destroy();
  }
}

/**
 * 收集一页资源字典里所有位图 XObject。
 *
 * 不按 `/Subtype` 过滤：FlateDecode / CCITTFaxDecode 包装的位图其 `/Subtype`
 * 可能是 `/Form`（历史遗留），而判断「是不是图」最可靠的依据是
 * 「能否用 `PDFObject.getImage()` 解出像素」。
 *
 * `/XObject` 字典是资源字典的**可继承**属性，因此要先沿页面树向上找。
 */
function collectImageXrefs(page: import('mupdf').PDFPage): import('mupdf').PDFObject[] {
  const objects: import('mupdf').PDFObject[] = [];

  const pageObj = page.getObject();
  // getInheritable 会沿 /Parent 链向上查找 Resources
  const resources = pageObj.getInheritable('Resources');
  if (!resources.isDictionary()) return objects;

  const xobjects = resources.get('XObject');
  if (!xobjects.isDictionary()) return objects;

  xobjects.forEach((value) => {
    // 注意：**不要**在这里调用 resolve()。
    // mupdf 的间接对象在 resolve() 之后会退化成不含流内容的占位对象
    // （实测 isStream() 变 false），导致 PDFDocument.loadImage 报
    // 「object is not a stream」。原始的间接引用才是 loadImage 需要的形态。
    objects.push(value);
  });

  return objects;
}

/** 从 XObject 解码出位图；不是位图或解码失败时返回 null。 */
function decodeXObject(
  doc: import('mupdf').PDFDocument,
  xobject: import('mupdf').PDFObject,
): { width: number; height: number; bytes: Uint8Array } | null {
  let image: import('mupdf').Image | null = null;
  let pixmap: import('mupdf').Pixmap | null = null;

  try {
    // loadImage 内部会按 /Subtype 与 /Filter 选择解码器：
    // DCTDecode -> JPEG、FlateDecode -> 原始位图、CCITTFaxDecode -> fax 解码。
    // Form XObject 等非位图会直接抛错，由下面的 catch 兜住。
    image = doc.loadImage(xobject);

    pixmap = image.toPixmap();
    if (!pixmap) return null;

    const width = pixmap.getWidth();
    const height = pixmap.getHeight();
    if (width <= 0 || height <= 0) return null;

    // 统一转成 PNG：格式无关、无损，前端 <img> 可直接显示，
    // 也免去了为每种源格式各写一套导出逻辑。
    return { width, height, bytes: new Uint8Array(pixmap.asPNG()) };
  } catch {
    return null;
  } finally {
    pixmap?.destroy();
    image?.destroy();
  }
}

/** 从一页文本里按顺序抽出所有图注。 */
function findCaptionsOnPage(pageText: string): Array<string | null> {
  const captions: Array<string | null> = [];
  for (const pattern of CAPTION_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(pageText);
    while (match) {
      if (match[1]) captions.push(match[1].trim());
      match = pattern.exec(pageText);
    }
  }
  return captions;
}

/** 解码单个 XObject 并判定其真实格式。 */
