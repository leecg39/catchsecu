import { randomUUID } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { PassThrough, Writable } from "node:stream";
import dns from "node:dns/promises";
import https from "node:https";
import type { RequestOptions, ClientRequest, IncomingMessage } from "node:http";
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { decrypt } from "@/server/crypto";
import type { Role } from "@/generated/prisma/client";
import type { IntegrationRecord, NotificationRecord, IntegrationOptions } from "@/contracts/notifications";
import type { Paged, FormRecord } from "@/contracts/forms";
import { GET, POST, PATCH, DELETE } from "@/app/api/v1/integrations/[[...segments]]/route";
import { POST as formPost } from "@/app/api/v1/forms/route";
import { POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { POST as submitPost } from "@/app/api/v1/public/forms/[...segments]/route";
import { cancelNotifications, emitNotificationEvent } from "@/server/notifications";
import { claimNotification, processNotification, recoverNotifications, runOneNotification } from "@/server/notification-worker";
import * as transport from "@/server/notification-transport";
import { roleCapabilities } from "@/server/permissions";
import { requireContext } from "@/server/context";
import { readIntegration } from "@/server/notifications";
import { POST as newImport } from "@/app/api/v1/imports/route";
import { POST as importAction, PATCH as importPatch } from "@/app/api/v1/imports/[...segments]/route";
import { PUT as uploadPut, POST as uploadPost } from "@/app/api/v1/uploads/[...segments]/route";
import { POST as purposePost } from "@/app/api/v1/processing-purposes/route";
import { sha256 } from "@/server/file-validation";
import { runOneImport } from "@/server/import-worker";
import type { ImportJobRecord } from "@/contracts/imports";
import type { PurposeRecord } from "@/contracts/processing-catalog";
const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test database required");
const origin = env.BETTER_AUTH_URL, tenant = randomUUID(), foreign = randomUUID(), service = randomUUID(), second = randomUUID(), other = randomUUID();
const cookies: Record<string, string> = {}, members: Record<string, string> = {};
const endpoint = "https://hooks.slack.com/services/TLOCAL/BLOCAL/SYNTHETICSECRET1234567890";
const teams = "https://synthetic.01.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/0123456789abcdef0123456789abcdef/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=SYNTHETICSECRET1234567890";
const original = { mode: env.NOTIFICATION_TRANSPORT, dir: env.LOCAL_NOTIFICATION_DIR };
function req(path: string, method = "GET", who = "owner", input?: unknown, headers: Record<string, string> = {}) { return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie: cookies[who] ?? "", ...(input === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }); }
async function ok<T = Record<string, unknown>>(r: Response, status = 200): Promise<T> { expect(r.status, r.status >= 400 ? JSON.stringify(await r.clone().json()) : "").toBe(status); return r.json(); }
async function signup(name: string, role: Role, company = tenant) {
  await db.rateLimit.deleteMany(); const email = name + "@notifications.local.test", password = "Notification-synthetic-testing-2026!";
  await ok(await auth.handler(req("/auth/sign-up/email", "POST", "anonymous", { name, email, password })));
  const user = await db.user.findUniqueOrThrow({ where: { email } }); await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  const member = await db.membership.create({ data: { tenantId: company, userId: user.id, role } }); members[name] = member.id;
  await db.serviceGrant.create({ data: { tenantId: company, memberId: member.id, serviceId: company === tenant ? service : other, capabilities: [...roleCapabilities(role)] } });
  const response = await auth.handler(req("/auth/sign-in/email", "POST", "anonymous", { email, password })); expect(response.status).toBe(200);
  cookies[name] = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
}
const createBody = (overrides: object = {}) => ({ serviceId: service, provider: "slack", endpoint, name: "합성 알림 " + randomUUID(), enabled: true, subscriptions: [{ kind: "submission.created", targetId: null }], ...overrides });
async function create(overrides: object = {}, who = "owner") { const saved = await ok<{ id: string }>(await POST(req("/integrations", "POST", who, createBody(overrides), { "idempotency-key": randomUUID() })), 201); return ok<IntegrationRecord>(await GET(req("/integrations/" + saved.id, "GET", who))); }
async function testSend(row: IntegrationRecord, key = randomUUID(), who = "owner") { return ok<{ id: string; version: number }>(await POST(req("/integrations/" + row.id + "/test", "POST", who, { version: row.version }, { "idempotency-key": key })), 202); }
async function history(row: IntegrationRecord) { return ok<Paged<NotificationRecord>>(await GET(req("/integrations/" + row.id + "/deliveries"))); }
async function form(serviceId = service, who = "owner") {
  const question = randomUUID(); const row = await ok<FormRecord>(await formPost(req("/forms", "POST", who, { serviceId, title: "알림 출처 폼", content: { body: "합성 자료", consentPurpose: "시험", consentRequired: true, retentionDays: 30, maxResponses: 100, questions: [{ id: question, label: "내용", type: "단문형 답변", required: true }] } }, { "idempotency-key": randomUUID() })), 201);
  const pub = await ok<{ token: string }>(await formAction(req("/forms/" + row.id + "/publish", "POST", who, { version: row.version }, { "idempotency-key": randomUUID() })), 201);
  return { ...row, question, token: pub.token };
}
async function submit(source: Awaited<ReturnType<typeof form>>, key = randomUUID()) { return ok<{ id: string }>(await submitPost(req("/public/forms/" + source.token + "/submissions", "POST", "anonymous", { answers: { [source.question]: "PRIVATE_ANSWER_NOT_IN_NOTIFICATION" }, consent: true }, { "idempotency-key": key })), 201); }
async function startImport() {
  const purpose = await ok<PurposeRecord>(await purposePost(req("/processing-purposes", "POST", "owner", { serviceId: service, name: "알림 시험 수집", purpose: "합성 CSV 처리", lawfulBasis: "consent", basisReference: "시험 양식", items: [{ name: "이름", kind: "general", required: true }], retentionMode: "days", retentionDays: 30, retentionReason: "", recipientIds: [] }, { "idempotency-key": randomUUID() })), 201);
  const bytes = Buffer.from("이름,동의\n합성 자료,yes\n");
  let row = await ok<ImportJobRecord>(await newImport(req("/imports", "POST", "owner", { serviceId: service, title: "알림 CSV", name: "notification.csv", mime: "text/csv", size: bytes.length, sha256: sha256(bytes), encoding: "utf-8" }, { "idempotency-key": randomUUID() })), 201);
  await ok(await uploadPut(new Request(origin + "/api/v1/uploads/" + row.fileId + "/content", { method: "PUT", body: new Uint8Array(bytes), headers: { origin, cookie: cookies.owner, "content-type": "text/csv" } })));
  await ok(await uploadPost(req("/uploads/" + row.fileId + "/complete", "POST")));
  row = await ok<ImportJobRecord>(await importAction(req("/imports/" + row.id + "/inspect", "POST", "owner", { version: row.version })));
  row = await ok<ImportJobRecord>(await importPatch(req("/imports/" + row.id, "PATCH", "owner", { version: row.version, mapping: { purposeId: purpose.id, fields: [{ name: "이름", column: 0, type: "text" }], collectedAt: { mode: "fixed", value: new Date(Date.now() - 60000).toISOString() }, retentionUntil: null, consentColumn: 1, evidenceColumn: null, sourceStatement: "합성 자료의 수집 동의 확인", source: "internal", sourceRecipientId: null } })));
  row = await ok<ImportJobRecord>(await importAction(req("/imports/" + row.id + "/validate", "POST", "owner", { version: row.version })));
  return ok<ImportJobRecord>(await importAction(req("/imports/" + row.id + "/commit", "POST", "owner", { version: row.version })), 202);
}
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "SubjectAccessRequest" CASCADE');
  for (const id of [tenant, foreign]) await db.company.create({ data: { id, name: "알림 QA", publicName: "알림 QA", policy: { create: {} } } });
  for (const [id, tenantId] of [[service, tenant], [second, tenant], [other, foreign]]) await db.service.create({ data: { id, tenantId, name: "알림 서비스 " + id, externalName: "알림 서비스" } });
  for (const [name, role] of [["owner", "owner"], ["admin", "admin"], ["sender", "sender"], ["editor", "editor"], ["privacy", "privacy"], ["viewer", "viewer"]] as const) await signup(name, role);
  await signup("foreign", "owner", foreign);
});
beforeEach(async () => {
  env.NOTIFICATION_TRANSPORT = "local"; env.LOCAL_NOTIFICATION_DIR = resolve(".local/notification-test", randomUUID());
  await db.apiRateLimit.deleteMany(); await db.rateLimit.deleteMany();
  await db.$transaction(async tx => {
    for (const row of await tx.notificationIntegration.findMany({ where: { deletedAt: null } })) {
      await cancelNotifications(tx, row.id, "TEST_CLEANUP"); await tx.notificationSubscription.deleteMany({ where: { integrationId: row.id } });
      await tx.notificationIntegration.update({ where: { id: row.id }, data: { name: "", enabled: false, endpointCipher: null, endpointHost: null, deletedAt: new Date(), version: { increment: 1 }, generation: { increment: 1 } } });
    }
  });
});
afterEach(() => { vi.restoreAllMocks(); env.NOTIFICATION_TRANSPORT = original.mode; env.LOCAL_NOTIFICATION_DIR = original.dir; });
afterAll(async () => { await db.$disconnect(); });

