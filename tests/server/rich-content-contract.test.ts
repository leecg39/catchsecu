import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  plainTextRichDocument, remapRichDocument, richDocumentImages, richDocumentSchema,
  richDocumentText, richMediaUrl,
  type RichDocumentV1, type RichImage, type RichMedia,
} from "@/contracts/rich-content";

// Expectations come from body-images/CONTRACT.md, not from the implementation.
// This suite imports no server, database, browser, network or frozen QA fixture.
const document = (blocks: unknown[] = []) => ({ schemaVersion: 1, blocks });
const text = (value: string) => ({ type: "text", text: value });
const paragraph = (value = "") => ({ type: "paragraph", children: value ? [text(value)] : [] });
const image = (patch: Record<string, unknown> = {}) => ({
  type: "image", nodeId: randomUUID(), assetId: randomUUID(), alt: "", ...patch,
});
const cell = (value: string, patch: Record<string, unknown> = {}) => ({
  children: [paragraph(value)], ...patch,
});
const parse = (blocks: unknown[]) => richDocumentSchema.parse(document(blocks));
const reject = (input: unknown) => {
  // safeParse must report a validation failure, including for cyclic/deep input.
  // An unbounded recursive schema throwing RangeError fails this assertion.
  expect(richDocumentSchema.safeParse(input).success).toBe(false);
};
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
function nestedQuotes(depth: number): unknown {
  let value: unknown = paragraph();
  for (let i = 1; i < depth; i++) value = { type: "quote", children: [value] };
  return value;
}
function sizedJsonDocument(bytes: number) {
  // Each table independently respects 20 columns / 400 explicit cells.
  // Empty cells are valid. Wrappers are not semantic nodes, so this exercises
  // the JSON-byte boundary without first exceeding node or text limits.
  const table = () => ({
    type: "table",
    rows: Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => ({
      header: true, colSpan: 1, rowSpan: 1, children: [],
    }))),
  });
  const blocks: unknown[] = Array.from({ length: 10 }, table);
  const padding = { type: "paragraph", children: [text("")] };
  blocks.push(padding);
  while (bytes - Buffer.byteLength(JSON.stringify(document(blocks))) > 20_000) {
    blocks.unshift(paragraph());
  }
  const missing = bytes - Buffer.byteLength(JSON.stringify(document(blocks)));
  if (missing < 0 || missing > 20_000) throw new Error("Invalid byte-boundary fixture");
  padding.children[0].text = "a".repeat(missing);
  return document(blocks);
}

