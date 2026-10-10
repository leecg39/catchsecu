import { parseDocument } from "htmlparser2";
import { isComment, isTag, isText, type ChildNode, type Element } from "domhandler";
import {
  richDocumentSchema,
  richMediaUrl,
  type RichBlock,
  type RichCell,
  type RichDocumentV1,
  type RichInline,
  type RichLayout,
  type RichMedia,
  type RichText,
  type RichWidth,
} from "./rich-content";

export const MAX_RICH_HTML_BYTES = 524_288;
const MAX_HTML_NODES = 10_000;
const MAX_HTML_DEPTH = 64;

export class RichHtmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RichHtmlError";
  }
}

function invalid(message: string): never {
  throw new RichHtmlError(message);
}

function attributes(element: Element, allowed: readonly string[]): Record<string, string> {
  const permitted = new Set(allowed);
  for (const key of Object.keys(element.attribs)) {
    if (!permitted.has(key)) invalid(`<${element.name}>에서 허용하지 않는 ${key} 속성을 사용할 수 없습니다.`);
  }
  return element.attribs;
}

function styleMap(value: string | undefined, allowed: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  if (value === undefined || value.trim() === "") return result;
  const permitted = new Set(allowed);
  for (const declaration of value.split(";")) {
    if (!declaration.trim()) continue;
    const colon = declaration.indexOf(":");
    if (colon < 1) invalid("본문 스타일 형식을 확인해주세요.");
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const content = declaration.slice(colon + 1).trim();
    if (!permitted.has(property) || !content || result.has(property))
      invalid(`허용하지 않는 ${property || "빈"} 스타일입니다.`);
    result.set(property, content);
  }
  return result;
}

function preflightHtml(html: string, nodes: ChildNode[]): void {
  if (new TextEncoder().encode(html).byteLength > MAX_RICH_HTML_BYTES)
    invalid("편집기 HTML은 512KiB 이하여야 합니다.");
  const stack = nodes.map(node => ({ node, depth: 1 }));
  let count = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (++count > MAX_HTML_NODES) invalid("편집기 HTML 노드가 너무 많습니다.");
    if (depth > MAX_HTML_DEPTH) invalid("편집기 HTML 구조가 너무 깊습니다.");
    if (isTag(node)) {
      for (let index = node.children.length - 1; index >= 0; index--)
        stack.push({ node: node.children[index], depth: depth + 1 });
    } else if (!isText(node) && !isComment(node)) {
      invalid("편집기 HTML에는 문서 지시문을 사용할 수 없습니다.");
    }
  }
}

function onlyWhitespace(node: ChildNode): boolean {
  return isText(node) && /^\s*$/u.test(node.data);
}

function classes(element: Element, allowed: readonly string[]): Set<string> {
  const values = new Set((element.attribs.class ?? "").split(/\s+/u).filter(Boolean));
  const permitted = new Set(allowed);
  for (const value of values) if (!permitted.has(value)) invalid(`허용하지 않는 ${value} 클래스입니다.`);
  return values;
}

function widthFromStyle(style: Map<string, string>): RichWidth | undefined {
  const width = style.get("width");
  if (!width) return undefined;
  const percent = /^(\d{1,3}(?:\.\d)?)%$/u.exec(width);
  if (percent) return { unit: "percent", value: Number(percent[1]) };
  const pixels = /^(\d{1,4})px$/u.exec(width);
  if (pixels) return { unit: "px", value: Number(pixels[1]) };
  return invalid("이미지와 미디어 폭은 제한된 px 또는 % 값이어야 합니다.");
}

function layoutFrom(element: Element): RichLayout {
  const attrs = attributes(element, ["style", "dir", "data-rich-indent"]);
  const style = styleMap(attrs.style, ["text-align"]);
  const result: RichLayout = {};
  const alignment = style.get("text-align");
  if (alignment) {
    if (!["left", "center", "right", "justify"].includes(alignment)) invalid("본문 정렬 값을 확인해주세요.");
    result.alignment = alignment as RichLayout["alignment"];
  }
  if (attrs.dir) {
    if (attrs.dir !== "ltr" && attrs.dir !== "rtl") invalid("본문 방향 값을 확인해주세요.");
    result.direction = attrs.dir;
  }
  if (attrs["data-rich-indent"] !== undefined) {
    if (!/^[0-8]$/u.test(attrs["data-rich-indent"])) invalid("본문 들여쓰기는 0~8이어야 합니다.");
    result.indent = Number(attrs["data-rich-indent"]);
  }
  return result;
}