describe("notification CRUD and transactional delivery", () => {
  test("creates, reads, updates, replaces and erases a write-only webhook with optimistic locking", async () => {
    const row = await create(); const stored = await db.notificationIntegration.findUniqueOrThrow({ where: { id: row.id } });
    expect(decrypt(stored.endpointCipher!)).toBe(endpoint); expect(JSON.stringify(row)).not.toContain("SYNTHETICSECRET");
    await ok(await PATCH(req("/integrations/" + row.id, "PATCH", "owner", { version: row.version, name: "수정 알림", enabled: false, subscriptions: row.subscriptions.map(({ kind, targetId }) => ({ kind, targetId })), endpoint: endpoint.replace("SYNTHETICSECRET", "REPLACEDSECRET") })));
    await ok(await PATCH(req("/integrations/" + row.id, "PATCH", "owner", { version: row.version, name: "충돌", enabled: true, subscriptions: [{ kind: "submission.created", targetId: null }] })), 409);
    const changed = await ok<IntegrationRecord>(await GET(req("/integrations/" + row.id))); expect(changed).toMatchObject({ name: "수정 알림", enabled: false, version: 2, generation: 2 });
    await ok(await DELETE(req("/integrations/" + row.id, "DELETE", "owner", { serviceId: service, version: changed.version })));
    expect(await db.notificationIntegration.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ name: "", enabled: false, endpointCipher: null, endpointHost: null });
    await ok(await GET(req("/integrations/" + row.id)), 410);
    const logs = await db.auditEvent.findMany({ where: { resourceId: row.id } }); expect(JSON.stringify(logs)).not.toMatch(/SYNTHETICSECRET|REPLACEDSECRET|hooks.slack/);
  });
  test("serializes duplicate create and test keys and rejects changed payloads", async () => {
    const input = createBody(), key = randomUUID(); const results = await Promise.all([1, 2].map(() => POST(req("/integrations", "POST", "owner", input, { "idempotency-key": key })).then(r => ok<{ id: string }>(r, 201))));
    expect(results[0].id).toBe(results[1].id); await ok(await POST(req("/integrations", "POST", "owner", { ...input, name: "다른 본문" }, { "idempotency-key": key })), 409);
    const row = await ok<IntegrationRecord>(await GET(req("/integrations/" + results[0].id))), sendKey = randomUUID();
    const sent = await Promise.all([testSend(row, sendKey), testSend(row, sendKey)]); expect(sent[0].id).toBe(sent[1].id); expect((await history(row)).total).toBe(1);
  });
  test("rejects anonymous, disallowed roles, foreign tenants, cross-service deletion and stale contexts", async () => {
    const row = await create();
    for (const who of ["sender", "editor", "privacy", "viewer"]) { await ok(await GET(req("/integrations?serviceId=" + service, "GET", who)), 403); await ok(await POST(req("/integrations", "POST", who, createBody(), { "idempotency-key": randomUUID() })), 403); }
    await ok(await GET(req("/integrations/" + row.id, "GET", "anonymous")), 401); await ok(await GET(req("/integrations/" + row.id, "GET", "foreign")), 404);
    await ok(await DELETE(req("/integrations/" + row.id, "DELETE", "owner", { serviceId: second, version: row.version })), 404);
    const admin = await requireContext(req("/context", "GET", "admin").headers); await db.membership.update({ where: { id: members.admin }, data: { role: "viewer" } });
    try { await expect(readIntegration(admin, row.id)).rejects.toMatchObject({ status: 403 }); } finally { await db.membership.update({ where: { id: members.admin }, data: { role: "admin" } }); }
  });
  test("enforces CSRF, strict schemas, URL shape, service scope and disabled test rejection", async () => {
    await ok(await POST(req("/integrations", "POST", "owner", createBody(), { "idempotency-key": randomUUID(), origin: "https://evil.example" })), 403);
    for (const overrides of [{ tenantId: foreign }, { subscriptions: [] }, { subscriptions: [{ kind: "unknown", targetId: null }] }, { endpoint: "http://localhost" }, { name: "" }]) await ok(await POST(req("/integrations", "POST", "owner", createBody(overrides), { "idempotency-key": randomUUID() })), 422);
    await ok(await POST(req("/integrations", "POST", "owner", createBody({ serviceId: other }), { "idempotency-key": randomUUID() })), 404);
    const row = await create({ enabled: false }); await ok(await POST(req("/integrations/" + row.id + "/test", "POST", "owner", { version: row.version }, { "idempotency-key": randomUUID() })), 409);
  });
  test("filters stable paginated lists and rejects atomic bulk deletion with one stale row", async () => {
    const first = await create({ name: "검색 알림 A" }), secondRow = await create({ name: "검색 알림 B", provider: "teams", endpoint: teams, enabled: false }, "admin");
    await create({ name: "다른 알림" });
    const list = await ok<Paged<IntegrationRecord>>(await GET(req("/integrations?" + new URLSearchParams({ serviceId: service, search: "검색", pageSize: "1" })))); expect(list.total).toBe(2); expect(list.items).toHaveLength(1);
    const filtered = await ok<Paged<IntegrationRecord>>(await GET(req("/integrations?" + new URLSearchParams({ serviceId: service, provider: "teams", enabled: "false", creatorId: members.admin })))); expect(filtered.items.map(r => r.id)).toEqual([secondRow.id]);
    await ok(await POST(req("/integrations/delete", "POST", "owner", { serviceId: service, items: [{ id: first.id, version: 1 }, { id: secondRow.id, version: 999 }] })), 409);
    await ok(await GET(req("/integrations/" + first.id))); await ok(await POST(req("/integrations/delete", "POST", "owner", { serviceId: service, items: [{ id: first.id, version: 1 }, { id: secondRow.id, version: 1 }] })));
    expect((await ok<Paged<IntegrationRecord>>(await GET(req("/integrations?serviceId=" + service)))).total).toBe(1);
  });
  test("delivers one real local file despite two workers and records immutable attempt history", async () => {
    const row = await create(), sent = await testSend(row);
    const results = await Promise.all([runOneNotification("worker-one"), runOneNotification("worker-two")]); expect(results.filter(Boolean)).toHaveLength(1);
    const content = JSON.parse(await readFile(resolve(env.LOCAL_NOTIFICATION_DIR, sent.id + ".json"), "utf8")); expect(content.payload.text).toContain("알림 연결을 확인하는 테스트"); expect(JSON.stringify(content)).not.toMatch(/SYNTHETICSECRET|hooks.slack|owner@/);
    const record = (await history(row)).items[0]; expect(record).toMatchObject({ status: "succeeded", outcome: "local_delivered", attempts: 1, canRetry: false }); expect(record.history).toHaveLength(1);
    await expect(db.notificationAttempt.updateMany({ where: { deliveryId: sent.id }, data: { code: "FORGED" } })).rejects.toThrow();
  });
  test("shares the submission transaction, respects target and disabled filters, and never copies answers", async () => {
    const source = await form(), otherForm = await form();
    const all = await create(), exact = await create({ subscriptions: [{ kind: "submission.created", targetId: source.id }] });
    const ignored = await create({ subscriptions: [{ kind: "submission.created", targetId: otherForm.id }] }), disabled = await create({ enabled: false });
    const key = randomUUID(), submitted = await submit(source, key); expect((await submit(source, key)).id).toBe(submitted.id);
    expect((await history(all)).total).toBe(1); expect((await history(exact)).total).toBe(1); expect((await history(ignored)).total).toBe(0); expect((await history(disabled)).total).toBe(0);
    const event = await db.notificationEvent.findUniqueOrThrow({ where: { eventKey: "submission:" + submitted.id } }); expect(JSON.stringify(event)).not.toContain("PRIVATE_ANSWER");
    await db.$transaction(tx => emitNotificationEvent(tx, "submission.created", submitted.id)); expect((await history(all)).total).toBe(1);
    while (await runOneNotification("events-worker")) { /* drain this scope */ }
    const delivered = (await history(all)).items[0]; const file = await readFile(resolve(env.LOCAL_NOTIFICATION_DIR, delivered.id + ".json"), "utf8"); expect(file).toContain("새 응답"); expect(file).not.toContain("PRIVATE_ANSWER");
    const rollback = await form(); const count = await db.notificationEvent.count();
    await expect(db.$transaction(async tx => { const sub = await tx.submission.create({ data: { tenantId: tenant, formVersionId: (await tx.form.findUniqueOrThrow({ where: { id: rollback.id } })).publishedVersionId!, publicationId: (await tx.publication.findFirstOrThrow({ where: { formId: rollback.id, status: "active" } })).id, retentionUntil: new Date(Date.now() + 86400000), originalRetentionUntil: new Date(Date.now() + 86400000) } }); await emitNotificationEvent(tx, "submission.created", sub.id); throw new Error("ROLLBACK"); })).rejects.toThrow("ROLLBACK");
    expect(await db.notificationEvent.count()).toBe(count);
  });
  test("emits CSV completion from the actual importer once and preserves counts and target scope", async () => {
    const all = await create({ provider: "teams", endpoint: teams, subscriptions: [{ kind: "import.completed", targetId: null }] });
    const job = await startImport(); const exact = await create({ subscriptions: [{ kind: "import.completed", targetId: job.id }] });
    await runOneImport("notification-importer"); const imported = await db.importJob.findUniqueOrThrow({ where: { id: job.id } }); expect(imported.status).toBe("completed");
    const event = await db.notificationEvent.findUniqueOrThrow({ where: { eventKey: "import:" + job.id + ":" + imported.version } }); expect(event).toMatchObject({ importedRows: 1, failedRows: 0 });
    await runOneImport("notification-importer"); expect((await history(all)).total).toBe(1); expect((await history(exact)).total).toBe(1);
    const options = await ok<IntegrationOptions>(await GET(req("/integrations/options?serviceId=" + service))); expect(options.imports.some(i => i.id === job.id)).toBe(true);
    while (await runOneNotification("import-notifier")) { /* drain */ }
    const output = JSON.parse(await readFile(resolve(env.LOCAL_NOTIFICATION_DIR, (await history(all)).items[0].id + ".json"), "utf8")); expect(output.payload.attachments[0].content.body[0].text).toContain("반영 1건");
  });
  test("blocks wrong service or target kinds in both API and SQL", async () => {
    const source = await form(second), row = await create();
    for (const kind of ["submission.created", "import.completed"]) await ok(await POST(req("/integrations", "POST", "owner", createBody({ subscriptions: [{ kind, targetId: source.id }] }), { "idempotency-key": randomUUID() })), 422);
    await expect(db.notificationSubscription.updateMany({ where: { integrationId: row.id }, data: { targetId: source.id } })).rejects.toThrow();
    await expect(db.notificationEvent.create({ data: { tenantId: tenant, serviceId: service, kind: "submission.created", sourceId: randomUUID(), sourceVersion: 1, targetId: source.id, eventKey: "forged" } })).rejects.toThrow();
    const sent = await testSend(row); await expect(db.notificationDelivery.update({ where: { id: sent.id }, data: { serviceId: second, version: { increment: 1 } } })).rejects.toThrow();
    await expect(db.notificationEvent.updateMany({ where: { sourceId: row.id }, data: { sourceVersion: 999 } })).rejects.toThrow();
  });
  test("disable, URL replacement and deletion cancel leased or queued sends before any effect", async () => {
    for (const action of ["disable", "replace", "delete"]) {
      const row = await create(), sent = await testSend(row), claimed = await claimNotification("old-worker"); expect(claimed.id).toBe(sent.id);
      if (action === "disable") await ok(await POST(req("/integrations/" + row.id + "/enabled", "POST", "owner", { version: 1, enabled: false })));
      if (action === "replace") await ok(await PATCH(req("/integrations/" + row.id, "PATCH", "owner", { version: 1, name: row.name, enabled: true, endpoint: endpoint.replace("SYNTHETICSECRET", "REPLACEDSECRET"), subscriptions: [{ kind: "submission.created", targetId: null }] })));
      if (action === "delete") await ok(await DELETE(req("/integrations/" + row.id, "DELETE", "owner", { serviceId: service, version: 1 })));
      await processNotification(claimed, "old-worker"); expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: sent.id } })).status).toBe("cancelled"); await expect(access(resolve(env.LOCAL_NOTIFICATION_DIR, sent.id + ".json"))).rejects.toThrow();
    }
  });
  test("revoked creator and changed transport cancel work and do not silently switch to external sending", async () => {
    const row = await create({}, "admin"), sent = await testSend(row, randomUUID(), "admin");
    await db.membership.update({ where: { id: members.admin }, data: { role: "viewer" } });
    try { await runOneNotification("revoked-worker"); expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: sent.id } })).lastError).toBe("PERMISSION_REVOKED"); } finally { await db.membership.update({ where: { id: members.admin }, data: { role: "admin" } }); }
    const row2 = await create(), sent2 = await testSend(row2); env.NOTIFICATION_TRANSPORT = "webhook";
    const spy = vi.spyOn(transport, "deliverNotification"); await runOneNotification("environment-worker"); expect(spy).not.toHaveBeenCalled(); expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: sent2.id } })).lastError).toBe("TRANSPORT_CHANGED");
  });
  test("expired source data and archived services suppress queued notifications", async () => {
    const source = await form(), row = await create(); const submitted = await submit(source);
    await db.submission.update({ where: { id: submitted.id }, data: { retentionUntil: new Date(Date.now() - 1000) } }); await runOneNotification("expiry-worker"); expect((await history(row)).items[0].error).toBe("SOURCE_UNAVAILABLE");
    const sent = await testSend(row); await db.service.update({ where: { id: service }, data: { status: "archived" } });
    try { await runOneNotification("archived-worker"); expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: sent.id } })).lastError).toBe("PERMISSION_REVOKED"); } finally { await db.service.update({ where: { id: service }, data: { status: "active" } }); }
  });
  test("failed local storage retries safely and manual retry has a bounded budget", async () => {
    const row = await create(), sent = await testSend(row), goodDir = env.LOCAL_NOTIFICATION_DIR; env.LOCAL_NOTIFICATION_DIR = "/dev/null/notifications";
    for (let attempt = 1; attempt <= 3; attempt++) { await runOneNotification("file-worker"); const current = await db.notificationDelivery.findUniqueOrThrow({ where: { id: sent.id } }); expect(current.attempts).toBe(attempt); if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 5100)); }
    const failed = (await history(row)).items[0]; expect(failed).toMatchObject({ status: "failed", error: "LOCAL_WRITE_FAILED", canRetry: true });
    env.LOCAL_NOTIFICATION_DIR = goodDir; const key = randomUUID(); const path = "/integrations/" + row.id + "/deliveries/" + sent.id + "/retry";
    const retry = await ok<{ id: string }>(await POST(req(path, "POST", "owner", { version: failed.version }, { "idempotency-key": key })), 202); expect(retry.id).toBe(sent.id);
    await ok(await POST(req(path, "POST", "owner", { version: failed.version }, { "idempotency-key": key })), 202); await runOneNotification("file-worker"); expect((await history(row)).items[0]).toMatchObject({ status: "succeeded", attempts: 4, maxAttempts: 6 });
    await ok(await POST(req(path, "POST", "owner", { version: (await history(row)).items[0].version }, { "idempotency-key": randomUUID() })), 409);
  }, 20000);
  test("recovers pre-send leases, preserves ambiguous sends and prevents automatic or manual duplicate effects", async () => {
    const row = await create(), before = await testSend(row), after = await testSend(row);
    const past = new Date(Date.now() - 1000);
    for (const sent of [before, after]) await db.notificationDelivery.update({ where: { id: sent.id }, data: { status: "leased", attempts: 1, leaseOwner: "terminated-worker", leaseUntil: past, startedAt: new Date(Date.now() - 70000), version: { increment: 1 } } });
    await db.notificationDelivery.update({ where: { id: after.id }, data: { status: "sending", version: { increment: 1 } } });
    expect(await recoverNotifications()).toBe(2); expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: before.id } })).status).toBe("retry");
    const uncertain = await db.notificationDelivery.findUniqueOrThrow({ where: { id: after.id } }); expect(uncertain.status).toBe("unknown");
    await runOneNotification("new-worker"); expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: before.id } })).status).toBe("succeeded"); expect(await runOneNotification("new-worker")).toBe(false);
    await ok(await POST(req("/integrations/" + row.id + "/deliveries/" + after.id + "/retry", "POST", "owner", { version: uncertain.version }, { "idempotency-key": randomUUID() })), 409); await expect(access(resolve(env.LOCAL_NOTIFICATION_DIR, after.id + ".json"))).rejects.toThrow();
  });
  test("a configuration change waits for an in-flight delivery and applies before subsequent work", async () => {
    const row = await create(), first = await testSend(row), secondSend = await testSend(row);
    let release!: () => void, reached!: () => void; const ready = new Promise<void>(r => { reached = r; }); const gate = new Promise<void>(r => { release = r; });
    vi.spyOn(transport, "deliverNotification").mockImplementation(async () => { reached(); await gate; return { kind: "success", outcome: "local_delivered" }; });
    const running = runOneNotification("inflight-worker"); await ready;
    let changed = false; const change = POST(req("/integrations/" + row.id + "/enabled", "POST", "owner", { version: row.version, enabled: false })).then(async r => { await ok(r); changed = true; });
    await new Promise(resolve => setTimeout(resolve, 50)); expect(changed).toBe(false); release(); await running; await change;
    const records = await db.notificationDelivery.findMany({ where: { id: { in: [first.id, secondSend.id] } } }); expect(records.map(r => r.status).sort()).toEqual(["cancelled", "succeeded"]);
  });
});

