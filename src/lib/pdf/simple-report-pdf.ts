import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { marked } from "marked";

type FontKey = "regular" | "bold" | "italic" | "mono";

interface Segment {
  text: string;
  link?: string;
  font: FontKey;
}

interface Block {
  kind: "heading" | "paragraph" | "list_item" | "code" | "hr" | "quote";
  level?: number;
  indent?: number;
  segments?: Segment[];
  text?: string;
}

interface LineRender {
  segments: Segment[];
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 54;
const MARGIN_TOP = 48;
const MARGIN_BOTTOM = 48;
const HEADER_H = 74;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const CONTENT_TOP_Y = PAGE_H - HEADER_H - 20;
const CONTENT_BOTTOM_Y = MARGIN_BOTTOM;

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTextAndLinks(raw: string, font: FontKey = "regular"): Segment[] {
  const segments: Segment[] = [];
  const mdLinkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = mdLinkRe.exec(raw)) !== null) {
    if (m.index > last) {
      segments.push({ text: raw.slice(last, m.index), font });
    }
    segments.push({ text: m[1], link: m[2], font });
    last = m.index + m[0].length;
  }
  if (last < raw.length) segments.push({ text: raw.slice(last), font });

  const withBareUrls: Segment[] = [];
  const bareUrlRe = /(https?:\/\/[^\s)]+)/g;
  for (const seg of segments) {
    if (seg.link) {
      withBareUrls.push(seg);
      continue;
    }
    let idx = 0;
    let b: RegExpExecArray | null;
    while ((b = bareUrlRe.exec(seg.text)) !== null) {
      if (b.index > idx) {
        withBareUrls.push({ text: seg.text.slice(idx, b.index), font: seg.font });
      }
      withBareUrls.push({ text: b[1], link: b[1], font: seg.font });
      idx = b.index + b[1].length;
    }
    if (idx < seg.text.length) withBareUrls.push({ text: seg.text.slice(idx), font: seg.font });
  }

  return withBareUrls
    .map((s) => ({
      ...s,
      text: s.text
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/[*_~]/g, ""),
    }))
    .filter((s) => s.text.length > 0);
}

function inlineSegmentsFromTokens(tokens: Array<Record<string, unknown>> | undefined): Segment[] {
  if (!tokens || tokens.length === 0) return [];
  const out: Segment[] = [];

  for (const t of tokens) {
    const type = typeof t.type === "string" ? t.type : "";

    if (type === "text") {
      const text = typeof t.raw === "string" ? t.raw : typeof t.text === "string" ? t.text : "";
      out.push(...parseTextAndLinks(text, "regular"));
      continue;
    }
    if (type === "strong") {
      const inner = inlineSegmentsFromTokens(
        Array.isArray(t.tokens) ? (t.tokens as Array<Record<string, unknown>>) : undefined
      );
      if (inner.length === 0) {
        const text = typeof t.text === "string" ? t.text : "";
        if (text) out.push({ text, font: "bold" });
      } else {
        inner.forEach((seg) => out.push({ ...seg, font: "bold" }));
      }
      continue;
    }
    if (type === "em") {
      const inner = inlineSegmentsFromTokens(
        Array.isArray(t.tokens) ? (t.tokens as Array<Record<string, unknown>>) : undefined
      );
      if (inner.length === 0) {
        const text = typeof t.text === "string" ? t.text : "";
        if (text) out.push({ text, font: "italic" });
      } else {
        inner.forEach((seg) => out.push({ ...seg, font: "italic" }));
      }
      continue;
    }
    if (type === "codespan") {
      const text = typeof t.text === "string" ? t.text : "";
      if (text) out.push({ text, font: "mono" });
      continue;
    }
    if (type === "link") {
      const href = typeof t.href === "string" ? t.href : "";
      const inner = inlineSegmentsFromTokens(
        Array.isArray(t.tokens) ? (t.tokens as Array<Record<string, unknown>>) : undefined
      );
      if (inner.length > 0) {
        inner.forEach((seg) => out.push({ ...seg, link: href || seg.link }));
      } else {
        const text = typeof t.text === "string" ? t.text : href;
        if (text) out.push({ text, font: "regular", link: href || undefined });
      }
      continue;
    }
    if (type === "br") {
      out.push({ text: "\n", font: "regular" });
      continue;
    }

    const fallback = typeof t.raw === "string" ? t.raw : typeof t.text === "string" ? t.text : "";
    if (fallback) out.push(...parseTextAndLinks(fallback, "regular"));
  }

  return out;
}

