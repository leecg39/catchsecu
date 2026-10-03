import { eraseMarketingJobs } from "./marketing-jobs";
import { z } from "zod";
import { Prisma, type MarketingPreference } from "@/generated/prisma/client";
import { marketingConfig, marketingCreate, marketingList, normalizeMarketingContact, normalizeMarketingName,
  type MarketingChannel, type MarketingConfig, type MarketingRecord, type MarketingSummaryQuery, type MarketingSummary } from "@/contracts/marketing";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { audit } from "./audit";
import { fail, requireVersion } from "./http";
import { lockFileContext } from "./file-access";
import { documentScope } from "./documents";
import { analyticsPeriod } from "./analytics-period";

export function marketingContactHash(channel: MarketingChannel, contact: string) {
  return tokenHash((channel === "email" ? "subject:email:" : "marketing:sms:") + normalizeMarketingContact(channel, contact));
}
const nameHash = (name: string) => tokenHash("subject:name:" + normalizeMarketingName(name));
export async function lockMarketingContact(tx: Transaction, row: Pick<MarketingPreference, "tenantId" | "serviceId" | "channel" | "contactHash">) {
  await tx.$executeRaw`SELECT marketing_delivery_lock(${row.tenantId},${row.serviceId},${row.channel},${row.contactHash})`;
}
const include = { sourceSubmission: { include: { formVersion: { include: { form: { include: { service: true } } } } } } };
type Stored = Prisma.MarketingPreferenceGetPayload<{ include: typeof include }>;
const sourceAvailable = (s: Stored["sourceSubmission"]) => ["submitted", "corrected", "withdrawn"].includes(s.status) && s.retentionUntil > new Date();
export async function marketingDenial(tx: Transaction, row: Stored) {
  if (row.channel === "email" && await tx.emailSuppression.count({ where: { tenantId: row.tenantId, serviceId: row.serviceId, contactHash: row.contactHash } })) return "이메일 반송·신고·수신거부에 따른 발송 차단";
  if (row.status !== "granted") return row.status === "erased" ? "삭제된 동의" : "동의 철회";
  if (row.excluded) return "발송 제외";
  if (!sourceAvailable(row.sourceSubmission) || !["submitted", "corrected"].includes(row.sourceSubmission.status)) return "원본 응답 사용 종료";
  if (row.sourceSubmission.formVersion.form.service.status !== "active") return "보관된 서비스";
  if (row.channel === "email" && await tx.suppression.count({ where: { tenantId: row.tenantId, serviceId: row.serviceId, channel: "email", emailHash: row.contactHash } })) return "정보주체 철회에 따른 발송 차단";
  return null;
}
async function dto(tx: Transaction, row: Stored, detail = false): Promise<MarketingRecord> {
  const available = sourceAvailable(row.sourceSubmission) && row.status !== "erased";
  const contact = available && row.contactCipher ? decrypt<{ name: string; contact: string }>(row.contactCipher) : null;
  const denial = await marketingDenial(tx, row);
  return { id: row.id, serviceId: row.serviceId, version: row.version, channel: row.channel as MarketingChannel, name: contact?.name ?? null, contact: contact?.contact ?? null,
    status: row.status as MarketingRecord["status"], excluded: row.excluded, grantedAt: row.grantedAt.toISOString(), withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
    sourceSubmissionId: row.sourceSubmissionId, sourceTitle: row.sourceSubmission.formVersion.title, sourceKind: row.sourceKind,
    retentionUntil: row.sourceSubmission.retentionUntil.toISOString(), available, eligible: !denial, denial,
    ...(detail ? { evidence: available && row.evidenceCipher ? decrypt<NonNullable<MarketingRecord["evidence"]>>(row.evidenceCipher) : null,
      events: (await tx.marketingEvent.findMany({ where: { preferenceId: row.id }, orderBy: { version: "desc" }, take: 100 })).map(e => ({ id: e.id, kind: e.kind, version: e.version, createdAt: e.createdAt.toISOString() })) } : {}) };
}
async function event(tx: Transaction, row: MarketingPreference, kind: string, actorId?: string) {
  await tx.marketingEvent.create({ data: { tenantId: row.tenantId, preferenceId: row.id, version: row.version, kind, actorId,
    ...(kind === "granted" || kind === "reconsented" ? { evidenceHash: row.evidenceHash } : {}) } });
}
async function lockSources(tx: Transaction, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${id} FOR SHARE`;
}
function queryWhere(tenantId: string, q: z.infer<typeof marketingList>): Prisma.MarketingPreferenceWhereInput {
  const search: Prisma.MarketingPreferenceWhereInput[] = [];
  if (q.search) {
    try { search.push({ nameHash: nameHash(q.search) }); } catch { /* An email may exceed the name limit. */ }
    for (const channel of ["email", "sms"] as const) try { search.push({ channel, contactHash: marketingContactHash(channel, q.search) }); } catch { /* Search only valid normalized identities. */ }
  }
  return { tenantId, serviceId: q.serviceId, ...(q.channel ? { channel: q.channel } : {}), ...(q.status ? { status: q.status } : {}),
    ...(q.excluded ? { excluded: q.excluded === "true" } : {}), ...(q.search ? { OR: search.length ? search : [{ id: "no-match" }] } : {}) };
}
export async function listMarketing(ctx: Context, q: z.infer<typeof marketingList>, requestId: string, exporting = false) {
  return db.$transaction(async tx => {
    await lockFileContext(tx, ctx, q.serviceId, ["marketing.read"], true);
    const where = queryWhere(ctx.tenantId, q), total = await tx.marketingPreference.count({ where });
    if (exporting && total > 5000) fail(422, "EXPORT_LIMIT", "검색 조건을 좁혀 5,000개 이하로 내보내주세요.");
    const ids = await tx.marketingPreference.findMany({ where, select: { id: true, sourceSubmissionId: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: exporting ? 5000 : q.pageSize, skip: exporting ? 0 : (q.page - 1) * q.pageSize });
    await lockSources(tx, ids.map(r => r.sourceSubmissionId));
    // A concurrent new consent can move an identity to another source. Omit it until the next refresh.
    const rows = await tx.marketingPreference.findMany({ where: { AND: [where, { OR: ids.map(r => ({ id: r.id, sourceSubmissionId: r.sourceSubmissionId })) }] }, include, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
    await audit(tx, ctx, requestId, exporting ? "marketing.exported" : "marketing.list_viewed", "marketing", undefined, [], q.serviceId);
    return { items: await Promise.all(rows.map(r => dto(tx, r))), total, page: q.page, pageSize: q.pageSize };
  }, { timeout: 20000 });
}
async function locate(tx: Transaction, ctx: Context, id: string, write = false) {
  const initial = await tx.marketingPreference.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!initial) fail(404, "NOT_FOUND", "수신동의를 찾을 수 없습니다.");
  await lockFileContext(tx, ctx, initial.serviceId, [write ? "marketing.write" : "marketing.read"], !write);
  await lockSources(tx, [initial.sourceSubmissionId]);
  await lockMarketingContact(tx, initial);
  const current = await tx.marketingPreference.findUniqueOrThrow({ where: { id }, include });
  if (current.sourceSubmissionId !== initial.sourceSubmissionId) fail(409, "VERSION_CONFLICT", "동의 출처가 변경되었습니다. 다시 불러와주세요.");
  return current;
}
export async function readMarketing(ctx: Context, id: string, requestId: string) {
  return db.$transaction(async tx => { const row = await locate(tx, ctx, id); await audit(tx, ctx, requestId, "marketing.viewed", "marketing", id, [], row.serviceId); return dto(tx, row, true); });
}
export async function marketingSources(ctx: Context, serviceId: string, page: number, search: string, requestId: string) {
  return db.$transaction(async tx => {
    await lockFileContext(tx, ctx, serviceId, ["marketing.write", "submission.read"]);
    const where = { tenantId: ctx.tenantId, formVersion: { form: { serviceId }, title: { contains: search, mode: "insensitive" as const } }, status: { in: ["submitted", "corrected"] }, retentionUntil: { gt: new Date() } };
    const picked = await tx.submission.findMany({ where, select: { id: true }, orderBy: [{ submittedAt: "desc" }, { id: "asc" }], skip: (page - 1) * 20, take: 20 });
    await lockSources(tx, picked.map(s => s.id));
    const rows = await tx.submission.findMany({ where: { ...where, id: { in: picked.map(s => s.id) } }, include: { formVersion: true, answers: { include: { question: true } } }, orderBy: [{ submittedAt: "desc" }, { id: "asc" }] });
    await audit(tx, ctx, requestId, "marketing.sources_viewed", "marketing", undefined, [], serviceId);
    return { items: rows.map(r => ({ id: r.id, title: r.formVersion.title, createdAt: r.submittedAt, retentionUntil: r.retentionUntil,
      questions: r.answers.filter(a => ["단문형 답변", "장문형 답변"].includes(a.question.type)).map(a => ({ id: a.question.stableKey, label: a.question.label, value: decrypt<string>(a.valueCipher) })) })), total: await tx.submission.count({ where }), page, pageSize: 20 };
  });
}
type GrantInput = { tenantId: string; serviceId: string; submissionId: string; channel: MarketingChannel; nameQuestionId: string; contactQuestionId: string;
  grantedAt: Date; purpose: string; reference: string; sourceKind: "form" | "manual"; actorId?: string };
/** Caller holds the source submission lock, or has just created the submission. */
export async function grantMarketing(tx: Transaction, input: GrantInput) {
  const source = await tx.submission.findFirst({ where: { id: input.submissionId, tenantId: input.tenantId, formVersion: { form: { serviceId: input.serviceId } } }, include: { answers: { include: { question: true } } } });
  if (!source) fail(404, "NOT_FOUND", "동의 출처를 찾을 수 없습니다.");
  if (!["submitted", "corrected"].includes(source.status) || source.retentionUntil <= new Date()) fail(409, "SOURCE_UNAVAILABLE", "유효한 원본 응답이 필요합니다.");
  if (input.grantedAt > new Date() || input.grantedAt < new Date("2000-01-01")) fail(422, "CONSENT_TIME", "동의 시각을 확인해주세요. 미래 시각은 사용할 수 없습니다.");
  const value = (id: string) => { const a = source.answers.find(a => a.question.stableKey === id && ["단문형 답변", "장문형 답변"].includes(a.question.type));
    if (!a) fail(422, "CONTACT_QUESTION", "원본 응답의 텍스트 질문을 선택해주세요."); return decrypt<string>(a.valueCipher); };
  if (input.nameQuestionId === input.contactQuestionId) fail(422, "CONTACT_QUESTION", "이름과 연락처 질문을 각각 선택해주세요.");
  const contact = normalizeMarketingContact(input.channel, value(input.contactQuestionId)), name = normalizeMarketingName(value(input.nameQuestionId));
  const scope = { tenantId: input.tenantId, serviceId: input.serviceId, channel: input.channel, contactHash: marketingContactHash(input.channel, contact) };
  const old = await tx.marketingPreference.findUnique({ where: { tenantId_serviceId_channel_contactHash: scope } });
  if (old) await lockSources(tx, [old.sourceSubmissionId]);
  await lockMarketingContact(tx, scope);
  const current = await tx.marketingPreference.findUnique({ where: { tenantId_serviceId_channel_contactHash: scope } });
  if (current && current.sourceSubmissionId !== old?.sourceSubmissionId) fail(409, "VERSION_CONFLICT", "동의 출처가 변경되었습니다. 다시 시도해주세요.");
  if (current && (input.grantedAt <= current.grantedAt || (current.withdrawnAt && input.grantedAt <= current.withdrawnAt))) fail(409, "NEW_CONSENT_REQUIRED", "기존 동의 또는 철회 이후에 받은 새로운 동의 근거가 필요합니다.");
  const evidence = { purpose: input.purpose, reference: input.reference, grantedAt: input.grantedAt.toISOString(), sourceKind: input.sourceKind,
    sourceSubmissionId: input.submissionId, nameQuestionId: input.nameQuestionId, contactQuestionId: input.contactQuestionId, channel: input.channel };
  const data = { sourceSubmissionId: input.submissionId, nameQuestionId: input.nameQuestionId, contactQuestionId: input.contactQuestionId,
    nameHash: nameHash(name), contactCipher: encrypt({ name, contact }), evidenceCipher: encrypt(evidence), evidenceHash: tokenHash(JSON.stringify(evidence)),
    sourceKind: input.sourceKind, grantedAt: input.grantedAt, status: "granted", withdrawnAt: null };
  const row = current ? await tx.marketingPreference.update({ where: { id: current.id }, data: { ...data, version: { increment: 1 } } })
    : await tx.marketingPreference.create({ data: { ...scope, ...data } });
  await event(tx, row, current ? "reconsented" : "granted", input.actorId);
  return { id: row.id, version: row.version };
}
export async function createMarketing(tx: Transaction, ctx: Context, input: z.infer<typeof marketingCreate>, requestId: string) {
  await lockFileContext(tx, ctx, input.serviceId, ["marketing.write", "submission.read"]);
  await lockSources(tx, [input.submissionId]);
  const result = await grantMarketing(tx, { ...input, tenantId: ctx.tenantId, sourceKind: "manual", actorId: ctx.user.id, grantedAt: new Date(input.grantedAt) });
  await audit(tx, ctx, requestId, "marketing.granted", "marketing", result.id, ["consentEvidence"], input.serviceId); return result;
}
export async function collectMarketing(tx: Transaction, source: { id: string; tenantId: string }, serviceId: string, raw: unknown, channels: MarketingChannel[]) {
  if (!channels.length) return;
  const config: MarketingConfig = marketingConfig.parse(raw);
  for (const channel of [...channels].sort()) {
    const contactQuestionId = channel === "email" ? config.emailQuestionId : config.smsQuestionId;
    if (!contactQuestionId) fail(422, "MARKETING_CHANNEL", "선택한 채널의 마케팅 동의 항목이 없습니다.");
    await grantMarketing(tx, { tenantId: source.tenantId, serviceId, submissionId: source.id, channel, nameQuestionId: config.nameQuestionId, contactQuestionId,
      grantedAt: new Date(), purpose: config.purpose, reference: "공개 폼의 채널별 선택 동의", sourceKind: "form" });
  }
}
export async function updateMarketing(ctx: Context, id: string, input: { version: number; excluded: boolean }, requestId: string) {
  return db.$transaction(async tx => {
    const row = await locate(tx, ctx, id, true); requireVersion(input, row);
    if (row.status === "erased") fail(409, "MARKETING_ERASED", "삭제된 항목은 변경할 수 없습니다.");
    if (row.excluded !== input.excluded) {
      const changed = await tx.marketingPreference.update({ where: { id }, data: { excluded: input.excluded, version: { increment: 1 } } });
      await event(tx, changed, input.excluded ? "excluded" : "included", ctx.user.id);
      await audit(tx, ctx, requestId, "marketing.exclusion_changed", "marketing", id, ["excluded"], row.serviceId);
    }
    return dto(tx, await tx.marketingPreference.findUniqueOrThrow({ where: { id }, include }), true);
  });
}
export async function withdrawMarketing(ctx: Context, serviceId: string, inputs: { id: string; version: number }[], requestId: string, erase = false) {
  return db.$transaction(async tx => {
    await lockFileContext(tx, ctx, serviceId, ["marketing.write"]);
    const originals = await tx.marketingPreference.findMany({ where: { tenantId: ctx.tenantId, serviceId, id: { in: inputs.map(i => i.id) } } });
    if (originals.length !== inputs.length) fail(404, "NOT_FOUND", "수신동의를 찾을 수 없습니다.");
    await lockSources(tx, originals.map(r => r.sourceSubmissionId));
    for (const row of [...originals].sort((a, b) => (a.channel + a.contactHash).localeCompare(b.channel + b.contactHash))) await lockMarketingContact(tx, row);
    const result = [];
    for (const input of inputs) {
      const row = await tx.marketingPreference.findUniqueOrThrow({ where: { id: input.id } });
      if (row.sourceSubmissionId !== originals.find(r => r.id === row.id)!.sourceSubmissionId) fail(409, "VERSION_CONFLICT", "동의 출처가 변경되었습니다.");
      const status = erase ? "erased" : "withdrawn";
      if (row.status === status) { result.push({ id: row.id, version: row.version, status }); continue; }
      requireVersion(input, row);
      if (row.status === "erased") fail(409, "MARKETING_ERASED", "삭제된 동의입니다.");
      if (erase) await eraseMarketingJobs(tx, { marketingPreferenceId: { in: [row.id] } });
      const changed = await tx.marketingPreference.update({ where: { id: row.id }, data: { status, version: { increment: 1 },
        ...(erase ? { contactCipher: null, evidenceCipher: null, nameHash: null } : { withdrawnAt: new Date() }) } });
      await event(tx, changed, status, ctx.user.id); await audit(tx, ctx, requestId, "marketing." + status, "marketing", row.id, ["status"], serviceId);
      result.push({ id: row.id, version: changed.version, status });
    }
    return { items: result };
  }, { timeout: 20000 });
}
export async function eraseMarketingSource(tx: Transaction, submissionId: string) {
  const rows = await tx.marketingPreference.findMany({ where: { sourceSubmissionId: submissionId, status: { not: "erased" } }, orderBy: [{ channel: "asc" }, { contactHash: "asc" }] });
  for (const row of rows) {
    await lockMarketingContact(tx, row);
    const changed = await tx.marketingPreference.update({ where: { id: row.id }, data: { status: "erased", nameHash: null, contactCipher: null, evidenceCipher: null, version: { increment: 1 } } });
    await event(tx, changed, "erased");
  }
  return rows.length;
}
export async function marketingSummary(ctx: Context, input: MarketingSummaryQuery, requestId: string): Promise<MarketingSummary> {
  return db.$transaction(async tx => {
    const [{ asOf }] = await tx.$queryRaw<{ asOf: Date }[]>`SELECT statement_timestamp() AS "asOf"`;
    const { from, to } = analyticsPeriod(input, asOf);
    const scope = await documentScope(tx, ctx, "marketing.read");
    if (input.serviceId && !await tx.service.count({ where: { AND: [scope, { id: input.serviceId, status: "active" }] } }))
      fail(404, "SERVICE_NOT_FOUND", "조회 가능한 서비스를 찾을 수 없습니다.");
    const services = await tx.service.findMany({ where: { AND: [scope, { ...(input.serviceId ? { id: input.serviceId } : {}), status: "active",
      name: { contains: input.search, mode: "insensitive" } }] }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    const period = { from: from.toISOString(), to: to.toISOString() };
    if (!services.length) {
      await audit(tx, ctx, requestId, "marketing.summary_viewed", "marketing", undefined, [], input.serviceId);
      return { asOf: asOf.toISOString(), period, items: [] };
    }
    const ids = services.map(service => service.id);
    const counts = await tx.$queryRaw<{ serviceId: string; granted: bigint; withdrawn: bigint; erased: bigint; excluded: bigint; eligible: bigint; suppressed: bigint; total: bigint }[]>(Prisma.sql`
      SELECT p."serviceId",count(*) FILTER(WHERE p.status='granted') AS granted,count(*) FILTER(WHERE p.status='withdrawn') AS withdrawn,
      count(*) FILTER(WHERE p.status='erased') AS erased,count(*) FILTER(WHERE p.excluded) AS excluded,count(*) AS total,
      count(*) FILTER(WHERE p.status='granted' AND p.channel='email' AND
        (EXISTS(SELECT 1 FROM "Suppression" x WHERE x."tenantId"=p."tenantId" AND x."serviceId"=p."serviceId" AND x."emailHash"=p."contactHash" AND x.channel='email')
        OR EXISTS(SELECT 1 FROM "EmailSuppression" x WHERE x."tenantId"=p."tenantId" AND x."serviceId"=p."serviceId" AND x."contactHash"=p."contactHash"))) AS suppressed,
      count(*) FILTER(WHERE p.status='granted' AND NOT p.excluded AND s.status IN ('submitted','corrected') AND s."retentionUntil">${asOf} AND svc.status='active'
        AND (p.channel<>'email' OR (NOT EXISTS(SELECT 1 FROM "Suppression" x WHERE x."tenantId"=p."tenantId" AND x."serviceId"=p."serviceId" AND x."emailHash"=p."contactHash" AND x.channel='email')
          AND NOT EXISTS(SELECT 1 FROM "EmailSuppression" x WHERE x."tenantId"=p."tenantId" AND x."serviceId"=p."serviceId" AND x."contactHash"=p."contactHash")))) AS eligible
      FROM "MarketingPreference" p JOIN "Submission" s ON s.id=p."sourceSubmissionId" JOIN "Service" svc ON svc.id=p."serviceId"
      WHERE p."tenantId"=${ctx.tenantId} AND p."serviceId" IN (${Prisma.join(ids)}) GROUP BY p."serviceId"`);
    const activity = await tx.$queryRaw<{ serviceId: string; grants: bigint; withdrawals: bigint; erasures: bigint }[]>(Prisma.sql`
      SELECT p."serviceId", COUNT(*) FILTER(WHERE e.kind IN ('granted','reconsented')) AS grants,
        COUNT(*) FILTER(WHERE e.kind='withdrawn') AS withdrawals,
        COUNT(*) FILTER(WHERE e.kind='erased') AS erasures
      FROM "MarketingEvent" e JOIN "MarketingPreference" p ON p.id=e."preferenceId" AND p."tenantId"=e."tenantId"
      WHERE e."tenantId"=${ctx.tenantId} AND p."serviceId" IN (${Prisma.join(ids)})
        AND e."createdAt">=${from} AND e."createdAt"<${to}
      GROUP BY p."serviceId"`);
    const countMap = new Map(counts.map(row => [row.serviceId, row]));
    const activityMap = new Map(activity.map(row => [row.serviceId, row]));
    await audit(tx, ctx, requestId, "marketing.summary_viewed", "marketing", undefined, [], input.serviceId);
    return { asOf: asOf.toISOString(), period, items: services.map(service => {
      const current = countMap.get(service.id), events = activityMap.get(service.id);
      return { id: service.id, name: service.name, granted: Number(current?.granted ?? 0),
        withdrawn: Number(current?.withdrawn ?? 0), erased: Number(current?.erased ?? 0),
        excluded: Number(current?.excluded ?? 0), eligible: Number(current?.eligible ?? 0),
        suppressed: Number(current?.suppressed ?? 0), total: Number(current?.total ?? 0),
        periodGrants: Number(events?.grants ?? 0), periodWithdrawals: Number(events?.withdrawals ?? 0),
        periodErasures: Number(events?.erasures ?? 0) };
    }) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}
export async function withMarketingDelivery<T>(scope: { tenantId: string; serviceId: string; channel: MarketingChannel; contact: string }, operation: (tx: Transaction, row: MarketingPreference) => Promise<T>, expected?: { id: string; version: number }) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${scope.tenantId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${scope.serviceId} AND "tenantId"=${scope.tenantId} FOR SHARE`;
    if (!await tx.service.count({ where: { id: scope.serviceId, tenantId: scope.tenantId, status: "active", tenant: { status: "active" } } })) return null;
    const key = { tenantId: scope.tenantId, serviceId: scope.serviceId, channel: scope.channel, contactHash: marketingContactHash(scope.channel, scope.contact) };
    const initial = await tx.marketingPreference.findUnique({ where: { tenantId_serviceId_channel_contactHash: key } });
    if (!initial) return null;
    await lockSources(tx, [initial.sourceSubmissionId]); await lockMarketingContact(tx, key);
    const current = await tx.marketingPreference.findUniqueOrThrow({ where: { id: initial.id }, include });
    if (current.sourceSubmissionId !== initial.sourceSubmissionId || (expected && (current.id !== expected.id || current.version !== expected.version)) || await marketingDenial(tx, current)) return null;
    return operation(tx, current);
  }, { timeout: 45000 });
}