type Marks = Pick<RichText, "bold" | "italic" | "fontSize" | "fontColor">;

function inlineNodes(nodes: ChildNode[], marks: Marks = {}, insideLink = false): RichInline[] {
  const result: RichInline[] = [];
  for (const node of nodes) {
    if (isComment(node)) continue;
    if (isText(node)) {
      if (node.data !== "") result.push({ type: "text", text: node.data, ...marks });
      continue;
    }
    if (!isTag(node)) invalid("본문의 인라인 구조를 확인해주세요.");
    const name = node.name.toLowerCase();
    if (name === "br") {
      attributes(node, []);
      if (node.children.length) invalid("줄바꿈 태그에는 내용을 넣을 수 없습니다.");
      result.push({ type: "break" });
    } else if (name === "strong" || name === "b") {
      attributes(node, []);
      result.push(...inlineNodes(node.children, { ...marks, bold: true }, insideLink));
    } else if (name === "em" || name === "i") {
      attributes(node, []);
      result.push(...inlineNodes(node.children, { ...marks, italic: true }, insideLink));
    } else if (name === "span") {
      const attrs = attributes(node, ["style"]), style = styleMap(attrs.style, ["font-size", "color"]);
      const next = { ...marks };
      const size = style.get("font-size"), color = style.get("color");
      if (size) {
        const value = /^(12|14|15|16|20|24|32)px$/u.exec(size)?.[1];
        if (!value) invalid("지원하지 않는 글자 크기입니다.");
        next.fontSize = Number(value) as RichText["fontSize"];
      }
      if (color) {
        if (!/^#[0-9a-f]{6}$/u.test(color)) invalid("글자색은 소문자 6자리 hex여야 합니다.");
        next.fontColor = color;
      }
      result.push(...inlineNodes(node.children, next, insideLink));
    } else if (name === "a") {
      if (insideLink) invalid("링크 안에 링크를 넣을 수 없습니다.");
      const href = attributes(node, ["href"]).href;
      if (!href) invalid("링크 주소가 필요합니다.");
      result.push({ type: "link", href, children: inlineNodes(node.children, marks, true) as (RichText | { type: "break" })[] });
    } else invalid(`<${name}> 태그는 인라인 본문에 사용할 수 없습니다.`);
  }
  return result;
}

function isInline(node: ChildNode): boolean {
  return isText(node) || isComment(node) || (isTag(node) && ["br", "strong", "b", "em", "i", "span", "a"].includes(node.name.toLowerCase()));
}

function mixedBlocks(nodes: ChildNode[], nodeId: () => string): RichBlock[] {
  const blocks: RichBlock[] = [];
  let inline: ChildNode[] = [];
  const flush = () => {
    if (!inline.length) return;
    if (!inline.every(onlyWhitespace)) blocks.push({ type: "paragraph", children: inlineNodes(inline) });
    inline = [];
  };
  for (const node of nodes) {
    if (isInline(node)) inline.push(node);
    else {
      flush();
      if (!isTag(node)) invalid("본문 블록 구조를 확인해주세요.");
      blocks.push(blockElement(node, nodeId));
    }
  }
  flush();
  return blocks;
}

function listBlock(element: Element, nodeId: () => string): RichBlock {
  attributes(element, []);
  const items: RichBlock[][] = [];
  for (const child of element.children) {
    if (onlyWhitespace(child) || isComment(child)) continue;
    if (!isTag(child) || child.name.toLowerCase() !== "li") invalid("목록에는 li 항목만 사용할 수 있습니다.");
    attributes(child, []);
    items.push(mixedBlocks(child.children, nodeId));
  }
  return { type: "list", ordered: element.name.toLowerCase() === "ol", items };
}

function tableRows(table: Element): Element[] {
  attributes(table, []);
  const rows: Element[] = [];
  for (const child of table.children) {
    if (onlyWhitespace(child) || isComment(child)) continue;
    if (!isTag(child)) invalid("표 구조를 확인해주세요.");
    const name = child.name.toLowerCase();
    if (name === "tr") rows.push(child);
    else if (["thead", "tbody", "tfoot"].includes(name)) {
      attributes(child, []);
      for (const row of child.children) {
        if (onlyWhitespace(row) || isComment(row)) continue;
        if (!isTag(row) || row.name.toLowerCase() !== "tr") invalid("표 그룹에는 tr 행만 사용할 수 있습니다.");
        rows.push(row);
      }
    } else invalid(`<${name}> 태그는 표에 사용할 수 없습니다.`);
  }
  return rows;
}

function tableBlock(figure: Element, nodeId: () => string): RichBlock {
  const table = figure.children.find((node): node is Element => isTag(node) && node.name.toLowerCase() === "table");
  if (!table || figure.children.some(node => !onlyWhitespace(node) && !isComment(node) && node !== table))
    invalid("표 figure에는 하나의 table만 있어야 합니다.");
  const rows = tableRows(table).map(row => {
    attributes(row, []);
    const cells: RichCell[] = [];
    for (const child of row.children) {
      if (onlyWhitespace(child) || isComment(child)) continue;
      if (!isTag(child) || !["td", "th"].includes(child.name.toLowerCase())) invalid("표 행에는 td/th 셀만 사용할 수 있습니다.");
      const attrs = attributes(child, ["colspan", "rowspan"]);
      const span = (name: "colspan" | "rowspan", max: number) => {
        if (attrs[name] === undefined) return undefined;
        if (!/^\d+$/u.test(attrs[name])) invalid("표 병합 값은 양의 정수여야 합니다.");
        const value = Number(attrs[name]);
        if (value < 1 || value > max) invalid("표 병합 값이 허용 범위를 벗어났습니다.");
        return value;
      };
      const colSpan = span("colspan", 20), rowSpan = span("rowspan", 100);
      cells.push({
        ...(child.name.toLowerCase() === "th" ? { header: true as const } : {}),
        ...(colSpan ? { colSpan } : {}),
        ...(rowSpan ? { rowSpan } : {}),
        children: mixedBlocks(child.children, nodeId),
      });
    }
    return cells;
  });
  return { type: "table", rows };
}

function figureLayout(element: Element, kind: "image" | "media") {
  const attrs = attributes(element, ["class", "style"]);
  const allowed = [kind, `${kind}-style-align-left`, `${kind}-style-align-right`, `${kind}-style-align-center`, `${kind}-align-left`, `${kind}-align-right`, `${kind}-align-center`];
  const names = classes(element, allowed);
  if (!names.has(kind)) invalid(`figure에는 ${kind} 클래스가 필요합니다.`);
  const alignments = (["left", "center", "right"] as const).filter(value => names.has(`${kind}-style-align-${value}`) || names.has(`${kind}-align-${value}`));
  if (alignments.length > 1) invalid("이미지 또는 미디어 정렬 클래스가 중복되었습니다.");
  return { alignment: alignments[0], width: widthFromStyle(styleMap(attrs.style, ["width"])) };
}

function imageBlock(figure: Element, nodeId: () => string): RichBlock {
  const layout = figureLayout(figure, "image");
  const meaningful = figure.children.filter(child => !onlyWhitespace(child) && !isComment(child));
  const image = meaningful.find((child): child is Element => isTag(child) && child.name.toLowerCase() === "img");
  const caption = meaningful.find((child): child is Element => isTag(child) && child.name.toLowerCase() === "figcaption");
  if (!image || meaningful.some(child => child !== image && child !== caption))
    invalid("이미지 figure에는 img와 선택적인 figcaption만 사용할 수 있습니다.");
  const attrs = attributes(image, ["data-rich-asset-id", "data-rich-node-id", "alt"]);
  if (image.children.length) invalid("img 태그에는 내용을 넣을 수 없습니다.");
  if (!attrs["data-rich-asset-id"]) invalid("이미지는 소유 자산 ID가 필요합니다.");
  if (caption) attributes(caption, []);
  return {
    type: "image",
    nodeId: attrs["data-rich-node-id"] || nodeId(),
    assetId: attrs["data-rich-asset-id"],
    alt: attrs.alt ?? "",
    ...(layout.alignment ? { alignment: layout.alignment } : {}),
    ...(layout.width ? { width: layout.width } : {}),
    ...(caption ? { caption: inlineNodes(caption.children) } : {}),
  };
}

function mediaFromUrl(value: string): Pick<RichMedia, "provider" | "mediaId"> {
  let url: URL;
  try { url = new URL(value); } catch { return invalid("미디어 주소를 확인해주세요."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || /[\s\\]/u.test(value))
    invalid("미디어는 사용자 정보 없는 절대 HTTPS 주소여야 합니다.");
  if (url.hostname === "www.youtube.com" && url.pathname === "/watch" && [...url.searchParams.keys()].every(key => key === "v"))
    return { provider: "youtube", mediaId: url.searchParams.get("v") ?? "" };
  if (["www.youtube.com", "youtube.com"].includes(url.hostname) && /^\/(?:shorts|embed)\/[^/]+$/u.test(url.pathname) && !url.search)
    return { provider: "youtube", mediaId: url.pathname.split("/").at(-1)! };
  if (url.hostname === "youtu.be" && /^\/[^/]+$/u.test(url.pathname) && !url.search)
    return { provider: "youtube", mediaId: url.pathname.slice(1) };
  if (["vimeo.com", "www.vimeo.com"].includes(url.hostname) && /^\/\d{1,15}$/u.test(url.pathname) && !url.search)
    return { provider: "vimeo", mediaId: url.pathname.slice(1) };
  return invalid("지원되는 YouTube 또는 Vimeo 주소를 입력해주세요.");
}

function mediaBlock(figure: Element): RichBlock {
  const layout = figureLayout(figure, "media");
  const meaningful = figure.children.filter(child => !onlyWhitespace(child) && !isComment(child));
  if (meaningful.length !== 1 || !isTag(meaningful[0]) || meaningful[0].name.toLowerCase() !== "div")
    invalid("미디어 figure에는 하나의 oEmbed div만 사용할 수 있습니다.");
  const container = meaningful[0], attrs = attributes(container, ["data-oembed-url"]);
  if (!attrs["data-oembed-url"]) invalid("미디어 주소가 필요합니다.");
  // CKEditor may include an iframe preview. It is parsed as inert data here and
  // deliberately discarded; no iframe attribute or child reaches storage.
  for (const child of container.children) {
    if (onlyWhitespace(child) || isComment(child)) continue;
    if (!isTag(child) || child.name.toLowerCase() !== "iframe") invalid("oEmbed 미리보기에는 iframe 외의 내용을 넣을 수 없습니다.");
  }
  return { type: "media", ...mediaFromUrl(attrs["data-oembed-url"]),
    ...(layout.alignment ? { alignment: layout.alignment } : {}),
    ...(layout.width ? { width: layout.width } : {}) };
}

function blockElement(element: Element, nodeId: () => string): RichBlock {
  const name = element.name.toLowerCase();
  if (name === "p") return { type: "paragraph", ...layoutFrom(element), children: inlineNodes(element.children) };
  if (["h2", "h3", "h4"].includes(name)) return { type: "heading", ...layoutFrom(element), level: Number(name.slice(1)) as 2 | 3 | 4, children: inlineNodes(element.children) };
  if (name === "blockquote") {
    attributes(element, []);
    return { type: "quote", children: mixedBlocks(element.children, nodeId) };
  }
  if (name === "ul" || name === "ol") return listBlock(element, nodeId);
  if (name === "figure") {
    const names = new Set((element.attribs.class ?? "").split(/\s+/u));
    if (names.has("image")) return imageBlock(element, nodeId);
    if (names.has("table")) {
      attributes(element, ["class"]);
      classes(element, ["table"]);
      return tableBlock(element, nodeId);
    }
    if (names.has("media")) return mediaBlock(element);
    invalid("지원하지 않는 figure입니다.");
  }
  if (name === "oembed") {
    const url = attributes(element, ["url"]).url;
    if (!url || element.children.some(child => !onlyWhitespace(child) && !isComment(child))) invalid("oembed 형식을 확인해주세요.");
    return { type: "media", ...mediaFromUrl(url) };
  }
  return invalid(`<${name}> 태그는 본문 블록에 사용할 수 없습니다.`);
}

export function parseRichDocumentHtml(html: string, options: { nodeId?: () => string } = {}): RichDocumentV1 {
  if (typeof html !== "string") invalid("편집기 HTML은 문자열이어야 합니다.");
  if (new TextEncoder().encode(html).byteLength > MAX_RICH_HTML_BYTES)
    invalid("편집기 HTML은 512KiB 이하여야 합니다.");
  const root = parseDocument(html, { decodeEntities: true, lowerCaseAttributeNames: true, lowerCaseTags: true });
  preflightHtml(html, root.children);
  const nodeId = options.nodeId ?? (() => globalThis.crypto.randomUUID());
  const blocks: RichBlock[] = [];
  for (const child of root.children) {
    if (onlyWhitespace(child) || isComment(child)) continue;
    if (!isTag(child)) invalid("최상위 본문은 블록 태그로 구성해야 합니다.");
    blocks.push(blockElement(child, nodeId));
  }
  const parsed = richDocumentSchema.safeParse({ schemaVersion: 1, blocks });
  if (!parsed.success) throw new RichHtmlError(parsed.error.issues[0]?.message ?? "편집기 HTML을 본문 문서로 변환할 수 없습니다.");
  return parsed.data;
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}

function serializeInline(nodes: RichInline[]): string {
  return nodes.map(node => {
    if (node.type === "break") return "<br>";
    if (node.type === "link") return `<a href="${escapeAttribute(node.href)}">${serializeInline(node.children)}</a>`;
    let value = escapeText(node.text);
    if (node.bold) value = `<strong>${value}</strong>`;
    if (node.italic) value = `<em>${value}</em>`;
    const styles = [node.fontSize ? `font-size:${node.fontSize}px` : "", node.fontColor ? `color:${node.fontColor}` : ""].filter(Boolean);
    return styles.length ? `<span style="${styles.join(";")}">${value}</span>` : value;
  }).join("");
}

function serializeLayout(layout: RichLayout): string {
  const attributes: string[] = [];
  if (layout.alignment) attributes.push(`style="text-align:${layout.alignment}"`);
  if (layout.direction) attributes.push(`dir="${layout.direction}"`);
  if (layout.indent !== undefined) attributes.push(`data-rich-indent="${layout.indent}"`);
  return attributes.length ? ` ${attributes.join(" ")}` : "";
}

function serializeWidth(width: RichWidth | undefined): string {
  return width ? ` style="width:${width.value}${width.unit === "percent" ? "%" : "px"}"` : "";
}

function serializeFigureClass(kind: "image" | "media", alignment: "left" | "center" | "right" | undefined): string {
  return `${kind}${alignment ? ` ${kind}-style-align-${alignment}` : ""}`;
}

function serializeBlocks(blocks: RichBlock[]): string {
  return blocks.map(block => {
    if (block.type === "paragraph") return `<p${serializeLayout(block)}>${serializeInline(block.children)}</p>`;
    if (block.type === "heading") return `<h${block.level}${serializeLayout(block)}>${serializeInline(block.children)}</h${block.level}>`;
    if (block.type === "quote") return `<blockquote>${serializeBlocks(block.children)}</blockquote>`;
    if (block.type === "list") {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag}>${block.items.map(item => `<li>${serializeBlocks(item)}</li>`).join("")}</${tag}>`;
    }
    if (block.type === "table") return `<figure class="table"><table><tbody>${block.rows.map(row => `<tr>${row.map(cell => {
      const tag = cell.header ? "th" : "td";
      const spans = `${cell.colSpan ? ` colspan="${cell.colSpan}"` : ""}${cell.rowSpan ? ` rowspan="${cell.rowSpan}"` : ""}`;
      return `<${tag}${spans}>${serializeBlocks(cell.children)}</${tag}>`;
    }).join("")}</tr>`).join("")}</tbody></table></figure>`;
    if (block.type === "image") return `<figure class="${serializeFigureClass("image", block.alignment)}"${serializeWidth(block.width)}><img data-rich-asset-id="${escapeAttribute(block.assetId)}" data-rich-node-id="${escapeAttribute(block.nodeId)}" alt="${escapeAttribute(block.alt)}">${block.caption ? `<figcaption>${serializeInline(block.caption)}</figcaption>` : ""}</figure>`;
    return `<figure class="${serializeFigureClass("media", block.alignment)}"${serializeWidth(block.width)}><div data-oembed-url="${escapeAttribute(richMediaUrl(block))}"></div></figure>`;
  }).join("");
}

/** Canonical editor HTML is generated only from a validated typed document.
 * Owned image URLs remain outside the HTML and are attached by the editor UI. */
export function serializeRichDocumentHtml(document: RichDocumentV1): string {
  return serializeBlocks(richDocumentSchema.parse(document).blocks);
}
