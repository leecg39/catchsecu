import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { crc32, deflateRawSync, deflateSync } from "node:zlib";
import sharp from "sharp";
import { beforeAll, expect, test, vi } from "vitest";
import { MAX_BODY_IMAGE_BYTES, authorAssetByteLimit, authorAssetUploadInput, bodyImagePurposes, type AuthorAssetPurpose } from "@/contracts/author-assets";

// Pure validation suite: importing the HTTP error shape must not initialize DB/auth.
vi.mock("@/server/http", () => ({ fail: (status: number, code: string, message: string): never => { throw Object.assign(new Error(message), { status, code }); } }));
import { AUTHOR_ASSET_VALIDATION_LIMITS as limits, validateAuthorAssetBytes, validateAuthorAssetName } from "@/server/author-asset-validation";

const fixture = (name: string) => readFileSync(new URL("../fixtures/author-assets/" + name, import.meta.url));
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function validate(bytes: Buffer, name = "자료.docx", purpose: AuthorAssetPurpose = "QUESTION_MATERIAL", override: Record<string, unknown> = {}) {
  return validateAuthorAssetBytes(bytes, { name, purpose, size: bytes.length, sha256: hash(bytes), mime: validateAuthorAssetName(name, purpose), ...override });
}
const rejected = (promise: Promise<void>, code = "AUTHOR_ASSET_CONTENT", status = 422) => expect(promise).rejects.toMatchObject({ code, status });

type Part = { name: string; data: Buffer; method?: 0 | 8; descriptor?: "signed" | "unsigned"; flags?: number; extra?: Buffer };
const parts = (): Part[] => [
  { name: "[Content_Types].xml", data: fixture("content-types.xml") },
  { name: "_rels/.rels", data: fixture("relationships.xml") },
  { name: "word/document.xml", data: fixture("document.xml") },
];
/** Small independent ZIP fixture writer; the production parser is never used to build expectations. */
function zip(entries = parts(), reverseDirectory = false) {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const part of entries) {
    const name = Buffer.from(part.name), extra = part.extra ?? Buffer.alloc(0), method = part.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(part.data) : part.data, crc = crc32(part.data), flags = part.flags ?? (0x800 | (part.descriptor ? 8 : 0));
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6); header.writeUInt16LE(method, 8);
    if (!part.descriptor) { header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(part.data.length, 22); }
    header.writeUInt16LE(name.length, 26); header.writeUInt16LE(extra.length, 28);
    const descriptor = part.descriptor ? Buffer.alloc(part.descriptor === "signed" ? 16 : 12) : Buffer.alloc(0);
    if (part.descriptor) {
      const at = part.descriptor === "signed" ? 4 : 0;
      if (at) descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(crc, at); descriptor.writeUInt32LE(compressed.length, at + 4); descriptor.writeUInt32LE(part.data.length, at + 8);
    }
    const local = Buffer.concat([header, name, extra, compressed, descriptor]); locals.push(local);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8); directory.writeUInt16LE(method, 10); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(part.data.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt16LE(extra.length, 30); directory.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([directory, name, extra])); offset += local.length;
  }
  if (reverseDirectory) central.reverse();
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function directoryOffsets(bytes: Buffer) {
  const end = bytes.length - 22, offsets: number[] = []; let p = bytes.readUInt32LE(end + 16);
  while (p < end) { offsets.push(p); p += 46 + bytes.readUInt16LE(p + 28) + bytes.readUInt16LE(p + 30) + bytes.readUInt16LE(p + 32); }
  return offsets;
}
function replacedPart(name: string, text: string | Buffer) {
  return parts().map(part => part.name === name ? { ...part, data: typeof text === "string" ? Buffer.from(text) : text } : part);
}
function pdf() {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>"];
  let text = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(text); text += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text);
}