function blocksFromMarkdown(markdown: string): Block[] {
  const tokens = marked.lexer(markdown, { gfm: true }) as Array<Record<string, unknown>>;
  const blocks: Block[] = [];

  for (const token of tokens) {
    const type = typeof token.type === "string" ? token.type : "";

    if (type === "heading") {
      const depth = typeof token.depth === "number" ? token.depth : 2;
      const text = stripInlineMarkdown(typeof token.text === "string" ? token.text : "");
      if (text) blocks.push({ kind: "heading", level: depth, text });
      continue;
    }

    if (type === "paragraph") {
      const segs = inlineSegmentsFromTokens(
        Array.isArray(token.tokens) ? (token.tokens as Array<Record<string, unknown>>) : undefined
      );
      if (segs.length > 0) blocks.push({ kind: "paragraph", segments: segs });
      continue;
    }

    if (type === "list") {
      const items = Array.isArray(token.items) ? (token.items as Array<Record<string, unknown>>) : [];
      for (const item of items) {
        let segs: Segment[] = [];
        if (Array.isArray(item.tokens)) {
          const itemTokens = item.tokens as Array<Record<string, unknown>>;
          const para = itemTokens.find((x) => x.type === "paragraph");
          if (para && Array.isArray(para.tokens)) {
            segs = inlineSegmentsFromTokens(para.tokens as Array<Record<string, unknown>>);
          } else {
            segs = inlineSegmentsFromTokens(itemTokens);
          }
        } else if (typeof item.text === "string") {
          segs = parseTextAndLinks(item.text);
        }
        if (segs.length > 0) {
          const level = typeof item.depth === "number" ? item.depth : 0;
          blocks.push({ kind: "list_item", segments: segs, indent: Math.min(level * 12, 36) });
        }
      }
      continue;
    }

    if (type === "blockquote") {
      const quoteTokens = Array.isArray(token.tokens) ? (token.tokens as Array<Record<string, unknown>>) : [];
      for (const qt of quoteTokens) {
        if (qt.type === "paragraph") {
          const segs = inlineSegmentsFromTokens(
            Array.isArray(qt.tokens) ? (qt.tokens as Array<Record<string, unknown>>) : undefined
          );
          if (segs.length > 0) blocks.push({ kind: "quote", segments: segs });
        }
      }
      continue;
    }

    if (type === "code") {
      const text = typeof token.text === "string" ? token.text : "";
      if (text) blocks.push({ kind: "code", text });
      continue;
    }

    if (type === "hr") {
      blocks.push({ kind: "hr" });
      continue;
    }
  }

  return blocks;
}

function fontFor(key: FontKey, fonts: Record<FontKey, PDFFont>): PDFFont {
  return fonts[key];
}

function measureSegment(seg: Segment, size: number, fonts: Record<FontKey, PDFFont>): number {
  return fontFor(seg.font, fonts).widthOfTextAtSize(seg.text, size);
}

function addLinkAnnotation(
  doc: PDFDocument,
  page: PDFPage,
  url: string,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [x, y, x + width, y + height],
    Border: [0, 0, 0],
    A: {
      Type: "Action",
      S: "URI",
      URI: PDFString.of(url),
    },
  });
  const annotRef = doc.context.register(annot);
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray) ?? doc.context.obj([]);
  annots.push(annotRef);
  page.node.set(PDFName.of("Annots"), annots);
}

function wrapSegments(
  segments: Segment[],
  width: number,
  size: number,
  fonts: Record<FontKey, PDFFont>
): LineRender[] {
  const out: LineRender[] = [{ segments: [] }];
  let currentW = 0;

  for (const seg of segments) {
    const parts = seg.text.split(/(\s+)/).filter((p) => p.length > 0);
    for (const part of parts) {
      if (part === "\n") {
        out.push({ segments: [] });
        currentW = 0;
        continue;
      }
      const token: Segment = { ...seg, text: part };
      const tokenW = measureSegment(token, size, fonts);
      if (currentW + tokenW > width && out[out.length - 1].segments.length > 0) {
        out.push({ segments: [] });
        currentW = 0;
      }
      out[out.length - 1].segments.push(token);
      currentW += tokenW;
    }
  }
  return out;
}

function blockStyle(block: Block): {
  font: FontKey;
  size: number;
  lineGap: number;
  spacingBefore: number;
  spacingAfter: number;
  indent: number;
  color: ReturnType<typeof rgb>;
} {
  if (block.kind === "heading") {
    if ((block.level ?? 2) <= 1) {
      return {
        font: "bold",
        size: 19,
        lineGap: 6,
        spacingBefore: 10,
        spacingAfter: 6,
        indent: 0,
        color: rgb(0.07, 0.1, 0.16),
      };
    }
    if ((block.level ?? 2) === 2) {
      return {
        font: "bold",
        size: 14,
        lineGap: 5,
        spacingBefore: 10,
        spacingAfter: 4,
        indent: 0,
        color: rgb(0.07, 0.1, 0.16),
      };
    }
    return {
      font: "bold",
      size: 12,
      lineGap: 4,
      spacingBefore: 8,
      spacingAfter: 3,
      indent: 0,
      color: rgb(0.13, 0.16, 0.21),
    };
  }

  if (block.kind === "list_item") {
    return {
      font: "regular",
      size: 10.8,
      lineGap: 3,
      spacingBefore: 1.5,
      spacingAfter: 1.5,
      indent: 16 + (block.indent ?? 0),
      color: rgb(0.08, 0.1, 0.16),
    };
  }

  if (block.kind === "quote") {
    return {
      font: "italic",
      size: 10.8,
      lineGap: 3,
      spacingBefore: 4,
      spacingAfter: 4,
      indent: 16,
      color: rgb(0.22, 0.25, 0.3),
    };
  }

  if (block.kind === "code") {
    return {
      font: "mono",
      size: 9.5,
      lineGap: 2,
      spacingBefore: 4,
      spacingAfter: 6,
      indent: 10,
      color: rgb(0.08, 0.1, 0.16),
    };
  }

  if (block.kind === "hr") {
    return {
      font: "regular",
      size: 10,
      lineGap: 0,
      spacingBefore: 8,
      spacingAfter: 8,
      indent: 0,
      color: rgb(0.8, 0.84, 0.9),
    };
  }

  return {
    font: "regular",
    size: 10.8,
    lineGap: 3,
    spacingBefore: 2.5,
    spacingAfter: 4,
    indent: 0,
    color: rgb(0.08, 0.1, 0.16),
  };
}

