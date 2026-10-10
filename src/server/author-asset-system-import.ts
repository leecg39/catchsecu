import { createHash, randomUUID } from "node:crypto";
import { authorAssetByteLimit, type AuthorAssetPurpose } from "@/contracts/author-assets";
import { db } from "./db";
import { encrypt } from "./crypto";
import { fail } from "./http";
import { privateFiles } from "./file-storage";
import { requireFileScanner, scanFile } from "./file-scanner";
import { validateAuthorAssetBytes, validateAuthorAssetName } from "./author-asset-validation";
import { authorAssetInfo } from "./author-asset-uploads";

/** Trusted seed/operator entry point. No HTTP route or user-supplied owner scope.
 * The importer must bind the returned key to a system template within one hour.
 */
export async function importSystemAuthorAsset(input: { name: string; purpose: AuthorAssetPurpose; bytes: Buffer }) {
  const { name, purpose, bytes } = input, mime = validateAuthorAssetName(name, purpose);
  const identity = { name, purpose, mime, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  await validateAuthorAssetBytes(bytes, identity);
  await requireFileScanner();
  const asset = await db.$transaction(async tx => {
    const blob = await tx.authorAssetBlob.create({ data: { id: randomUUID(), storageKey: randomUUID(), mime, size: identity.size, sha256: identity.sha256 } });
    return tx.authorAsset.create({ data: { id: randomUUID(), blobId: blob.id, ownerKind: "system", purpose,
      nameCipher: encrypt(name), size: identity.size }, include: { blob: true } });
  });
  // The durable pending reservation lets the normal worker remove bytes after a crash.
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "AuthorAsset" WHERE id=${asset.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "AuthorAssetBlob" WHERE id=${asset.blobId} FOR UPDATE`;
    await privateFiles.write(asset.blob.storageKey, bytes);
    await tx.authorAssetBlob.update({ where: { id: asset.blobId }, data: { status: "uploaded", version: { increment: 1 } } });
    await tx.authorAsset.update({ where: { id: asset.id }, data: { status: "uploaded", version: { increment: 1 } } });
  });
  let scan: Awaited<ReturnType<typeof scanFile>>;
  try { scan = await scanFile(bytes, authorAssetByteLimit(purpose)); }
  catch (error) {
    await db.authorAssetBlob.update({ where: { id: asset.blobId }, data: { scanStatus: "error", version: { increment: 1 } } }).catch(() => {});
    throw error;
  }
  const saved = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "AuthorAsset" WHERE id=${asset.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "AuthorAssetBlob" WHERE id=${asset.blobId} FOR UPDATE`;
    const current = await tx.authorAsset.findUniqueOrThrow({ where: { id: asset.id } });
    if (current.status !== "uploaded" || !current.expiresAt || current.expiresAt.getTime() <= Date.now()) fail(410, "AUTHOR_ASSET_EXPIRED", "가져오기 작업의 사용 기간이 끝났습니다.");
    await tx.authorAssetBlob.update({ where: { id: asset.blobId }, data: { status: scan.clean ? "ready" : "quarantined",
      scanStatus: scan.clean ? "clean" : "infected", scanEngine: scan.engine, scannedAt: new Date(), version: { increment: 1 } } });
    return tx.authorAsset.update({ where: { id: asset.id }, data: { status: scan.clean ? "ready" : "rejected", version: { increment: 1 } }, include: { blob: true } });
  });
  if (!scan.clean) fail(422, "AUTHOR_ASSET_UNSAFE", "파일 안전성 검사를 통과하지 못했습니다.");
  return authorAssetInfo(saved);
}