test.each([
  ["자료.PDF", "QUESTION_MATERIAL", "application/pdf"], ["자료.docx", "QUESTION_MATERIAL", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["그림.AI", "QUESTION_MATERIAL", "application/postscript"], ["보기.JPEG", "OPTION_IMAGE", "image/jpeg"], ["보기.jpg", "OPTION_IMAGE", "image/jpeg"], ["보기.png", "OPTION_IMAGE", "image/png"],
  ["폼본문.png", "FORM_CONTENT_IMAGE", "image/png"], ["페이지본문.jpg", "PAGE_CONTENT_IMAGE", "image/jpeg"],
  ["종료본문.jpeg", "END_PAGE_CONTENT_IMAGE", "image/jpeg"], ["비공개본문.png", "PRIVATE_PAGE_CONTENT_IMAGE", "image/png"],
])("canonical name MIME: %s", (name, purpose, mime) => expect(validateAuthorAssetName(name, purpose as AuthorAssetPurpose)).toBe(mime));
test("display names preserve whitespace and count UTF-16 without a 100-character source limit", () => {
  expect(validateAuthorAssetName("  " + "가".repeat(249) + ".pdf", "QUESTION_MATERIAL")).toBe("application/pdf");
  expect(validateAuthorAssetName("😀".repeat(125) + "a.pdf", "QUESTION_MATERIAL")).toBe("application/pdf");
  expect(() => validateAuthorAssetName("😀".repeat(126) + ".pdf", "QUESTION_MATERIAL")).toThrow(expect.objectContaining({ code: "AUTHOR_ASSET_NAME" }));
});
test.each(["", " ", "../a.pdf", "a\\b.pdf", "a\0.pdf", "a\n.pdf", "a\u0085.pdf", "\ud800.pdf", "a".repeat(252) + ".pdf"])("reject invalid filename %j", name => {
  expect(() => validateAuthorAssetName(name, "QUESTION_MATERIAL")).toThrow(expect.objectContaining({ code: "AUTHOR_ASSET_NAME" }));
});
test.each([["x.png", "QUESTION_MATERIAL"], ["x.pdf", "OPTION_IMAGE"], ["x.svg", "OPTION_IMAGE"], ["x.docm", "QUESTION_MATERIAL"], ["x", "QUESTION_MATERIAL"]])("reject purpose/extension %s", (name, purpose) => {
  expect(() => validateAuthorAssetName(name, purpose as AuthorAssetPurpose)).toThrow(expect.objectContaining({ code: "AUTHOR_ASSET_TYPE", status: 415 }));
});
test("PDF and both original AI families preserve exact bytes", async () => {
  for (const [name, bytes] of [["guide.pdf", pdf()], ["pdf-backed.ai", pdf()], ["postscript.ai", fixture("minimal.ps.ai")]] as const) {
    const before = Buffer.from(bytes); await validate(bytes, name); expect(bytes.equals(before)).toBe(true);
  }
});
test("material size accepts exactly 5 MiB and refuses zero/over without widening the legacy limit", async () => {
  const exact = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(5 * 1024 * 1024 - 15, 32), Buffer.from("%%EOF\n")]);
  expect(exact.length).toBe(5 * 1024 * 1024); await validate(exact, "limit.pdf");
  await rejected(validate(Buffer.alloc(0), "empty.pdf"), "AUTHOR_ASSET_SIZE", 413);
  await rejected(validate(Buffer.concat([exact, Buffer.from(" ")]), "large.pdf"), "AUTHOR_ASSET_SIZE", 413);
});
test("declared MIME, hash and size are independently checked", async () => {
  await rejected(validate(pdf(), "a.pdf", "QUESTION_MATERIAL", { mime: "application/postscript" }), "AUTHOR_ASSET_TYPE", 415);
  await rejected(validate(pdf(), "a.pdf", "QUESTION_MATERIAL", { sha256: "0".repeat(64) }), "AUTHOR_ASSET_INTEGRITY");
  await rejected(validate(pdf(), "a.pdf", "QUESTION_MATERIAL", { size: 1 }), "AUTHOR_ASSET_INTEGRITY");
});
test.each(["<html>%%EOF", "%PDF-1.4\nno end", "%PDF-1.4\n%%EOF\n<script>x</script>", "%!PS-Adobe-3.0\nno end"])("reject invalid document framing", async text => {
  await rejected(validate(Buffer.from(text), text.startsWith("%!PS") ? "x.ai" : "x.pdf"));
});
test.each(["store", "deflate", "signed", "unsigned", "reverse-directory"])("valid DOCX archive: %s", async variant => {
  const bytes = zip(parts().map((part): Part => ({ ...part, method: variant === "store" ? 0 : 8, descriptor: variant === "signed" || variant === "unsigned" ? variant : undefined })), variant === "reverse-directory");
  const before = hash(bytes); await validate(bytes); expect(hash(bytes)).toBe(before);
});
test("DOCX external hyperlinks remain inert and UTF-16 core XML is supported", async () => {
  const document = fixture("document.xml").toString().replace("UTF-8", "UTF-16");
  const entries = replacedPart("word/document.xml", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(document, "utf16le")]));
  entries.push({ name: "word/_rels/document.xml.rels", data: Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/never-fetch" TargetMode="External"/></Relationships>') });
  await validate(zip(entries));
});
test.each(["[Content_Types].xml", "_rels/.rels", "word/document.xml"])("missing DOCX required part: %s", async name => {
  await rejected(validate(zip(parts().filter(part => part.name !== name))));
});
test.each([
  ["[Content_Types].xml", () => fixture("content-types.xml").toString().replace("wordprocessingml.document.main+xml", "ms-word.document.macroEnabled.main+xml")],
  ["_rels/.rels", () => fixture("relationships.xml").toString().replace('Target="word/document.xml"', 'Target="https://example.invalid/document.xml" TargetMode="External"')],
  ["word/document.xml", () => '<document><body/></document>'],
  ["word/document.xml", () => fixture("document.xml").toString().replaceAll("w:body", "w:unknown")],
  ["word/document.xml", () => '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///never-read">]><x>&e;</x>'],
  ["word/document.xml", () => '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body></w:document>'],
  ["word/document.xml", () => fixture("document.xml").toString() + "<extra/>"],
])("reject DOCX semantic/XML mismatch %s", async (name, content) => await rejected(validate(zip(replacedPart(name as string, (content as () => string)())))));
test("macro payload, duplicate part and traversal/ambiguous names are rejected", async () => {
  for (const name of ["word/vbaProject.bin", "word/activeX/activeX1.xml", "word/document.xml", "../evil.xml", "/evil.xml", "word\\evil.xml", "word/%2e%2e/evil.xml"]) {
    await rejected(validate(zip([...parts(), { name, data: Buffer.from("x") }])));
  }
});
test("all XML is checked, including auxiliary DTD, invalid UTF-8 and deep XML", async () => {
  await rejected(validate(zip([...parts(), { name: "extra.xml", data: Buffer.from('<!DOCTYPE x><x/>') }])));
  await rejected(validate(zip([...parts(), { name: "extra.xml", data: Buffer.from([0x3c, 0x78, 0x3e, 0xff]) }])));
  await rejected(validate(zip([...parts(), { name: "extra.xml", data: Buffer.from("<x>".repeat(129) + "</x>".repeat(129)) }])), "AUTHOR_ASSET_COMPLEXITY", 413);
});
test("ZIP encrypted/unknown compression and local/central disagreement are rejected", async () => {
  await rejected(validate(zip(parts().map(part => ({ ...part, flags: 0x801 })))));
  for (const field of ["method", "local-name", "crc", "offset", "size"] as const) {
    const bytes = zip(), central = directoryOffsets(bytes)[0];
    if (field === "method") bytes.writeUInt16LE(99, central + 10);
    if (field === "local-name") bytes[30] = 88;
    if (field === "crc") bytes.writeUInt32LE(0, central + 16);
    if (field === "offset") bytes.writeUInt32LE(1, central + 42);
    if (field === "size") bytes.writeUInt32LE(1, central + 24);
    await rejected(validate(bytes));
  }
});
test("actual ZIP bytes and descriptor CRC are checked, not only claimed metadata", async () => {
  const stored = zip(parts().map((part): Part => ({ ...part, method: 0 }))), central = directoryOffsets(stored)[0];
  const dataOffset = 30 + stored.readUInt16LE(26) + stored.readUInt16LE(28); stored[dataOffset] ^= 1;
  expect(stored.readUInt32LE(central + 16)).not.toBe(crc32(stored.subarray(dataOffset, dataOffset + stored.readUInt32LE(central + 20))));
  await rejected(validate(stored));
  const descriptor = zip(parts().map((part): Part => ({ ...part, descriptor: "signed" }))), first = directoryOffsets(descriptor)[0];
  descriptor[30 + descriptor.readUInt16LE(26) + descriptor.readUInt32LE(first + 20) + 4] ^= 1;
  await rejected(validate(descriptor));
});
test("understated inflate size is bounded and rejected", async () => {
  const bytes = zip([...parts(), { name: "extra.bin", data: Buffer.alloc(300_000, 65) }]), central = directoryOffsets(bytes).at(-1)!;
  const local = bytes.readUInt32LE(central + 42); bytes.writeUInt32LE(1, local + 22); bytes.writeUInt32LE(1, central + 24);
  await rejected(validate(bytes));
});
test("ZIP64, duplicate records, prepended/trailing data and truncated directory are rejected", async () => {
  const extra = Buffer.alloc(4); extra.writeUInt16LE(1);
  await rejected(validate(zip(parts().map(part => ({ ...part, extra })))), "AUTHOR_ASSET_COMPLEXITY", 413);
  const bytes = zip();
  for (const damaged of [Buffer.concat([Buffer.from("prefix"), bytes]), Buffer.concat([bytes, Buffer.from("suffix")]), bytes.subarray(0, -1)]) await rejected(validate(damaged));
});
test("ZIP entry count and compression expansion have explicit upper bounds", async () => {
  await rejected(validate(zip([...parts(), ...Array.from({ length: limits.zipEntries }, (_, i) => ({ name: `extra-${i}.bin`, data: Buffer.alloc(0) }))])), "AUTHOR_ASSET_COMPLEXITY", 413);
  await rejected(validate(zip([...parts(), { name: "bomb.bin", data: Buffer.alloc(2 * 1024 * 1024, 65) }])), "AUTHOR_ASSET_COMPLEXITY", 413);
  await rejected(validate(zip([...parts(), { name: "oversize.xml", method: 0, data: Buffer.alloc(limits.xmlEntryBytes + 1, 32) }])), "AUTHOR_ASSET_COMPLEXITY", 413);
});