describe("rich content meaning and plain-text preservation", () => {
  test("empty documents, a blank paragraph and image-only documents are valid", () => {
    expect(richDocumentSchema.parse(document())).toEqual(document());
    expect(parse([paragraph()])).toEqual(document([paragraph()]));
    const picture = image();
    expect(parse([picture])).toEqual(document([picture]));
    expect(richDocumentText(parse([]))).toBe("");
    expect(richDocumentText(parse([picture]))).toBe("");
  });

  test("all supported formatting and Unicode survive without HTML interpretation", () => {
    const input = document([
      { type: "heading", level: 2, alignment: "right", direction: "rtl", indent: 8, children: [
        { type: "text", text: " مرحبًا <img onerror='x'>\uFEFF ", bold: true, italic: true, fontSize: 32, fontColor: "#a1b2c3" },
      ] },
      { type: "paragraph", alignment: "justify", direction: "ltr", indent: 0, children: [
        text("한글 ไทย Türkçe 🧭"), { type: "break" },
        { type: "link", href: "https://example.test/a?b=1&c=2#part", children: [text("링크"), { type: "break" }, text("표시")] },
      ] },
    ]);
    expect(richDocumentSchema.parse(input)).toEqual(input);
    expect(richDocumentText(richDocumentSchema.parse(input))).toBe(
      " مرحبًا <img onerror='x'>\uFEFF \n한글 ไทย Türkçe 🧭\n링크\n표시",
    );
  });

  test("block, quote, list, table, caption and media projection has exact separators", () => {
    const content = parse([
      { type: "heading", level: 3, children: [text("제목")] },
      { type: "quote", children: [paragraph("인용 1"), paragraph("인용 2")] },
      { type: "list", ordered: false, items: [[paragraph("항목 1")], [paragraph("항목 2"), paragraph("계속")]] },
      { type: "table", rows: [[cell("A"), cell("B")], [cell("C"), cell("D")]] },
      image({ alt: "대체 설명은 본문에 합치지 않음", caption: [text("캡션"), { type: "break" }, text("둘째 줄")] }),
      { type: "media", provider: "youtube", mediaId: "aB_09-Zxy12" },
      { type: "media", provider: "vimeo", mediaId: "123456789012345" },
    ]);
    expect(richDocumentText(content)).toBe(
      "제목\n인용 1\n인용 2\n항목 1\n항목 2\n계속\nA\tB\nC\tD\n캡션\n둘째 줄\nhttps://www.youtube.com/watch?v=aB_09-Zxy12\nhttps://vimeo.com/123456789012345",
    );
  });

  test("blank blocks and explicit trailing line breaks are not trimmed", () => {
    expect(richDocumentText(parse([paragraph(), paragraph("x"), paragraph()]))).toBe("\nx\n");
    expect(richDocumentText(parse([
      { type: "paragraph", children: [{ type: "break" }, text("x"), { type: "break" }] },
    ]))).toBe("\nx\n");
  });

  test("plain text round-trips spaces, HTML literals, Unicode and every newline form", () => {
    for (const value of [
      "", " ", "  \t x \t  ", "\n", "\r", "\r\n", "\n\n끝\n",
      "\uFEFF앞\u00A0뒤\u200B", "<script>alert('literal')</script><img src=x>",
      "A\rB\nC\r\nD\n", "한글 👩🏽‍💻 e\u0301 مُرحبًا ไทย", "\n".repeat(19_999),
    ]) {
      const rich = plainTextRichDocument(value);
      expect(richDocumentSchema.safeParse(rich).success).toBe(true);
      expect(richDocumentText(rich)).toBe(value);
    }
    expect(plainTextRichDocument("")).toEqual(document());
  });

  test("plain conversion obeys UTF-16 bounds and rejects malformed surrogates", () => {
    for (const value of ["x".repeat(20_000), "🧭".repeat(10_000)]) {
      expect(richDocumentText(plainTextRichDocument(value))).toBe(value);
    }
    for (const value of ["x".repeat(20_001), "🧭".repeat(10_000) + "x", "\uD800", "\uDC00", "a\uD800b"]) {
      expect(() => plainTextRichDocument(value)).toThrow();
    }
  });
});

