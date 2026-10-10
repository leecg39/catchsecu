import { randomUUID, createHash } from "node:crypto";
import type { z } from "zod";
import type { AuthorAsset, AuthorAssetBlob } from "@/generated/prisma/client";
import { authorAssetByteLimit, authorAssetUploadInput, isAuthorImagePurpose, type AuthorAssetInfo, type AuthorAssetUploadInfo } from "@/contracts/author-assets";
import type { Context } from "./context";
import { db, type Transaction } from "./db";
import { decrypt, encrypt } from "./crypto";
import { fail, HttpError } from "./http";
import { idempotent } from "./idempotency";
import { withFormAccess, lockFormService } from "./form-access";
import { fileQuotaUsage, lockFileQuota, reserveQuota } from "./file-quota";
import { privateFiles } from "./file-storage";
import { readFileBody } from "./file-validation";
import { requireFileScanner, scanFile } from "./file-scanner";
import { validateAuthorAssetBytes } from "./author-asset-validation";

export type StoredAuthorAsset = AuthorAsset & { blob: AuthorAssetBlob };
export function authorAssetInfo(asset: StoredAuthorAsset): AuthorAssetInfo {
  if (!asset.nameCipher) fail(410, "AUTHOR_ASSET_UNAVAILABLE", "삭제된 자료입니다.");
  return { id: asset.id, purpose: asset.purpose as AuthorAssetInfo["purpose"], name: decrypt<string>(asset.nameCipher),
    mime: asset.blob.mime as AuthorAssetInfo["mime"], size: asset.size, sha256: asset.blob.sha256,
    status: asset.status as AuthorAssetInfo["status"], version: asset.version, expiresAt: asset.expiresAt?.toISOString() ?? null };
}
async function uploadInfo(tx: Transaction, asset: StoredAuthorAsset): Promise<AuthorAssetUploadInfo> {
  if (asset.status === "ready") assertLiveAuthorAsset(asset, true);
  return { ...authorAssetInfo(asset), usage: await fileQuotaUsage(tx, asset.tenantId!) };
}
export function assertLiveAuthorAsset(asset: StoredAuthorAsset, ready = false) {
  if (["deleting", "deleted"].includes(asset.status) || (asset.expiresAt && asset.expiresAt.getTime() <= Date.now()))
    fail(410, "AUTHOR_ASSET_EXPIRED", "자료의 사용 기간이 끝났습니다. 파일을 다시 선택해주세요.");
  if (ready && (asset.status !== "ready" || asset.blob.status !== "ready" || asset.blob.scanStatus !== "clean"))
    fail(409, "AUTHOR_ASSET_NOT_READY", "파일 검사를 통과한 자료만 사용할 수 있습니다.");
}
export async function lockAuthorUpload(tx: Transaction, ctx: Context, id: string) {
  const initial = await tx.authorAsset.findFirst({ where: { id, tenantId: ctx.tenantId, createdById: ctx.member.id, ownerKind: "company" } });
  if (!initial?.serviceId) fail(404, "NOT_FOUND", "첨부 자료를 찾을 수 없습니다.");
  await lockFormService(tx, ctx, initial.serviceId, "form.write");
  await tx.$queryRaw`SELECT id FROM "AuthorAsset" WHERE id=${id} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "AuthorAssetBlob" WHERE id=${initial.blobId} FOR UPDATE`;
  const asset = await tx.authorAsset.findUniqueOrThrow({ where: { id }, include: { blob: true } });
  assertLiveAuthorAsset(asset);
  return asset;
}
async function withUpload<T>(ctx: Context, id: string, operation: (tx: Transaction, asset: StoredAuthorAsset) => Promise<T>) {
  return db.$transaction(tx => withFormAccess(tx, ctx, "form.write", async () => {
    const asset = await lockAuthorUpload(tx, ctx, id), result = await operation(tx, asset);
    // Natural expiry may pass while decoding, reading storage, or writing an audit row.
    if (asset.expiresAt && asset.expiresAt.getTime() <= Date.now()) fail(410, "AUTHOR_ASSET_EXPIRED", "자료의 사용 기간이 끝났습니다.");
    return result;
  }), { timeout: 15000 });
}
async function assetAudit(tx: Transaction, asset: AuthorAsset, requestId: string, action: string, ctx?: Context) {
  if (!asset.tenantId) return;
  await tx.auditEvent.create({ data: { tenantId: asset.tenantId, serviceId: asset.serviceId, actorId: ctx?.user.id,
    resource: "author-asset", resourceId: asset.id, requestId, action, detail: { status: asset.status, purpose: asset.purpose } } });
}
export async function initAuthorAssetUpload(ctx: Context, raw: z.infer<typeof authorAssetUploadInput>, key: string | null, requestId: string) {
  const input = authorAssetUploadInput.parse(raw);
  await requireFileScanner();
  let reservationId: string | undefined;
  return idempotent("author-asset:upload:" + ctx.member.id, key, input, async tx => {
    await lockFileQuota(tx, ctx.tenantId);
    return withFormAccess(tx, ctx, "form.write", async () => {
      await lockFormService(tx, ctx, input.serviceId, "form.write");
      await reserveQuota(tx, ctx.tenantId, input.size);
      const blob = await tx.authorAssetBlob.create({ data: { id: randomUUID(), storageKey: randomUUID(), mime: input.mime, size: input.size, sha256: input.sha256 } });
      const asset = await tx.authorAsset.create({ data: { id: randomUUID(), blobId: blob.id, ownerKind: "company", tenantId: ctx.tenantId,
        serviceId: input.serviceId, createdById: ctx.member.id, purpose: input.purpose, nameCipher: encrypt(input.name), size: input.size }, include: { blob: true } });
      reservationId = asset.id;
      await assetAudit(tx, asset, requestId, "author_asset.upload_initialized", ctx);
      return { status: 201, body: await uploadInfo(tx, asset), resource: { tenantId: ctx.tenantId, resourceType: "author-asset" as const, resourceId: asset.id } };
    });
  }, tx => lockFormService(tx, ctx, input.serviceId, "form.write"),
  (tx, cached) => withFormAccess(tx, ctx, "form.write", async () => { reservationId = cached.id; return uploadInfo(tx, await lockAuthorUpload(tx, ctx, cached.id)); }),
  tx => withFormAccess(tx, ctx, "form.write", async () => { if (reservationId) await lockAuthorUpload(tx, ctx, reservationId); }));
}
export async function getAuthorAssetUpload(ctx: Context, id: string) {
  return withUpload(ctx, id, uploadInfo);
}
export async function authorAssetUsage(ctx: Context, serviceId: string) {
  return db.$transaction(tx => withFormAccess(tx, ctx, "form.write", async () => {
    await lockFormService(tx, ctx, serviceId, "form.write");
    return fileQuotaUsage(tx, ctx.tenantId);
  }));
}
function validationMeta(asset: StoredAuthorAsset) {
  return { name: decrypt<string>(asset.nameCipher!), purpose: asset.purpose as AuthorAssetInfo["purpose"],
    size: asset.size, mime: asset.blob.mime, sha256: asset.blob.sha256 };
}
export async function putAuthorAssetContent(ctx: Context, id: string, request: Request, requestId: string) {
  const initial = await withUpload(ctx, id, async (_tx, asset) => asset);
  const bytes = await readFileBody(request, initial.size, initial.blob.mime, authorAssetByteLimit(initial.purpose as AuthorAssetInfo["purpose"]));
  await validateAuthorAssetBytes(bytes, validationMeta(initial));
  return withUpload(ctx, id, async (tx, asset) => {
    if (["uploaded", "ready"].includes(asset.status)) return uploadInfo(tx, asset);
    if (asset.status !== "pending" || asset.blob.status !== "pending") fail(409, "AUTHOR_ASSET_STATE", "다시 업로드할 수 없는 상태입니다.");
    // The committed pending row survives a storage failure or transaction rollback.
    await privateFiles.write(asset.blob.storageKey, bytes);
    await tx.authorAssetBlob.update({ where: { id: asset.blobId }, data: { status: "uploaded", version: { increment: 1 } } });
    const saved = await tx.authorAsset.update({ where: { id }, data: { status: "uploaded", version: { increment: 1 } }, include: { blob: true } });
    await assetAudit(tx, saved, requestId, "author_asset.uploaded", ctx);
    return uploadInfo(tx, saved);
  });
}
export async function completeAuthorAssetUpload(ctx: Context, id: string, requestId: string) {
  const initial = await withUpload(ctx, id, async (tx, asset) => {
    if (asset.status === "rejected") fail(422, "AUTHOR_ASSET_UNSAFE", "검사를 통과하지 못한 파일입니다. 다른 파일을 선택해주세요.");
    if (asset.status === "ready") { assertLiveAuthorAsset(asset, true); return { info: await uploadInfo(tx, asset) }; }
    if (asset.status !== "uploaded") fail(409, "AUTHOR_ASSET_NOT_UPLOADED", "파일 업로드를 먼저 완료해주세요.");
    return { asset, bytes: await privateFiles.read(asset.blob.storageKey) };
  });
  if (initial.info) return initial.info;
  await validateAuthorAssetBytes(initial.bytes!, validationMeta(initial.asset!));
  let scan: Awaited<ReturnType<typeof scanFile>>;
  try { scan = await scanFile(initial.bytes!, authorAssetByteLimit(initial.asset!.purpose as AuthorAssetInfo["purpose"])); }
  catch (error) {
    if (error instanceof HttpError) await withUpload(ctx, id, async (tx, asset) => {
      if (asset.status !== "uploaded") return;
      await tx.authorAssetBlob.update({ where: { id: asset.blobId }, data: { scanStatus: "error", version: { increment: 1 } } });
      await assetAudit(tx, asset, requestId, "author_asset.scan_failed", ctx);
    }).catch(() => {});
    throw error;
  }
  const result = await withUpload(ctx, id, async (tx, asset) => {
    if (asset.status === "ready") { assertLiveAuthorAsset(asset, true); return uploadInfo(tx, asset); }
    if (asset.status !== "uploaded") fail(409, "AUTHOR_ASSET_STATE", "파일 상태가 변경되었습니다.");
    await tx.authorAssetBlob.update({ where: { id: asset.blobId }, data: { status: scan.clean ? "ready" : "quarantined",
      scanStatus: scan.clean ? "clean" : "infected", scanEngine: scan.engine, scannedAt: new Date(), version: { increment: 1 } } });
    const saved = await tx.authorAsset.update({ where: { id }, data: { status: scan.clean ? "ready" : "rejected", version: { increment: 1 } }, include: { blob: true } });
    await assetAudit(tx, saved, requestId, scan.clean ? "author_asset.scan_passed" : "author_asset.scan_rejected", ctx);
    return uploadInfo(tx, saved);
  });
  if (result.status === "rejected") fail(422, "AUTHOR_ASSET_UNSAFE", "파일 안전성 검사를 통과하지 못했습니다. 다른 파일을 선택해주세요.");
  return result;
}
export async function readAuthorAssetBytes(asset: StoredAuthorAsset) {
  assertLiveAuthorAsset(asset, true);
  let bytes: Buffer;
  try { bytes = await privateFiles.read(asset.blob.storageKey); }
  catch { fail(503, "AUTHOR_ASSET_STORAGE", "첨부 자료를 읽을 수 없습니다. 잠시 후 다시 시도해주세요."); }
  if (bytes.length !== asset.size || createHash("sha256").update(bytes).digest("hex") !== asset.blob.sha256)
    fail(503, "AUTHOR_ASSET_INTEGRITY", "첨부 자료의 무결성을 확인할 수 없습니다.");
  assertLiveAuthorAsset(asset, true);
  return bytes;
}
export function authorAssetResponse(asset: StoredAuthorAsset, bytes: Buffer) {
  const name = encodeURIComponent(decrypt<string>(asset.nameCipher!)).replace(/[!'()*]/g, ch => "%" + ch.charCodeAt(0).toString(16).toUpperCase());
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": asset.blob.mime, "Content-Length": String(bytes.length),
    "Content-Disposition": (isAuthorImagePurpose(asset.purpose) ? "inline" : "attachment") + "; filename=\"attachment\"; filename*=UTF-8''" + name,
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "sandbox; default-src 'none'", "Cross-Origin-Resource-Policy": "same-origin" } });
}
export async function downloadAuthorAssetUpload(ctx: Context, id: string, requestId: string) {
  return withUpload(ctx, id, async (tx, asset) => {
    const bytes = await readAuthorAssetBytes(asset);
    await assetAudit(tx, asset, requestId, "author_asset.previewed", ctx);
    return authorAssetResponse(asset, bytes);
  });
}
export async function finishAuthorAssetDeletion(id: string, requestId: string) {
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "AuthorAsset" WHERE id=${id} FOR UPDATE`;
    const asset = await tx.authorAsset.findUnique({ where: { id } });
    if (!asset || asset.status === "deleted") return;
    if (asset.status !== "deleting") fail(409, "AUTHOR_ASSET_STATE", "삭제 요청이 필요합니다.");
    await tx.$queryRaw`SELECT id FROM "AuthorAssetBlob" WHERE id=${asset.blobId} FOR UPDATE`;
    const blob = await tx.authorAssetBlob.findUniqueOrThrow({ where: { id: asset.blobId } });
    const others = await tx.authorAsset.count({ where: { blobId: asset.blobId, id: { not: id }, status: { not: "deleted" } } });
    // Holding the blob lock also fences new ownership copies while its last owner is removed.
    if (!others) await privateFiles.remove(blob.storageKey);
    const removed = await tx.authorAsset.update({ where: { id }, data: { status: "deleted", nameCipher: null, expiresAt: null, version: { increment: 1 } } });
    if (!others) {
      await tx.authorAssetBlob.update({ where: { id: blob.id }, data: { status: "deleting", version: { increment: 1 } } });
      await tx.authorAssetBlob.update({ where: { id: blob.id }, data: { status: "deleted", expiresAt: null, leaseUntil: null, version: { increment: 1 } } });
    }
    await tx.idempotencyRecord.updateMany({ where: { resourceType: "author-asset", resourceId: id, invalidatedAt: null },
      data: { invalidatedAt: new Date(), responseCipher: null, requestHash: null } });
    await assetAudit(tx, removed, requestId, "author_asset.deleted");
  }, { timeout: 15000 });
}
export async function discardAuthorAssetUpload(ctx: Context, id: string, version: number, requestId: string) {
  await withUpload(ctx, id, async (tx, asset) => {
    if (asset.version !== version) fail(409, "VERSION_CONFLICT", "파일 상태가 변경되었습니다. 다시 불러와주세요.");
    if (await tx.authorAssetReference.count({ where: { assetId: id } })) fail(409, "AUTHOR_ASSET_IN_USE", "저장된 문항에서 사용 중인 자료입니다.");
    const marked = await tx.authorAsset.update({ where: { id }, data: { status: "deleting", version: { increment: 1 } } });
    await assetAudit(tx, marked, requestId, "author_asset.deletion_requested", ctx);
  });
  try { await finishAuthorAssetDeletion(id, requestId); }
  catch { fail(503, "AUTHOR_ASSET_DELETE_PENDING", "자료 접근을 차단했습니다. 저장소 삭제를 다시 처리하고 있습니다."); }
}
export async function cleanupAuthorAssets(requestId = randomUUID()) {
  const ids = await db.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT id,status FROM "AuthorAsset"
      WHERE status='deleting' OR (status IN ('pending','uploaded','ready','rejected') AND "expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC'))
      ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`;
    for (const row of rows) if (row.status !== "deleting") {
      const marked = await tx.authorAsset.update({ where: { id: row.id }, data: { status: "deleting", version: { increment: 1 } } });
      await assetAudit(tx, marked, requestId, "author_asset.expired");
    }
    return rows.map(row => row.id);
  });
  let deleted = 0, retry = 0;
  for (const id of ids) { try { await finishAuthorAssetDeletion(id, requestId); deleted++; } catch { retry++; } }
  // A pending blob can remain after a failed system import or reservation rollback boundary.
  const orphanIds = await db.authorAssetBlob.findMany({ where: { status: { not: "deleted" }, expiresAt: { lte: new Date() }, assets: { none: { status: { not: "deleted" } } } }, select: { id: true }, take: 100 });
  for (const row of orphanIds) {
    try {
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "AuthorAssetBlob" WHERE id=${row.id} FOR UPDATE`;
        const blob = await tx.authorAssetBlob.findUniqueOrThrow({ where: { id: row.id } });
        if (blob.status === "deleted" || await tx.authorAsset.count({ where: { blobId: row.id, status: { not: "deleted" } } })) return;
        if (!blob.expiresAt || blob.expiresAt.getTime() > Date.now()) return;
        if (blob.status !== "deleting") await tx.authorAssetBlob.update({ where: { id: row.id }, data: { status: "deleting", version: { increment: 1 } } });
        await privateFiles.remove(blob.storageKey);
        await tx.authorAssetBlob.update({ where: { id: row.id }, data: { status: "deleted", expiresAt: null, leaseUntil: null, version: { increment: 1 } } });
      });
    } catch { retry++; }
  }
  return { deleted, retry };
}
