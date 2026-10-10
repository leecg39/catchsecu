import bidiFactory, { type EmbeddingLevels } from "bidi-js";
import LineBreaker from "linebreak";
import type { GlyphRun } from "fontkit";
import { fail } from "./http";
import { pdfLayoutControl, supportsPdfText, type PdfFont, type PdfFonts } from "./pdf-font-loader";

const bidi = bidiFactory();
const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });
const thaiWords = new Intl.Segmenter("th", { granularity: "word" });
const trailingTypes = new Set(["S", "WS", "B", "LRI", "RLI", "FSI", "PDI", "BN", "RLE", "LRE", "RLO", "LRO", "PDF"]);
export const PDF_LAYOUT_WORK_LIMIT = 2_000_000;
export type PdfLayoutBudget = { used: number };
function spend(budget: PdfLayoutBudget, units: number) {
  budget.used += units;
  if (budget.used > PDF_LAYOUT_WORK_LIMIT) fail(422, "PDF_TOO_COMPLEX", "PDF 문자 배치 작업량을 초과했습니다. 문서를 나누어 게시해주세요.");
}
type Cluster = { text: string; start: number; end: number; script: string; font: PdfFont };
export type PdfLayoutRun = { text: string; start: number; end: number; font: PdfFont; script: string; direction: "ltr" | "rtl"; level: number; shape: GlyphRun; width: number; x: number };
export type PdfLayoutLine = { text: string; start: number; end: number; direction: "ltr" | "rtl"; runs: PdfLayoutRun[]; width: number; ascent: number; descent: number };

