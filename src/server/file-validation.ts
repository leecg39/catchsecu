import { createHash } from "node:crypto";
import { extname } from "node:path";
import { MAX_FILE_BYTES } from "@/contracts/files";
import { MAX_PRIVATE_OBJECT_BYTES } from "@/contracts/storage-limits";
import { fail } from "./http";

const extensions: Record<string, string[]> = {
  "application/pdf": [".pdf"], "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"],
  "text/csv": [".csv"], "text/plain": [".txt"],
};
export function validateFileName(name: string, mime: string) {
  if (!extensions[mime]?.includes(extname(name).toLowerCase()))
    fail(422, "FILE_EXTENSION_MISMATCH", "파일 확장자와 형식을 확인해주세요. PDF, PNG, JPG, TXT, CSV를 지원합니다.");
}
export function sha256(bytes: Buffer) { return createHash("sha256").update(bytes).digest("hex"); }
export function validateFileBytes(bytes: Buffer, meta: { name: string; size: number; mime: string; sha256: string | null; encoding?: string; ownerKind?: string }) {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) fail(413, "FILE_TOO_LARGE", "파일은 1바이트 이상, 10MB 이하로 첨부해주세요.");
  if (bytes.length !== meta.size || sha256(bytes) !== meta.sha256) fail(422, "FILE_INTEGRITY", "업로드한 파일의 크기나 내용이 일치하지 않습니다.");
  validateFileName(meta.name, meta.mime);
  let valid = false;
  if (meta.mime === "application/pdf") valid = bytes.subarray(0, 5).toString("ascii") === "%PDF-" && bytes.subarray(-1024).includes(Buffer.from("%%EOF"));
  if (meta.mime === "image/png") valid = bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.subarray(12, 16).toString("ascii") === "IHDR" && bytes.subarray(-8, -4).toString("ascii") === "IEND";
  if (meta.mime === "image/jpeg") valid = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 &&
    bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (meta.mime.startsWith("text/")) {
    try { new TextDecoder(meta.ownerKind === "import" && meta.mime === "text/csv" ? meta.encoding : "utf-8", { fatal: true }).decode(bytes); valid = !bytes.includes(0); } catch {}
  }
  if (!valid) fail(422, "FILE_CONTENT_MISMATCH", "선택한 형식과 실제 파일 내용이 일치하지 않습니다.");
}
export async function readFileBody(request: Request, expectedSize: number, expectedMime: string, maxBytes = MAX_FILE_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PRIVATE_OBJECT_BYTES) throw new Error("Invalid trusted upload byte limit");
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > maxBytes) fail(413, "FILE_TOO_LARGE", "파일 크기 제한을 초과했습니다.");
  if (request.headers.get("content-type")?.split(";")[0].trim() !== expectedMime) fail(415, "FILE_CONTENT_TYPE", "파일 형식을 확인해주세요.");
  if (request.headers.has("content-encoding")) fail(415, "FILE_CONTENT_ENCODING", "압축되지 않은 파일을 업로드해주세요.");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== expectedSize))
    fail(422, "FILE_INTEGRITY", "파일 크기가 일치하지 않습니다.");
  const reader = request.body?.getReader();
  if (!reader) fail(422, "FILE_EMPTY", "파일이 비어 있습니다.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.length;
      if (size > maxBytes || size > expectedSize) { await reader.cancel(); fail(413, "FILE_TOO_LARGE", "파일 크기 제한을 초과했습니다."); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
