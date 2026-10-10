import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { randomUUID, createHash } from "node:crypto";
import { beforeAll, beforeEach, afterAll, afterEach, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { privateFiles } from "@/server/file-storage";
import * as scanner from "@/server/file-scanner";
import { HttpError } from "@/server/http";
import * as quota from "@/server/file-quota";
import { fileQuotaUsage, reserveQuota } from "@/server/file-quota";
import { initAuthorAssetUpload, putAuthorAssetContent, completeAuthorAssetUpload, getAuthorAssetUpload, discardAuthorAssetUpload,
  downloadAuthorAssetUpload, cleanupAuthorAssets } from "@/server/author-asset-uploads";
import { GET, POST, PUT, DELETE } from "@/app/api/v1/author-assets/[[...segments]]/route";
import { MAX_BODY_IMAGE_BYTES, type AuthorAssetUploadInfo } from "@/contracts/author-assets";

const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test database required");
const pdf = Buffer.from("%PDF-1.7\n% Synthetic author material\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
let ctx: Context, serviceId: string, cookie: string, bodyImage: Buffer, smallBodyImage: Buffer;
function req(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1/author-assets" + path, { method, headers: { origin, cookie,
    ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const input = (bytes = pdf) => ({ serviceId, purpose: "QUESTION_MATERIAL" as const, name: "참고 자료.pdf", mime: "application/pdf" as const, size: bytes.length, sha256: hash(bytes) });
const raw = (id: string, bytes = pdf) => new Request(origin + "/api/v1/author-assets/uploads/" + id + "/content", {
  method: "PUT", headers: { origin, cookie, "content-type": "application/pdf" }, body: new Uint8Array(bytes) });
async function init(bytes = pdf, key = randomUUID()) { return (await initAuthorAssetUpload(ctx, input(bytes), key, randomUUID())).body; }
async function ready(bytes = pdf) {
  const asset = await init(bytes); await putAuthorAssetContent(ctx, asset.id, raw(asset.id, bytes), randomUUID());
  return completeAuthorAssetUpload(ctx, asset.id, randomUUID());
}
async function clearStored() {
  for (const row of await db.authorAssetBlob.findMany({ select: { storageKey: true } })) await privateFiles.remove(row.storageKey);
}
function pngChunk(type: string, payload: Buffer) {
  const chunk = Buffer.alloc(payload.length + 12); chunk.writeUInt32BE(payload.length); chunk.write(type, 4, "ascii"); payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + payload.length)), 8 + payload.length); return chunk;
}
beforeAll(async () => {
  await scanner.requireFileScanner();
  smallBodyImage = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 20, g: 80, b: 140 } } }).png().toBuffer();
  bodyImage = Buffer.concat([smallBodyImage.subarray(0, -12), pngChunk("npAD", Buffer.alloc(MAX_BODY_IMAGE_BYTES - smallBodyImage.length - 12)), smallBodyImage.subarray(-12)]);
});
beforeEach(async () => {
  await clearStored();
  await db.$executeRawUnsafe('TRUNCATE "Company", "User", "AuthorAssetBlob", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Author upload QA", publicName: "QA", policy: { create: { passwordMonths: 0 } }, services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = randomUUID() + "@asset.example.test", password = "Author-asset-QA!123";
  const authReq = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(authReq("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(authReq("sign-in/email", { email, password })); expect(login.status).toBe(200);
  cookie = login.headers.getSetCookie().map(item => item.split(";", 1)[0]).join("; ");
  ctx = await requireContext(new Headers({ cookie }), "form.write");
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await clearStored(); await db.$disconnect(); });

test("HTTP upload, real ClamAV completion, encrypted storage and scoped preview preserve exact bytes", async () => {
  const post = await POST(req("/uploads", "POST", input(), { "idempotency-key": randomUUID() })); expect(post.status).toBe(201);
  const first = await post.json() as AuthorAssetUploadInfo;
  expect(first).toMatchObject({ status: "pending", version: 1, size: pdf.length, usage: { usedBytes: pdf.length } });
  expect(first).not.toHaveProperty("storageKey"); expect(first).not.toHaveProperty("blobId"); expect(first).not.toHaveProperty("createdById");
  expect((await PUT(raw(first.id))).status).toBe(200);
  const complete = await POST(req("/uploads/" + first.id + "/complete", "POST")); expect(complete.status).toBe(200);
  const saved = await complete.json(); expect(saved.status).toBe("ready");
  const stored = await db.authorAsset.findUniqueOrThrow({ where: { id: first.id }, include: { blob: true } });
  expect(stored.nameCipher).not.toContain("참고 자료"); expect(stored.createdById).toBe(ctx.member.id);
  expect(stored.blob.scanStatus).toBe("clean"); expect(stored.blob.scanEngine).toMatch(/^ClamAV /);
  expect(stored.blob.storageKey).not.toBe(stored.id); expect(await privateFiles.read(stored.blob.storageKey)).toEqual(pdf);
  const download = await GET(req("/uploads/" + first.id + "/download")); expect(download.status).toBe(200);
  expect(download.headers.get("content-disposition")).toContain("attachment;"); expect(download.headers.get("cache-control")).toContain("no-store");
  expect(Buffer.from(await download.arrayBuffer())).toEqual(pdf);
  expect((await DELETE(req("/uploads/" + first.id + "?version=" + saved.version, "DELETE"))).status).toBe(204);
  expect((await GET(req("/uploads/" + first.id))).status).toBe(410);
  expect(await db.authorAssetBlob.findUniqueOrThrow({ where: { id: stored.blobId } })).toMatchObject({ status: "deleted" });
  await expect(privateFiles.read(stored.blob.storageKey)).rejects.toThrow();
});
test("14 MiB body image crosses HTTP, encrypted storage and real ClamAV with an exact hash", async () => {
  expect(bodyImage.length).toBe(MAX_BODY_IMAGE_BYTES);
  expect(hash(bodyImage)).toBe("1a749928a588ed3c3c933b63356976a4542c68fbe12e6471a714025126b444e0");
  const metadata = { serviceId, purpose: "FORM_CONTENT_IMAGE" as const, name: "본문.png", mime: "image/png" as const,
    size: bodyImage.length, sha256: hash(bodyImage) };
  const post = await POST(req("/uploads", "POST", metadata, { "idempotency-key": randomUUID() }));
  expect(post.status).toBe(201); const first = await post.json() as AuthorAssetUploadInfo;
  const upload = new Request(origin + "/api/v1/author-assets/uploads/" + first.id + "/content", {
    method: "PUT", headers: { origin, cookie, "content-type": "image/png" }, body: new Uint8Array(bodyImage),
  });
  expect((await PUT(upload)).status).toBe(200);
  const complete = await POST(req("/uploads/" + first.id + "/complete", "POST"));
  expect(complete.status).toBe(200); expect(await complete.json()).toMatchObject({ status: "ready", size: MAX_BODY_IMAGE_BYTES, sha256: hash(bodyImage) });
  const row = await db.authorAsset.findUniqueOrThrow({ where: { id: first.id }, include: { blob: true } });
  expect(row).toMatchObject({ purpose: "FORM_CONTENT_IMAGE", size: MAX_BODY_IMAGE_BYTES, blob: { scanStatus: "clean" } });
  expect(hash(await privateFiles.read(row.blob.storageKey))).toBe(hash(bodyImage));
  const download = await GET(req("/uploads/" + first.id + "/download"));
  expect(download.status).toBe(200); expect(hash(Buffer.from(await download.arrayBuffer()))).toBe(hash(bodyImage));
}, 60000);
test("body and legacy purpose byte limits reject one extra byte before a reservation", async () => {
  for (const input of [
    { purpose: "FORM_CONTENT_IMAGE", name: "body.png", mime: "image/png", size: MAX_BODY_IMAGE_BYTES + 1 },
    { purpose: "QUESTION_MATERIAL", name: "file.pdf", mime: "application/pdf", size: 5 * 1024 * 1024 + 1 },
    { purpose: "OPTION_IMAGE", name: "option.png", mime: "image/png", size: 1024 * 1024 + 1 },
    { purpose: "QUESTION_IMAGE", name: "question.png", mime: "image/png", size: 1024 * 1024 + 1 },
  ]) expect((await POST(req("/uploads", "POST", { serviceId, ...input, sha256: "a".repeat(64) },
    { "idempotency-key": randomUUID() }))).status).toBe(422);
  expect(await db.authorAsset.count()).toBe(0);
});
test("body image resource rejection leaves no bytes or refs and cancel/expiry release quota and blob", async () => {
  const tooWide = Buffer.from(smallBodyImage); tooWide.writeUInt32BE(16_385, 16); tooWide.writeUInt32BE(crc32(tooWide.subarray(12, 29)), 29);
  async function rejectedReservation() {
    const metadata = { serviceId, purpose: "FORM_CONTENT_IMAGE" as const, name: "too-wide.png", mime: "image/png" as const,
      size: tooWide.length, sha256: hash(tooWide) };
    const asset = (await initAuthorAssetUpload(ctx, metadata, randomUUID(), randomUUID())).body;
    const upload = new Request(origin + "/api/v1/author-assets/uploads/" + asset.id + "/content", {
      method: "PUT", headers: { origin, cookie, "content-type": "image/png" }, body: new Uint8Array(tooWide),
    });
    await expect(putAuthorAssetContent(ctx, asset.id, upload, randomUUID())).rejects.toMatchObject({ status: 413, code: "AUTHOR_ASSET_COMPLEXITY" });
    const row = await db.authorAsset.findUniqueOrThrow({ where: { id: asset.id }, include: { blob: true } });
    expect(row.status).toBe("pending"); expect(await db.authorAssetReference.count({ where: { assetId: asset.id } })).toBe(0);
    await expect(privateFiles.read(row.blob.storageKey)).rejects.toThrow();
    return { asset, row };
  }
  const cancelled = await rejectedReservation();
  expect(await db.$transaction(tx => fileQuotaUsage(tx, ctx.tenantId))).toMatchObject({ usedBytes: tooWide.length });
  await discardAuthorAssetUpload(ctx, cancelled.asset.id, cancelled.asset.version, randomUUID());
  expect(await db.$transaction(tx => fileQuotaUsage(tx, ctx.tenantId))).toMatchObject({ usedBytes: 0 });
  expect(await db.authorAssetBlob.findUniqueOrThrow({ where: { id: cancelled.row.blobId } })).toMatchObject({ status: "deleted" });

  const abandoned = await rejectedReservation();
  await db.authorAsset.update({ where: { id: abandoned.asset.id }, data: { expiresAt: new Date(Date.now() - 1000), version: { increment: 1 } } });
  expect(await cleanupAuthorAssets()).toMatchObject({ deleted: 1, retry: 0 });
  expect(await db.$transaction(tx => fileQuotaUsage(tx, ctx.tenantId))).toMatchObject({ usedBytes: 0 });
  expect(await db.authorAssetBlob.findUniqueOrThrow({ where: { id: abandoned.row.blobId } })).toMatchObject({ status: "deleted" });
}, 30000);
test("idempotent init returns current ready state and does not reserve twice", async () => {
  const key = randomUUID(), first = await init(pdf, key);
  await putAuthorAssetContent(ctx, first.id, raw(first.id), randomUUID()); await completeAuthorAssetUpload(ctx, first.id, randomUUID());
  const replay = await init(pdf, key); expect(replay).toMatchObject({ id: first.id, status: "ready", usage: { usedBytes: pdf.length } });
  expect(await db.authorAsset.count()).toBe(1);
  await expect(initAuthorAssetUpload(ctx, { ...input(), name: "다른.pdf" }, key, randomUUID())).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_MISMATCH" });
});
test("complete before content and unsupported metadata are rejected without ready data", async () => {
  const first = await init();
  await expect(completeAuthorAssetUpload(ctx, first.id, randomUUID())).rejects.toMatchObject({ status: 409 });
  for (const override of [{ ownerKind: "system" }, { purpose: "OPTION_IMAGE" }, { name: "../x.pdf" }, { name: "x.svg" }, { size: 0 }, { size: 5242881 }])
    expect((await POST(req("/uploads", "POST", { ...input(), ...override }, { "idempotency-key": randomUUID() }))).status).toBe(422);
  expect(await db.authorAsset.count()).toBe(1);
});
test("actual bytes and content-type must agree with the reservation before storage is written", async () => {
  const first = await init(), meta = await db.authorAsset.findUniqueOrThrow({ where: { id: first.id }, include: { blob: true } });
  await expect(putAuthorAssetContent(ctx, first.id, raw(first.id, Buffer.from("not PDF")), randomUUID())).rejects.toMatchObject({ status: 422 });
  const request = raw(first.id); request.headers.set("content-type", "image/png");
  await expect(putAuthorAssetContent(ctx, first.id, request, randomUUID())).rejects.toMatchObject({ status: 415 });
  await expect(privateFiles.read(meta.blob.storageKey)).rejects.toThrow();
  expect((await getAuthorAssetUpload(ctx, first.id)).status).toBe("pending");
});
test("lost content and completion responses are safely repeatable", async () => {
  const first = await init();
  const uploaded = await putAuthorAssetContent(ctx, first.id, raw(first.id), randomUUID());
  expect((await putAuthorAssetContent(ctx, first.id, raw(first.id), randomUUID())).version).toBe(uploaded.version);
  const completed = await completeAuthorAssetUpload(ctx, first.id, randomUUID());
  expect((await completeAuthorAssetUpload(ctx, first.id, randomUUID())).version).toBe(completed.version);
  expect((await putAuthorAssetContent(ctx, first.id, raw(first.id), randomUUID())).version).toBe(completed.version);
});
test("storage write failure leaves a durable pending row that can be retried", async () => {
  const first = await init(), write = privateFiles.write.bind(privateFiles);
  vi.spyOn(privateFiles, "write").mockImplementationOnce(async (key, bytes) => { await write(key, bytes); throw new Error("Injected storage acknowledgement loss"); });
  await expect(putAuthorAssetContent(ctx, first.id, raw(first.id), randomUUID())).rejects.toThrow("acknowledgement");
  expect((await getAuthorAssetUpload(ctx, first.id)).status).toBe("pending");
  await putAuthorAssetContent(ctx, first.id, raw(first.id), randomUUID());
  expect((await completeAuthorAssetUpload(ctx, first.id, randomUUID())).status).toBe("ready");
});
test("scanner unavailable is retryable and never makes bytes readable", async () => {
  const first = await init(); await putAuthorAssetContent(ctx, first.id, raw(first.id), randomUUID());
  vi.spyOn(scanner, "scanFile").mockRejectedValueOnce(new HttpError(503, "FILE_SCANNER_UNAVAILABLE", "QA injected outage"));
  await expect(completeAuthorAssetUpload(ctx, first.id, randomUUID())).rejects.toMatchObject({ status: 503 });
  await expect(downloadAuthorAssetUpload(ctx, first.id, randomUUID())).rejects.toMatchObject({ status: 409 });
  expect((await db.authorAsset.findUniqueOrThrow({ where: { id: first.id }, include: { blob: true } })).blob.scanStatus).toBe("error");
  expect((await completeAuthorAssetUpload(ctx, first.id, randomUUID())).status).toBe("ready");
});
test("actual ClamAV rejects a DOCX containing the standard EICAR test file", async () => {
  const eicar = "X5O!P%@AP[4" + String.fromCharCode(92) + "PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
  const entries = [
    ["[Content_Types].xml", Buffer.from(readFileSync(new URL("../fixtures/author-assets/content-types.xml", import.meta.url), "utf8").replace("</Types>", '<Default Extension="txt" ContentType="text/plain"/></Types>'))],
    ["_rels/.rels", readFileSync(new URL("../fixtures/author-assets/relationships.xml", import.meta.url))],
    ["word/document.xml", readFileSync(new URL("../fixtures/author-assets/document.xml", import.meta.url))],
    ["word/embeddings/test.txt", Buffer.from(eicar)],
  ] as const;
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [path, data] of entries) {
    const name = Buffer.from(path), local = Buffer.alloc(30), directory = Buffer.alloc(46), crc = crc32(data);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    locals.push(local, name, data); central.push(directory, name); offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const bytes = Buffer.concat([...locals, directory, end]), mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const first = (await initAuthorAssetUpload(ctx, { ...input(bytes), name: "검사 자료.docx", mime }, randomUUID(), randomUUID())).body;
  const request = raw(first.id, bytes); request.headers.set("content-type", mime);
  await putAuthorAssetContent(ctx, first.id, request, randomUUID());
  await expect(completeAuthorAssetUpload(ctx, first.id, randomUUID())).rejects.toMatchObject({ status: 422, code: "AUTHOR_ASSET_UNSAFE" });
  const row = await db.authorAsset.findUniqueOrThrow({ where: { id: first.id }, include: { blob: true } });
  expect(row).toMatchObject({ status: "rejected", blob: { status: "quarantined", scanStatus: "infected" } });
  await expect(downloadAuthorAssetUpload(ctx, first.id, randomUUID())).rejects.toMatchObject({ status: 409 });
});
test("current service authority and current membership are enforced on every operation", async () => {
  const first = await ready();
  const backup = await db.user.create({ data: { name: "Backup", email: randomUUID() + "@example.test", emailVerified: true } });
  await db.membership.create({ data: { tenantId: ctx.tenantId, userId: backup.id, role: "owner" } });
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
  await expect(getAuthorAssetUpload(ctx, first.id)).rejects.toMatchObject({ status: 403 });
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "owner" } });
  await db.service.update({ where: { id: serviceId }, data: { status: "archived" } });
  await expect(downloadAuthorAssetUpload(ctx, first.id, randomUUID())).rejects.toMatchObject({ code: "SERVICE_ARCHIVED" });
});
test("a foreign creator cannot use an upload preview even with company-wide form permission", async () => {
  const first = await ready(), user = await db.user.create({ data: { name: "Other", email: randomUUID() + "@example.test", emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId: ctx.tenantId, userId: user.id, role: "owner" } });
  const session = await db.session.create({ data: { userId: user.id, token: randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
  const other = { ...ctx, user, session, member: { ...ctx.member, ...member } };
  await expect(getAuthorAssetUpload(other, first.id)).rejects.toMatchObject({ status: 404 });
});
test("expiry blocks a read that started before its deadline and cleanup invalidates replay", async () => {
  const key = randomUUID(), first = await init(pdf, key); await putAuthorAssetContent(ctx, first.id, raw(first.id), randomUUID());
  await completeAuthorAssetUpload(ctx, first.id, randomUUID());
  await db.authorAsset.update({ where: { id: first.id }, data: { expiresAt: new Date(Date.now() + 250), version: { increment: 1 } } });
  const read = privateFiles.read.bind(privateFiles);
  vi.spyOn(privateFiles, "read").mockImplementationOnce(async name => { const bytes = await read(name); await new Promise(resolve => setTimeout(resolve, 300)); return bytes; });
  await expect(downloadAuthorAssetUpload(ctx, first.id, randomUUID())).rejects.toMatchObject({ status: 410 });
  expect(await cleanupAuthorAssets()).toMatchObject({ deleted: 1, retry: 0 });
  await expect(init(pdf, key)).rejects.toMatchObject({ status: 410, code: "IDEMPOTENCY_EXPIRED" });
});
test("failed physical deletion keeps logical quota until a worker retries successfully", async () => {
  const first = await ready(); vi.spyOn(privateFiles, "remove").mockRejectedValueOnce(new Error("Injected delete outage"));
  await expect(discardAuthorAssetUpload(ctx, first.id, first.version, randomUUID())).rejects.toMatchObject({ status: 503, code: "AUTHOR_ASSET_DELETE_PENDING" });
  expect((await db.authorAsset.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("deleting");
  expect(await db.$transaction(tx => fileQuotaUsage(tx, ctx.tenantId))).toMatchObject({ usedBytes: pdf.length });
  expect(await cleanupAuthorAssets()).toMatchObject({ deleted: 1, retry: 0 });
  expect(await db.$transaction(tx => fileQuotaUsage(tx, ctx.tenantId))).toMatchObject({ usedBytes: 0 });
});
test("response files, business documents and author reservations share one quota total", async () => {
  await init();
  await db.fileObject.create({ data: { tenantId: ctx.tenantId, serviceId, ownerKind: "member", ownerId: ctx.user.id,
    nameCipher: "fixture-only", mime: "text/plain", size: 200, sha256: "a".repeat(64), storageKey: randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
  await db.companyBusinessFile.create({ data: { tenantId: ctx.tenantId, nameCipher: "fixture-only", size: 300, mime: "application/pdf", sha256: "b".repeat(64), storageKey: randomUUID(), scanEngine: "fixture-only", scannedAt: new Date() } });
  const used = pdf.length + 500;
  expect(await db.$transaction(tx => fileQuotaUsage(tx, ctx.tenantId))).toMatchObject({ usedBytes: used });
  await expect(db.$transaction(tx => reserveQuota(tx, ctx.tenantId, env.FILE_TENANT_QUOTA_BYTES - used + 1))).rejects.toMatchObject({ status: 409 });
  await expect(db.$transaction(tx => reserveQuota(tx, ctx.tenantId, env.FILE_TENANT_QUOTA_BYTES - used))).resolves.toMatchObject({ usedBytes: used });
});

test("idempotent init rechecks reservation expiry after delayed quota aggregation", async () => {
  const key = randomUUID(), asset = await init(pdf, key);
  await db.authorAsset.update({ where: { id: asset.id }, data: { expiresAt: new Date(Date.now() + 250), version: { increment: 1 } } });
  const original = quota.fileQuotaUsage;
  vi.spyOn(quota, "fileQuotaUsage").mockImplementationOnce(async (tx, tenantId) => {
    const result = await original(tx, tenantId); await new Promise(resolve => setTimeout(resolve, 300)); return result;
  });
  await expect(init(pdf, key)).rejects.toMatchObject({ status: 410, code: "AUTHOR_ASSET_EXPIRED" });
  expect(await db.authorAsset.count()).toBe(1);
});
