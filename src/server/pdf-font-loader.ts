import { create as createFont, type Font } from "fontkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import manifest from "../../assets/fonts/pdf-v2-manifest.json";
import { fail } from "./http";

export type PdfFontKey = "cjk" | "latin" | "arabic" | "thai";
export type PdfFont = { key: PdfFontKey; font: Font; characters: ReadonlySet<number> };
export type PdfFonts = Record<PdfFontKey, PdfFont>;
const legacy = { family: "NotoSansCJKkr", file: "NotoSansCJKkr-Regular.otf", sha256: "6bcb2a0703aa137e874fc2dffa85f6c21ba9a67fa329e81b8c801663af7e992a" };
const entries = [legacy, ...manifest.fonts].map(({ family, file, sha256 }) => ({ family, file, sha256 }));
export const PDF_V2_FONT_HASH = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
export const PDF_V2_LAYOUT = "pdf-layout-v2;pdfkit=0.20.2;fontkit=2.0.4;bidi-js=1.1.0/Unicode13;linebreak=1.1.0";
let bytesPromise: Promise<Buffer[]> | undefined;
// Only byte buffers are shared. fontkit's glyph/layout caches are mutable and must not leak between PDFs.
export async function loadPdfFonts(): Promise<PdfFonts> {
  bytesPromise ??= Promise.all(entries.map(async entry => {
    const bytes = await readFile(join(process.cwd(), "assets/fonts", entry.file));
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("PDF font checksum mismatch");
    return bytes;
  })).catch(() => { bytesPromise = undefined; fail(503, "PDF_FONT_UNAVAILABLE", "PDF 글꼴을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."); });
  const buffers = await bytesPromise;
  return Object.fromEntries((["cjk", "latin", "arabic", "thai"] as const).map((key, i) => {
    const font = createFont(buffers[i]);
    if (!("characterSet" in font)) fail(503, "PDF_FONT_UNAVAILABLE", "PDF 글꼴을 확인하지 못했습니다.");
    // fontkit caches outlines by glyph ID. Unicode source metadata belongs to each shaping call,
    // not the first cached alias/GSUB use of that outline (otherwise ToUnicode can contain controls).
    const getGlyph = font.getGlyph.bind(font);
    font.getGlyph = (id, codePoints = []) => new Proxy(getGlyph(id, codePoints), { get(target, property) {
      return property === "codePoints" ? codePoints : Reflect.get(target, property, target);
    } });
    return [key, { key, font, characters: new Set(font.characterSet) }];
  })) as unknown as PdfFonts;
}
// Controls affect layout, not visible glyphs. They stay in the logical source/ActualText.
export const pdfLayoutControl = /^[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]$/u;
export function supportsPdfText(font: PdfFont, text: string) {
  return [...text].every(char => /\s/u.test(char) || pdfLayoutControl.test(char) || font.characters.has(char.codePointAt(0)!));
}
export function assertPdfCharacters(fonts: PdfFonts, text: string) {
  for (const char of new Set(text)) if (!Object.values(fonts).some(font => supportsPdfText(font, char)))
    fail(422, "PDF_UNSUPPORTED_CHARACTER", `PDF 글꼴에 없는 문자(U+${char.codePointAt(0)!.toString(16).toUpperCase()})가 있습니다. 문구를 수정해 새 버전으로 게시해주세요.`);
}
