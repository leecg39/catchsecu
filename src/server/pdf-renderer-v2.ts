import PDFDocument from "pdfkit";
import type { Font, GlyphRun } from "fontkit";
import { createHash } from "node:crypto";
import type { PdfSource } from "./pdf-renderer";
import { fail } from "./http";
import { assertPdfCharacters, loadPdfFonts, PDF_V2_FONT_HASH, PDF_V2_LAYOUT, type PdfFontKey } from "./pdf-font-loader";
import { layoutPdfParagraph, type PdfLayoutLine, type PdfLayoutRun } from "./pdf-layout";
import { richMediaUrl, type RichBlock, type RichDocumentV1, type RichInline } from "@/contracts/rich-content";

export const PDF_MULTILINGUAL_RENDERER_VERSION = 2;
export type RichPdfImage = { nodeId: string; bytes: Uint8Array; width: number; height: number };
export type RichPdfDocument = { label: string; document: RichDocumentV1; images: RichPdfImage[] };
export type RichPdfSource = PdfSource & { richDocuments: RichPdfDocument[] };
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function cloneShape(shape: GlyphRun): GlyphRun {
  // PDFKit scales positions in place. Never let measuring/encoding mutate the retained layout.
  return Object.assign(Object.create(Object.getPrototypeOf(shape)), shape,
    { glyphs: [...shape.glyphs], positions: shape.positions.map(position => ({ ...position })) });
}
function fontAdapter(font: Font) {
  let active: PdfLayoutRun | undefined;
  // One outline can mean different original characters after GSUB (Arabic alef variants, Thai
  // decompositions, mirrored brackets). Give each outline+Unicode pair its own subset CID.
  // PDFKit's default glyph-ID-only map would silently extract the first alias in later text.
  const variants = new Map<string, number>(), realGlyphs = new Map<number, number>();
  let nextId = font.numGlyphs;
  const proxy = new Proxy(font, { get(target, key) {
    if (key === "layout") return (text: string) => {
      if (!active || text !== active.text) throw new Error("PDF run adapter input mismatch");
      const shape = cloneShape(active.shape);
      shape.glyphs = shape.glyphs.map(glyph => {
        const signature = glyph.id + ":" + glyph.codePoints.join(",");
        let id = variants.get(signature);
        if (id === undefined) { id = nextId++; variants.set(signature, id); realGlyphs.set(id, glyph.id); }
        return new Proxy(glyph, { get(outline, property) { return property === "id" ? id : Reflect.get(outline, property, outline); } });
      });
      return shape;
    };
    if (key === "createSubset") return () => {
      // Version-pinned fontkit subset contract: glyphs contains original outline IDs; mapping maps
      // requested IDs to subset CIDs. Duplicate outlines are valid in both its TTF and CFF writers.
      const subset = target.createSubset() as unknown as { glyphs: number[]; mapping: Record<number, number>; includeGlyph(glyph: number | { id: number }): number };
      const includeGlyph = subset.includeGlyph.bind(subset);
      subset.includeGlyph = (glyph: number | { id: number }) => {
        const id = typeof glyph === "number" ? glyph : glyph.id, real = realGlyphs.get(id);
        if (real === undefined) return includeGlyph(id);
        if (subset.mapping[id] === undefined) {
          if (subset.glyphs.length >= 65535) fail(422, "PDF_TOO_LARGE", "PDF 글꼴의 문자 매핑 수를 초과했습니다.");
          subset.glyphs.push(real); subset.mapping[id] = subset.glyphs.length - 1;
        }
        return subset.mapping[id];
      };
      return subset;
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return { font: proxy, setRun(run: PdfLayoutRun) { active = run; } };
}
function inlineText(nodes: RichInline[]): string {
  return nodes.map(node => node.type === "text" ? node.text : node.type === "break" ? "\n" : inlineText(node.children)).join("");
}
function blockText(blocks: RichBlock[]): string {
  return blocks.map(block => block.type === "paragraph" || block.type === "heading" ? inlineText(block.children)
    : block.type === "quote" ? blockText(block.children)
      : block.type === "list" ? block.items.map(blockText).join("\n")
        : block.type === "table" ? block.rows.map(row => row.map(cell => blockText(cell.children)).join(" | ")).join("\n")
          : block.type === "image" ? inlineText(block.caption ?? []) || block.alt
            : richMediaUrl(block)).join("\n");
}
export async function renderPdfV2(source: PdfSource | RichPdfSource) {
  if (source.text.length > 500000) fail(422, "PDF_TOO_LARGE", "PDF로 만들 수 있는 본문 길이를 초과했습니다. 문서를 나누어 게시해주세요.");
  const fonts = await loadPdfFonts();
  const header = `${source.label ?? "게시 버전"} v${source.version}  |  ${source.publishedAt.toISOString()}`;
  const richDocuments = "richDocuments" in source ? source.richDocuments : undefined;
  const richText = richDocuments?.map(item => item.label + "\n" + blockText(item.document.blocks)).join("\n") ?? "";
  assertPdfCharacters(fonts, source.text + richText + source.title + source.author + header + source.contentHash + "본문 해시 (SHA-256)0123456789 /|•“”");
  const doc = new PDFDocument({ size: "A4", margins: { top: 54, right: 48, bottom: 65, left: 48 }, bufferPages: true,
    info: { Title: source.title, Author: source.author, Subject: (source.label ?? "게시 문서") + " v" + source.version,
      Creator: "Catchsecu document renderer v2", Producer: "PDFKit 0.20.2", CreationDate: source.publishedAt, ModDate: source.publishedAt,
      Keywords: `fontManifest=${PDF_V2_FONT_HASH};${PDF_V2_LAYOUT};node=${process.versions.node};icu=${process.versions.icu};unicode=${process.versions.unicode}` } });
  const adapters = Object.fromEntries(Object.entries(fonts).map(([key, value]) => {
    const adapter = fontAdapter(value.font);
    // PDFKit 0.20.2 accepts parsed fontkit instances; @types/pdfkit still lists only bytes/path.
    doc.registerFont(key, adapter.font as unknown as Buffer);
    return [key, adapter];
  })) as Record<PdfFontKey, ReturnType<typeof fontAdapter>>;
  const chunks: Buffer[] = []; let size = 0, pages = 1;
  const output = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => { chunks.push(chunk); size += chunk.length; });
    doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
  });
  doc.on("pageAdded", () => { if (++pages > 250) fail(422, "PDF_TOO_LARGE", "PDF는 최대 250페이지까지 만들 수 있습니다. 문서를 나누어 게시해주세요."); });
  const width = doc.page.width - 96;
  let y = 54;
  const layoutBudget = { used: 0 };
  const drawLine = (line: PdfLayoutLine, fontSize: number, baseline: number, right = false) => {
    const left = line.direction === "rtl" || right ? 48 + width - line.width : 48;
    // ActualText retains source characters (including mirrored brackets/ligatures) for conforming readers.
    // Emit runs in source order, at their bidi visual coordinates, for readers that use the content stream.
    doc.markContent("Span", { actual: line.text });
    for (const run of line.runs) {
      if (!run.shape.glyphs.length) continue;
      adapters[run.font.key].setRun(run);
      doc.font(run.font.key).fontSize(fontSize).text(run.text, left + run.x, baseline,
        { lineBreak: false, features: [], baseline: "alphabetic" });
    }
    doc.endMarkedContent();
  };
  const paragraph = (text: string, fontSize: number, gap: number, color: string) => {
    doc.fillColor(color);
    for (const value of text.split(/\r\n|[\r\n\u2028\u2029]/u)) {
      for (const line of layoutPdfParagraph(value, fonts, fontSize, width, layoutBudget)) {
        const height = line.ascent + line.descent;
        if (height > doc.page.height - 119) fail(422, "PDF_TOO_LARGE", "PDF 한 페이지에 표시할 수 없는 결합 문자가 있습니다.");
        if (y + height > doc.page.height - 65) { doc.addPage(); y = 54; }
        drawLine(line, fontSize, y + line.ascent);
        y += height + 4;
      }
      y += gap;
    }
  };
  const richParagraph = (text: string, options: { fontSize?: number; gap?: number; color?: string; indent?: number;
    alignment?: "left" | "center" | "right" | "justify" } = {}) => {
    const fontSize = options.fontSize ?? 11, gap = options.gap ?? 7, indent = Math.min(48, Math.max(0, options.indent ?? 0));
    const available = width - indent;
    doc.fillColor(options.color ?? "#111827");
    for (const value of text.split(/\r\n|[\r\n\u2028\u2029]/u)) {
      for (const line of layoutPdfParagraph(value, fonts, fontSize, available, layoutBudget)) {
        const height = line.ascent + line.descent;
        if (height > doc.page.height - 119) fail(422, "PDF_TOO_LARGE", "PDF 한 페이지에 표시할 수 없는 결합 문자가 있습니다.");
        if (y + height > doc.page.height - 65) { doc.addPage(); y = 54; }
        const align = options.alignment ?? (line.direction === "rtl" ? "right" : "left");
        const offset = align === "center" ? (available - line.width) / 2 : align === "right" ? available - line.width : 0;
        const left = 48 + indent + Math.max(0, offset);
        doc.markContent("Span", { actual: line.text });
        for (const run of line.runs) {
          if (!run.shape.glyphs.length) continue;
          adapters[run.font.key].setRun(run);
          doc.font(run.font.key).fontSize(fontSize).text(run.text, left + run.x, y + line.ascent,
            { lineBreak: false, features: [], baseline: "alphabetic" });
        }
        doc.endMarkedContent(); y += height + 4;
      }
      y += gap;
    }
  };
  const renderRichDocument = (item: RichPdfDocument) => {
    const images = new Map(item.images.map(image => [image.nodeId, image]));
    const renderBlocks = (blocks: RichBlock[], indent = 0) => {
      for (const block of blocks) {
        if (block.type === "paragraph" || block.type === "heading") {
          const inlineSize = Math.max(0, ...block.children.flatMap(node => node.type === "link" ? node.children : [node])
            .filter(node => node.type === "text").map(node => node.fontSize ?? 0));
          richParagraph(inlineText(block.children), { fontSize: block.type === "heading" ? ({ 2: 18, 3: 15, 4: 13 } as const)[block.level]
            : inlineSize || 11, gap: block.type === "heading" ? 10 : 7, indent: indent + (block.indent ?? 0) * 14,
            alignment: block.alignment, color: block.type === "heading" ? "#0f172a" : "#111827" });
        } else if (block.type === "quote") {
          richParagraph("“", { fontSize: 16, gap: 2, indent: indent + 12, color: "#64748b" });
          renderBlocks(block.children, indent + 18);
        } else if (block.type === "list") {
          block.items.forEach((children, index) => {
            richParagraph((block.ordered ? `${index + 1}.` : "•"), { gap: 0, indent: indent + 8, color: "#334155" });
            renderBlocks(children, indent + 24);
          });
        } else if (block.type === "table") {
          for (const row of block.rows) richParagraph(row.map(cell => blockText(cell.children)).join(" | "),
            { fontSize: 9, gap: 4, indent, color: "#334155" });
        } else if (block.type === "media") {
          richParagraph(richMediaUrl(block), { fontSize: 9, gap: 7, indent, alignment: block.alignment, color: "#2563eb" });
        } else {
          const image = images.get(block.nodeId);
          if (!image) fail(500, "RECEIPT_INTEGRITY_ERROR", "영수증 이미지 렌더 자료가 누락되었습니다.");
          const requested = block.width?.unit === "percent" ? width * block.width.value / 100
            : block.width?.unit === "px" ? block.width.value * 0.75 : width;
          const imageWidth = Math.min(width, Math.max(36, requested));
          const imageHeight = Math.min(doc.page.height - 140, imageWidth * image.height / image.width);
          if (y + imageHeight > doc.page.height - 65) { doc.addPage(); y = 54; }
          const x = block.alignment === "right" ? 48 + width - imageWidth
            : block.alignment === "center" ? 48 + (width - imageWidth) / 2 : 48;
          doc.image(Buffer.from(image.bytes), x, y, { width: imageWidth, height: imageHeight });
          y += imageHeight + 6;
          const caption = inlineText(block.caption ?? []) || block.alt;
          if (caption) richParagraph(caption, { fontSize: 8, gap: 7, alignment: block.alignment ?? "left", color: "#64748b" });
        }
      }
    };
    richParagraph(item.label, { fontSize: 14, gap: 10, color: "#0f172a" });
    renderBlocks(item.document.blocks);
  };
  try {
    paragraph(header, 9, 12, "#5b6472");
    paragraph(source.text, 11, 7, "#111827");
    for (const item of richDocuments ?? []) renderRichDocument(item);
    y += 8;
    paragraph("본문 해시 (SHA-256)", 8, 4, "#475569");
    paragraph(source.contentHash, 8, 2, "#475569");
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i); doc.fillColor("#64748b");
      const footer = layoutPdfParagraph(`v${source.version}  |  ${i + 1} / ${range.count}`, fonts, 8, width, layoutBudget).next().value!;
      drawLine(footer, 8, doc.page.height - 32, true);
    }
    doc.end(); const bytes = await output;
    if (size > 16777216) fail(422, "PDF_TOO_LARGE", "PDF 파일이 16MB를 초과했습니다. 문서를 나누어 게시해주세요.");
    return { bytes: new Uint8Array(bytes), pageCount: range.count, pdfHash: sha256(bytes), rendererVersion: PDF_MULTILINGUAL_RENDERER_VERSION, fontHash: PDF_V2_FONT_HASH };
  } catch (error) { doc.destroy(error instanceof Error ? error : new Error("PDF rendering failed")); await output.catch(() => undefined); throw error; }
}