describe("strict nodes, styles, media and URL boundaries", () => {
  test("strict root and every node reject extra executable or transport fields", () => {
    for (const root of [
      { ...document(), schemaVersion: 0 }, { ...document(), schemaVersion: 2 },
      { ...document(), html: "<p>x</p>" }, { blocks: [] }, null, [],
    ]) reject(root);
    const cases = [
      { ...paragraph(), html: "<img>" },
      { ...paragraph(), style: "background:url(https://example.test/x)" },
      { type: "heading", level: 2, children: [], onclick: "x()" },
      { type: "quote", children: [], className: "unsafe" },
      { type: "list", ordered: false, items: [[paragraph()]], start: 3 },
      { type: "table", rows: [[{ ...cell("x"), style: "color:red" }]] },
      image({ src: "https://example.test/x.png" }),
      image({ storageKey: "tenant/private.png" }),
      image({ onerror: "x()" }),
      { type: "media", provider: "youtube", mediaId: "aB_09-Zxy12", iframe: "<iframe>" },
    ];
    for (const value of cases) reject(document([value]));
    for (const value of [
      { ...text("x"), html: "<b>x</b>" }, { type: "break", text: "x" },
      { type: "link", href: "https://example.test", children: [], target: "_blank" },
    ]) reject(document([{ type: "paragraph", children: [value] }]));
  });

  test("unsupported node names, block nesting and nested links are rejected", () => {
    for (const value of [
      { type: "iframe", src: "https://example.test" },
      { type: "html", html: "<p>x</p>" }, text("top-level inline"),
      { type: "paragraph", children: [image()] },
      { type: "heading", level: 2, children: [paragraph("nested")] },
      { type: "paragraph", children: [{ type: "link", href: "https://example.test", children: [
        { type: "link", href: "https://example.test/b", children: [text("nested")] },
      ] }] },
    ]) reject(document([value]));
  });

  test("formatting enums and numeric settings reject coercion and non-finite values", () => {
    for (const patch of [
      { bold: false }, { italic: false }, { fontSize: 18 }, { fontSize: "16" },
      { fontColor: "#ABCDEF" }, { fontColor: "#abc" }, { fontColor: "red" }, { fontColor: "#aabbcc;" },
    ]) reject(document([{ type: "paragraph", children: [{ ...text("x"), ...patch }] }]));
    for (const patch of [
      { alignment: "start" }, { direction: "auto" }, { indent: -1 }, { indent: 9 },
      { indent: 1.5 }, { indent: NaN }, { indent: Infinity }, { indent: "1" },
    ]) reject(document([{ ...paragraph("x"), ...patch }]));
    for (const level of [1, 5, 6, 2.5, "2"]) reject(document([{ type: "heading", level, children: [] }]));
  });

  test("all enumerated font sizes, headings and alignments are accepted", () => {
    for (const fontSize of [12, 14, 15, 16, 20, 24, 32]) {
      expect(parse([{ type: "paragraph", children: [{ ...text("x"), fontSize }] }]).blocks).toHaveLength(1);
    }
    for (const level of [2, 3, 4]) {
      expect(parse([{ type: "heading", level, children: [] }]).blocks).toHaveLength(1);
    }
    for (const alignment of ["left", "center", "right", "justify"]) {
      expect(parse([{ ...paragraph("x"), alignment }]).blocks).toHaveLength(1);
    }
  });

  test("absolute HTTP(S) URLs are valid and retain their original string", () => {
    for (const href of [
      "http://example.test/path", "https://example.test/a%20b?q=1&x=2#frag",
      "https://example.test:8443/path", "https://example.test/" + "x".repeat(2027),
    ]) {
      expect(href.length).toBeLessThanOrEqual(2048);
      const input = document([{ type: "paragraph", children: [{ type: "link", href, children: [text("표시")] }] }]);
      expect(richDocumentSchema.parse(input)).toEqual(input);
    }
  });

  test("unsafe, ambiguous and overlong link targets fail instead of being repaired", () => {
    for (const href of [
      "javascript:alert(1)", "data:text/html,x", "file:///tmp/x", "blob:https://example.test/id",
      "mailto:a@example.test", "//example.test/x", "/relative", "../x", "example.test",
      "https:example.test", "http:/example.test", "https://", "https://u:p@example.test",
      "https://u@example.test", " https://example.test", "https://example.test ",
      "https://example.test/a b", "https://example.test/a\tb", "https://example.test/a\nb",
      "https://example.test/a\u0000b", "https://example.test/a\u007Fb",
      "https://example.test/a\u00A0b", "https://example.test\\@other.test",
      "https://example.test/" + "x".repeat(2048), "https://example.test/\uD800",
    ]) reject(document([{ type: "paragraph", children: [{ type: "link", href, children: [text("표시")] }] }]));
  });

  test("media use exact provider IDs and canonical HTTPS URLs only", () => {
    const youtube = { type: "media", provider: "youtube", mediaId: "aB_09-Zxy12" } as const;
    const vimeo = { type: "media", provider: "vimeo", mediaId: "123456789012345" } as const;
    expect(richMediaUrl(youtube)).toBe("https://www.youtube.com/watch?v=aB_09-Zxy12");
    expect(richMediaUrl(vimeo)).toBe("https://vimeo.com/123456789012345");
    expect(parse([youtube, vimeo]).blocks).toHaveLength(2);
    for (const value of [
      { ...youtube, provider: "other" }, { ...youtube, mediaId: "https://youtu.be/aB_09-Zxy12" },
      { ...youtube, mediaId: "aB_09-Zxy1" }, { ...youtube, mediaId: "aB_09-Zxy123" },
      { ...youtube, mediaId: "aB_09-Zxy1?" }, { ...vimeo, mediaId: "" },
      { ...vimeo, mediaId: "1234567890123456" }, { ...vimeo, mediaId: "-123" },
      { ...vimeo, mediaId: "１２３" }, { ...vimeo, mediaId: "12/3" },
    ]) {
      reject(document([value]));
      expect(() => richMediaUrl(value as RichMedia)).toThrow();
    }
  });

  test("image and media widths accept only bounded units and precision", () => {
    for (const width of [
      { unit: "percent", value: 10 }, { unit: "percent", value: 75.5 }, { unit: "percent", value: 100 },
      { unit: "px", value: 1 }, { unit: "px", value: 4096 },
    ]) expect(parse([image({ width }), { type: "media", provider: "vimeo", mediaId: "1", width }]).blocks).toHaveLength(2);
    for (const width of [
      { unit: "percent", value: 9.9 }, { unit: "percent", value: 100.1 }, { unit: "percent", value: 33.33 },
      { unit: "px", value: 0 }, { unit: "px", value: 4097 }, { unit: "px", value: 1.5 },
      { unit: "%", value: 50 }, { unit: "px", value: "50" }, { unit: "px", value: Infinity },
      { unit: "percent", value: NaN }, { unit: "px", value: 50, height: 20 },
    ]) {
      reject(document([image({ width })]));
      reject(document([{ type: "media", provider: "vimeo", mediaId: "1", width }]));
    }
    reject(document([image({ alignment: "justify" })]));
  });
});