let png: Buffer, jpeg: Buffer, oriented: Buffer;
beforeAll(async () => {
  const create = { width: 3, height: 2, channels: 3 as const, background: { r: 10, g: 60, b: 120 } };
  png = await sharp({ create }).png().toBuffer(); jpeg = await sharp({ create }).jpeg().toBuffer();
  oriented = await sharp({ create }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
});
function pngChunk(type: string, payload: Buffer) {
  const chunk = Buffer.alloc(payload.length + 12); chunk.writeUInt32BE(payload.length); chunk.write(type, 4, "ascii"); payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + payload.length)), 8 + payload.length); return chunk;
}
test("actual JPEG/PNG decode preserves bytes, hash and EXIF orientation", async () => {
  for (const [name, bytes] of [["x.png", png], ["x.jpeg", jpeg], ["oriented.jpg", oriented]] as const) {
    const before = Buffer.from(bytes); await validate(bytes, name, "OPTION_IMAGE"); expect(bytes.equals(before)).toBe(true);
  }
  expect((await sharp(oriented).metadata()).orientation).toBe(6);
});
test("image maximum accepts exactly 1 MiB and rejects one extra byte", async () => {
  const padding = pngChunk("npAD", Buffer.alloc(1024 * 1024 - png.length - 12));
  const exact = Buffer.concat([png.subarray(0, -12), padding, png.subarray(-12)]);
  expect(exact.length).toBe(1024 * 1024); await validate(exact, "exact.png", "OPTION_IMAGE");
  await rejected(validate(Buffer.concat([exact, Buffer.from([0])]), "large.png", "OPTION_IMAGE"), "AUTHOR_ASSET_SIZE", 413);
});
test("four body image purposes share the exact 14 MiB contract without widening legacy purposes", async () => {
  for (const purpose of bodyImagePurposes) {
    expect(authorAssetByteLimit(purpose)).toBe(MAX_BODY_IMAGE_BYTES);
    expect(authorAssetUploadInput.safeParse({ serviceId: crypto.randomUUID(), purpose, name: "body.png", mime: "image/png",
      size: MAX_BODY_IMAGE_BYTES, sha256: "a".repeat(64) }).success).toBe(true);
    expect(authorAssetUploadInput.safeParse({ serviceId: crypto.randomUUID(), purpose, name: "body.png", mime: "image/png",
      size: MAX_BODY_IMAGE_BYTES + 1, sha256: "a".repeat(64) }).success).toBe(false);
  }
  expect(authorAssetByteLimit("QUESTION_MATERIAL")).toBe(5 * 1024 * 1024);
  expect(authorAssetByteLimit("OPTION_IMAGE")).toBe(1024 * 1024);
  expect(authorAssetByteLimit("QUESTION_IMAGE")).toBe(1024 * 1024);
  const padding = pngChunk("npAD", Buffer.alloc(MAX_BODY_IMAGE_BYTES - png.length - 12));
  const exact = Buffer.concat([png.subarray(0, -12), padding, png.subarray(-12)]);
  expect(exact.length).toBe(MAX_BODY_IMAGE_BYTES);
  await validate(exact, "body.png", "FORM_CONTENT_IMAGE");
  await rejected(validate(Buffer.concat([exact, Buffer.from([0])]), "body.png", "FORM_CONTENT_IMAGE"), "AUTHOR_ASSET_SIZE", 413);
}, 30000);
test("PNG CRC/truncation and mismatched image format are rejected", async () => {
  const damaged = Buffer.from(png); damaged[29] ^= 1;
  await rejected(validate(damaged, "bad.png", "OPTION_IMAGE"));
  await rejected(validate(png.subarray(0, -5), "short.png", "OPTION_IMAGE"));
  await rejected(validate(png, "wrong.jpg", "OPTION_IMAGE"));
  await rejected(validate(Buffer.concat([jpeg.subarray(0, 100), Buffer.from([255, 217])]), "short.jpg", "OPTION_IMAGE"));
});
test("PNG pixel/dimension bounds and APNG are explicit independent restrictions", async () => {
  for (const [width, height] of [[8193, 1], [4096, 4096]]) {
    const huge = Buffer.from(png); huge.writeUInt32BE(width, 16); huge.writeUInt32BE(height, 20); huge.writeUInt32BE(crc32(huge.subarray(12, 29)), 29);
    await rejected(validate(huge, "huge.png", "OPTION_IMAGE"), "AUTHOR_ASSET_COMPLEXITY", 413);
  }
  const control = Buffer.alloc(8); control.writeUInt32BE(2);
  const animated = Buffer.concat([png.subarray(0, 33), pngChunk("acTL", control), png.subarray(33)]);
  for (const purpose of ["OPTION_IMAGE", "FORM_CONTENT_IMAGE"] as const)
    await rejected(validate(animated, "animated.png", purpose), "AUTHOR_ASSET_COMPLEXITY", 413);
});
test("body images use 24 MiPixels and 16,384px while question images keep 8 MiPixels and 8,192px", async () => {
  const wide = await sharp({ create: { width: limits.bodyImageDimension, height: 1, channels: 3, background: "#123456" } }).png().toBuffer();
  await validate(wide, "wide.png", "FORM_CONTENT_IMAGE");
  await rejected(validate(wide, "wide.png", "QUESTION_IMAGE"), "AUTHOR_ASSET_COMPLEXITY", 413);
  const exactPixels = await sharp({ create: { width: 6144, height: 4096, channels: 3, background: "#654321" } }).png().toBuffer();
  expect(6144 * 4096).toBe(limits.bodyImagePixels);
  await validate(exactPixels, "pixels.png", "PAGE_CONTENT_IMAGE");
  await rejected(validate(exactPixels, "pixels.png", "OPTION_IMAGE"), "AUTHOR_ASSET_COMPLEXITY", 413);
  const tooWide = Buffer.from(png); tooWide.writeUInt32BE(limits.bodyImageDimension + 1, 16);
  tooWide.writeUInt32BE(crc32(tooWide.subarray(12, 29)), 29);
  await rejected(validate(tooWide, "too-wide.png", "END_PAGE_CONTENT_IMAGE"), "AUTHOR_ASSET_COMPLEXITY", 413);
}, 30000);
test("compressed PNG text is bounded before native metadata processing", async () => {
  const bomb = pngChunk("zTXt", Buffer.concat([Buffer.from("Note\0\0"), deflateSync(Buffer.alloc(limits.pngMetadataEntryBytes + 1, 65))]));
  await rejected(validate(Buffer.concat([png.subarray(0, 33), bomb, png.subarray(33)]), "metadata.png", "OPTION_IMAGE"), "AUTHOR_ASSET_COMPLEXITY", 413);
});
test("decode failure releases its slot and invalid pixels cannot pass with a valid chunk CRC", async () => {
  const damaged = Buffer.from(png); let p = 8;
  while (damaged.subarray(p + 4, p + 8).toString("ascii") !== "IDAT") p += damaged.readUInt32BE(p) + 12;
  const length = damaged.readUInt32BE(p); damaged[p + 8] ^= 255;
  damaged.writeUInt32BE(crc32(damaged.subarray(p + 4, p + 8 + length)), p + 8 + length);
  for (let i = 0; i < 3; i++) await rejected(validate(damaged, "decode.png", "OPTION_IMAGE"));
  await validate(png, "after-error.png", "OPTION_IMAGE");
});
test("image decode concurrency is shared across legacy and body purposes and a completed slot is reusable", async () => {
  const purposes = ["OPTION_IMAGE", "FORM_CONTENT_IMAGE", "PRIVATE_PAGE_CONTENT_IMAGE"] as const;
  const results = await Promise.allSettled(purposes.map(purpose => validate(png, "parallel.png", purpose)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(2);
  const failure = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  expect(failure.reason).toMatchObject({ status: 503, code: "AUTHOR_ASSET_VALIDATION_BUSY" });
  await validate(png, "retry.png", "OPTION_IMAGE");
});
