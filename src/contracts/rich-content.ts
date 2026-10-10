import { z } from "zod";

export const MAX_RICH_DOCUMENT_BYTES = 262_144;
export const MAX_RICH_DOCUMENT_TEXT_LENGTH = 20_000;
export const MAX_RICH_DOCUMENT_NODES = 2_000;
export const MAX_RICH_DOCUMENT_DEPTH = 12;
export const MAX_RICH_DOCUMENT_IMAGES = 32;

export type RichText = {
  type: "text"; text: string; bold?: true; italic?: true;
  fontSize?: 12 | 14 | 15 | 16 | 20 | 24 | 32; fontColor?: string;
};
export type RichBreak = { type: "break" };
export type RichLink = { type: "link"; href: string; children: (RichText | RichBreak)[] };
export type RichInline = RichText | RichBreak | RichLink;
export type RichLayout = {
  alignment?: "left" | "center" | "right" | "justify";
  direction?: "ltr" | "rtl"; indent?: number;
};
export type RichParagraph = RichLayout & { type: "paragraph"; children: RichInline[] };
export type RichHeading = RichLayout & { type: "heading"; level: 2 | 3 | 4; children: RichInline[] };
export type RichQuote = { type: "quote"; children: RichBlock[] };
export type RichList = { type: "list"; ordered: boolean; items: RichBlock[][] };
export type RichCell = { header?: true; colSpan?: number; rowSpan?: number; children: RichBlock[] };
export type RichTable = { type: "table"; rows: RichCell[][] };
export type RichWidth = { unit: "percent" | "px"; value: number };
export type RichImage = {
  type: "image"; nodeId: string; assetId: string; alt: string;
  alignment?: "left" | "center" | "right"; width?: RichWidth; caption?: RichInline[];
};
export type RichMedia = {
  type: "media"; provider: "youtube" | "vimeo"; mediaId: string;
  alignment?: "left" | "center" | "right"; width?: RichWidth;
};
export type RichBlock = RichParagraph | RichHeading | RichQuote | RichList | RichTable | RichImage | RichMedia;
export type RichDocumentV1 = { schemaVersion: 1; blocks: RichBlock[] };

/** JSON string size, including quotes/escapes. Reject invalid UTF-16 rather than
 * silently replacing an unpaired surrogate during UTF-8 encoding. */
function jsonStringBytes(value: string): number {
  if (value.length > MAX_RICH_DOCUMENT_BYTES) return -1;
  let bytes = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return -1;
      bytes += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff) return -1;
    else if (code === 0x22 || code === 0x5c) bytes += 2;
    else if (code < 0x20) bytes += [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
    else bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    if (bytes > MAX_RICH_DOCUMENT_BYTES) return -1;
  }
  return bytes;
}

type VisitFrame = {
  kind: "visit"; value: unknown; rawDepth: number; depth: number; inTable: boolean; field?: string;
};
type ContainerFrame = {
  kind: "container"; value: object; keys: string[]; index: number;
  array: boolean; rawDepth: number; depth: number; inTable: boolean;
};

/** Before recursive Zod parsing, bound even malformed arrays and cyclic direct
 * calls. Containers are visited one child at a time: an attacker cannot enqueue
 * a large tree before the byte budget is checked. No getter/toJSON is invoked. */
