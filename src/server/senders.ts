import { randomInt } from "node:crypto";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { Prisma, type Sender } from "@/generated/prisma/client";
import { normalizeSenderAddress, senderCreate, senderList, senderPatch, senderEvidenceInput, type SenderRecord } from "@/contracts/senders";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { decrypt, encrypt, opaqueToken, tokenHash } from "./crypto";
import { env } from "./env";
import { fail, requireVersion } from "./http";
import { audit } from "./audit";
import { idempotent } from "./idempotency";
import { fileInfo, lockFileContext } from "./file-access";
import { fileData, finishFileDeletion, reserveQuota } from "./files";
import { requireFileScanner } from "./file-scanner";
import { enqueueMail } from "./jobs";
import { senderDenial } from "./sender-access";
import { senderEmailDomain, senderEnvironment, verifySenderDns, verifySolapiSender } from "./sender-providers";

export const senderAddressHash = (channel: "email" | "sms", address: string) => tokenHash("sender:" + channel + ":" + normalizeSenderAddress(channel, address));
async function lockScope(tx: Transaction, ctx: Context, serviceId: string, write: boolean) {
  await lockFileContext(tx, ctx, serviceId, [write ? "sender.manage" : "sender.read"], !write);
  if (write) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"sender:" + ctx.tenantId + ":" + serviceId},0))`;
}
async function locate(tx: Transaction, ctx: Context, id: string, write = true) {
  const row = await tx.sender.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!row) fail(404, "NOT_FOUND", "발신자를 찾을 수 없습니다.");
  await lockScope(tx, ctx, row.serviceId, write);
  if (write) await tx.$queryRaw`SELECT id FROM "Sender" WHERE id=${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Sender" WHERE id=${id} FOR SHARE`;
  return tx.sender.findUniqueOrThrow({ where: { id } });
}
async function event(tx: Transaction, ctx: Pick<Context, "user"> | null, row: Sender, kind: string) {
  await tx.senderEvent.create({ data: { tenantId: row.tenantId, senderId: row.id, version: row.version, kind, actorId: ctx?.user.id } });
}
async function change(tx: Transaction, ctx: Context | null, row: Sender, data: Prisma.SenderUpdateInput, kind: string, requestId: string) {
  const saved = await tx.sender.update({ where: { id: row.id }, data: { ...data, version: { increment: 1 } } });
  await event(tx, ctx, saved, kind);
  if (ctx) await audit(tx, ctx, requestId, "sender." + kind, "sender", row.id, Object.keys(data).filter(k => !/Cipher|Hash/.test(k)), row.serviceId);
  return saved;
}
const actualStatus = (r: Sender) => r.status === "verified" && r.expiresAt! <= new Date() ? "expired" : r.status;
async function dto(tx: Transaction, r: Sender, detail = false): Promise<SenderRecord> {
  const denial = senderDenial(r), creator = await tx.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: r.tenantId, userId: r.creatorId } }, select: { user: { select: { name: true } } } });
  return { id: r.id, serviceId: r.serviceId, channel: r.channel as "email" | "sms", address: r.addressCipher ? decrypt<string>(r.addressCipher) : null, label: r.label, description: r.description, domain: r.domain,
    status: actualStatus(r), storedStatus: r.status, isDefault: r.isDefault, version: r.version, generation: r.generation, verifiedAt: r.verifiedAt?.toISOString() ?? null, expiresAt: r.expiresAt?.toISOString() ?? null,
    environment: r.environment as "live" | "local" | null, eligible: !denial, denial, creator: creator.user.name, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    ...(detail ? { verifications: (await tx.senderVerification.findMany({ where: { senderId: r.id, generation: r.generation }, orderBy: { createdAt: "desc" }, take: 20 })).map(v => ({ id: v.id, method: v.method, status: v.status, attempts: v.attempts, expiresAt: v.expiresAt.toISOString(), verifiedAt: v.verifiedAt?.toISOString() ?? null, resultCode: v.resultCode,
      ...(v.method === "dns" && v.valueCipher && v.status !== "superseded" ? { recordName: "_catchsecu-sender." + r.domain, recordValue: decrypt<string>(v.valueCipher) } : {}) })),
      evidence: (await tx.fileObject.findMany({ where: { senderId: r.id, status: { notIn: ["deleting", "deleted"] } }, orderBy: { createdAt: "desc" } })).map(fileInfo),
      events: (await tx.senderEvent.findMany({ where: { senderId: r.id }, orderBy: { version: "desc" }, take: 100 })).map(e => ({ version: e.version, kind: e.kind, createdAt: e.createdAt.toISOString() })) } : {}) };
}
function addressData(channel: "email" | "sms", value: string) {
  const address = normalizeSenderAddress(channel, value);
  return { addressHash: senderAddressHash(channel, address), addressCipher: encrypt(address), domain: channel === "email" ? senderEmailDomain(address) : null };
}
export async function listSenders(ctx: Context, q: z.infer<typeof senderList>, requestId: string) {
  return db.$transaction(async tx => {
    await lockScope(tx, ctx, q.serviceId, false);
    let hash: string | undefined; try { hash = senderAddressHash(q.channel, q.search); } catch { /* Names are also searchable. */ }
    const status: Prisma.SenderWhereInput = q.status === "all" ? { status: { not: "deleted" } } : q.status === "expired" ? { OR: [{ status: "expired" }, { status: "verified", expiresAt: { lte: new Date() } }] } : q.status === "verified" ? { status: "verified", expiresAt: { gt: new Date() } } : { status: q.status };
    const where: Prisma.SenderWhereInput = { tenantId: ctx.tenantId, serviceId: q.serviceId, channel: q.channel, AND: [status, ...(q.search ? [{ OR: [{ label: { contains: q.search, mode: "insensitive" as const } }, ...(hash ? [{ addressHash: hash }] : [])] }] : [])] };
    const rows = await tx.sender.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize });
    await audit(tx, ctx, requestId, "sender.list_viewed", "sender", undefined, [], q.serviceId);
    return { items: await Promise.all(rows.map(r => dto(tx, r))), total: await tx.sender.count({ where }), page: q.page, pageSize: q.pageSize };
  });
}
export async function readSender(ctx: Context, id: string, requestId: string) {
  return db.$transaction(async tx => { const row = await locate(tx, ctx, id, false); await audit(tx, ctx, requestId, "sender.viewed", "sender", id, [], row.serviceId); return dto(tx, row, true); });
}
export async function createSender(ctx: Context, input: z.infer<typeof senderCreate>, key: string | null, requestId: string) {
  const address = addressData(input.channel, input.address);
  return idempotent("sender:create:" + ctx.member.id, key, input, async tx => {
    await lockScope(tx, ctx, input.serviceId, true);
    const row = await tx.sender.create({ data: { ...address, tenantId: ctx.tenantId, serviceId: input.serviceId, creatorId: ctx.user.id, channel: input.channel, label: input.label, description: input.description } });
    await event(tx, ctx, row, "created"); await audit(tx, ctx, requestId, "sender.created", "sender", row.id, [], row.serviceId);
    return { status: 201, body: { id: row.id, version: row.version } };
  }, tx => lockScope(tx, ctx, input.serviceId, true));
}
async function eraseChallengeMail(tx: Transaction, ids: string[]) {
  const jobs = await tx.job.findMany({ where: { dedupeKey: { in: ids.map(id => "mail:sender-verification:" + id) }, payloadErasedAt: null } });
  for (const job of jobs) {
    try { await unlink(resolve(env.LOCAL_MAIL_DIR, job.id + ".json")); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    await tx.job.update({ where: { id: job.id }, data: { payloadCipher: encrypt({ erased: true }), payloadErasedAt: new Date(), status: job.status === "done" ? "done" : "cancelled", leaseOwner: null, leaseUntil: null, lastError: job.status === "done" ? null : "DATA_ERASED" } });
  }
}
async function revokeProof(tx: Transaction, row: Sender) {
  const rows = await tx.senderVerification.findMany({ where: { senderId: row.id, status: { not: "superseded" } }, select: { id: true } });
  await tx.senderVerification.updateMany({ where: { id: { in: rows.map(r => r.id) } }, data: { status: "superseded", tokenHash: null, valueCipher: null } });
  await eraseChallengeMail(tx, rows.map(r => r.id));
}
const resetProof = { verifiedAt: null, expiresAt: null, environment: null, isDefault: false, generation: { increment: 1 } };
const live = (row: Sender) => { if (row.status === "deleted") fail(410, "SENDER_DELETED", "삭제된 발신자입니다."); };
export async function updateSender(ctx: Context, id: string, input: z.infer<typeof senderPatch>, requestId: string) {
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id); live(row); requireVersion(input, row);
    const changedAddress = senderAddressHash(row.channel as "email" | "sms", input.address) !== row.addressHash;
    if (changedAddress) {
      if (await tx.job.count({ where: { senderId: id, status: { in: ["queued", "leased", "retry"] } } })) fail(409, "SENDER_IN_USE", "예약 발송을 먼저 취소해주세요.");
      if (await tx.fileObject.count({ where: { senderId: id, status: { not: "deleted" } } })) fail(409, "SENDER_EVIDENCE_EXISTS", "번호를 변경하기 전에 기존 증빙 파일을 삭제해주세요.");
      await revokeProof(tx, row);
    }
    const saved = await change(tx, ctx, row, { label: input.label, description: input.description, ...(changedAddress ? { ...addressData(row.channel as "email" | "sms", input.address), ...resetProof, status: "pending" } : {}) }, changedAddress ? "address_changed" : "updated", requestId);
    return { id, version: saved.version };
  });
}
export async function senderAction(ctx: Context, id: string, version: number, action: "default" | "disable" | "renew" | "delete", requestId: string) {
  const result = await db.$transaction(async tx => {
    const row = await locate(tx, ctx, id); live(row); requireVersion({ version }, row);
    if (action === "default") {
      if (senderDenial(row)) fail(409, "SENDER_UNAVAILABLE", senderDenial(row)!);
      const previous = await tx.sender.findMany({ where: { tenantId: row.tenantId, serviceId: row.serviceId, channel: row.channel, isDefault: true, id: { not: id } } });
      for (const p of previous) await change(tx, ctx, p, { isDefault: false }, "default_changed", requestId);
      return { row: await change(tx, ctx, row, { isDefault: true }, "default_changed", requestId), files: [] as string[] };
    }
    if (action === "delete" && await tx.job.count({ where: { senderId: id, status: { in: ["queued", "leased", "retry"] } } })) fail(409, "SENDER_IN_USE", "예약 또는 처리 중인 발송을 먼저 취소해주세요.");
    const files = action === "delete" ? await tx.fileObject.findMany({ where: { senderId: id, status: { notIn: ["deleted", "deleting"] } }, select: { id: true } }) : [];
    for (const f of files) await tx.fileObject.update({ where: { id: f.id }, data: { status: "deleting", version: { increment: 1 } } });
    await revokeProof(tx, row);
    const saved = await change(tx, ctx, row, { ...resetProof, status: action === "delete" ? "deleted" : action === "disable" ? "disabled" : "pending", ...(action === "delete" ? { addressCipher: null, domain: null, label: "", description: "" } : {}) }, action === "delete" ? "deleted" : action === "disable" ? "disabled" : "renewed", requestId);
    return { row: saved, files: files.map(f => f.id) };
  });
  const deletion = await Promise.allSettled(result.files.map(id => finishFileDeletion(id, requestId)));
  return { id, version: result.row.version, cleanupPending: deletion.some(r => r.status === "rejected") };
}
async function finalize(tx: Transaction, row: Sender) {
  const needed = row.channel === "email" ? ["email", "dns"] : ["solapi"];
  const proofs = await tx.senderVerification.findMany({ where: { senderId: row.id, generation: row.generation, method: { in: needed }, status: "verified", validUntil: { gt: new Date() } }, orderBy: { verifiedAt: "desc" } });
  const matched = needed.map(method => proofs.find(p => p.method === method));
  if (matched.some(p => !p) || new Set(matched.map(p => p?.environment)).size !== 1) return {};
  return { status: "verified", environment: matched[0]!.environment, verifiedAt: new Date(), expiresAt: new Date(Math.min(...matched.map(p => p!.validUntil!.getTime()))) };
}
const pending = (row: Sender) => { live(row); if (row.status !== "pending") fail(409, "SENDER_RENEW_REQUIRED", "재인증을 시작한 후 확인해주세요."); };
export async function startEmailVerification(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id); pending(row); requireVersion({ version }, row); if (row.channel !== "email") fail(422, "CHANNEL", "이메일 발신자를 선택해주세요.");
    const previous = await tx.senderVerification.findFirst({ where: { senderId: id, method: "email", generation: row.generation }, orderBy: { createdAt: "desc" } });
    if (previous && Date.now() - previous.createdAt.getTime() < 60000) fail(429, "VERIFICATION_COOLDOWN", "인증 요청 후 1분 뒤에 다시 요청해주세요.");
    const old = await tx.senderVerification.findMany({ where: { senderId: id, method: "email", status: { not: "superseded" } }, select: { id: true } });
    await tx.senderVerification.updateMany({ where: { id: { in: old.map(v => v.id) } }, data: { status: "superseded", tokenHash: null } }); await eraseChallengeMail(tx, old.map(v => v.id));
    const code = String(randomInt(100000, 1000000)), expiresAt = new Date(Date.now() + 600000);
    const verification = await tx.senderVerification.create({ data: { tenantId: row.tenantId, senderId: id, generation: row.generation, method: "email", tokenHash: tokenHash("sender-code:" + id + ":" + code), expiresAt, environment: senderEnvironment() } });
    await enqueueMail({ to: decrypt<string>(row.addressCipher!), subject: "캐치시큐 발신 주소 인증", text: `발신 주소 인증번호: ${code}\n10분 안에 인증번호를 입력해주세요. 요청하지 않았다면 입력하지 마세요.` }, "sender-verification:" + verification.id, tx, row.tenantId);
    const saved = await change(tx, ctx, row, {}, "email_requested", requestId); return { id: verification.id, expiresAt, version: saved.version };
  });
}
export async function confirmSenderEmail(ctx: Context, id: string, input: { version: number; verificationId: string; code: string }, requestId: string) {
  const result = await db.$transaction(async tx => {
    const row = await locate(tx, ctx, id); pending(row); requireVersion(input, row);
    const proof = await tx.senderVerification.findFirst({ where: { id: input.verificationId, senderId: id, method: "email", generation: row.generation } });
    if (!proof || proof.status !== "pending" || proof.expiresAt <= new Date() || proof.attempts >= 5) return { error: true };
    if (proof.environment !== senderEnvironment()) fail(409, "VERIFICATION_ENVIRONMENT", "발송 환경이 변경되었습니다. 재인증을 시작해주세요.");
    const valid = proof.tokenHash === tokenHash("sender-code:" + id + ":" + input.code);
    await tx.senderVerification.update({ where: { id: proof.id }, data: { attempts: { increment: 1 }, ...(valid ? { status: "verified", tokenHash: null, verifiedAt: new Date(), validUntil: new Date(Date.now() + 90 * 86400000) } : proof.attempts === 4 ? { status: "failed", tokenHash: null, resultCode: "ATTEMPTS_EXHAUSTED" } : {}) } });
    if (!valid) return { error: true };
    await eraseChallengeMail(tx, [proof.id]);
    const saved = await change(tx, ctx, row, await finalize(tx, row), "email_confirmed", requestId); return { id, version: saved.version, error: false };
  });
  if (result.error) fail(422, "VERIFICATION_INVALID", "인증번호가 틀렸거나 만료·소비되었습니다."); return result;
}
export async function startDnsVerification(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id); pending(row); requireVersion({ version }, row); if (row.channel !== "email") fail(422, "CHANNEL", "이메일 발신자를 선택해주세요.");
    await tx.senderVerification.updateMany({ where: { senderId: id, method: "dns", status: { not: "superseded" } }, data: { status: "superseded", tokenHash: null, valueCipher: null } });
    const value = "catchsecu-sender=" + opaqueToken();
    await tx.senderVerification.create({ data: { tenantId: row.tenantId, senderId: id, generation: row.generation, method: "dns", tokenHash: tokenHash(value), valueCipher: encrypt(value), expiresAt: new Date(Date.now() + 86400000), environment: senderEnvironment() } });
    const saved = await change(tx, ctx, row, {}, "dns_requested", requestId); return { id, version: saved.version };
  });
}
export async function checkSenderProof(ctx: Context, id: string, version: number, requestId: string) {
  // Network calls run outside locks. Commit rechecks scope, generation, version and challenge.
  const initial = await db.$transaction(async tx => { const row = await locate(tx, ctx, id); pending(row); requireVersion({ version }, row);
    const proof = row.channel === "email" ? await tx.senderVerification.findFirst({ where: { senderId: id, generation: row.generation, method: "dns", status: "pending", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }) : null;
    if (row.channel === "email" && !proof?.valueCipher) fail(409, "DNS_CHALLENGE_REQUIRED", "DNS 확인값을 먼저 발급해주세요.");
    if (proof && proof.environment !== senderEnvironment()) fail(409, "VERIFICATION_ENVIRONMENT", "발송 환경이 변경되었습니다. 재인증을 시작해주세요.");
    return { row, proof }; });
  const result = initial.row.channel === "email" ? { verified: await verifySenderDns(initial.row.domain!, decrypt<string>(initial.proof!.valueCipher!)), expiresAt: new Date(Date.now() + 90 * 86400000), reference: "dns", code: "DNS_NOT_FOUND" } : await verifySolapiSender(ctx.tenantId, decrypt<string>(initial.row.addressCipher!));
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id); pending(row); requireVersion({ version }, row);
    const data = { tenantId: row.tenantId, senderId: id, generation: row.generation, method: row.channel === "email" ? "dns" : "solapi", environment: row.channel === "email" ? senderEnvironment() : "live",
      ...(result.verified ? { status: "verified", verifiedAt: new Date(), validUntil: result.expiresAt, resultCode: "VERIFIED", providerRefHash: tokenHash(result.reference) } : { resultCode: row.channel === "email" ? "DNS_NOT_FOUND" : result.code }) };
    if (initial.proof) {
      const proof = await tx.senderVerification.findUniqueOrThrow({ where: { id: initial.proof.id } });
      if (proof.status !== "pending" || proof.expiresAt <= new Date() || proof.generation !== row.generation) fail(409, "VERIFICATION_CHANGED", "확인값이 변경되거나 만료되었습니다.");
      await tx.senderVerification.update({ where: { id: proof.id }, data });
    } else await tx.senderVerification.create({ data: { ...data, status: result.verified ? "verified" : "failed", expiresAt: new Date(Date.now() + 600000) } });
    const saved = await change(tx, ctx, row, await finalize(tx, row), row.channel === "email" ? "dns_checked" : "provider_checked", requestId);
    return { id, version: saved.version, verified: result.verified, status: saved.status };
  });
}
export async function initSenderEvidence(ctx: Context, id: string, input: z.infer<typeof senderEvidenceInput>, key: string | null, requestId: string) {
  await requireFileScanner();
  return idempotent("sender:evidence:" + ctx.member.id + ":" + id, key, input, async tx => {
    await reserveQuota(tx, ctx.tenantId, input.size);
    const row = await locate(tx, ctx, id); live(row); requireVersion(input, row);
    if (row.channel !== "sms") fail(422, "CHANNEL", "발신번호의 증빙만 첨부할 수 있습니다.");
    if (await tx.fileObject.count({ where: { senderId: id, status: { notIn: ["deleting", "deleted"] } } }) >= 5) fail(409, "EVIDENCE_LIMIT", "증빙은 최대 5개입니다.");
    const file = await tx.fileObject.create({ data: { ...fileData(input), tenantId: row.tenantId, serviceId: row.serviceId, senderId: id, ownerId: ctx.user.id, ownerKind: "sender" } });
    await audit(tx, ctx, requestId, "sender.evidence_initialized", "sender", id, [], row.serviceId);
    return { status: 201, body: fileInfo(file), resource: { tenantId: ctx.tenantId, resourceType: "file", resourceId: file.id } };
  }, async tx => { const row = await locate(tx, ctx, id); live(row); });
}
export async function changeSenderEvidence(ctx: Context, id: string, fileId: string, version: number, remove: boolean, requestId: string) {
  const saved = await db.$transaction(async tx => {
    const row = await locate(tx, ctx, id); live(row); requireVersion({ version }, row);
    await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id=${fileId} FOR UPDATE`;
    const file = await tx.fileObject.findFirst({ where: { id: fileId, senderId: id, tenantId: ctx.tenantId, serviceId: row.serviceId, ownerKind: "sender" } });
    if (!file) fail(404, "NOT_FOUND", "연결된 증빙을 찾을 수 없습니다.");
    if (remove) { if (["deleting", "deleted"].includes(file.status)) fail(409, "FILE_DELETED", "이미 삭제 요청한 파일입니다."); await tx.fileObject.update({ where: { id: fileId }, data: { status: "deleting", version: { increment: 1 } } }); }
    else { if (file.ownerId !== ctx.user.id || file.status !== "ready" || file.scanStatus !== "clean" || !file.expiresAt || file.expiresAt <= new Date()) fail(409, "FILE_NOT_READY", "본인이 업로드하고 검사를 마친 증빙을 선택해주세요.");
      await tx.fileObject.update({ where: { id: fileId }, data: { status: "attached", expiresAt: null, version: { increment: 1 } } }); }
    return change(tx, ctx, row, {}, remove ? "evidence_removed" : "evidence_attached", requestId);
  });
  let cleanupPending = false; if (remove) try { await finishFileDeletion(fileId, requestId); } catch { cleanupPending = true; }
  return { id, version: saved.version, cleanupPending };
}
export async function cleanupSenderVerificationMail() {
  const rows = await db.$queryRaw<{ senderId: string }[]>`SELECT DISTINCT v."senderId" FROM "SenderVerification" v
    JOIN "Job" j ON j."dedupeKey"='mail:sender-verification:' || v.id
    WHERE v.method='email' AND v."expiresAt" < ${new Date()} AND j."payloadErasedAt" IS NULL LIMIT 100`;
  for (const { senderId } of rows) await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Sender" WHERE id=${senderId} FOR UPDATE`;
    const expired = await tx.senderVerification.findMany({ where: { senderId, method: "email", expiresAt: { lt: new Date() } } });
    await eraseChallengeMail(tx, expired.map(p => p.id));
    for (const p of expired) if (p.status === "pending") await tx.senderVerification.update({ where: { id: p.id }, data: { status: "failed", tokenHash: null, resultCode: "EXPIRED" } });
  });
}
