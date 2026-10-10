import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect, test, vi } from "vitest";
vi.mock("@/server/http", () => ({ fail: (status: number, code: string, message: string): never => { throw Object.assign(new Error(message), { status, code }); } }));
import { validateAuthorAssetBytes } from "@/server/author-asset-validation";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const image = () => sharp({ create: { width: 24, height: 16, channels: 3, background: "#3278ab" } });
const check = (b: Buffer, name = "image.png", mime = "image/png", overrides = {}) => validateAuthorAssetBytes(b,
  { purpose: "QUESTION_IMAGE", name, mime, size: b.length, sha256: sha(b), ...overrides });

test("QUESTION_IMAGE uses the real PNG and JPEG decoder and retains source bytes", async () => {
  for (const [bytes, name, mime] of [[await image().png().toBuffer(), "image.png", "image/png"],
    [await image().jpeg().toBuffer(), "image.jpeg", "image/jpeg"]] as const) {
    const original = Buffer.from(bytes);
    await expect(check(bytes, name, mime)).resolves.toBeUndefined(); expect(bytes.equals(original)).toBe(true);
  }
});
test("QUESTION_IMAGE rejects a PNG magic prefix without a decodable image", async () => {
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("not image data")]);
  await expect(check(bytes)).rejects.toMatchObject({ status: 422, code: "AUTHOR_ASSET_CONTENT" });
});
test("QUESTION_IMAGE cannot pass the document validator by changing MIME and extension", async () => {
  const bytes = Buffer.from("%PDF-1.4\n%%EOF\n");
  await expect(check(bytes, "image.pdf", "application/pdf")).rejects.toMatchObject({ status: 415, code: "AUTHOR_ASSET_TYPE" });
});
test("QUESTION_IMAGE rejects JPEG bytes advertised as PNG and PNG bytes as JPEG", async () => {
  await expect(check(await image().jpeg().toBuffer())).rejects.toMatchObject({ status: 422, code: "AUTHOR_ASSET_CONTENT" });
  await expect(check(await image().png().toBuffer(), "image.jpg", "image/jpeg")).rejects.toMatchObject({ status: 422, code: "AUTHOR_ASSET_CONTENT" });
});
test("QUESTION_IMAGE has the 1 MiB bound before decoding", async () => {
  await expect(check(Buffer.alloc(1048577))).rejects.toMatchObject({ status: 413 });
});
test("QUESTION_IMAGE rejects a changed source hash", async () => {
  await expect(check(await image().png().toBuffer(), "image.png", "image/png", { sha256: "0".repeat(64) })).rejects.toMatchObject({ status: 422 });
});