function preflight(input: unknown): string | undefined {
  const stack: (VisitFrame | ContainerFrame)[] = [
    { kind: "visit", value: input, rawDepth: 0, depth: 0, inTable: false },
  ];
  const active = new WeakSet<object>();
  let bytes = 0;
  let nodes = 0;
  let textLength = 0;
  let images = 0;
  try {
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.kind === "container") {
        if (frame.index === frame.keys.length) {
          active.delete(frame.value);
          stack.pop();
          continue;
        }
        const key = frame.keys[frame.index++];
        const descriptor = Object.getOwnPropertyDescriptor(frame.value, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
          return "본문에는 일반 JSON 값만 사용할 수 있습니다.";
        if (frame.index > 1) bytes++; // comma
        if (!frame.array) {
          const size = jsonStringBytes(key);
          if (size < 0) return "본문의 키 인코딩 또는 크기를 확인해주세요.";
          bytes += size + 1; // property name and colon
        }
        if (bytes > MAX_RICH_DOCUMENT_BYTES) return "본문 JSON은 256KiB 이하여야 합니다.";
        stack.push({
          kind: "visit", value: descriptor.value, rawDepth: frame.rawDepth + 1,
          depth: frame.depth, inTable: frame.inTable, field: frame.array ? undefined : key,
        });
        continue;
      }
      stack.pop();
      const { value } = frame;
      if (typeof value === "string") {
        const size = jsonStringBytes(value);
        if (size < 0) return "본문의 문자 인코딩 또는 크기를 확인해주세요.";
        bytes += size;
        if (["text", "href", "alt", "mediaId"].includes(frame.field ?? "")) {
          textLength += value.length;
          if (textLength > MAX_RICH_DOCUMENT_TEXT_LENGTH) return "본문 문자열 합계는 20,000자 이하여야 합니다.";
        }
      } else if (typeof value === "number") {
        if (!Number.isFinite(value)) return "본문의 숫자는 유한한 값이어야 합니다.";
        bytes += String(value).length;
      } else if (typeof value === "boolean") bytes += value ? 4 : 5;
      else if (value === null) bytes += 4;
      else if (typeof value !== "object") return "본문에는 일반 JSON 값만 사용할 수 있습니다.";
      else {
        // With at most 12 semantic levels, valid array/cell wrappers stay below
        // 64 physical levels. The independent guard also rejects unknown nesting.
        if (frame.rawDepth > 64) return "본문 구조가 너무 깊습니다.";
        if (active.has(value)) return "본문은 순환 구조를 포함할 수 없습니다.";
        const array = Array.isArray(value);
        const prototype: unknown = Object.getPrototypeOf(value);
        if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
          return "본문에는 일반 JSON 객체와 배열만 사용할 수 있습니다.";
        if (array && value.length > MAX_RICH_DOCUMENT_NODES)
          return "본문 배열의 항목이 너무 많습니다.";
        const names = Object.getOwnPropertyNames(value);
        if (Object.getOwnPropertySymbols(value).length) return "본문에는 기호 키를 사용할 수 없습니다.";
        if (array && (names.length !== value.length + 1 || !names.includes("length")))
          return "본문 배열은 빈 슬롯이나 추가 속성을 포함할 수 없습니다.";
        if (!array && names.length > 16) return "본문 객체의 속성이 너무 많습니다.";
        const keys = array ? names.filter(key => key !== "length") : names;
        if (array && keys.some((key, index) => key !== String(index)))
          return "본문 배열은 연속된 항목이어야 합니다.";
        const typeDescriptor = array ? undefined : Object.getOwnPropertyDescriptor(value, "type");
        if (typeDescriptor && !("value" in typeDescriptor)) return "본문은 계산된 속성을 포함할 수 없습니다.";
        const type: unknown = typeDescriptor?.value;
        const depth = frame.depth + (typeof type === "string" ? 1 : 0);
        if (typeof type === "string" && ++nodes > MAX_RICH_DOCUMENT_NODES)
          return "본문 노드는 2,000개 이하여야 합니다.";
        if (depth > MAX_RICH_DOCUMENT_DEPTH) return "본문 노드의 깊이는 12 이하여야 합니다.";
        if (type === "image" && ++images > MAX_RICH_DOCUMENT_IMAGES) return "본문 이미지는 32개 이하여야 합니다.";
        if (type === "table" && frame.inTable) return "표 안에는 다른 표를 넣을 수 없습니다.";
        bytes += 2; // container delimiters
        active.add(value);
        stack.push({ kind: "container", value, keys, index: 0, array,
          rawDepth: frame.rawDepth, depth, inTable: frame.inTable || type === "table" });
      }
      if (bytes > MAX_RICH_DOCUMENT_BYTES) return "본문 JSON은 256KiB 이하여야 합니다.";
    }
  } catch {
    return "본문 구조를 확인해주세요.";
  }
}