describe("table geometry and structural limits", () => {
  test("combined row/column spans form a complete rectangular grid", () => {
    const table = { type: "table", rows: [
      [cell("A", { header: true, colSpan: 2, rowSpan: 2 }), cell("B")],
      [cell("C")],
      [cell("D"), cell("E"), cell("F")],
    ] };
    expect(parse([table])).toEqual(document([table]));
    // Projection follows explicit cells, not virtual occupied grid positions.
    expect(richDocumentText(parse([table]))).toBe("A\tB\nC\nD\tE\tF");
  });

  test("a fully spanned row is empty in projection, not repeated text", () => {
    const table = { type: "table", rows: [[cell("A", { colSpan: 2, rowSpan: 2 })], []] };
    expect(richDocumentText(parse([table]))).toBe("A\n");
  });

  test("overlap, holes, unequal widths and spans past the final row fail", () => {
    for (const rows of [
      [[cell("A"), cell("B", { rowSpan: 2 }), cell("C")], [cell("overlap", { colSpan: 2 })]],
      [[cell("A"), cell("B")], [cell("missing")]],
      [[cell("A")], [cell("B"), cell("too wide")]],
      [[cell("A", { rowSpan: 2 })]],
      [[]], [[cell("A")], []],
    ]) reject(document([{ type: "table", rows }]));
    reject(document([{ type: "table", rows: [] }]));
  });

  test("tables cannot be nested even indirectly through quote or list cells", () => {
    const nested = { type: "table", rows: [[cell("inner")]] };
    for (const child of [
      nested, { type: "quote", children: [nested] },
      { type: "list", ordered: true, items: [[nested]] },
    ]) reject(document([{ type: "table", rows: [[{ children: [child] }]] }]));
  });

  test("table spans and explicit row/column/cell boundaries are enforced", () => {
    for (const patch of [
      { colSpan: 0 }, { colSpan: 21 }, { colSpan: 1.5 }, { rowSpan: 0 },
      { rowSpan: 101 }, { rowSpan: 1.5 }, { header: false }, { colSpan: NaN },
    ]) reject(document([{ type: "table", rows: [[cell("x", patch)]] }]));
    const rows100 = Array.from({ length: 100 }, () => [cell("")]);
    const cells400 = Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => cell("")));
    expect(parse([{ type: "table", rows: rows100 }]).blocks).toHaveLength(1);
    expect(parse([{ type: "table", rows: cells400 }]).blocks).toHaveLength(1);
    reject(document([{ type: "table", rows: [...rows100, [cell("")]] }]));
    reject(document([{ type: "table", rows: [Array.from({ length: 21 }, () => cell(""))] }]));
    reject(document([{ type: "table", rows: Array.from({ length: 21 }, () => Array.from({ length: 20 }, () => cell(""))) }]));
    expect(parse([{ type: "table", rows: [[cell("max span", { colSpan: 20, rowSpan: 100 })], ...Array.from({ length: 99 }, () => [])] }]).blocks).toHaveLength(1);
  });

  test("empty list items fail but a list item containing a blank paragraph is valid", () => {
    reject(document([{ type: "list", ordered: false, items: [[]] }]));
    reject(document([{ type: "list", ordered: true, items: [[paragraph()], []] }]));
    expect(parse([{ type: "list", ordered: true, items: [[paragraph()]] }]).blocks).toHaveLength(1);
  });

  test("semantic depth excludes root, array, row and cell wrappers", () => {
    expect(parse([nestedQuotes(12)]).blocks).toHaveLength(1);
    reject(document([nestedQuotes(13)]));
    // 9 quote nodes -> table(10) -> paragraph(11) -> text(12).
    let atBoundary: unknown = { type: "table", rows: [[cell("depth 12")]] };
    for (let i = 0; i < 9; i++) atBoundary = { type: "quote", children: [atBoundary] };
    expect(parse([atBoundary]).blocks).toHaveLength(1);
    // A link adds one real type node, taking its text to depth 13.
    let over: unknown = { type: "table", rows: [[{ children: [{
      type: "paragraph", children: [{ type: "link", href: "https://example.test", children: [text("depth 13")] }],
    }] }]] };
    for (let i = 0; i < 9; i++) over = { type: "quote", children: [over] };
    reject(document([over]));
  });

  test("the 2000 semantic-node boundary counts inline nodes but not wrappers", () => {
    expect(parse(Array.from({ length: 2000 }, () => paragraph())).blocks).toHaveLength(2000);
    reject(document(Array.from({ length: 2001 }, () => paragraph())));
    expect(parse([{ type: "paragraph", children: Array.from({ length: 1999 }, () => text("")) }]).blocks).toHaveLength(1);
    reject(document([{ type: "paragraph", children: Array.from({ length: 2000 }, () => text("")) }]));
  });
});