function drawHeader(page: PDFPage, fonts: Record<FontKey, PDFFont>, title: string): void {
  page.drawRectangle({
    x: 0,
    y: PAGE_H - HEADER_H,
    width: PAGE_W,
    height: HEADER_H,
    color: rgb(0.06, 0.09, 0.14),
  });
  page.drawText("Code Intelligence Digest", {
    x: MARGIN_X,
    y: PAGE_H - 27,
    size: 15,
    font: fonts.bold,
    color: rgb(1, 1, 1),
  });
  page.drawText(title, {
    x: MARGIN_X,
    y: PAGE_H - 47,
    size: 10,
    font: fonts.regular,
    color: rgb(0.84, 0.89, 0.95),
    maxWidth: CONTENT_W,
  });
}

export async function renderReportPdf(markdown: string, title: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonts: Record<FontKey, PDFFont> = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
  };

  let page = doc.addPage([PAGE_W, PAGE_H]);
  drawHeader(page, fonts, title);
  let y = CONTENT_TOP_Y;

  const blocks = blocksFromMarkdown(markdown);

  const newPage = (): void => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    drawHeader(page, fonts, title);
    y = CONTENT_TOP_Y;
  };

  for (const block of blocks) {
    const style = blockStyle(block);

    if (block.kind === "hr") {
      if (y - (style.spacingBefore + style.spacingAfter + 8) < CONTENT_BOTTOM_Y) newPage();
      y -= style.spacingBefore;
      page.drawLine({
        start: { x: MARGIN_X, y },
        end: { x: PAGE_W - MARGIN_X, y },
        thickness: 1,
        color: rgb(0.8, 0.84, 0.9),
      });
      y -= style.spacingAfter;
      continue;
    }

    let segments: Segment[] = [];
    if (block.kind === "heading" && block.text) {
      segments = [{ text: block.text, font: style.font }];
    } else if (block.kind === "paragraph" || block.kind === "list_item" || block.kind === "quote") {
      segments = block.segments ?? [];
      if (block.kind === "list_item") {
        segments = [{ text: "• ", font: "bold" }, ...segments];
      }
    } else if (block.kind === "code") {
      const text = block.text ?? "";
      segments = [{ text, font: "mono" }];
    }
    if (segments.length === 0) continue;

    const maxWidth = CONTENT_W - style.indent;
    const wrapped = wrapSegments(segments, maxWidth, style.size, fonts);
    const totalHeight =
      style.spacingBefore +
      wrapped.length * (style.size + style.lineGap) +
      style.spacingAfter;

    // Keep short blocks together on page boundaries for cleaner output.
    if (totalHeight < 160 && y - totalHeight < CONTENT_BOTTOM_Y) newPage();

    y -= style.spacingBefore;

    if (block.kind === "code") {
      const boxHeight = wrapped.length * (style.size + style.lineGap) + 8;
      if (y - boxHeight < CONTENT_BOTTOM_Y) newPage();
      page.drawRectangle({
        x: MARGIN_X,
        y: y - boxHeight + 4,
        width: CONTENT_W,
        height: boxHeight,
        color: rgb(0.95, 0.96, 0.98),
      });
    }

    for (const line of wrapped) {
      if (y - (style.size + style.lineGap) < CONTENT_BOTTOM_Y) {
        newPage();
      }
      let x = MARGIN_X + style.indent;
      for (const seg of line.segments) {
        const font = fontFor(seg.font, fonts);
        const color = seg.link ? rgb(0.11, 0.31, 0.85) : style.color;
        page.drawText(seg.text, {
          x,
          y,
          size: style.size,
          font,
          color,
        });
        const w = font.widthOfTextAtSize(seg.text, style.size);
        if (seg.link) {
          addLinkAnnotation(doc, page, seg.link, x, y - 1, w, style.size + 2.5);
          page.drawLine({
            start: { x, y: y - 1 },
            end: { x: x + w, y: y - 1 },
            thickness: 0.6,
            color: rgb(0.11, 0.31, 0.85),
          });
        }
        x += w;
      }
      y -= style.size + style.lineGap;
    }

    y -= style.spacingAfter;
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
