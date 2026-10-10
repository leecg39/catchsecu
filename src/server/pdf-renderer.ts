import PDFDocument from "pdfkit";
import { create as createFont } from "fontkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fail } from "./http";

export const PDF_RENDERER_VERSION = 1;
export const PDF_FONT_HASH = "6bcb2a0703aa137e874fc2dffa85f6c21ba9a67fa329e81b8c801663af7e992a";
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
let fontPromise: Promise<{ bytes: Buffer; characters: Set<number> }> | undefined;
async function koreanFont() {
  fontPromise ??= (async () => {
    const bytes = await readFile(join(process.cwd(), "assets/fonts/NotoSansCJKkr-Regular.otf"));
    if (sha256(bytes) !== PDF_FONT_HASH) throw new Error("PDF font checksum mismatch");
    const font = createFont(bytes);
    if (!("characterSet" in font)) throw new Error("Expected a single PDF font");
    return { bytes, characters: new Set(font.characterSet) };
  })().catch(() => { fontPromise = undefined; fail(503, "PDF_FONT_UNAVAILABLE", "PDF 글꼴을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."); });
  return fontPromise;
}
export type PdfSource = { title: string; author: string; text: string; contentHash: string; version: number; publishedAt: Date; label?: string };
export async function renderPdf(source: PdfSource) {
  if (source.text.length > 500000) fail(422, "PDF_TOO_LARGE", "PDF로 만들 수 있는 본문 길이를 초과했습니다. 문서를 나누어 게시해주세요.");
  const font = await koreanFont();
  // Preserve the exact v1 render path for every previously supported input. New scripts use an
  // independent renderer/font manifest; stored PDFs and receipt evidence are never regenerated here.
  const outputText = source.text + source.title + source.author + (source.label ?? "") + source.contentHash;
  if ([...outputText].some(char => !/\s/u.test(char) && !font.characters.has(char.codePointAt(0)!)))
    return (await import("./pdf-renderer-v2")).renderPdfV2(source);
  for (const char of new Set(source.text + source.title + source.author)) {
    if (!/\s/u.test(char) && !font.characters.has(char.codePointAt(0)!))
      fail(422, "PDF_UNSUPPORTED_CHARACTER", `PDF 글꼴에 없는 문자(U+${char.codePointAt(0)!.toString(16).toUpperCase()})가 있습니다. 문구를 수정해 새 버전으로 게시해주세요.`);
  }
  const doc = new PDFDocument({ size: "A4", margins: { top: 54, right: 48, bottom: 65, left: 48 }, bufferPages: true,
    info: { Title: source.title, Author: source.author, Subject: (source.label ?? "게시 문서") + " v" + source.version,
      Creator: "Catchsecu document renderer v" + PDF_RENDERER_VERSION, Producer: "PDFKit 0.20.2",
      CreationDate: source.publishedAt, ModDate: source.publishedAt } });
  doc.font(font.bytes);
  const chunks: Buffer[] = []; let size = 0;
  // Register the stream handlers before rendering so a failed render cannot leak a rejected promise.
  const output = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => { chunks.push(chunk); size += chunk.length; });
    doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
  });
  let count = 1;
  doc.on("pageAdded", () => { if (++count > 250) fail(422, "PDF_TOO_LARGE", "PDF는 최대 250페이지까지 만들 수 있습니다. 문서를 나누어 게시해주세요."); });
  try {
    doc.fillColor("#5b6472").fontSize(9).text(`${source.label ?? "게시 버전"} v${source.version}  |  ${source.publishedAt.toISOString()}`, { paragraphGap: 12 });
    doc.fillColor("#111827").fontSize(11).text(source.text, { lineGap: 4, paragraphGap: 7 });
    doc.moveDown().fontSize(8).fillColor("#475569").text("본문 해시 (SHA-256)", { paragraphGap: 4 });
    doc.text(source.contentHash, { lineGap: 2 });
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fillColor("#64748b").fontSize(8).text(`v${source.version}  |  ${i + 1} / ${range.count}`, 48, doc.page.height - 40,
        { width: doc.page.width - 96, align: "right", lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end(); const bytes = await output;
    if (size > 16777216) fail(422, "PDF_TOO_LARGE", "PDF 파일이 16MB를 초과했습니다. 문서를 나누어 게시해주세요.");
    return { bytes: new Uint8Array(bytes), pageCount: range.count, pdfHash: sha256(bytes), rendererVersion: PDF_RENDERER_VERSION, fontHash: PDF_FONT_HASH };
  } catch (error) { doc.destroy(error instanceof Error ? error : new Error("PDF rendering failed")); await output.catch(() => undefined); throw error; }
}
export function pdfResponse(file: { bytes: Uint8Array; pdfHash: string; contentHash: string; filename: string }) {
  const filename = encodeURIComponent(file.filename.replace(/[\\/\u0000-\u001f\u007f]/g, "_")).replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16));
  return new Response(new Uint8Array(file.bytes), { headers: {
    "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="document.pdf"; filename*=UTF-8''${filename}`,
    "Content-Length": String(file.bytes.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow",
    "X-PDF-SHA256": file.pdfHash, "X-Document-SHA256": file.contentHash,
    "Content-Security-Policy": "sandbox; default-src 'none'",
  } });
}