describe("Unicode, aggregate bytes, identity and hostile direct inputs", () => {
  test("UTF-16 content, href, alt, caption and media IDs share one 20000-unit budget", () => {
    const href = "https://example.test/x";
    const id = "aB_09-Zxy12";
    const alt = "🧭".repeat(500);
    const caption = "캡션";
    const remaining = 20_000 - href.length - id.length - alt.length - caption.length;
    const blocks = [
      { type: "paragraph", children: [{ type: "link", href, children: [text("x".repeat(remaining))] }] },
      image({ alt, caption: [text(caption)] }),
      { type: "media", provider: "youtube", mediaId: id },
    ];
    expect(parse(blocks).blocks).toHaveLength(3);
    reject(document([...blocks, paragraph("x")]));
    reject(document([image({ alt: "🧭".repeat(500) + "x" })]));
  });

  test("lone surrogates fail in text, alt, caption and link metadata", () => {
    for (const malformed of ["\uD800", "\uDC00", "x\uD800y", "\uD800\uD800", "\uDC00\uD800"]) {
      reject(document([paragraph(malformed)]));
      reject(document([image({ alt: malformed })]));
      reject(document([image({ caption: [text(malformed)] })]));
      reject(document([{ type: "paragraph", children: [{ type: "link", href: "https://example.test/" + malformed, children: [] }] }]));
    }
    expect(parse([paragraph("\uFEFF\u00A0e\u0301🧭")])).toEqual(document([paragraph("\uFEFF\u00A0e\u0301🧭")]));
  });

  test("JSON limit is exact UTF-8 bytes, independently of wrapper or text counts", () => {
    const boundary = sizedJsonDocument(262_144);
    expect(Buffer.byteLength(JSON.stringify(boundary), "utf8")).toBe(262_144);
    expect(richDocumentSchema.safeParse(boundary).success).toBe(true);
    const over = structuredClone(boundary);
    const padding = over.blocks.at(-1) as { children: { text: string }[] };
    padding.children[0].text += "x";
    expect(Buffer.byteLength(JSON.stringify(over), "utf8")).toBe(262_145);
    reject(over);
    const multibyte = structuredClone(boundary);
    const tail = multibyte.blocks.at(-1) as { children: { text: string }[] };
    tail.children[0].text = "한" + tail.children[0].text.slice(1);
    expect(JSON.stringify(multibyte).length).toBe(JSON.stringify(boundary).length);
    expect(Buffer.byteLength(JSON.stringify(multibyte), "utf8")).toBe(262_146);
    reject(multibyte);
  });

  test("image occurrence IDs are UUIDs and unique while shared assets are allowed", () => {
    const assetId = randomUUID(), first = image({ assetId }), second = image({ assetId });
    expect(parse([first, { type: "quote", children: [second] }]).blocks).toHaveLength(2);
    reject(document([first, { type: "quote", children: [{ ...second, nodeId: first.nodeId }] }]));
    for (const key of ["", "not-a-uuid", "https://example.test/image.png", "../object", 42, null]) {
      reject(document([image({ nodeId: key })]));
      reject(document([image({ assetId: key })]));
    }
  });

  test("image count is global across nested blocks, not per container", () => {
    const pictures = Array.from({ length: 32 }, () => image());
    const blocks = [{ type: "quote", children: pictures.slice(0, 16) }, {
      type: "list", ordered: false, items: [pictures.slice(16)],
    }];
    expect(richDocumentImages(parse(blocks))).toHaveLength(32);
    reject(document([...blocks, image()]));
  });

  test("cyclic and huge-depth direct inputs produce validation failures, not stack errors", () => {
    const cyclicQuote: { type: string; children: unknown[] } = { type: "quote", children: [] };
    cyclicQuote.children.push(cyclicQuote);
    reject(document([cyclicQuote]));
    const rootCycle: { schemaVersion: number; blocks: unknown[] } = { schemaVersion: 1, blocks: [] };
    rootCycle.blocks.push(rootCycle);
    reject(rootCycle);
    reject(document([nestedQuotes(20_000)]));
  });

  test("large wrapper arrays and oversized scalar input fail before recursive processing", () => {
    reject(document([{ type: "list", ordered: false, items: Array.from({ length: 100_000 }, () => []) }]));
    reject(document([{ type: "table", rows: Array.from({ length: 100_000 }, () => []) }]));
    reject(document([paragraph("x".repeat(300_000))]));
  });

  test("direct callers cannot trigger getters or toJSON while malformed containers are rejected", () => {
    let getterCalls = 0;
    let toJsonCalls = 0;
    const getterNode = paragraph("안전");
    Object.defineProperty(getterNode, "html", {
      enumerable: true,
      get() {
        getterCalls++;
        return "<script>alert(1)</script>";
      },
    });
    reject(document([getterNode]));
    expect(getterCalls).toBe(0);

    const toJsonNode = {
      ...paragraph("안전"),
      toJSON() {
        toJsonCalls++;
        return paragraph("바뀐 값");
      },
    };
    reject(document([toJsonNode]));
    expect(toJsonCalls).toBe(0);

    const sparse = document([paragraph("첫째"), paragraph("둘째")]);
    delete sparse.blocks[0];
    reject(sparse);
    reject(document([Object.assign(Object.create(null), paragraph("null prototype"), {
      [Symbol("hidden")]: "value",
    })]));
  });
});

