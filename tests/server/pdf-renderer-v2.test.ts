import { describe, expect, test, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import baseline25 from "../../docs/qa/R08-T02/international-contact/pdf-v2-legacy-baseline.json";
import countries from "@/data/form-countries.json";
import systemCopy from "@/data/form-system-copy.json";

// No database-backed module is imported in this actual-PDF render suite.
vi.mock("@/server/http", () => ({ fail(status: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { status, code });
} }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
import { renderPdf, PDF_FONT_HASH } from "@/server/pdf-renderer";
import { renderPdf as originalV1 } from "../fixtures/pdf-renderer-v1-original";
import { loadPdfFonts, PDF_V2_FONT_HASH, supportsPdfText } from "@/server/pdf-font-loader";
import { layoutPdfParagraph, PDF_LAYOUT_WORK_LIMIT } from "@/server/pdf-layout";
import { pdfActualText } from "../fixtures/pdf-actual-text";

const source = { title: "게시 문서 검증", author: "공개 회사", text: "한글과 English 개인정보 안내 123.",
  contentHash: "a".repeat(64), version: 3, publishedAt: new Date("2026-01-01T00:00:00.000Z") };
const qaPath = "docs/qa/R08-T02/international-contact/";
const clean = (text: string) => text.replace(/[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu, "").normalize("NFC");
async function parsed(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const document = await task.promise, pages = [];
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n), content = await page.getTextContent();
      pages.push(content.items.filter(item => "str" in item).map(item => item.str).join(""));
    }
    return { pages, metadata: (await document.getMetadata()).info };
  } finally { await task.destroy(); }
}
const samples = [
  { key: "arabic", text: "مرحبا بالعالم\nمرحباً (test@example.com) +82 1012345678 رقم 123\n한글 العربية (2026-10-10) English 끝\nالخصوصية: لا لأ لإ لآ بَ بِ بُ شَدّة\nمعرّف: 550e8400-e29b-41d4-a716-446655440000" },
  { key: "thai", text: "ภาษาไทย\nข้อมูลส่วนบุคคลและความเป็นส่วนตัว\nน้ำ กำ เก้า ผู้ใช้ ที่อยู่ โทรศัพท์ 123\n한국어 ภาษาไทย English +66 123456789" },
  { key: "turkish", text: "İstanbul ş ı İ Ş ğ\nKişisel verilerin korunması ve aydınlatma metni\n한국어 Türkçe English +90 123456789" },
];

