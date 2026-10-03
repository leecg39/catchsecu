import { randomInt } from "node:crypto";
import { z } from "zod";
import { Prisma, type Sender } from "@/generated/prisma/client";
import { normalizeSenderAddress, senderCreate, senderList, senderPatch, senderEvidenceInput, type SenderRecord } from "@/contracts/senders";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { decrypt, encrypt, opaqueToken, tokenHash } from "./crypto";
import { fail, requireVersion } from "./http";
import { audit } from "./audit";
import { idempotent } from "./idempotency";
import { assertFileDeadlines, fileInfo, lockFileContext } from "./file-access";
import { fileData, finishFileDeletion, reserveQuota } from "./files";
import { requireFileScanner } from "./file-scanner";
import { enqueueMail } from "./jobs";
import { senderDenial } from "./sender-access";
import { senderEmailDomain, senderEnvironment, verifySenderDns, verifySolapiSender } from "./sender-providers";
import { roleCan } from "./permissions";
import { cleanupMarketingLocalCopies } from "./marketing-jobs";

export const senderAddressHash = (channel: "email" | "sms", address: string) => tokenHash("sender:" + channel + ":" + normalizeSenderAddress(channel, address));
async function lockScope(tx: Transaction, ctx: Context, serviceId: string, write: boolean) {
  const deadlines = await lockFileContext(tx, ctx, serviceId, [write ? "sender.manage" : "sender.read"], !write);
  if (write) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"sender:" + ctx.tenantId + ":" + serviceId},0))`;
  const member = await tx.membership.findUniqueOrThrow({ where: { id: ctx.member.id }, include: { grants: true } });
  const service = await tx.service.findUniqueOrThrow({ where: { id: serviceId } });
  const canManage = service.status === "active" && roleCan(member.role, "sender.manage") &&
    (["owner", "admin"].includes(member.role) || member.grants.some(g => g.serviceId === serviceId && g.capabilities.includes("sender.manage")));
  assertFileDeadlines(deadlines);
  return { deadlines, canManage, serviceActive: service.status === "active" };
}
type SenderAccess = Awaited<ReturnType<typeof lockScope>>;
type LockedSender = Sender & { access: SenderAccess };
async function locate(tx: Transaction, ctx: Context, id: string, write = true): Promise<LockedSender> {
  const row = await tx.sender.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!row) fail(404, "NOT_FOUND", "발신자를 찾을 수 없습니다.");
  const access = await lockScope(tx, ctx, row.serviceId, write);
  if (write) await tx.$queryRaw`SELECT id FROM "Sender" WHERE id=${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Sender" WHERE id=${id} FOR SHARE`;
  const current = await tx.sender.findUniqueOrThrow({ where: { id } });
  assertFileDeadlines(access.deadlines);
  return { ...current, access };
}
async function event(tx: Transaction, ctx: Pick<Context, "user"> | null, row: Sender, kind: string) {
  await tx.senderEvent.create({ data: { tenantId: row.tenantId, senderId: row.id, version: row.version, kind, actorId: ctx?.user.id } });
}
async function change(tx: Transaction, ctx: Context | null, row: Sender & { access?: SenderAccess }, data: Prisma.SenderUpdateInput, kind: string, requestId: string) {
  const saved = await tx.sender.update({ where: { id: row.id }, data: { ...data, version: { increment: 1 } } });
  await event(tx, ctx, saved, kind);
  if (ctx) await audit(tx, ctx, requestId, "sender." + kind, "sender", row.id, Object.keys(data).filter(k => !/Cipher|Hash/.test(k)), row.serviceId);
  if (row.access) assertFileDeadlines(row.access.deadlines);
  return saved;
}
const actualStatus = (r: Sender) => r.status === "verified" && r.expiresAt! <= new Date() ? "expired" : r.status;
async function dto(tx: Transaction, r: Sender, access: SenderAccess, detail = false): Promise<SenderRecord> {
  const creator = await tx.user.findUniqueOrThrow({ where: { id: r.creatorId }, select: { name: true } });
  const proofs = detail ? await tx.senderVerification.findMany({ where: { senderId: r.id, generation: r.generation }, orderBy: { createdAt: "desc" }, take: 20 }) : [];
  const files = detail ? await tx.fileObject.findMany({ where: { senderId: r.id, status: { notIn: ["deleting", "deleted"] } }, orderBy: { createdAt: "desc" } }) : [];
  const events = detail ? await tx.senderEvent.findMany({ where: { senderId: r.id }, orderBy: { version: "desc" }, take: 100 }) : [];
  const proofIds = (await tx.senderVerification.findMany({ where: { senderId: r.id }, select: { id: true } })).map(p => p.id);
  const cleanupPending = !!(await tx.fileObject.count({ where: { senderId: r.id, status: "deleting" } }) +
    await tx.job.count({ where: { tenantId: r.tenantId, dedupeKey: { in: proofIds.map(id => "mail:sender-verification:" + id) }, payloadErasedAt: { not: null }, localCopyErasedAt: null } }));
  const denial = access.serviceActive ? senderDenial(r) : "보관된 서비스의 발신자입니다.", active = r.status !== "deleted";
  return { id: r.id, serviceId: r.serviceId, channel: r.channel as "email" | "sms", address: r.addressCipher ? decrypt<string>(r.addressCipher) : null, label: r.label, description: r.description, domain: r.domain,
    status: actualStatus(r), storedStatus: r.status, isDefault: r.isDefault, version: r.version, generation: r.generation, verifiedAt: r.verifiedAt?.toISOString() ?? null, expiresAt: r.expiresAt?.toISOString() ?? null,
    environment: r.environment as "live" | "local" | null, eligible: !denial, denial, creator: creator.name, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), cleanupPending,
    permissions: { canEdit: access.canManage && active, canVerify: access.canManage && r.status === "pending", canSetDefault: access.canManage && !denial && !r.isDefault,
      canDisable: access.canManage && active && r.status !== "disabled", canRenew: access.canManage && active, canDelete: access.canManage && active,
      canManageEvidence: access.canManage && active && r.channel === "sms", canCleanup: access.canManage && cleanupPending },
    ...(detail ? { verifications: proofs.map(v => ({ id: v.id, method: v.method, status: v.status === "pending" && v.expiresAt <= new Date() ? "expired" : v.status, attempts: v.attempts, expiresAt: v.expiresAt.toISOString(), verifiedAt: v.verifiedAt?.toISOString() ?? null, resultCode: v.resultCode,
      ...(access.canManage && v.method === "dns" && v.valueCipher && ["pending", "verified"].includes(v.status) && v.expiresAt > new Date() ? { recordName: "_catchsecu-sender." + r.domain, recordValue: decrypt<string>(v.valueCipher) } : {}) })),
      evidence: access.canManage ? files.filter(f => !f.expiresAt || f.expiresAt > new Date()).map(fileInfo) : [],
      events: events.map(e => ({ version: e.version, kind: e.kind, createdAt: e.createdAt.toISOString() })) } : {}) };
}
function addressData(channel: "email" | "sms", value: string) {
  const address = normalizeSenderAddress(channel, value);
  return { addressHash: senderAddressHash(channel, address), addressCipher: encrypt(address), domain: channel === "email" ? senderEmailDomain(address) : null };
}
export async function listSenders(ctx: Context, q: z.infer<typeof senderList>, requestId: string) {
  return db.$transaction(async tx => {
    const access = await lockScope(tx, ctx, q.serviceId, false);
    let hash: string | undefined; try { hash = senderAddressHash(q.channel, q.search); } catch { /* Names are also searchable. */ }
    const status: Prisma.SenderWhereInput = q.status === "all" ? { status: { not: "deleted" } } : q.status === "expired" ? { OR: [{ status: "expired" }, { status: "verified", expiresAt: { lte: new Date() } }] } : q.status === "verified" ? { status: "verified", expiresAt: { gt: new Date() } } : { status: q.status };
    const where: Prisma.SenderWhereInput = { tenantId: ctx.tenantId, serviceId: q.serviceId, channel: q.channel, AND: [status, ...(q.search ? [{ OR: [{ label: { contains: q.search, mode: "insensitive" as const } }, ...(hash ? [{ addressHash: hash }] : [])] }] : [])] };
    const total = await tx.sender.count({ where }), page = Math.min(q.page, Math.max(1, Math.ceil(total / q.pageSize)));
    const orderBy = [{ [q.sort]: q.direction }, { id: "asc" as const }];
    const ids = (await tx.sender.findMany({ where, select: { id: true }, orderBy, skip: (page - 1) * q.pageSize, take: q.pageSize })).map(r => r.id);
    for (const id of [...ids].sort()) await tx.$queryRaw`SELECT id FROM "Sender" WHERE id=${id} FOR SHARE`;
    const rows = await tx.sender.findMany({ where: { ...where, id: { in: ids } }, orderBy });
    await audit(tx, ctx, requestId, "sender.list_viewed", "sender", undefined, [], q.serviceId);
    const items = (await Promise.all(rows.map(r => dto(tx, r, access)))).map(finalRecord);
    assertFileDeadlines(access.deadlines);
    return { items, total, page, pageSize: q.pageSize, permissions: { canCreate: access.canManage } };
  });
}
function finalRecord(record: SenderRecord) {
  if (record.status === "verified" && record.expiresAt && new Date(record.expiresAt) <= new Date()) {
    record.status = "expired"; record.eligible = false; record.denial = "발신자 인증이 만료되었습니다."; record.permissions.canSetDefault = false;
  }
  for (const proof of record.verifications ?? []) if (new Date(proof.expiresAt) <= new Date()) {
    delete proof.recordName; delete proof.recordValue;
    if (proof.status === "pending") proof.status = "expired";
  }
  return record;
}
export async function readSender(ctx: Context, id: string, requestId: string) {
  return db.$transaction(async tx => { const row = await locate(tx, ctx, id, false); await audit(tx, ctx, requestId, "sender.viewed", "sender", id, [], row.serviceId);
    const result = await dto(tx, row, row.access, true); assertFileDeadlines(row.access.deadlines); return finalRecord(result); });
}
export async function createSender(ctx: Context, input: z.infer<typeof senderCreate>, key: string | null, requestId: string) {
  const address = addressData(input.channel, input.address);
  let access: SenderAccess;
  return idempotent("sender:create:" + ctx.member.id, key, input, async tx => {
    access = await lockScope(tx, ctx, input.serviceId, true);
    const row = await tx.sender.create({ data: { ...address, tenantId: ctx.tenantId, serviceId: input.serviceId, creatorId: ctx.user.id, channel: input.channel, label: input.label, description: input.description } });
    await event(tx, ctx, row, "created"); await audit(tx, ctx, requestId, "sender.created", "sender", row.id, [], row.serviceId);
    return { status: 201, body: { id: row.id, version: row.version } };
  }, async tx => { access = await lockScope(tx, ctx, input.serviceId, true); }, async (tx, cached) => {
    const row = await locate(tx, ctx, cached.id); live(row); access = row.access;
    return { id: row.id, version: row.version };
  }, async () => { assertFileDeadlines(access.deadlines); });
}
async function eraseChallengeMail(tx: Transaction, ids: string[]) {
  const jobs = await tx.job.findMany({ where: { dedupeKey: { in: ids.map(id => "mail:sender-verification:" + id) }, payloadErasedAt: null } });
  for (const job of jobs) {
    await tx.job.update({ where: { id: job.id }, data: { payloadCipher: encrypt({ erased: true }), payloadErasedAt: new Date(), status: job.status === "done" ? "done" : "cancelled", leaseOwner: null, leaseUntil: null, lastError: job.status === "done" ? null : "DATA_ERASED" } });
  }
}
export async function cleanupSenderCopies(tenantId: string, senderId: string, requestId: string) {
  const proofs = await db.senderVerification.findMany({ where: { tenantId, senderId }, select: { id: true } });
  const jobs = await db.job.findMany({ where: { tenantId, dedupeKey: { in: proofs.map(p => "mail:sender-verification:" + p.id) }, payloadErasedAt: { not: null }, localCopyErasedAt: null }, select: { id: true } });
  const mail = await cleanupMarketingLocalCopies({ tenantId, jobIds: jobs.map(j => j.id) });
  const files = await db.fileObject.findMany({ where: { tenantId, senderId, status: "deleting" }, select: { id: true } });
  const deleted = await Promise.allSettled(files.map(f => finishFileDeletion(f.id, requestId)));
  return { cleaned: mail.cleaned + deleted.filter(r => r.status === "fulfilled").length,
    pending: mail.pending + await db.fileObject.count({ where: { tenantId, senderId, status: "deleting" } }) };
}
export async function retrySenderCleanup(ctx: Context, id: string, version: number, requestId: string) {
  const row = await db.$transaction(async tx => {
    const current = await locate(tx, ctx, id); requireVersion({ version }, current);
    await audit(tx, ctx, requestId, "sender.cleanup_requested", "sender", id, [], current.serviceId);
    assertFileDeadlines(current.access.deadlines); return current;
  });
  const cleanup = await cleanupSenderCopies(ctx.tenantId, id, requestId);
  return { id, version: row.version, cleanupPending: cleanup.pending > 0 };
}
async function revokeProof(tx: Transaction, row: Sender) {
  const rows = await tx.senderVerification.findMany({ where: { senderId: row.id, status: { not: "superseded" } }, select: { id: true } });
  await tx.senderVerification.updateMany({ where: { id: { in: rows.map(r => r.id) } }, data: { status: "superseded", tokenHash: null, valueCipher: null } });
  await eraseChallengeMail(tx, rows.map(r => r.id));
}
const resetProof = { verifiedAt: null, expiresAt: null, environment: null, isDefault: false, generation: { increment: 1 } };
const live = (row: Sender) => { if (row.status === "deleted") fail(410, "SENDER_DELETED", "삭제된 발신자입니다."); };
export async function updateSender(ctx: Context, id: string, input: z.infer<typeof senderPatch>, requestId: string) {
  const result = await db.$transaction(async tx => {
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
  const cleanup = await cleanupSenderCopies(ctx.tenantId, id, requestId);
  return { ...result, cleanupPending: cleanup.pending > 0 };
}
export async function senderAction(ctx: Context, id: string, version: number, action: "default" | "disable" | "renew" | "delete", requestId: string) {
  const result = await db.$transaction(async tx => {
    const row = await locate(tx, ctx, id); requireVersion({ version }, row);
    if (action === "delete" && row.status === "deleted") { assertFileDeadlines(row.access.deadlines); return { row, files: [] as string[] }; }
    live(row);
    if (action === "default") {
      if (senderDenial(row)) fail(409, "SENDER_UNAVAILABLE", senderDenial(row)!);
      const previous = await tx.sender.findMany({ where: { tenantId: row.tenantId, serviceId: row.serviceId, channel: row.channel, isDefault: true, id: { not: id } } });
      for (const p of previous) await change(tx, ctx, p, { isDefault: false }, "default_changed", requestId);
      const saved = await change(tx, ctx, row, { isDefault: true }, "default_changed", requestId);
      if (senderDenial(saved)) fail(409, "SENDER_UNAVAILABLE", "발신자 인증이 만료되었습니다. 재인증해주세요.");
      return { row: saved, files: [] as string[] };
    }
    if (action === "delete" && await tx.job.count({ where: { senderId: id, status: { in: ["queued", "leased", "retry"] } } })) fail(409, "SENDER_IN_USE", "예약 또는 처리 중인 발송을 먼저 취소해주세요.");
    const files = action === "delete" ? await tx.fileObject.findMany({ where: { senderId: id, status: { notIn: ["deleted", "deleting"] } }, select: { id: true } }) : [];
    for (const f of files) await tx.fileObject.update({ where: { id: f.id }, data: { status: "deleting", version: { increment: 1 } } });
    await revokeProof(tx, row);
    const saved = await change(tx, ctx, row, { ...resetProof, status: action === "delete" ? "deleted" : action === "disable" ? "disabled" : "pending", ...(action === "delete" ? { addressCipher: null, domain: null, label: "", description: "" } : {}) }, action === "delete" ? "deleted" : action === "disable" ? "disabled" : "renewed", requestId);
    return { row: saved, files: files.map(f => f.id) };
  });
  const cleanup = await cleanupSenderCopies(ctx.tenantId, id, requestId);
  return { id, version: result.row.version, cleanupPending: cleanup.pending > 0 };
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
  const result = await db.$transaction(async tx => {
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
  const cleanup = await cleanupSenderCopies(ctx.tenantId, id, requestId);
  return { ...result, cleanupPending: cleanup.pending > 0 };
}
export async function confirmSenderEmail(ctx: Context, id: string, input: { version: number; verificationId: string; code: string }, requestId: string) {
  const result = await db.$transaction(async tx => {
    const row = await locate(tx, ctx, id); pending(row); requireVersion(input, row);
    const proof = await tx.senderVerification.findFirst({ where: { id: input.verificationId, senderId: id, method: "email", generation: row.generation } });
    assertFileDeadlines(row.access.deadlines);
    if (!proof || proof.status !== "pending" || proof.expiresAt <= new Date() || proof.attempts >= 5) return { error: true };
    if (proof.environment !== senderEnvironment()) fail(409, "VERIFICATION_ENVIRONMENT", "발송 환경이 변경되었습니다. 재인증을 시작해주세요.");
    const valid = proof.tokenHash === tokenHash("sender-code:" + id + ":" + input.code);
    await tx.senderVerification.update({ where: { id: proof.id }, data: { attempts: { increment: 1 }, ...(valid ? { status: "verified", tokenHash: null, verifiedAt: new Date(), validUntil: new Date(Date.now() + 90 * 86400000) } : proof.attempts === 4 ? { status: "failed", tokenHash: null, resultCode: "ATTEMPTS_EXHAUSTED" } : {}) } });
    if (!valid && proof.attempts === 4) await eraseChallengeMail(tx, [proof.id]);
    assertFileDeadlines(row.access.deadlines);
    if (!valid) return { error: true };
    await eraseChallengeMail(tx, [proof.id]);
    const saved = await change(tx, ctx, row, await finalize(tx, row), "email_confirmed", requestId);
    if (proof.expiresAt <= new Date()) fail(422, "VERIFICATION_INVALID", "인증번호가 만료되었습니다.");
    if (saved.status === "verified" && senderDenial(saved)) fail(409, "SENDER_UNAVAILABLE", "발신자 인증이 만료되었습니다. 재인증해주세요.");
    return { id, version: saved.version, error: false };
  });
  const cleanup = await cleanupSenderCopies(ctx.tenantId, id, requestId);
  if (result.error) fail(422, "VERIFICATION_INVALID", "인증번호가 틀렸거나 만료·소비되었습니다.");
  return { ...result, cleanupPending: cleanup.pending > 0 };
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
    assertFileDeadlines(row.access.deadlines); return { row, proof }; });
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
    if (initial.proof && initial.proof.expiresAt <= new Date()) fail(409, "VERIFICATION_CHANGED", "확인값이 만료되었습니다.");
    if (result.verified && result.expiresAt <= new Date()) fail(409, "VERIFICATION_CHANGED", "공급자 인증이 만료되었습니다.");
    if (saved.status === "verified" && senderDenial(saved)) fail(409, "SENDER_UNAVAILABLE", "현재 발송 환경과 인증 기한을 확인해주세요.");
    return { id, version: saved.version, verified: result.verified, status: saved.status };
  });
}
export async function initSenderEvidence(ctx: Context, id: string, input: z.infer<typeof senderEvidenceInput>, key: string | null, requestId: string) {
  await requireFileScanner();
  let access: SenderAccess;
  let uploadExpiresAt: Date | null = null;
  return idempotent("sender:evidence:" + ctx.member.id + ":" + id, key, input, async tx => {
    await reserveQuota(tx, ctx.tenantId, input.size);
    const row = await locate(tx, ctx, id); access = row.access; live(row); requireVersion(input, row);
    if (row.channel !== "sms") fail(422, "CHANNEL", "발신번호의 증빙만 첨부할 수 있습니다.");
    if (await tx.fileObject.count({ where: { senderId: id, status: { notIn: ["deleting", "deleted"] } } }) >= 5) fail(409, "EVIDENCE_LIMIT", "증빙은 최대 5개입니다.");
    const file = await tx.fileObject.create({ data: { ...fileData(input), tenantId: row.tenantId, serviceId: row.serviceId, senderId: id, ownerId: ctx.user.id, ownerKind: "sender" } });
    uploadExpiresAt = file.expiresAt;
    await audit(tx, ctx, requestId, "sender.evidence_initialized", "sender", id, [], row.serviceId);
    return { status: 201, body: fileInfo(file), resource: { tenantId: ctx.tenantId, resourceType: "file", resourceId: file.id } };
  }, async tx => { const row = await locate(tx, ctx, id); access = row.access; live(row); }, async (tx, cached) => {
    const file = await tx.fileObject.findFirst({ where: { id: cached.id, tenantId: ctx.tenantId, senderId: id, ownerId: ctx.user.id } });
    if (!file || !file.expiresAt || file.expiresAt <= new Date()) fail(410, "UPLOAD_EXPIRED", "업로드 시간이 만료되었습니다.");
    uploadExpiresAt = file.expiresAt;
    return fileInfo(file);
  }, async () => { assertFileDeadlines(access.deadlines); if (!uploadExpiresAt || uploadExpiresAt <= new Date()) fail(410, "UPLOAD_EXPIRED", "업로드 시간이 만료되었습니다."); });
}
export async function changeSenderEvidence(ctx: Context, id: string, fileId: string, version: number, remove: boolean, requestId: string) {
  const saved = await db.$transaction(async tx => {
    const row = await locate(tx, ctx, id); live(row); requireVersion({ version }, row);
    await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id=${fileId} FOR UPDATE`;
    const file = await tx.fileObject.findFirst({ where: { id: fileId, senderId: id, tenantId: ctx.tenantId, serviceId: row.serviceId, ownerKind: "sender" } });
    if (!file) fail(404, "NOT_FOUND", "연결된 증빙을 찾을 수 없습니다.");
    if (remove) { if (["deleting", "deleted"].includes(file.status)) { assertFileDeadlines(row.access.deadlines); return row; } await tx.fileObject.update({ where: { id: fileId }, data: { status: "deleting", version: { increment: 1 } } }); }
    else { if (file.ownerId !== ctx.user.id || file.status !== "ready" || file.scanStatus !== "clean" || !file.expiresAt || file.expiresAt <= new Date()) fail(409, "FILE_NOT_READY", "본인이 업로드하고 검사를 마친 증빙을 선택해주세요.");
      await tx.fileObject.update({ where: { id: fileId }, data: { status: "attached", expiresAt: null, version: { increment: 1 } } }); }
    const changed = await change(tx, ctx, row, {}, remove ? "evidence_removed" : "evidence_attached", requestId);
    if (!remove && file.expiresAt! <= new Date()) fail(410, "UPLOAD_EXPIRED", "증빙 연결 전에 업로드 시간이 만료되었습니다.");
    return changed;
  });
  const cleanup = await cleanupSenderCopies(ctx.tenantId, id, requestId);
  return { id, version: saved.version, cleanupPending: cleanup.pending > 0 };
}
export async function cleanupSenderVerificationMail() {
  const dnsRows = await db.senderVerification.findMany({ where: { method: "dns", expiresAt: { lte: new Date() }, OR: [{ valueCipher: { not: null } }, { tokenHash: { not: null } }] }, select: { id: true, senderId: true }, take: 100 });
  for (const dns of dnsRows) await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Sender" WHERE id=${dns.senderId} FOR UPDATE`;
    const proof = await tx.senderVerification.findUniqueOrThrow({ where: { id: dns.id } });
    if (proof.expiresAt > new Date()) return;
    await tx.senderVerification.update({ where: { id: proof.id }, data: { valueCipher: null, tokenHash: null,
      ...(proof.status === "pending" ? { status: "failed", resultCode: "EXPIRED" } : {}) } });
  });
  const rows = await db.$queryRaw<{ senderId: string }[]>`SELECT DISTINCT v."senderId" FROM "SenderVerification" v
    JOIN "Job" j ON j."dedupeKey"='mail:sender-verification:' || v.id
    WHERE v.method='email' AND (v."expiresAt" <= ${new Date()} OR v.status <> 'pending')
      AND (j."payloadErasedAt" IS NULL OR j."localCopyErasedAt" IS NULL) LIMIT 100`;
  for (const { senderId } of rows) {
    const tenantId = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Sender" WHERE id=${senderId} FOR UPDATE`;
    const expired = await tx.senderVerification.findMany({ where: { senderId, method: "email", OR: [{ expiresAt: { lte: new Date() } }, { status: { not: "pending" } }] } });
    await eraseChallengeMail(tx, expired.map(p => p.id));
    for (const p of expired) if (p.status === "pending") await tx.senderVerification.update({ where: { id: p.id }, data: { status: "failed", tokenHash: null, resultCode: "EXPIRED" } });
    return (await tx.sender.findUniqueOrThrow({ where: { id: senderId }, select: { tenantId: true } })).tenantId;
    });
    await cleanupSenderCopies(tenantId, senderId, "sender-expiry");
  }
}