describe("owned image discovery and immutable structural copy", () => {
  function copySource(): RichDocumentV1 {
    const shared = randomUUID();
    return parse([
      image({ assetId: shared, alt: "첫째", width: { unit: "percent", value: 75.5 }, caption: [text("앞")] }),
      { type: "quote", children: [{
        type: "list", ordered: true, items: [[image({ assetId: shared, alt: "둘째" })]],
      }] },
      { type: "table", rows: [[{ children: [image({ alt: "셋째" }), paragraph("표 뒤")] }]] },
      { type: "paragraph", children: [{
        type: "link", href: "https://example.test", children: [{ ...text("불변"), bold: true }],
      }] },
    ]);
  }

  test("image discovery follows document order and deep-copies every result", () => {
    const source = copySource(), before = structuredClone(source);
    deepFreeze(source);
    const found = richDocumentImages(source);
    expect(found.map(entry => entry.alt)).toEqual(["첫째", "둘째", "셋째"]);
    found[0].alt = "변경";
    if (found[0].width) found[0].width.value = 10;
    const caption = found[0].caption?.[0];
    if (caption?.type === "text") caption.text = "변경";
    found.pop();
    expect(source).toEqual(before);
    expect(richDocumentImages(source)).toHaveLength(3);
  });

  test("asset remap is complete, preserves node IDs by default and does not mutate any source", () => {
    const source = copySource(), before = structuredClone(source);
    const originals = richDocumentImages(source);
    const assetIds = new Map<string, string>(originals.map(entry => [entry.assetId, randomUUID()]));
    const mappingBefore = [...assetIds];
    deepFreeze(source);
    const mapped = remapRichDocument(source, { assetIds });
    expect(richDocumentSchema.safeParse(mapped).success).toBe(true);
    expect(richDocumentImages(mapped).map(entry => entry.nodeId)).toEqual(originals.map(entry => entry.nodeId));
    expect(richDocumentImages(mapped).map(entry => entry.assetId)).toEqual(originals.map(entry => assetIds.get(entry.assetId)));
    expect(richDocumentText(mapped)).toBe(richDocumentText(source));
    const first = mapped.blocks[0] as RichImage;
    first.alt = "복사본";
    if (first.width) first.width.value = 10;
    const caption = first.caption?.[0];
    if (caption?.type === "text") caption.text = "독립 캡션";
    const last = mapped.blocks.at(-1);
    if (last?.type === "paragraph") {
      const link = last.children[0];
      if (link.type === "link" && link.children[0]?.type === "text") link.children[0].text = "독립 링크";
    }
    expect(source).toEqual(before);
    expect([...assetIds]).toEqual(mappingBefore);
  });

  test("node ID callbacks allocate once per occurrence even when two images share one asset", () => {
    const source = copySource(), originals = richDocumentImages(source);
    const assetIds = new Map<string, string>(originals.map(entry => [entry.assetId, randomUUID()]));
    const newIds = originals.map(() => randomUUID());
    let calls = 0;
    const mapped = remapRichDocument(source, { assetIds, nodeId: () => newIds[calls++] });
    expect(calls).toBe(3);
    expect(richDocumentImages(mapped).map(entry => entry.nodeId)).toEqual(newIds);
    expect(richDocumentImages(source).map(entry => entry.nodeId)).toEqual(originals.map(entry => entry.nodeId));
    expect(richDocumentImages(mapped)[0].assetId).toBe(richDocumentImages(mapped)[1].assetId);
  });

  test("node ID callbacks receive occurrence order and isolated metadata copies", () => {
    const source = copySource(), before = structuredClone(source), originals = richDocumentImages(source);
    const assetIds = new Map<string, string>(originals.map(entry => [entry.assetId, randomUUID()]));
    const seen: { nodeId: string; index: number }[] = [];
    deepFreeze(source);
    const mapped = remapRichDocument(source, { assetIds, nodeId: (entry, index) => {
      seen.push({ nodeId: entry.nodeId, index });
      // The callback type is shallow Readonly; nested objects must still be
      // isolated from both the original and the returned document.
      if (entry.width) entry.width.value = 10;
      entry.caption?.push({ type: "text", text: "callback must not inject this" });
      (entry as RichImage).alt = "callback must not replace this";
      return randomUUID();
    } });
    expect(seen).toEqual(originals.map((entry, index) => ({
      nodeId: entry.nodeId, index,
    })));
    expect(source).toEqual(before);
    const metadata = (entry: RichImage) => ({
      alt: entry.alt, alignment: entry.alignment, width: entry.width, caption: entry.caption,
    });
    expect(richDocumentImages(mapped).map(metadata)).toEqual(originals.map(metadata));
    expect(richDocumentText(mapped)).toBe(richDocumentText(before));
  });

  test("missing, invalid or duplicate replacement identities fail atomically", () => {
    const source = copySource(), before = structuredClone(source), originals = richDocumentImages(source);
    const fullMap = new Map<string, string>(originals.map(entry => [entry.assetId, randomUUID()]));
    const partial = new Map(fullMap);
    partial.delete(originals.at(-1)!.assetId);
    expect(() => remapRichDocument(source, { assetIds: partial })).toThrow();
    const invalid = new Map(fullMap);
    invalid.set(originals[0].assetId, "https://example.test/private");
    expect(() => remapRichDocument(source, { assetIds: invalid })).toThrow();
    expect(() => remapRichDocument(source, { assetIds: fullMap, nodeId: () => "invalid" })).toThrow();
    const repeated = randomUUID();
    expect(() => remapRichDocument(source, { assetIds: fullMap, nodeId: () => repeated })).toThrow();
    let calls = 0;
    expect(() => remapRichDocument(source, { assetIds: fullMap, nodeId: () => {
      if (++calls === 2) throw new Error("Allocation failed");
      return randomUUID();
    } })).toThrow();
    expect(source).toEqual(before);
  });
});