function scriptOf(text: string): string | undefined {
  if (/\p{Script=Arabic}/u.test(text)) return "arab";
  if (/\p{Script=Thai}/u.test(text)) return "thai";
  if (/\p{Script=Hangul}/u.test(text)) return "hang";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return "kana";
  if (/\p{Script=Han}/u.test(text)) return "hani";
  if (/\p{Script=Cyrillic}/u.test(text)) return "cyrl";
  if (/\p{Script=Greek}/u.test(text)) return "grek";
  if (/\p{Script=Latin}/u.test(text)) return "latn";
}
function chooseFont(fonts: PdfFonts, text: string, script: string) {
  const preferred = script === "arab" ? fonts.arabic : script === "thai" ? fonts.thai : ["latn", "grek", "cyrl"].includes(script) ? fonts.latin : fonts.cjk;
  const found = [preferred, fonts.cjk, fonts.latin, fonts.arabic, fonts.thai].find(font => supportsPdfText(font, text));
  if (!found) fail(422, "PDF_UNSUPPORTED_CHARACTER", "결합 문자를 한 글꼴로 표시할 수 없습니다. 문구를 확인해주세요.");
  return found;
}
function clustersFor(text: string, fonts: PdfFonts): Cluster[] {
  const segments = [...graphemes.segment(text)];
  const scripts = segments.map(segment => scriptOf(segment.segment));
  let previous = "latn";
  return segments.map((segment, index) => {
    // Common/inherited clusters follow their script context so marks and joining controls stay together.
    const script = scripts[index] ?? (index === 0 ? scripts.find(Boolean) ?? previous : previous);
    previous = script;
    if (segment.segment.length > 256) fail(422, "PDF_TOO_LARGE", "PDF로 만들 수 있는 결합 문자 길이를 초과했습니다.");
    return { text: segment.segment, start: segment.index, end: segment.index + segment.segment.length,
      script, font: chooseFont(fonts, segment.segment, script) };
  });
}
function shapeRun(text: string, font: PdfFont, script: string, direction: "ltr" | "rtl") {
  // fontkit does not implement paragraph bidi. We provide the already resolved direction per run.
  // Mirroring belongs to bidi; disable font GSUB mirroring to avoid applying it twice.
  const mirrored = direction === "rtl" ? [...text].map(char => bidi.getMirroredCharacter(char) ?? char).join("") : text;
  const visible = mirrored.replace(/[\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu, "").replace(/\t/g, "    ");
  const shape = font.font.layout(visible, { rtlm: false }, script, undefined, direction);
  // Arabic GSUB can split a letter into its body plus a dot glyph with no source code points.
  // An empty ToUnicode entry makes readers fall back to the subset glyph ID (a control character).
  // A non-textbearing zero-width mapping plus line ActualText preserves the logical source instead.
  shape.glyphs = shape.glyphs.map(glyph => {
    let points = glyph.codePoints;
    if (direction === "rtl") points = points.map(cp => (bidi.getMirroredCharacter(String.fromCodePoint(cp)) ?? String.fromCodePoint(cp)).codePointAt(0)!);
    const codePoints = points.length ? points : [0x200b];
    return new Proxy(glyph, { get(target, property) { return property === "codePoints" ? codePoints : Reflect.get(target, property, target); } });
  });
  for (let i = 0; i < shape.glyphs.length; i++) {
    const glyph = shape.glyphs[i];
    if (glyph.id === 0 && glyph.codePoints.some(cp => !pdfLayoutControl.test(String.fromCodePoint(cp))))
      fail(422, "PDF_UNSUPPORTED_CHARACTER", "PDF 글꼴에서 문자를 조합하지 못했습니다.");
  }
  return shape;
}

export function* layoutPdfParagraph(text: string, fonts: PdfFonts, fontSize: number, maxWidth: number, budget: PdfLayoutBudget = { used: 0 }): Generator<PdfLayoutLine> {
  if (!(fontSize > 0) || !(maxWidth > 0)) throw new Error("Invalid PDF layout dimensions");
  spend(budget, text.length);
  const shapeCache = new Map<string, GlyphRun>(); let cachedUnits = 0;
  const measuredShape = (run: PdfLayoutRun) => {
    const key = `${run.font.key}:${run.script}:${run.direction}:${run.text}`;
    const cached = shapeCache.get(key); if (cached) return cached;
    const shape = shapeRun(run.text, run.font, run.script, run.direction);
    while (cachedUnits + key.length > 65536 && shapeCache.size) {
      const oldest = shapeCache.keys().next().value!; cachedUnits -= oldest.length; shapeCache.delete(oldest);
    }
    if (key.length <= 65536) { shapeCache.set(key, shape); cachedUnits += key.length; }
    return shape;
  };
  const clusters = clustersFor(text, fonts), embedding = bidi.getEmbeddingLevels(text), baseLevel = embedding.paragraphs[0]?.level ?? 0;
  if (!clusters.length) { yield { text: "", start: 0, end: 0, direction: "ltr", runs: [], width: 0, ascent: fontSize, descent: fontSize * .3 }; return; }
  const line = (first: number, last: number): PdfLayoutLine => {
    const start = clusters[first].start, end = clusters[last - 1].end, value = text.slice(start, end);
    // A very long token is split by the binary search below without shaping an unbounded run.
    if (value.length > 8192) return { text: value, start, end, direction: baseLevel % 2 ? "rtl" : "ltr", runs: [], width: Infinity, ascent: fontSize, descent: fontSize * .3 };
    spend(budget, value.length);
    const levels = embedding.levels.slice(start, end);
    for (let i = value.length - 1; i >= 0 && trailingTypes.has(bidi.getBidiCharTypeName(value[i])); i--) levels[i] = baseLevel;
    // Local indices also avoid bidi-js 1.1.0's trailing-space reset using absolute indices on a line slice.
    const local: EmbeddingLevels = { levels, paragraphs: [{ start: 0, end: value.length - 1, level: baseLevel }] };
    const order = bidi.getReorderedIndices(value, local), ranks = new Map(order.map((logical, visual) => [logical, visual]));
    const runs: PdfLayoutRun[] = [];
    for (const cluster of clusters.slice(first, last)) {
      const level = levels[cluster.start - start] ?? baseLevel, direction = level % 2 ? "rtl" : "ltr";
      const previous = runs.at(-1);
      if (previous && previous.font === cluster.font && previous.script === cluster.script && previous.level === level) {
        previous.text += cluster.text; previous.end = cluster.end;
      } else runs.push({ text: cluster.text, start: cluster.start, end: cluster.end, font: cluster.font,
        script: cluster.script, direction, level, shape: undefined as unknown as GlyphRun, width: 0, x: 0 });
    }
    let ascent = fontSize, descent = fontSize * .3;
    for (const run of runs) {
      run.shape = measuredShape(run);
      const scale = fontSize / run.font.font.unitsPerEm;
      run.width = run.shape.advanceWidth * scale;
      ascent = Math.max(ascent, run.font.font.ascent * scale, run.shape.bbox.maxY * scale);
      descent = Math.max(descent, -run.font.font.descent * scale, -run.shape.bbox.minY * scale);
    }
    let x = 0;
    const visualRank = (run: PdfLayoutRun) => {
      let rank = Infinity;
      for (let i = run.start; i < run.end; i++) rank = Math.min(rank, ranks.get(i - start) ?? Infinity);
      return rank;
    };
    for (const run of [...runs].sort((a, b) => visualRank(a) - visualRank(b))) { run.x = x; x += run.width; }
    // Preserve logical source order in the content stream; x coordinates carry visual ordering.
    return { text: value, start, end, direction: baseLevel % 2 ? "rtl" : "ltr", runs, width: x, ascent, descent };
  };
  const boundaryToCluster = new Map(clusters.map((cluster, i) => [cluster.end, i + 1]));
  const breaks = new Set<number>();
  const breaker = new LineBreaker(text);
  for (let point = breaker.nextBreak(); point; point = breaker.nextBreak()) {
    const boundary = boundaryToCluster.get(point.position); if (boundary) breaks.add(boundary);
  }
  if (/\p{Script=Thai}/u.test(text)) for (const word of thaiWords.segment(text)) {
    const boundary = boundaryToCluster.get(word.index + word.segment.length); if (boundary) breaks.add(boundary);
  }
  breaks.add(clusters.length);
  const opportunities = [...breaks].sort((a, b) => a - b);
  let first = 0, opportunity = 0, count = 0, previousLength = Math.max(1, Math.floor(maxWidth / fontSize));
  while (first < clusters.length) {
    while (opportunities[opportunity] <= first) opportunity++;
    let accepted: PdfLayoutLine | undefined, last = first;
    // Probe break opportunities exponentially, then refine the first overflowing interval.
    // Measuring every growing prefix is quadratic for zero-width soft-break/control input.
    const initial = opportunity;
    let probe = initial, step = 1, firstOverflow = opportunities.length;
    while (probe < opportunities.length) {
      const candidate = line(first, opportunities[probe]);
      if (candidate.width > maxWidth) { firstOverflow = probe; break; }
      accepted = candidate; last = opportunities[probe]; opportunity = probe + 1;
      if (probe === opportunities.length - 1) break;
      probe = Math.min(opportunities.length - 1, initial + step); step *= 2;
    }
    if (accepted && firstOverflow < opportunities.length) {
      let low = opportunity, high = firstOverflow - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2), candidate = line(first, opportunities[mid]);
        if (candidate.width <= maxWidth) { accepted = candidate; last = opportunities[mid]; opportunity = mid + 1; low = mid + 1; }
        else high = mid - 1;
      }
    }
    if (!accepted) {
      // Unbreakable tokens may wrap only at grapheme boundaries, then are reshaped for their new line context.
      const limit = opportunities[opportunity];
      let probe = Math.min(limit, first + previousLength), low = first + 1, high = probe - 1, best = first;
      // Start near the preceding line's measured length, not halfway through a 500k token.
      // Expand only while the real shaped line fits; all selected ends are still verified below.
      let step = 1;
      while (true) {
        const candidate = line(first, probe);
        if (candidate.width > maxWidth) { high = probe - 1; break; }
        accepted = candidate; best = probe; low = probe + 1;
        if (probe === limit) { high = probe; break; }
        probe = Math.min(limit, probe + step); step *= 2;
      }
      while (low <= high) {
        const mid = Math.floor((low + high) / 2), candidate = line(first, mid);
        if (candidate.width <= maxWidth) { accepted = candidate; best = mid; low = mid + 1; } else high = mid - 1;
      }
      if (!accepted) fail(422, "PDF_TOO_LARGE", "PDF 한 줄에 표시할 수 없는 결합 문자가 있습니다.");
      last = best;
    }
    if (++count > 20000) fail(422, "PDF_TOO_LARGE", "PDF로 만들 수 있는 줄 수를 초과했습니다.");
    previousLength = last - first;
    yield accepted; first = last;
  }
}