function fakeHttp(status: number, body = "ok", headers: Record<string, string> = {}) {
  const calls: { options: RequestOptions; body: string }[] = [];
  const replacement = ((options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    let bytes = ""; const request = new Writable({ write(chunk, _encoding, done) { bytes += chunk.toString(); done(); } });
    request.on("finish", () => { calls.push({ options, body: bytes }); const stream = new PassThrough(); const response = stream as unknown as IncomingMessage; response.statusCode = status; response.headers = headers; callback(response); queueMicrotask(() => stream.end(body)); });
    return request as unknown as ClientRequest;
  }) as typeof https.request;
  vi.spyOn(https, "request").mockImplementation(replacement); return calls;
}
const transportInput = () => ({ id: randomUUID(), provider: "slack" as const, transport: "webhook", endpoint, text: "합성 알림" });
describe("notification network boundary", () => {
  test("rejects credentials, IP literals, redirects disguised as paths and unknown or duplicate query parameters", () => {
    for (const url of ["http://hooks.slack.com/services/T1/B1/ABCDEFGHIJK", "https://user:pass@hooks.slack.com/services/T1/B1/ABCDEFGHIJK", "https://127.0.0.1/services/T1/B1/ABCDEFGHIJK", "https://2130706433/a", endpoint + "#secret", endpoint + "?redirect=https://internal", endpoint.replace("hooks.slack.com", "hooks.slack.com.evil.example"), endpoint.replace("https://", "https://[::1]/"), endpoint.replace(".com/", ".com:444/"), endpoint.replace("services", "%73ervices")]) expect(() => transport.notificationEndpoint("slack", url)).toThrow();
    for (const url of [teams + "&sig=another", teams + "&evil=x", teams.replace("environment.api.powerplatform.com", "evil.example"), teams.replace("%2Ftriggers%2Fmanual%2Frun", "%2Fother")]) expect(() => transport.notificationEndpoint("teams", url)).toThrow();
    expect(transport.notificationEndpoint("teams", teams).hostname).toContain("environment.api.powerplatform.com");
  });
  test("rejects non-public IPv4, mapped IPv6, local IPv6 and documentation networks", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "100.64.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.2", "198.18.1.1", "192.0.2.2", "203.0.113.5", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fd00::1", "fe80::1", "2001:db8::1", "2002:7f00:1::", "3fff::1"]) expect(transport.publicNotificationAddress(address), address).toBe(false);
    for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(transport.publicNotificationAddress(address), address).toBe(true);
  });
  test("blocks mixed DNS answers before making a request and never follows redirects", async () => {
    env.NOTIFICATION_TRANSPORT = "webhook"; const dnsSpy = vi.spyOn(dns, "lookup"); dnsSpy.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }] as never);
    const calls = fakeHttp(302, "", { location: "http://127.0.0.1/secret" }); expect(await transport.deliverNotification(transportInput())).toMatchObject({ kind: "failed", code: "UNSAFE_DNS" }); expect(calls).toHaveLength(0);
    dnsSpy.mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never); expect(await transport.deliverNotification(transportInput())).toMatchObject({ kind: "failed", code: "REDIRECT_BLOCKED" }); expect(calls).toHaveLength(1);
  });
  test("pins the checked IP, keeps TLS hostname verification and sends bounded provider-specific JSON", async () => {
    env.NOTIFICATION_TRANSPORT = "webhook"; vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never); const calls = fakeHttp(200);
    expect(await transport.deliverNotification(transportInput())).toMatchObject({ kind: "success", outcome: "accepted" });
    expect(calls[0].options).toMatchObject({ hostname: "hooks.slack.com", servername: "hooks.slack.com", rejectUnauthorized: true, agent: false, method: "POST" });
    const callback = vi.fn(); (calls[0].options.lookup as (host: string, options: object, callback: (error: null, address: string, family: number) => void) => void)("rebound.evil", {}, callback); expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    expect(JSON.parse(calls[0].body)).toMatchObject({ text: "합성 알림", mrkdwn: false, unfurl_links: false });
    expect(await transport.deliverNotification({ ...transportInput(), provider: "teams", endpoint: teams })).toMatchObject({ kind: "success", outcome: "accepted" }); expect(JSON.parse(calls[1].body).attachments[0].content).toMatchObject({ type: "AdaptiveCard", version: "1.2" });
  });
  test("treats rate limits as retryable but 5xx and oversized responses as uncertain without leaking provider text", async () => {
    env.NOTIFICATION_TRANSPORT = "webhook"; vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never); fakeHttp(429, "SECRET_PROVIDER_CONTENT", { "retry-after": "12" });
    expect(await transport.deliverNotification(transportInput())).toEqual({ kind: "retry", code: "RATE_LIMITED", httpStatus: 429, retrySeconds: 12 });
    vi.mocked(https.request).mockRestore(); fakeHttp(503, "SECRET_PROVIDER_CONTENT"); expect(await transport.deliverNotification(transportInput())).toEqual({ kind: "unknown", code: "PROVIDER_UNCERTAIN", httpStatus: 503 });
    vi.mocked(https.request).mockRestore(); fakeHttp(200, "x".repeat(16385)); expect(await transport.deliverNotification(transportInput())).toEqual({ kind: "unknown", code: "RESPONSE_TOO_LARGE", httpStatus: 200 });
  });
});