describe("PDF renderer v2 without database", () => {
  test("preserves exact v1 bytes against a frozen pre-change source on the same Node runtime", async () => {
    const records = [];
    for (const before of baseline25) {
      const input = { ...before.source, publishedAt: new Date(before.source.publishedAt) };
      const old = await originalV1(input), current = await renderPdf(input);
      expect(current).toMatchObject({ rendererVersion: 1, fontHash: PDF_FONT_HASH, pageCount: old.pageCount, pdfHash: old.pdfHash });
      expect(current.bytes).toEqual(old.bytes);
      records.push({ source: before.source, originalHash: old.pdfHash, currentHash: current.pdfHash, pageCount: old.pageCount,
        bytes: old.bytes.length, node25OriginalHash: before.pdfHash });
    }
    if (process.env.PDF_V2_QA === "1") await writeFile(qaPath + "pdf-v2-legacy-node24.json", JSON.stringify({ node: process.versions,
      originalSource: "git HEAD:src/server/pdf-renderer.ts (only ./http import changed to @/server/http for no-DB test isolation)",
      originalSourceSha256: createHash("sha256").update(await readFile("tests/fixtures/pdf-renderer-v1-original.ts")).digest("hex"), records }, null, 2) + "\n");
  });
  test.each(samples)("renders $key with exact logical ActualText and distinct v2 metadata", async sample => {
    const file = await renderPdf({ ...source, text: sample.text });
    expect(file).toMatchObject({ rendererVersion: 2, fontHash: PDF_V2_FONT_HASH });
    expect(file.fontHash).not.toBe(PDF_FONT_HASH);
    const result = await parsed(file.bytes), text = result.pages.join("");
    const actualText = pdfActualText(file.bytes);
    expect(actualText.join("\n")).toContain(sample.text);
    // PDF.js 6.3.289 ignores ActualText and reorders Arabic marks/neutral runs by geometry.
    // Its strict paragraph extraction is tested for Thai/Latin; the Arabic limitation is recorded.
    if (sample.key !== "arabic") expect(clean(text)).toContain(clean(sample.text));
    else expect(text).toContain("مرحبا بالعالم");
    expect(text).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u);
    expect(result.metadata).toMatchObject({ Creator: "Catchsecu document renderer v2" });
    if (process.env.PDF_V2_QA === "1") {
      await writeFile(qaPath + `pdf-v2-${sample.key}.pdf`, file.bytes);
      await writeFile(qaPath + `pdf-v2-${sample.key}.json`, JSON.stringify({ ...sample, extracted: text, pdfHash: file.pdfHash,
        fontHash: file.fontHash, pageCount: file.pageCount, actualText, exactActualText: actualText.join("\n").includes(sample.text), pdfJsLogicalEquality: clean(text).includes(clean(sample.text)), metadata: result.metadata, node: process.versions }, null, 2) + "\n");
    }
  });
  test("preserves source bidi controls and standalone Arabic marks without layout rewriting", async () => {
    const text = "غير معزول: +82 1012345678 (2026-10-10)\nمعزول: \u2066+82 1012345678\u2069 (\u20662026-10-10\u2069)\nمعرّف: \u2066550e8400-e29b-41d4-a716-446655440000\u2069\nَ بَ بّ بِ لا لأ لإ لآ";
    const file = await renderPdf({ ...source, text });
    expect(pdfActualText(file.bytes).join("\n")).toContain(text);
    if (process.env.PDF_V2_QA === "1") {
      await writeFile(qaPath + "pdf-v2-arabic-isolates.pdf", file.bytes);
      await writeFile(qaPath + "pdf-v2-arabic-isolates.json", JSON.stringify({ source: text, actualText: pdfActualText(file.bytes), pdfJs: await parsed(file.bytes), pdfHash: file.pdfHash, fontHash: file.fontHash }, null, 2) + "\n");
    }
  });
  test("keeps the complete 16-language source corpus and all 44810 legacy cmap glyphs supported", async () => {
    const fonts = await loadPdfFonts();
    expect(fonts.cjk.characters.size).toBe(44810);
    for (const cp of fonts.cjk.characters) expect(fonts.cjk.font.glyphForCodePoint(cp).id).not.toBe(0);
    const strings = (value: unknown): string[] => typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
    const text = strings([countries.map(row => row.names), systemCopy]).join("");
    const missing = [...new Set(text)].filter(char => !Object.values(fonts).some(font => supportsPdfText(font, char)));
    expect(missing).toEqual([]);
  });
  test("places mixed-direction runs visually while retaining logical content order and mirroring brackets", async () => {
    const fonts = await loadPdfFonts(), text = "مرحبا (abc@example.com) +82 1012345678 نهاية";
    const lines = [...layoutPdfParagraph(text, fonts, 11, 500)];
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.direction).toBe("rtl");
    expect(line.runs.map(run => run.text).join("")).toBe(text);
    expect(line.runs[0].x).toBeGreaterThan(line.runs.at(-1)!.x);
    expect(line.runs.filter(run => run.text.includes("abc") || run.text.includes("1012345678")).every(run => run.direction === "ltr")).toBe(true);
    for (const run of line.runs) expect(run.x + run.width).toBeLessThanOrEqual(line.width + 0.001);
  });
  test("wraps Thai and Arabic without splitting graphemes and keeps trailing whitespace on later lines", async () => {
    const fonts = await loadPdfFonts(), text = "น้ำ กำ ที่อยู่ العربية 123 ".repeat(25);
    const boundaries = new Set([...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text)].map(part => part.index)); boundaries.add(text.length);
    const lines = [...layoutPdfParagraph(text, fonts, 11, 130)];
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.map(line => line.text).join("")).toBe(text);
    for (const line of lines) { expect(line.width).toBeLessThanOrEqual(130); expect(boundaries.has(line.start)).toBe(true); expect(boundaries.has(line.end)).toBe(true); }
  });
  test("generates deterministic multiple pages with all source paragraphs in order", async () => {
    const text = Array.from({ length: 75 }, (_, i) => `${i + 1}. مرحبا بالعالم ภาษาไทย İstanbul`).join("\n");
    const first = await renderPdf({ ...source, text }), second = await renderPdf({ ...source, text });
    expect(first.pageCount).toBeGreaterThan(2); expect(first.bytes).toEqual(second.bytes);
    const result = await parsed(first.bytes), all = clean(result.pages.join(""));
    let previous = -1;
    for (let i = 1; i <= 75; i++) { const at = all.indexOf(clean(`${i}. مرحبا بالعالم ภาษาไทย İstanbul`), previous + 1); expect(at).toBeGreaterThan(previous); previous = at; }
    if (process.env.PDF_V2_QA === "1") {
      await writeFile(qaPath + "pdf-v2-multipage.pdf", first.bytes);
      await writeFile(qaPath + "pdf-v2-multipage.json", JSON.stringify({ pdfHash: first.pdfHash, fontHash: first.fontHash, pageCount: first.pageCount, identicalSecondRender: true, sourceParagraphs: 75 }, null, 2) + "\n");
    }
  });
  test("rejects unsupported characters including the previously unchecked label", async () => {
    for (const patch of [{ text: "ภาษาไทย 💩" }, { title: "😀" }, { author: "😀" }, { label: "😀" }, { text: "مرحبا\ud800" }])
      await expect(renderPdf({ ...source, ...patch })).rejects.toMatchObject({ status: 422, code: "PDF_UNSUPPORTED_CHARACTER" });
  });
  test("uses the v2 check for foreign labels even when the body is legacy-compatible", async () => {
    const file = await renderPdf({ ...source, label: "ภาษาไทย" });
    expect(file.rendererVersion).toBe(2); expect(clean((await parsed(file.bytes)).pages.join(""))).toContain("ภาษาไทย");
  });
  test("wraps long tokens and rejects oversized or adversarial combining input in bounded time", async () => {
    const fonts = await loadPdfFonts(), start = performance.now();
    const text = "ع".repeat(9000), lines = [...layoutPdfParagraph(text, fonts, 11, 200)];
    expect(lines.map(line => line.text).join("")).toBe(text);
    expect(lines.every(line => Number.isFinite(line.width) && line.width <= 200)).toBe(true);
    for (const count of [8191, 8192, 8193]) expect(() => [...layoutPdfParagraph("ب" + "\u064e".repeat(count), fonts, 11, 200)]).toThrow();
    await expect(renderPdf({ ...source, text: "ع".repeat(500001) })).rejects.toMatchObject({ code: "PDF_TOO_LARGE" });
    expect(performance.now() - start).toBeLessThan(10000);
  });
  test("enforces a deterministic shared work budget before expensive shaping", async () => {
    const fonts = await loadPdfFonts(), budget = { used: PDF_LAYOUT_WORK_LIMIT - 2 };
    expect(() => [...layoutPdfParagraph("عرب", fonts, 11, 500, budget)]).toThrow(expect.objectContaining({ code: "PDF_TOO_COMPLEX" }));
  });
  test.each([
    { key: "single-arabic-500k", text: "ع".repeat(500000), expectedStatus: "rendered" },
    { key: "single-thai-500k", text: "ภาษาไทย".repeat(71429).slice(0, 500000), expectedStatus: "rejected" },
    { key: "zero-width-breaks-500k", text: "ع" + "\u200b\u200e".repeat(249999), expectedStatus: "rejected" },
  ])("bounds actual v2 resource work for $key", async ({ key, text, expectedStatus }) => {
    const start = performance.now(), memory = process.memoryUsage().rss;
    let outcome: { status: string; code?: string; pageCount?: number; bytes?: number };
    try {
      const result = await renderPdf({ ...source, text });
      expect(result.rendererVersion).toBe(2); expect(result.pageCount).toBeLessThanOrEqual(250);
      const alphabet = new Set(text);
      const body = pdfActualText(result.bytes).filter(line => [...line].every(char => alphabet.has(char))).join("");
      expect(createHash("sha256").update(body).digest("hex")).toBe(createHash("sha256").update(text).digest("hex"));
      outcome = { status: "rendered", pageCount: result.pageCount, bytes: result.bytes.length };
    } catch (error) {
      expect(error).toMatchObject({ status: 422, code: "PDF_TOO_COMPLEX" });
      outcome = { status: "rejected", code: "PDF_TOO_COMPLEX" };
    }
    expect(outcome.status).toBe(expectedStatus);
    const milliseconds = performance.now() - start;
    expect(milliseconds).toBeLessThan(20000);
    if (process.env.PDF_V2_QA === "1") await writeFile(qaPath + `pdf-v2-resource-${key}.json`, JSON.stringify({ key, codeUnits: text.length,
      milliseconds, rssStart: memory, rssEnd: process.memoryUsage().rss, peakRss: process.resourceUsage().maxRSS, outcome,
      node: process.versions, deterministicWorkLimit: PDF_LAYOUT_WORK_LIMIT, testTimeoutMs: 25000 }, null, 2) + "\n");
  }, 25000);
  test("stops excessive page rendering before persisting any result", async () => {
    await expect(renderPdf({ ...source, text: "ภาษาไทย\n".repeat(9000) })).rejects.toMatchObject({ code: "PDF_TOO_LARGE" });
  });
  test.each(["missing", "checksum"])("fails closed for a %s bundled font without touching real assets", async mode => {
    vi.resetModules();
    const real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(readFile).mockImplementation((...args: Parameters<typeof readFile>) => {
      if (String(args[0]).endsWith("NotoSansArabic-Regular.ttf")) return mode === "missing" ? Promise.reject(new Error("ENOENT")) : Promise.resolve(Buffer.from("bad checksum"));
      return real.readFile(...args);
    });
    try { await expect((await import("@/server/pdf-font-loader")).loadPdfFonts()).rejects.toMatchObject({ status: 503, code: "PDF_FONT_UNAVAILABLE" }); }
    finally { vi.mocked(readFile).mockImplementation(real.readFile); }
  });
});
