import { createHash } from "node:crypto";
import { crc32, inflateRawSync, inflateSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import sharp, { type Sharp } from "sharp";
import {
  authorAssetByteLimit, authorAssetMimeForName, authorAssetNameSchema, authorAssetPurposes, bodyImagePurposes, isAuthorImagePurpose,
  type AuthorAssetMime, type AuthorAssetPurpose,
} from "@/contracts/author-assets";
import { fail } from "./http";

/** Independent processing bounds, not limits observed in the original service. */
export const AUTHOR_ASSET_VALIDATION_LIMITS = {
  zipEntries: 512, zipEntryBytes: 16 * 1024 * 1024, zipTotalBytes: 32 * 1024 * 1024,
  zipRatio: 200, zipRatioGraceBytes: 1024 * 1024,
  xmlEntryBytes: 4 * 1024 * 1024, xmlTotalBytes: 8 * 1024 * 1024,
  xmlMarkup: 50_000, xmlDepth: 128,
  imageDimension: 8192, imagePixels: 8 * 1024 * 1024, imageChannels: 4,
  bodyImageDimension: 16_384, bodyImagePixels: 24 * 1024 * 1024, imageFrames: 1,
  pngChunks: 2048, pngMetadataEntryBytes: 1024 * 1024, pngMetadataTotalBytes: 2 * 1024 * 1024,
  imageDecodeSeconds: 3, concurrentImageDecodes: 2,
} as const;

export type AuthorAssetValidationMeta = {
  name: string; purpose: AuthorAssetPurpose; size: number; sha256: string; mime: string;
};
function invalid(): never { return fail(422, "AUTHOR_ASSET_CONTENT", "파일 내용이나 문서 구조를 확인해주세요."); }
function complex(): never { return fail(413, "AUTHOR_ASSET_COMPLEXITY", "파일의 압축·문서·이미지 복잡도 제한을 초과했습니다."); }
const limits = AUTHOR_ASSET_VALIDATION_LIMITS;

export function validateAuthorAssetName(name: string, purpose: AuthorAssetPurpose): AuthorAssetMime {
  if (!authorAssetNameSchema.safeParse(name).success)
    fail(422, "AUTHOR_ASSET_NAME", "파일 이름은 경로·제어문자 없이 255자 이내로 입력해주세요.");
  const mime = authorAssetPurposes.includes(purpose) ? authorAssetMimeForName(name, purpose) : undefined;
  if (!mime) fail(415, "AUTHOR_ASSET_TYPE", "파일의 용도와 확장자를 확인해주세요.");
  return mime;
}

function pdf(bytes: Buffer): boolean {
  return /^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/.test(bytes.subarray(0, 16).toString("ascii"))
    && /%%EOF[\u0000\t\n\f\r ]*$/.test(bytes.subarray(-1024).toString("latin1"));
}
function postscript(bytes: Buffer): boolean {
  return /^%!PS-Adobe-\d\.\d(?:\s|$)/.test(bytes.subarray(0, 40).toString("ascii"))
    && /%%EOF[\t\n\f\r ]*$/.test(bytes.subarray(-1024).toString("latin1"));
}

type ZipEntry = { name: string; nameBytes: Buffer; flags: number; method: number; crc: number; compressed: number; size: number; offset: number };
function inBounds(bytes: Buffer, offset: number, length: number, end = bytes.length) {
  if (offset < 0 || length < 0 || offset + length > end) invalid();
}
function zipExtra(bytes: Buffer) {
  for (let p = 0; p < bytes.length;) {
    inBounds(bytes, p, 4);
    const id = bytes.readUInt16LE(p), size = bytes.readUInt16LE(p + 2);
    if (id === 1 || id === 0x9901) complex(); // ZIP64/AES are outside this bounded ZIP32 reader.
    inBounds(bytes, p + 4, size); p += 4 + size;
  }
}
function zipName(bytes: Buffer, utf8: boolean): string {
  if (!bytes.length || bytes.length > 1024) complex();
  if (!utf8 && bytes.some(value => value > 127)) invalid();
  let name: string;
  try { name = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return invalid(); }
  const segments = name.replace(/\/$/, "").split("/");
  if (name.length > 512 || /[\u0000-\u001f\u007f-\u009f\\:]/.test(name) || name.startsWith("/")
    || /%(?:2e|2f|5c|00)/i.test(name) || segments.some(segment => !segment || segment === "." || segment === "..")) invalid();
  return name;
}

/** Reads archive records into memory only; never extracts a path to the filesystem. */
function unzipDocx(bytes: Buffer): Map<string, Buffer> {
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 22 - 65535); p--) {
    if (bytes.readUInt32LE(p) === 0x06054b50 && p + 22 + bytes.readUInt16LE(p + 20) === bytes.length) { end = p; break; }
  }
  if (end < 0) invalid();
  const count = bytes.readUInt16LE(end + 10), directorySize = bytes.readUInt32LE(end + 12), directory = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)
    || bytes.readUInt16LE(end + 8) !== count || directory + directorySize !== end) invalid();
  if (!count || count > limits.zipEntries || count === 0xffff || directory === 0xffffffff || directorySize === 0xffffffff) complex();
  const entries: ZipEntry[] = [], names = new Set<string>();
  let p = directory, total = 0;
  for (let index = 0; index < count; index++) {
    inBounds(bytes, p, 46, end);
    if (bytes.readUInt32LE(p) !== 0x02014b50) invalid();
    const flags = bytes.readUInt16LE(p + 8), method = bytes.readUInt16LE(p + 10), crc = bytes.readUInt32LE(p + 16);
    const compressed = bytes.readUInt32LE(p + 20), size = bytes.readUInt32LE(p + 24);
    const nameSize = bytes.readUInt16LE(p + 28), extraSize = bytes.readUInt16LE(p + 30), commentSize = bytes.readUInt16LE(p + 32);
    const offset = bytes.readUInt32LE(p + 42), mode = (bytes.readUInt32LE(p + 38) >>> 16) & 0xf000;
    if ((flags & ~0x080e) || ![0, 8].includes(method) || (method === 0 && (flags & 6)) || bytes.readUInt16LE(p + 34)) invalid();
    if (mode && mode !== 0x8000 && mode !== 0x4000) invalid();
    inBounds(bytes, p + 46, nameSize + extraSize + commentSize, end);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameSize), name = zipName(nameBytes, !!(flags & 0x800));
    if (names.has(name) || (name.endsWith("/") && size)) invalid();
    names.add(name);
    zipExtra(bytes.subarray(p + 46 + nameSize, p + 46 + nameSize + extraSize));
    total += size;
    if (size > limits.zipEntryBytes || total > limits.zipTotalBytes
      || size > Math.max(limits.zipRatioGraceBytes, compressed * limits.zipRatio)) complex();
    if (method === 0 && compressed !== size) invalid();
    entries.push({ name, nameBytes, flags, method, crc, compressed, size, offset });
    p += 46 + nameSize + extraSize + commentSize;
  }
  if (p !== end) invalid();
  // Physical records may have a different order than the central directory.
  entries.sort((a, b) => a.offset - b.offset);
  const files = new Map<string, Buffer>(); let next = 0;
  for (const entry of entries) {
    const { offset, flags, method, size, compressed } = entry;
    if (offset !== next) invalid(); // no prefix, unindexed entry, overlap or unexplained padding
    inBounds(bytes, offset, 30, directory);
    if (bytes.readUInt32LE(offset) !== 0x04034b50 || bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method) invalid();
    const nameSize = bytes.readUInt16LE(offset + 26), extraSize = bytes.readUInt16LE(offset + 28);
    inBounds(bytes, offset + 30, nameSize + extraSize, directory);
    if (!bytes.subarray(offset + 30, offset + 30 + nameSize).equals(entry.nameBytes)) invalid();
    zipExtra(bytes.subarray(offset + 30 + nameSize, offset + 30 + nameSize + extraSize));
    const localFields = [bytes.readUInt32LE(offset + 14), bytes.readUInt32LE(offset + 18), bytes.readUInt32LE(offset + 22)];
    const centralFields = [entry.crc, compressed, size];
    if (localFields.some((value, i) => value !== centralFields[i] && (!(flags & 8) || value !== 0))) invalid();
    const start = offset + 30 + nameSize + extraSize;
    inBounds(bytes, start, compressed, directory); next = start + compressed;
    if (flags & 8) {
      const descriptorMatches = (position: number) => position + 12 <= directory
        && bytes.readUInt32LE(position) === entry.crc && bytes.readUInt32LE(position + 4) === compressed && bytes.readUInt32LE(position + 8) === size;
      if (next + 4 <= directory && bytes.readUInt32LE(next) === 0x08074b50 && descriptorMatches(next + 4)) next += 16;
      else if (descriptorMatches(next)) next += 12;
      else invalid();
    }
    let data: Buffer;
    try {
      if (method === 0) data = bytes.subarray(start, start + compressed);
      else {
        // Limit actual output even when a hostile central directory understates it.
        const inflated = inflateRawSync(bytes.subarray(start, start + compressed), { maxOutputLength: size + 1, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
        if (inflated.engine.bytesWritten !== compressed) invalid();
        data = inflated.buffer;
      }
    } catch { return invalid(); }
    if (data.length !== size || crc32(data) !== entry.crc) invalid();
    files.set(entry.name, data);
  }
  if (next !== directory) invalid();
  return files;
}

/** Bound depth before building a DOM. Quoted '>' and CDATA/comments are not tags. */
function boundXml(text: string) {
  let position = 0, depth = 0, markup = 0;
  while ((position = text.indexOf("<", position)) >= 0) {
    if (++markup > limits.xmlMarkup) complex();
    const closing = text.startsWith("<!--", position) ? "-->" : text.startsWith("<![CDATA[", position) ? "]]>" : text.startsWith("<?", position) ? "?>" : null;
    if (closing) {
      const end = text.indexOf(closing, position + (closing === "-->" ? 4 : closing === "]]>" ? 9 : 2));
      if (end < 0 || (closing === "-->" && text.slice(position + 4, end).includes("--"))) invalid();
      position = end + closing.length; continue;
    }
    if (text.startsWith("<!", position)) invalid(); // DTD/ENTITY and unsupported declarations
    let end = position + 1, quote = "";
    for (; end < text.length; end++) {
      const char = text[end];
      if (quote) { if (char === quote) quote = ""; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    if (end === text.length) invalid();
    if (text[position + 1] === "/") depth--;
    else if (!/\/\s*$/.test(text.slice(position + 1, end))) depth++;
    if (depth < 0) invalid();
    if (depth > limits.xmlDepth) complex();
    position = end + 1;
  }
  if (depth) invalid();
}
function parseXml(bytes: Buffer): Document {
  if (bytes.length > limits.xmlEntryBytes) complex();
  let text: string;
  const encoding = bytes[0] === 0xfe && bytes[1] === 0xff || bytes[0] === 0 && bytes[1] === 0x3c ? "utf-16be"
    : bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0x3c && bytes[1] === 0 ? "utf-16le" : "utf-8";
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); } catch { return invalid(); }
  const declaration = /^\s*<\?xml\s[^?]*encoding\s*=\s*["']([^"']+)["']/i.exec(text)?.[1].toLowerCase();
  if (declaration && declaration !== encoding && !(declaration === "utf-16" && encoding.startsWith("utf-16"))) invalid();
  if (!text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) invalid();
  boundXml(text);
  let failed = false;
  const recordError = () => { failed = true; };
  const doc = new DOMParser({ errorHandler: { warning: recordError, error: recordError, fatalError: recordError } }).parseFromString(text, "application/xml");
  if (failed || !doc.documentElement || doc.doctype || doc.getElementsByTagName("parsererror").length) invalid();
  if (Array.from(doc.childNodes).filter(node => node.nodeType === 1).length !== 1
    || Array.from(doc.childNodes).some(node => node.nodeType === 3 && !!node.nodeValue?.trim())) invalid();
  return doc;
}
const CONTENT_TYPES = "http://schemas.openxmlformats.org/package/2006/content-types";
const RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships";
const WORD_NAMESPACES = ["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"];
const OFFICE_RELATIONSHIPS = ["http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument"];
const DOCX_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
function validateDocx(bytes: Buffer) {
  const files = unzipDocx(bytes), core = new Map<string, Document>();
  const typeBytes = files.get("[Content_Types].xml"); if (!typeBytes) invalid();
  const types = parseXml(typeBytes).documentElement;
  if (types.localName !== "Types" || types.namespaceURI !== CONTENT_TYPES) invalid();
  const overrides = new Map<string, string>(), defaults = new Map<string, string>();
  for (const node of Array.from(types.childNodes)) {
    if (node.nodeType !== 1) continue;
    const element = node as Element, mime = element.getAttribute("ContentType") ?? "";
    if (element.namespaceURI !== CONTENT_TYPES || !["Override", "Default"].includes(element.localName)
      || !mime.includes("/") || /macroEnabled|vbaProject|activeX/i.test(mime)) invalid();
    if (element.localName === "Override") {
      const part = element.getAttribute("PartName") ?? "";
      if (!part.startsWith("/") || overrides.has(part)) invalid();
      overrides.set(part, mime);
    } else {
      const extension = (element.getAttribute("Extension") ?? "").toLowerCase();
      if (!extension || /[./\\]/.test(extension) || defaults.has(extension)) invalid();
      defaults.set(extension, mime);
    }
  }
  if (overrides.get("/word/document.xml") !== DOCX_MAIN) invalid();
  let xmlBytes = typeBytes.length;
  for (const [name, data] of files) {
    if (/(?:^|\/)(?:vbaProject\.bin|activeX)(?:\/|$)/i.test(name)) invalid();
    if (name.endsWith("/") || name === "[Content_Types].xml") continue;
    const mime = overrides.get("/" + name) ?? defaults.get(name.slice(name.lastIndexOf(".") + 1).toLowerCase());
    if (!mime) invalid();
    if (name.endsWith(".rels") && mime !== "application/vnd.openxmlformats-package.relationships+xml") invalid();
    if (!/\.(?:xml|rels)$/i.test(name) && !/(?:\+xml|\/xml)$/i.test(mime)) continue;
    xmlBytes += data.length; if (xmlBytes > limits.xmlTotalBytes) complex();
    const doc = parseXml(data);
    if (["_rels/.rels", "word/document.xml"].includes(name)) core.set(name, doc);
  }
  const relationships = core.get("_rels/.rels")?.documentElement, document = core.get("word/document.xml")?.documentElement;
  if (!relationships || relationships.localName !== "Relationships" || relationships.namespaceURI !== RELATIONSHIPS
    || !document || document.localName !== "document" || !WORD_NAMESPACES.includes(document.namespaceURI ?? "")) invalid();
  const rootRelations = Array.from(relationships.childNodes).filter(node => node.nodeType === 1) as Element[];
  const mainRelations = rootRelations.filter(node => OFFICE_RELATIONSHIPS.includes(node.getAttribute("Type") ?? ""));
  if (mainRelations.length !== 1) invalid();
  const relation = mainRelations[0];
  if (relation.localName !== "Relationship" || relation.namespaceURI !== RELATIONSHIPS
    || !["word/document.xml", "/word/document.xml"].includes(relation.getAttribute("Target") ?? "")
    || (relation.hasAttribute("TargetMode") && relation.getAttribute("TargetMode") !== "Internal")) invalid();
  if (!Array.from(document.childNodes).some(node => node.nodeType === 1 && (node as Element).localName === "body"
    && (node as Element).namespaceURI === document.namespaceURI)) invalid();
}

type ImageLimits = { dimension: number; pixels: number };
function imageLimits(purpose: AuthorAssetPurpose): ImageLimits {
  return (bodyImagePurposes as readonly string[]).includes(purpose)
    ? { dimension: limits.bodyImageDimension, pixels: limits.bodyImagePixels }
    : { dimension: limits.imageDimension, pixels: limits.imagePixels };
}
function checkImageDimensions(width: number, height: number, selected: ImageLimits, channels = 4) {
  if (!width || !height || !channels) invalid();
  if (width > selected.dimension || height > selected.dimension || width * height > selected.pixels || channels > limits.imageChannels) complex();
}
function validatePngStructure(bytes: Buffer, selected: ImageLimits) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) invalid();
  let p = 8, chunks = 0, data = false, ended = false, metadataBytes = 0;
  while (p < bytes.length) {
    inBounds(bytes, p, 12); const length = bytes.readUInt32BE(p), type = bytes.subarray(p + 4, p + 8).toString("ascii");
    inBounds(bytes, p + 8, length + 4);
    if (crc32(bytes.subarray(p + 4, p + 8 + length)) !== bytes.readUInt32BE(p + 8 + length)) invalid();
    if ((!chunks && (type !== "IHDR" || length !== 13)) || (chunks > 0 && type === "IHDR")) invalid();
    if (!chunks) checkImageDimensions(bytes.readUInt32BE(p + 8), bytes.readUInt32BE(p + 12), selected);
    if (type === "acTL" || type === "fcTL" || type === "fdAT") complex();
    // libvips reads text/ICC during metadata(), before its processing timeout.
    // Bound compressed ancillary output separately from image pixels.
    if (["zTXt", "iCCP", "iTXt"].includes(type)) {
      const payload = bytes.subarray(p + 8, p + 8 + length), keywordEnd = payload.indexOf(0);
      if (keywordEnd < 1 || keywordEnd > 79) invalid();
      let start = keywordEnd + 2, compressed = true;
      if (type === "iTXt") {
        if (![0, 1].includes(payload[keywordEnd + 1]) || payload[keywordEnd + 2] !== 0) invalid();
        compressed = payload[keywordEnd + 1] === 1;
        const languageEnd = payload.indexOf(0, keywordEnd + 3), translationEnd = languageEnd < 0 ? -1 : payload.indexOf(0, languageEnd + 1);
        if (translationEnd < 0) invalid(); start = translationEnd + 1;
      } else if (payload[keywordEnd + 1] !== 0) invalid();
      if (start > payload.length || (compressed && start === payload.length)) invalid();
      let expanded: number;
      try { expanded = compressed ? inflateSync(payload.subarray(start), { maxOutputLength: limits.pngMetadataEntryBytes }).length : payload.length - start; }
      catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE") complex();
        invalid();
      }
      metadataBytes += expanded;
      if (expanded > limits.pngMetadataEntryBytes || metadataBytes > limits.pngMetadataTotalBytes) complex();
    }
    if (type === "IDAT") data = true;
    p += length + 12; chunks++;
    if (chunks > limits.pngChunks) complex();
    if (type === "IEND") { if (length || p !== bytes.length) invalid(); ended = true; break; }
  }
  if (!data || !ended) invalid();
}
function validateJpegHeader(bytes: Buffer, selected: ImageLimits) {
  if (bytes.length < 4 || !bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) invalid();
  let p = 2;
  while (p < bytes.length - 2) {
    if (bytes[p++] !== 255) invalid();
    while (bytes[p] === 255) p++;
    inBounds(bytes, p, 1); const marker = bytes[p++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    inBounds(bytes, p, 2); const size = bytes.readUInt16BE(p);
    if (size < 2) invalid(); inBounds(bytes, p, size);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (size < 8) invalid();
      checkImageDimensions(bytes.readUInt16BE(p + 5), bytes.readUInt16BE(p + 3), selected, bytes[p + 7]);
      return;
    }
    p += size;
  }
  invalid();
}
let activeImageDecodes = 0;
async function validateImage(bytes: Buffer, mime: string, purpose: AuthorAssetPurpose) {
  const selected = imageLimits(purpose);
  if (mime === "image/png") validatePngStructure(bytes, selected);
  else validateJpegHeader(bytes, selected);
  if (activeImageDecodes >= limits.concurrentImageDecodes)
    fail(503, "AUTHOR_ASSET_VALIDATION_BUSY", "이미지 검사 중입니다. 잠시 후 다시 시도해주세요.");
  activeImageDecodes++;
  let decoder: Sharp | undefined;
  try {
    decoder = sharp(bytes, { failOn: "warning", limitInputPixels: selected.pixels, limitInputChannels: limits.imageChannels, unlimited: false, sequentialRead: true });
    const meta = await decoder.metadata();
    if (meta.format !== (mime === "image/png" ? "png" : "jpeg")) invalid();
    if (!meta.width || !meta.height || meta.width > selected.dimension || meta.height > selected.dimension
      || meta.width * meta.height > selected.pixels || (meta.channels ?? 0) > limits.imageChannels || (meta.pages ?? 1) > limits.imageFrames) complex();
    const result = await decoder.timeout({ seconds: limits.imageDecodeSeconds }).raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
    if (result.info.width !== meta.width || result.info.height !== meta.height || result.info.channels > limits.imageChannels
      || result.data.length > selected.pixels * limits.imageChannels) invalid();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && String(error.code).startsWith("AUTHOR_ASSET_")) throw error;
    invalid();
  } finally { decoder?.destroy(); activeImageDecodes--; }
}