describe("notification limits and failure boundaries", () => {
  test("serializes concurrent creation at the 50 active integration service limit", async () => {
    const row = await create(); const stored = await db.notificationIntegration.findUniqueOrThrow({ where: { id: row.id } });
    await db.notificationIntegration.createMany({ data: Array.from({ length: 48 }, (_, index) => ({ tenantId: tenant, serviceId: service, creatorId: members.owner, name: "정원 시험 " + index, provider: "slack", transport: "local", endpointCipher: stored.endpointCipher, endpointHost: stored.endpointHost })) });
    const results = await Promise.all([1, 2].map(() => POST(req("/integrations", "POST", "owner", createBody(), { "idempotency-key": randomUUID() })))); expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect(await db.notificationIntegration.count({ where: { serviceId: service, deletedAt: null } })).toBe(50);
    const lastPage = await ok<Paged<IntegrationRecord>>(await GET(req("/integrations?" + new URLSearchParams({ serviceId: service, page: "3", pageSize: "20" })))); expect(lastPage.items).toHaveLength(10);
    await expect(db.notificationIntegration.create({ data: { tenantId: foreign, serviceId: service, creatorId: members.foreign, name: "교차 범위", provider: "slack", transport: "local", endpointCipher: stored.endpointCipher, endpointHost: stored.endpointHost } })).rejects.toThrow();
  });
  test("persists an uncertain HTTP result, never auto-retries it and excludes provider response text", async () => {
    env.NOTIFICATION_TRANSPORT = "webhook"; const row = await create(), sent = await testSend(row);
    vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never); const calls = fakeHttp(503, "SECRET_RECIPIENT_AND_CREDENTIAL");
    await runOneNotification("uncertain-http"); const record = (await history(row)).items[0]; expect(record).toMatchObject({ id: sent.id, status: "unknown", canRetry: false, error: "PROVIDER_UNCERTAIN" });
    expect(JSON.stringify(record)).not.toContain("SECRET_RECIPIENT"); expect(await runOneNotification("again")).toBe(false); expect(calls).toHaveLength(1);
  });
  test("enforces a 24 hour event deadline and recovers exhausted leases to a retryable failure", async () => {
    const row = await create(), old = await testSend(row); vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86400001);
    await runOneNotification("late-event"); expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: old.id } })).lastError).toBe("EVENT_EXPIRED"); vi.mocked(Date.now).mockRestore();
    const exhausted = await testSend(row);
    // Reproduce a worker lost after its final permitted claim; no transport is called.
    for (let n = 1; n <= 3; n++) {
      await db.notificationDelivery.update({ where: { id: exhausted.id }, data: { status: "leased", attempts: { increment: 1 }, leaseOwner: "lost-worker", leaseUntil: new Date(Date.now() - 1), startedAt: new Date(Date.now() - 70000), version: { increment: 1 } } });
      await recoverNotifications();
    }
    const historyRow = (await history(row)).items.find(r => r.id === exhausted.id)!; expect(historyRow).toMatchObject({ status: "failed", error: "LEASE_EXHAUSTED", canRetry: true, attempts: 3 }); expect(historyRow.history).toHaveLength(3);
  });
  test("handles DNS failure and IPv6-only hosts without opening a socket", async () => {
    env.NOTIFICATION_TRANSPORT = "webhook"; const lookup = vi.spyOn(dns, "lookup").mockRejectedValue(new Error("PRIVATE_DNS_DETAIL")); const calls = fakeHttp(200);
    expect(await transport.deliverNotification(transportInput())).toEqual({ kind: "failed", code: "DNS_UNAVAILABLE" });
    lookup.mockResolvedValue([{ address: "2606:4700:4700::1111", family: 6 }] as never); expect(await transport.deliverNotification(transportInput())).toEqual({ kind: "failed", code: "IPV4_REQUIRED" }); expect(calls).toHaveLength(0);
  });
  test("bounds external I/O time and treats a stalled written request as uncertain", async () => {
    env.NOTIFICATION_TRANSPORT = "webhook"; vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
    vi.spyOn(https, "request").mockImplementation((() => new Writable({ write(_chunk, _encoding, done) { done(); } }) as unknown as ClientRequest) as typeof https.request);
    vi.useFakeTimers();
    try { const sending = transport.deliverNotification(transportInput()); await vi.advanceTimersByTimeAsync(8001); expect(await sending).toEqual({ kind: "unknown", code: "DELIVERY_TIMEOUT" }); }
    finally { vi.useRealTimers(); }
  });
});