function safeLink(value: string): boolean {
  if (value.length > 2048 || /[\s\u0000-\u001f\u007f-\u009f\\]/u.test(value) || !/^https?:\/\//i.test(value)) return false;
  const authority = value.replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0];
  if (!authority || authority.includes("@")) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

const textSchema = z.object({
  type: z.literal("text"), text: z.string(), bold: z.literal(true).optional(), italic: z.literal(true).optional(),
  fontSize: z.union([z.literal(12), z.literal(14), z.literal(15), z.literal(16), z.literal(20), z.literal(24), z.literal(32)]).optional(),
  fontColor: z.string().regex(/^#[0-9a-f]{6}$/).optional(),
}).strict();
const breakSchema = z.object({ type: z.literal("break") }).strict();
const linkSchema = z.object({
  type: z.literal("link"), href: z.string().refine(safeLink, "링크는 사용자 정보·공백·제어문자 없는 절대 HTTP(S) URL이어야 합니다."),
  children: z.array(z.discriminatedUnion("type", [textSchema, breakSchema])),
}).strict();
const inlineSchema: z.ZodType<RichInline> = z.discriminatedUnion("type", [textSchema, breakSchema, linkSchema]);
const layout = {
  alignment: z.enum(["left", "center", "right", "justify"]).optional(),
  direction: z.enum(["ltr", "rtl"]).optional(), indent: z.number().int().min(0).max(8).optional(),
};
const widthSchema = z.discriminatedUnion("unit", [
  z.object({ unit: z.literal("percent"), value: z.number().min(10).max(100)
    .refine(value => /^\d+(?:\.\d)?$/.test(String(value)), "이미지 비율은 소수점 한 자리까지 사용할 수 있습니다.") }).strict(),
  z.object({ unit: z.literal("px"), value: z.number().int().min(1).max(4096) }).strict(),
]);
const imageSchema = z.object({
  type: z.literal("image"), nodeId: z.uuid(), assetId: z.uuid(), alt: z.string().refine(value => value.length <= 1000),
  alignment: z.enum(["left", "center", "right"]).optional(), width: widthSchema.optional(), caption: z.array(inlineSchema).optional(),
}).strict();
const mediaSchema = z.object({
  type: z.literal("media"), provider: z.enum(["youtube", "vimeo"]), mediaId: z.string(),
  alignment: z.enum(["left", "center", "right"]).optional(), width: widthSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (!(value.provider === "youtube" ? /^[A-Za-z0-9_-]{11}$/ : /^\d{1,15}$/).test(value.mediaId))
    ctx.addIssue({ code: "custom", path: ["mediaId"], message: "지원되는 영상 식별자를 입력해주세요." });
});

/** Place each explicit cell at the next unoccupied column. A colspan crossing
 * an earlier rowspan is an overlap, not permission to skip a hole. */
function tableError(table: RichTable): string | undefined {
  if (!table.rows.length || table.rows.length > 100) return "표는 1~100행이어야 합니다.";
  const occupied = Array.from({ length: table.rows.length }, () => Array<boolean>(20).fill(false));
  let cellCount = 0;
  let width = 0;
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
    let column = 0;
    for (const cell of table.rows[rowIndex]) {
      if (++cellCount > 400) return "표의 명시적인 셀은 400개 이하여야 합니다.";
      while (column < 20 && occupied[rowIndex][column]) column++;
      const columns = cell.colSpan ?? 1;
      const rows = cell.rowSpan ?? 1;
      if (column + columns > 20 || rowIndex + rows > table.rows.length) return "병합한 셀이 표의 범위를 벗어납니다.";
      for (let row = rowIndex; row < rowIndex + rows; row++) {
        for (let col = column; col < column + columns; col++) {
          if (occupied[row][col]) return "병합한 표의 셀이 겹칩니다.";
          occupied[row][col] = true;
        }
      }
      column += columns;
      width = Math.max(width, column);
    }
  }
  if (!width) return "표에는 셀이 있어야 합니다.";
  if (occupied.some(row => row.slice(0, width).some(value => !value))) return "표에는 빈 틈이나 서로 다른 행 너비가 없어야 합니다.";
}

const cellSchema: z.ZodType<RichCell> = z.object({
  header: z.literal(true).optional(), colSpan: z.number().int().min(1).max(20).optional(),
  rowSpan: z.number().int().min(1).max(100).optional(), children: z.array(z.lazy(() => blockSchema)),
}).strict();
const tableSchema = z.object({ type: z.literal("table"), rows: z.array(z.array(cellSchema).max(20)).min(1).max(100) })
  .strict().superRefine((value, ctx) => {
    const message = tableError(value);
    if (message) ctx.addIssue({ code: "custom", message });
  });
const blockSchema: z.ZodType<RichBlock> = z.lazy(() => z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), ...layout, children: z.array(inlineSchema) }).strict(),
  z.object({ type: z.literal("heading"), ...layout, level: z.union([z.literal(2), z.literal(3), z.literal(4)]), children: z.array(inlineSchema) }).strict(),
  z.object({ type: z.literal("quote"), children: z.array(blockSchema) }).strict(),
  z.object({ type: z.literal("list"), ordered: z.boolean(), items: z.array(z.array(blockSchema).min(1)).min(1) }).strict(),
  tableSchema, imageSchema, mediaSchema,
]));