export async function validateAuthorAssetBytes(bytes: Buffer, meta: AuthorAssetValidationMeta): Promise<void> {
  const mime = validateAuthorAssetName(meta.name, meta.purpose);
  if (mime !== meta.mime) fail(415, "AUTHOR_ASSET_TYPE", "파일의 용도·확장자·형식을 확인해주세요.");
  if (!bytes.length || bytes.length > authorAssetByteLimit(meta.purpose))
    fail(413, "AUTHOR_ASSET_SIZE", "자료는 5MiB, 문항·보기 이미지는 1MiB, 본문 이미지는 14MiB 이하의 비어 있지 않은 파일을 선택해주세요.");
  if (!Number.isSafeInteger(meta.size) || bytes.length !== meta.size || createHash("sha256").update(bytes).digest("hex") !== meta.sha256)
    fail(422, "AUTHOR_ASSET_INTEGRITY", "업로드한 파일의 크기나 내용이 일치하지 않습니다.");
  if (isAuthorImagePurpose(meta.purpose)) return validateImage(bytes, mime, meta.purpose);
  if (mime === "application/pdf") { if (!pdf(bytes)) invalid(); }
  else if (mime === "application/postscript") { if (!pdf(bytes) && !postscript(bytes)) invalid(); }
  else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    try { validateDocx(bytes); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && String(error.code).startsWith("AUTHOR_ASSET_")) throw error;
      invalid();
    }
  } else invalid();
}
