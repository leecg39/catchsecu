import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { Client } from "pg";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { encrypt, tokenHash } from "@/server/crypto";
import { requireContext } from "@/server/context";
import { getVerificationState, updateVerificationIntegration } from "@/server/verification";
import { GET, POST, PATCH, DELETE } from "@/app/api/v1/services/[id]/verification/route";
import { POST as createForm } from "@/app/api/v1/forms/route";
import { POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { POST as publicSubmit } from "@/app/api/v1/public/forms/[...segments]/route";
import type { VerificationState } from "@/contracts/verification";
import { verificationStateSchema } from "@/contracts/verification";
import { mkdir, writeFile } from "node:fs/promises";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const configuration = { identityProvider: "synthetic_identity", signatureProvider: "synthetic_signature", environment: "sandbox" as const, status: "pending" as const };
const barriers: unknown[] = [];
function req(path: string, cookie: string, method = "GET", value?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, ...(value !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
}
async function ok(response: Response, status = 200): Promise<VerificationState> { const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(status); return verificationStateSchema.parse(result); }
async function person() {
  const email = "verification-" + randomUUID() + "@catchsecu.test", password = "Verification-test!123";
  expect((await auth.handler(req("/auth/sign-up/email", "", "POST", { name: "Synthetic", email, password }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const login = await auth.handler(req("/auth/sign-in/email", "", "POST", { email, password })); expect(login.status).toBe(200);
  return { user, cookie: login.headers.getSetCookie().map(item => item.split(";")[0]).join("; ") };
}
async function fixture() {
  const company = await db.company.create({ data: { name: "Verification", publicName: "Verification", policy: { create: {} }, services: { create: [{ name: "A", externalName: "A" }, { name: "B", externalName: "B" }] } }, include: { services: true } });
  const owner = await person(), editor = await person();
  await db.membership.create({ data: { tenantId: company.id, userId: owner.user.id, role: "owner" } });
  const member = await db.membership.create({ data: { tenantId: company.id, userId: editor.user.id, role: "editor" } });
  const serviceId = company.services[0].id, otherServiceId = company.services[1].id;
  const grant = await db.serviceGrant.create({ data: { tenantId: company.id, memberId: member.id, serviceId, capabilities: ["form.read", "form.write", "form.publish"] } });
  const ctx = await requireContext(req("/context", owner.cookie).headers), editorCtx = await requireContext(req("/context", editor.cookie).headers);
  const path = `/services/${serviceId}/verification`;
  return { company, owner, editor, member, grant, serviceId, otherServiceId, ctx, editorCtx, path };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function create(f: Fixture, value: unknown = configuration, key = randomUUID()) { return ok(await POST(req(f.path, f.owner.cookie, "POST", value, { "Idempotency-Key": key })), 201); }
// 앱 계층은 외부 공급자의 enabled를 막지만, 합성 픽스처는 과거 검증 상태를 재현해야 하므로
// 트랜잭션으로 설정을 enabled로 승격한다(리비전 정합 유지).
async function promote(integrationId: string) {
  await db.$transaction(async tx => {
    const current = await tx.verificationIntegration.findUniqueOrThrow({ where: { id: integrationId } });
    await tx.verificationIntegration.update({ where: { id: current.id }, data: { status: "enabled", version: { increment: 1 } } });
    await tx.verificationIntegrationRevision.create({ data: { tenantId: current.tenantId, serviceId: current.serviceId, integrationId: current.id,
      version: current.version + 1, identityProvider: current.identityProvider, signatureProvider: current.signatureProvider,
      environment: current.environment, status: "enabled" } });
  });
  return db.verificationIntegration.findUniqueOrThrow({ where: { id: integrationId } });
}
async function attempt(f: Fixture, environment: "sandbox" | "production" = "sandbox") {
  const created = await create(f, { ...configuration, environment });
  const integration = await promote(created.integration!.id);
  const form = await db.form.create({ data: { tenantId: f.company.id, serviceId: f.serviceId, ownerId: f.owner.user.id, title: "Synthetic proof model" } });
  const version = await db.formVersion.create({ data: { tenantId: f.company.id, formId: form.id, number: 1, title: "Synthetic", status: "published" } });
  const token = randomUUID();
  const publication = await db.publication.create({ data: { tenantId: f.company.id, formId: form.id, formVersionId: version.id, tokenHash: tokenHash(token), tokenCipher: encrypt(token), maxResponses: 10 } });
  const row = await db.verificationAttempt.create({ data: { tenantId: f.company.id, serviceId: f.serviceId, integrationId: integration.id,
    integrationVersion: integration.version, formId: form.id, formVersionId: version.id, publicationId: publication.id, kind: "signature", environment,
    browserNonceHash: tokenHash(randomUUID()), requestHash: tokenHash(randomUUID()), documentHash: tokenHash("synthetic document"), expiresAt: new Date(Date.now() + 60000) } });
  return { integration, form, version, publication, row };
}
async function syntheticEvidence(f: Fixture, environment: "sandbox" | "production" = "production") {
  // Database integrity fixture only: no provider protocol, callback signature, or sandbox success is claimed.
  const a = await attempt(f, environment), verifiedAt = new Date();
  const row = await db.verificationAttempt.update({ where: { id: a.row.id }, data: { status: "verified", version: { increment: 1 }, verifiedAt,
    providerRequestHash: tokenHash("synthetic reference"), providerRequestCipher: encrypt("synthetic reference") } });
  const event = await db.verificationEvent.create({ data: { tenantId: f.company.id, serviceId: f.serviceId, attemptId: row.id,
    providerEventHash: tokenHash(randomUUID()), bodyHash: tokenHash("synthetic event body"), signatureValid: true, verificationStatus: "verified" } });
  const receipt = { tenantId: f.company.id, serviceId: f.serviceId, attemptId: row.id, eventId: event.id, formVersionId: row.formVersionId,
    publicationId: row.publicationId, provider: configuration.signatureProvider, kind: row.kind, environment, documentHash: row.documentHash, proofHash: event.bodyHash, verifiedAt, retentionUntil: new Date(Date.now() + 86400000) };
  return { ...a, row, event, receipt };
}
async function delay(table: "AuditEvent" | "IdempotencyRecord", operation: () => Promise<void>) {
  const condition = table === "AuditEvent" ? "IF NEW.resource='VerificationIntegration' THEN PERFORM pg_sleep(2); END IF;" : "IF NEW.\"resourceType\"='verificationIntegration' THEN PERFORM pg_sleep(2); END IF;";
  await db.$executeRawUnsafe(`CREATE FUNCTION qa_verification_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${condition} RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER qa_verification_delay BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION qa_verification_delay()`);
  try { await operation(); } finally { await db.$executeRawUnsafe(`DROP TRIGGER qa_verification_delay ON "${table}"`); await db.$executeRawUnsafe("DROP FUNCTION qa_verification_delay()"); }
}
async function sqlRejected(sql: string, parameters: unknown[], code: string) {
  const client = new Client({ connectionString: env.DATABASE_URL }); await client.connect();
  try {
    await client.query("BEGIN"); let actual: string | undefined;
    try { await client.query(sql, parameters); } catch (error) { actual = (error as { code?: string }).code; }
    expect(actual).toBe(code);
  } finally { await client.query("ROLLBACK"); await client.end(); }
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE'); });
afterAll(async () => { await mkdir("docs/qa/P06-T06", { recursive: true }); await writeFile("docs/qa/P06-T06/lock-barriers.json", JSON.stringify({ checkedAt: new Date().toISOString(), barriers }, null, 2) + "\n"); await db.$disconnect(); });

test("unconfigured state is explicit, safe, and current role controls configuration actions", async () => {
  const f = await fixture(), owner = await ok(await GET(req(f.path, f.owner.cookie))), editor = await ok(await GET(req(f.path, f.editor.cookie)));
  expect(owner).toMatchObject({ integration: null, readiness: { ready: false, reason: "NOT_CONFIGURED", sandboxVerified: false }, permissions: { canManage: true }, history: [] });
  expect(editor.permissions.canManage).toBe(false);
  expect((await POST(req(f.path, f.editor.cookie, "POST", configuration, { "Idempotency-Key": randomUUID() }))).status).toBe(403);
});
test("configuration CRUD keeps immutable revisions and idempotent create without external readiness", async () => {
  const f = await fixture(), key = randomUUID(), first = await create(f, configuration, key), replay = await create(f, configuration, key);
  expect(replay.integration?.id).toBe(first.integration?.id); expect(replay.history).toHaveLength(1);
  expect(await db.auditEvent.count({ where: { resource: "VerificationIntegration", action: "create" } })).toBe(1);
  expect((await POST(req(f.path, f.owner.cookie, "POST", { ...configuration, environment: "production" }, { "Idempotency-Key": key }))).status).toBe(409);
  const updated = await ok(await PATCH(req(f.path, f.owner.cookie, "PATCH", { ...configuration, environment: "production", version: 1 })));
  expect(updated).toMatchObject({ integration: { version: 2, environment: "production" }, readiness: { ready: false, reason: "PROVIDER_ADAPTER_REQUIRED" } });
  expect(updated.history.map(item => item.version)).toEqual([2, 1]);
  expect((await POST(req(f.path, f.owner.cookie, "POST", configuration, { "Idempotency-Key": key }))).status).toBe(410);
  expect((await PATCH(req(f.path, f.owner.cookie, "PATCH", { ...configuration, version: 1 }))).status).toBe(409);
  expect((await DELETE(req(f.path, f.owner.cookie, "DELETE", undefined, { "If-Match": "1" }))).status).toBe(409);
  expect((await DELETE(req(f.path, f.owner.cookie, "DELETE", undefined, { "If-Match": "2" }))).status).toBe(204);
  const deleted = await ok(await GET(req(f.path, f.owner.cookie))); expect(deleted.integration).toMatchObject({ version: 3, status: "deleted", identityProvider: null, signatureProvider: null });
  expect(deleted.readiness.reason).toBe("NOT_CONFIGURED");
  const restored = await create(f); expect(restored.integration).toMatchObject({ id: first.integration!.id, version: 4, status: "pending" }); expect(restored.history).toHaveLength(4);
  expect(JSON.stringify(restored)).not.toMatch(/Cipher|tenantId|secret|cookie|requestHash|providerRequest/);
});
test("concurrent creates serialize the empty service configuration and do not duplicate revisions", async () => {
  const f = await fixture(); const responses = await Promise.all([POST(req(f.path, f.owner.cookie, "POST", configuration, { "Idempotency-Key": randomUUID() })), POST(req(f.path, f.owner.cookie, "POST", configuration, { "Idempotency-Key": randomUUID() }))]);
  expect(responses.map(response => response.status).sort()).toEqual([201, 409]); expect(await db.verificationIntegrationRevision.count()).toBe(1);
});
test.each([{ ...configuration, ready: true }, { ...configuration, status: "ready" }, { ...configuration, secret: "private" }, { ...configuration, callbackUrl: "https://example.test" }, { ...configuration, identityProvider: "https://example.test" }, { ...configuration, identityProvider: null, signatureProvider: null }, { ...configuration, environment: "live" }])("client cannot set readiness, secrets, arbitrary URLs or invalid configuration %j", async value => {
  const f = await fixture(); expect((await POST(req(f.path, f.owner.cookie, "POST", value, { "Idempotency-Key": randomUUID() }))).status).toBe(422); expect(await db.verificationIntegration.count()).toBe(0);
});
test.each(["?ready=true", "?page=1", "?page=1&page=2"])("all configuration methods reject ignored query %s", async query => {
  const f = await fixture(); for (const [handler, method, value] of [[GET, "GET", undefined], [POST, "POST", configuration], [PATCH, "PATCH", { ...configuration, version: 1 }], [DELETE, "DELETE", undefined]] as const)
    expect((await handler(req(f.path + query, f.owner.cookie, method, value, { "Idempotency-Key": randomUUID(), "If-Match": "1" }))).status).toBe(422);
});
test("delete requires canonical If-Match and create requires an idempotency key", async () => {
  const f = await fixture(); expect((await POST(req(f.path, f.owner.cookie, "POST", configuration))).status).toBe(400); await create(f);
  for (const value of ["", "01", "1.0", "1e0", "-1", "2147483647"]) expect((await DELETE(req(f.path, f.owner.cookie, "DELETE", undefined, { "If-Match": value }))).status).toBe(422);
});
test("revoked grants and changed roles are checked from stale contexts and idempotent replays", async () => {
  const f = await fixture(), key = randomUUID(); await create(f, configuration, key);
  await db.serviceGrant.delete({ where: { id: f.grant.id } }); await expect(getVerificationState(f.editorCtx, f.serviceId)).rejects.toMatchObject({ status: 403 });
  await db.membership.update({ where: { id: f.member.id }, data: { role: "owner" } });
  await db.membership.updateMany({ where: { userId: f.owner.user.id }, data: { role: "viewer" } });
  await expect(updateVerificationIntegration(f.ctx, f.serviceId, { ...configuration, version: 1 }, randomUUID())).rejects.toMatchObject({ status: 403 });
  expect((await POST(req(f.path, f.owner.cookie, "POST", configuration, { "Idempotency-Key": key }))).status).toBe(403);
});
test("other service or tenant is not exposed and archived service rejects configuration writes", async () => {
  const f = await fixture(); expect((await GET(req(`/services/${f.otherServiceId}/verification`, f.editor.cookie))).status).toBe(403);
  const company = await db.company.create({ data: { name: "Other", publicName: "Other", services: { create: { name: "Other", externalName: "Other" } } }, include: { services: true } });
  expect((await GET(req(`/services/${company.services[0].id}/verification`, f.owner.cookie))).status).toBe(404);
  await db.service.update({ where: { id: f.serviceId }, data: { status: "archived" } });
  expect((await POST(req(f.path, f.owner.cookie, "POST", configuration, { "Idempotency-Key": randomUUID() }))).status).toBe(409);
});
test("company suspension, removed session and current MFA policy reject stale context", async () => {
  const f = await fixture(); await db.securityPolicy.update({ where: { tenantId: f.company.id }, data: { requireMfa: true } });
  await expect(getVerificationState(f.ctx, f.serviceId)).rejects.toMatchObject({ status: 403, code: "MFA_REQUIRED" });
  await db.securityPolicy.update({ where: { tenantId: f.company.id }, data: { requireMfa: false } });
  await db.company.update({ where: { id: f.company.id }, data: { status: "suspended" } }); await expect(getVerificationState(f.ctx, f.serviceId)).rejects.toMatchObject({ status: 403 });
  await db.company.update({ where: { id: f.company.id }, data: { status: "active" } }); await db.session.delete({ where: { id: f.ctx.session.id } });
  await expect(getVerificationState(f.ctx, f.serviceId)).rejects.toMatchObject({ status: 401 });
});
test.each(["AuditEvent", "IdempotencyRecord"] as const)("expiry during actual %s insert rolls back configuration, revision, audit and cache", async table => {
  const f = await fixture(); await delay(table, async () => {
    await db.session.update({ where: { id: f.ctx.session.id }, data: { expiresAt: new Date(Date.now() + 1000) } });
    expect((await POST(req(f.path, f.owner.cookie, "POST", configuration, { "Idempotency-Key": randomUUID() }))).status).toBe(401);
    expect(await db.verificationIntegration.count()).toBe(0); expect(await db.verificationIntegrationRevision.count()).toBe(0);
    expect(await db.auditEvent.count({ where: { resource: "VerificationIntegration" } })).toBe(0); expect(await db.idempotencyRecord.count()).toBe(0);
  });
});
test("session expiry during native configuration lock rejects stale read after the wait", async () => {
  const f = await fixture(), first = await create(f), client = new Client({ connectionString: env.DATABASE_URL }); await client.connect();
  let promise: Promise<VerificationState> | undefined;
  try {
    await client.query("BEGIN"); await client.query('SELECT id FROM "VerificationIntegration" WHERE id=$1 FOR UPDATE', [first.integration!.id]);
    await db.session.update({ where: { id: f.ctx.session.id }, data: { expiresAt: new Date(Date.now() + 2000) } });
    promise = getVerificationState(f.ctx, f.serviceId); const caught = promise.catch(error => error);
    let waiting = 0; for (let i = 0; i < 60; i++) { await client.query("SELECT pg_stat_clear_snapshot()"); const result = await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM \"VerificationIntegration\"%'"); waiting = result.rows[0].n; if (waiting) break; await new Promise(resolve => setTimeout(resolve, 20)); }
    expect(waiting).toBeGreaterThan(0); await new Promise(resolve => setTimeout(resolve, 2100)); await client.query("ROLLBACK");
    const error = await caught; expect(error).toMatchObject({ status: 401 }); barriers.push({ table: "VerificationIntegration", actualWaitObserved: true, waiters: waiting, afterWaitStatus: error.status });
  } finally { await client.query("ROLLBACK"); await promise?.catch(() => undefined); await client.end(); }
});
test("configuration mutation cancels pending attempts and a restored configuration cannot resurrect the old generation", async () => {
  const f = await fixture(), a = await attempt(f);
  await ok(await PATCH(req(f.path, f.owner.cookie, "PATCH", { ...configuration, status: "disabled", version: a.integration.version })));
  expect((await db.verificationAttempt.findUniqueOrThrow({ where: { id: a.row.id } })).status).toBe("cancelled");
  expect((await db.verificationIntegrationRevision.findMany({ orderBy: { version: "asc" } })).map(item => item.status)).toEqual(["pending", "enabled", "disabled"]);
  await expect(db.verificationAttempt.create({ data: { ...a.row, id: randomUUID() } })).rejects.toBeTruthy();
});
test("native revision guard rejects edits, deletion and configuration snapshot mismatches", async () => {
  const f = await fixture(), c = await create(f), row = await db.verificationIntegrationRevision.findFirstOrThrow();
  await sqlRejected('UPDATE "VerificationIntegrationRevision" SET status=\'disabled\' WHERE id=$1', [row.id], "23514");
  await sqlRejected('DELETE FROM "VerificationIntegrationRevision" WHERE id=$1', [row.id], "23514");
  await expect(db.verificationIntegrationRevision.create({ data: { ...row, id: randomUUID(), version: 999 } })).rejects.toBeTruthy();
  await sqlRejected('UPDATE "VerificationIntegration" SET status=\'ready\', version=2 WHERE id=$1', [c.integration!.id], "23514");
});
test("native attempts reject cross-service form and publication/version mismatch", async () => {
  const f = await fixture(), a = await attempt(f), other = await db.form.create({ data: { tenantId: f.company.id, serviceId: f.otherServiceId, ownerId: f.owner.user.id, title: "Other" } });
  await expect(db.verificationAttempt.create({ data: { ...a.row, id: randomUUID(), formId: other.id } })).rejects.toMatchObject({ code: "P2003" });
  const otherVersion = await db.formVersion.create({ data: { tenantId: f.company.id, formId: a.form.id, number: 2, title: "Other version" } });
  await expect(db.verificationAttempt.create({ data: { ...a.row, id: randomUUID(), formVersionId: otherVersion.id } })).rejects.toMatchObject({ code: "P2003" });
  await sqlRejected('UPDATE "VerificationAttempt" SET "documentHash"=$1, version=2 WHERE id=$2', [tokenHash("changed"), a.row.id], "23514");
});
test("synthetic database evidence accepts sandbox receipts and still rejects forged event facts and reused event IDs", async () => {
  // local 공급자는 sandbox에서만 동작하므로 영수증 environment 제약은 sandbox도 허용한다(20261008000000).
  // 위조 이벤트 사실·재사용 eventId·이벤트 불변성은 그대로 강제된다.
  const f = await fixture(), a = await syntheticEvidence(f, "sandbox");
  const sandboxReceipt = await db.verificationReceipt.create({ data: a.receipt });
  expect(sandboxReceipt.environment).toBe("sandbox");
  await expect(db.verificationEvent.create({ data: { ...a.event, id: randomUUID() } })).rejects.toMatchObject({ code: "P2002" });
  await expect(db.verificationEvent.create({ data: { ...a.event, id: randomUUID(), providerEventHash: tokenHash(randomUUID()), signatureValid: false } })).rejects.toBeTruthy();
  await sqlRejected('UPDATE "VerificationEvent" SET "bodyHash"=$1 WHERE id=$2', [tokenHash("changed"), a.event.id], "23514");
});
test("synthetic database receipts bind the exact proof, provider, document, publication and one submission", async () => {
  const f = await fixture(), a = await syntheticEvidence(f);
  for (const patch of [{ documentHash: tokenHash("wrong") }, { proofHash: tokenHash("wrong") }, { provider: "other_provider" }, { publicationId: randomUUID() }, { kind: "identity" }])
    await expect(db.verificationReceipt.create({ data: { ...a.receipt, ...patch } })).rejects.toBeTruthy();
  const receipt = await db.verificationReceipt.create({ data: a.receipt });
  await expect(db.verificationReceipt.create({ data: a.receipt })).rejects.toMatchObject({ code: "P2002" });
  const sub = await db.submission.create({ data: { tenantId: f.company.id, formVersionId: a.version.id, publicationId: a.publication.id, retentionUntil: new Date(Date.now() + 86400000), originalRetentionUntil: new Date(Date.now() + 86400000) } });
  await db.verificationReceipt.update({ where: { id: receipt.id }, data: { submissionId: sub.id } });
  await sqlRejected('UPDATE "VerificationReceipt" SET "proofHash"=$1 WHERE id=$2', [tokenHash("wrong"), receipt.id], "23514");
  await expect(db.verificationReceipt.update({ where: { id: receipt.id }, data: { submissionId: null } })).rejects.toBeTruthy();
});
test("provider labels and production environment never unblock verified form publication or public acceptance", async () => {
  const f = await fixture(); await create(f, { ...configuration, environment: "production" });
  const formResponse = await createForm(req("/forms", f.owner.cookie, "POST", { serviceId: f.serviceId, title: "Provider required", content: { body: "Synthetic", verify: true, questions: [{ id: randomUUID(), type: "단문형 답변", label: "Value", required: true }], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10 } }, { "Idempotency-Key": randomUUID() }));
  const form = await formResponse.json(); expect(formResponse.status, JSON.stringify(form)).toBe(201);
  expect((await formAction(req(`/forms/${form.id}/publish`, f.owner.cookie, "POST", { version: form.version }, { "Idempotency-Key": randomUUID() }))).status).toBe(503);
  const version = await db.formVersion.findFirstOrThrow({ where: { formId: form.id } }), token = "A".repeat(43);
  await db.form.update({ where: { id: form.id }, data: { status: "published", publishedVersionId: version.id } });
  await db.formVersion.update({ where: { id: version.id }, data: { status: "published" } });
  const publication = await db.publication.create({ data: { tenantId: f.company.id, formId: form.id, formVersionId: version.id, tokenHash: tokenHash(token), tokenCipher: encrypt(token), maxResponses: 10 } });
  expect((await publicSubmit(req(`/public/forms/${token}/submissions`, "", "POST", { consent: true, answers: {} }, { "Idempotency-Key": randomUUID() }))).status).toBe(503);
  expect(await db.submission.count()).toBe(0); expect((await db.publication.findUniqueOrThrow({ where: { id: publication.id } })).responseCount).toBe(0);
});

test("synthetic identity and signature database receipts can bind one submission but cannot duplicate a proof kind", async () => {
  const f = await fixture(), a = await syntheticEvidence(f);
  const sub = await db.submission.create({ data: { tenantId: f.company.id, formVersionId: a.version.id, publicationId: a.publication.id,
    retentionUntil: new Date(Date.now() + 86400000), originalRetentionUntil: new Date(Date.now() + 86400000) } });
  await db.verificationReceipt.create({ data: { ...a.receipt, submissionId: sub.id } });
  const build = async (kind: "identity" | "signature") => {
    const pending = await db.verificationAttempt.create({ data: { ...a.row, id: randomUUID(), kind, status: "pending", version: 1, verifiedAt: null, providerRequestHash: null, providerRequestCipher: null } });
    const verifiedAt = new Date();
    const row = await db.verificationAttempt.update({ where: { id: pending.id }, data: { status: "verified", version: 2, verifiedAt, providerRequestHash: tokenHash(randomUUID()), providerRequestCipher: encrypt("synthetic reference") } });
    const event = await db.verificationEvent.create({ data: { ...a.event, id: randomUUID(), attemptId: row.id, providerEventHash: tokenHash(randomUUID()) } });
    return { ...a.receipt, kind, attemptId: row.id, eventId: event.id, verifiedAt, provider: kind === "identity" ? configuration.identityProvider : configuration.signatureProvider, submissionId: sub.id };
  };
  await db.verificationReceipt.create({ data: await build("identity") });
  expect((await db.verificationReceipt.findMany({ where: { submissionId: sub.id }, orderBy: { kind: "asc" } })).map(row => row.kind)).toEqual(["identity", "signature"]);
  await expect(db.verificationReceipt.create({ data: await build("signature") })).rejects.toMatchObject({ code: "P2002" });
});