function visitImages(blocks: RichBlock[], visit: (image: RichImage) => void): void {
  for (const block of blocks) {
    switch (block.type) {
      case "image": visit(block); break;
      case "quote": visitImages(block.children, visit); break;
      case "list": for (const item of block.items) visitImages(item, visit); break;
      case "table": for (const row of block.rows) for (const cell of row) visitImages(cell.children, visit); break;
    }
  }
}

const documentSchema = z.object({ schemaVersion: z.literal(1), blocks: z.array(blockSchema) }).strict()
  .superRefine((document, ctx) => {
    const ids = new Set<string>();
    visitImages(document.blocks, image => {
      const id = image.nodeId.toLowerCase();
      if (ids.has(id)) ctx.addIssue({ code: "custom", message: "이미지 노드 ID는 문서 안에서 유일해야 합니다." });
      ids.add(id);
    });
  });

/** The guard is on the input side of the pipe: invalid/cyclic/deep values never
 * enter a recursive schema. Parsing also gives callers an independent copy. */
export const richDocumentSchema: z.ZodType<RichDocumentV1> = z.unknown().superRefine((input, ctx) => {
  const message = preflight(input);
  if (message) ctx.addIssue({ code: "custom", message });
}).pipe(documentSchema);

function canonicalMediaUrl(media: Pick<RichMedia, "provider" | "mediaId">): string {
  return media.provider === "youtube"
    ? `https://www.youtube.com/watch?v=${media.mediaId}` : `https://vimeo.com/${media.mediaId}`;
}

export function richMediaUrl(media: RichMedia): string {
  return canonicalMediaUrl(mediaSchema.parse(media));
}

function inlineText(nodes: RichInline[]): string {
  return nodes.map(node => node.type === "text" ? node.text : node.type === "break" ? "\n" : inlineText(node.children)).join("");
}
function blocksText(blocks: RichBlock[]): string {
  return blocks.map(block => {
    switch (block.type) {
      case "paragraph": case "heading": return inlineText(block.children);
      case "quote": return blocksText(block.children);
      case "list": return block.items.map(blocksText).join("\n");
      case "table": return block.rows.map(row => row.map(cell => blocksText(cell.children)).join("\t")).join("\n");
      case "image": return inlineText(block.caption ?? []);
      case "media": return canonicalMediaUrl(block);
    }
  }).join("\n");
}

export function richDocumentText(document: RichDocumentV1): string {
  return blocksText(richDocumentSchema.parse(document).blocks);
}

export function plainTextRichDocument(text: string): RichDocumentV1 {
  // Newlines inside a text node are literal text, just like CR and CRLF. Using
  // one node avoids turning an otherwise valid legacy string into >2,000 nodes.
  return richDocumentSchema.parse({ schemaVersion: 1,
    blocks: text === "" ? [] : [{ type: "paragraph", children: [{ type: "text", text }] }],
  });
}

export function richDocumentImages(document: RichDocumentV1): RichImage[] {
  const images: RichImage[] = [];
  visitImages(richDocumentSchema.parse(document).blocks, image => images.push(image));
  return images;
}

export function remapRichDocument(document: RichDocumentV1, options: {
  assetIds: ReadonlyMap<string, string>;
  nodeId?: (image: Readonly<RichImage>, index: number) => string;
}): RichDocumentV1 {
  const result = richDocumentSchema.parse(document);
  let index = 0;
  visitImages(result.blocks, image => {
    const assetId = options.assetIds.get(image.assetId);
    if (assetId === undefined) throw new Error("본문 이미지의 자산 매핑이 누락되었습니다.");
    // Callers receive a separate snapshot even if they disregard Readonly.
    const nodeId = options.nodeId ? options.nodeId(structuredClone(image), index) : image.nodeId;
    image.assetId = assetId;
    image.nodeId = nodeId;
    index++;
  });
  return richDocumentSchema.parse(result);
}
