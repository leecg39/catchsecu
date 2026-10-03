import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireContext } from "@/server/context";
import { decrypt } from "@/server/crypto";
import { json, route } from "@/server/http";
import { createShare, getShare, listShares, shareOptions, shareEvents, changeShare } from "@/server/sharing";
import { POST as formCreate } from "@/app/api/v1/forms/route";
import { POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { GET as shareList, POST as shareCreate } from "@/app/api/v1/share-grants/route";
import { GET as shareGet, PATCH as shareEdit, POST as shareAction, DELETE as shareDelete } from "@/app/api/v1/share-grants/[...segments]/route";
import { GET as viewerGet, POST as viewerPost } from "@/app/api/v1/viewer/[...segments]/route";
import { roleCapabilities } from "@/server/permissions";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const barriers: { name: string; waiting: number; status: number }[] = [];
const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
function req(path: string, method = "GET", value?: unknown, cookie = "", key = randomUUID(), extra: Record<string, string> = {}) {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, "content-type": "application/json", "idempotency-key": key, ...extra },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
const cookieOf = (response: Response) => response.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
async function ok(response: Response, status = 200) { expect(response.status, response.status >= 400 ? JSON.stringify(await response.clone().json()) : "").toBe(status); return response.json(); }
async function fixture() {
  const email = "share-gate-" + randomUUID() + "@catchsecu.test", password = "Share-gate!123";
  await ok(await auth.handler(req("/auth/sign-up/email", "POST", { email, password, name: "공유 경계 검증" })));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const backup = await db.user.create({ data: { name: "보조 소유자", email: "share-backup-" + randomUUID() + "@catchsecu.test", emailVerified: true } });
  const company = await db.company.create({ data: { name: "공유 합성 회사", publicName: "공유 검증", policy: { create: {} },
    memberships: { create: [{ userId: user.id, role: "owner" }, { userId: backup.id, role: "owner" }] }, services: { create: { name: "공유 서비스", externalName: "공유" } } }, include: { services: true } });
  const response = await auth.handler(req("/auth/sign-in/email", "POST", { email, password })); await ok(response);
  const cookie = cookieOf(response), ctx = await requireContext(req("/context", "GET", undefined, cookie).headers), serviceId = company.services[0].id;
  const text = randomUUID(), file = randomUUID();
  const form = await ok(await formCreate(req("/forms", "POST", { serviceId, title: "공유 범위 검증", content: { body: "합성 공유", consentRequired: true,
    consentPurpose: "시험", retentionDays: 30, maxResponses: 10, questions: [{ id: text, type: "단문형 답변", label: "공유 이름", required: false }, { id: file, type: "파일 업로드", label: "공유 파일", required: false }] } }, cookie)), 201);
  await ok(await formAction(req("/forms/" + form.id + "/publish", "POST", { version: form.version }, cookie)), 201);
  const versionId = (await db.form.findUniqueOrThrow({ where: { id: form.id } })).publishedVersionId!;
  const input = { formId: form.id as string, formVersionId: versionId, email: "share-recipient@catchsecu.test", questionIds: [text], expiresAt: new Date(Date.now() + 86400000).toISOString() };
  return { company, user, cookie, ctx, serviceId, text, file, form, input };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const create = (f: Fixture, key = randomUUID(), input = f.input) => shareCreate(req("/share-grants", "POST", input, f.cookie, key));
async function invitation(id: string, version = 1) {
  const mail = decrypt<{ to: string; text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + id + ":invite:" + version } })).payloadCipher);
  return { email: mail.to, invitationCode: mail.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)![1] };
}
async function challenge(f: Fixture, grant: { id: string }) {
  const response = await viewerPost(req("/viewer/challenges", "POST", { ...await invitation(grant.id), formCode: f.form.id, consent: true }));
  const result = await ok(response, 202), cookie = cookieOf(response);
  const mail = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + grant.id + ":challenge:" + result.id } })).payloadCipher);
  return { id: result.id as string, cookie, code: mail.text.match(/인증코드: (\d{6})/)![1] };
}
async function delayedAudit(action: string, operation: () => Promise<void>) {
  await db.$executeRawUnsafe(`CREATE FUNCTION qa_share_gate_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='${action}' THEN PERFORM pg_sleep(0.8); END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER qa_share_gate_delay BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_share_gate_delay()');
  try { await operation(); } finally { await db.$executeRawUnsafe('DROP TRIGGER qa_share_gate_delay ON "AuditEvent"'); await db.$executeRawUnsafe('DROP FUNCTION qa_share_gate_delay()'); }
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job" CASCADE'); });
afterAll(async () => { await mkdir("docs/qa/P06-T04", { recursive: true }); await writeFile("docs/qa/P06-T04/lock-barriers.json", JSON.stringify({ checkedAt: new Date().toISOString(), barriers }, null, 2) + "\n"); await db.$disconnect(); });

test.each(["file-capability", "form-archived", "service-archived"])("creation replay rechecks current %s", async kind => {
  const f = await fixture(), key = randomUUID(), input = { ...f.input, questionIds: [f.file] }, g = await ok(await create(f, key, input), 201);
  if (kind === "file-capability") {
    await db.membership.update({ where: { id: f.ctx.member.id }, data: { role: "privacy" } });
    await db.serviceGrant.create({ data: { tenantId: f.company.id, memberId: f.ctx.member.id, serviceId: f.serviceId, capabilities: roleCapabilities("privacy").filter(c => c !== "file.read") } });
  } else if (kind === "form-archived") await db.form.update({ where: { id: f.form.id }, data: { status: "archived" } });
  else await db.service.update({ where: { id: f.serviceId }, data: { status: "archived" } });
  expect((await create(f, key, input)).status).toBe(kind === "file-capability" ? 403 : 409);
  expect(await db.shareGrant.count()).toBe(1); expect(await db.job.count({ where: { dedupeKey: "mail:share:" + g.id + ":invite:1" } })).toBe(1);
});
test.each(["expired", "revoked"])("creation replay cannot return an active snapshot after grant %s", async kind => {
  const f = await fixture(), key = randomUUID(), g = await ok(await create(f, key), 201);
  if (kind === "expired") await db.shareGrant.update({ where: { id: g.id }, data: { createdAt: new Date(Date.now() - 10000), expiresAt: new Date(Date.now() - 1000) } });
  else await ok(await shareDelete(req("/share-grants/" + g.id, "DELETE", undefined, f.cookie, randomUUID(), { "if-match": "1" })));
  expect((await create(f, key)).status).toBe(410); expect(await db.shareGrant.count()).toBe(1);
});
test("recipient change clears both resource-bound and legacy creation cache ciphertext", async () => {
  const f = await fixture(), key = randomUUID(), g = await ok(await create(f, key), 201), scope = "share:create:" + f.company.id + ":" + f.ctx.member.id;
  const record = await db.idempotencyRecord.findUniqueOrThrow({ where: { scope_key: { scope, key } } });
  await db.idempotencyRecord.create({ data: { ...record, id: randomUUID(), key: randomUUID(), tenantId: null, resourceType: null, resourceId: null } });
  const updated = await ok(await shareEdit(req("/share-grants/" + g.id, "PATCH", { version: 1, email: "changed@catchsecu.test", expiresAt: g.expiresAt, questionIds: [f.text] }, f.cookie)));
  expect(updated.email).toBe("changed@catchsecu.test");
  for (const item of await db.idempotencyRecord.findMany({ where: { scope } })) { expect(item.responseCipher).toBeNull(); expect(item.requestHash).toBeNull(); expect(item.invalidatedAt).not.toBeNull(); }
  expect((await create(f, key)).status).toBe(410);
});
test.each(["create", "update"])("manager %s rolls back successful audit and mail when session expires during audit INSERT", async action => {
  const f = await fixture(), g = action === "update" ? await ok(await create(f), 201) : null;
  const before = { grants: await db.shareGrant.count(), jobs: await db.job.count(), audits: await db.auditEvent.count() };
  await delayedAudit("share." + (action === "create" ? "created" : "updated"), async () => {
    await db.session.update({ where: { id: f.ctx.session.id }, data: { expiresAt: new Date(Date.now() + 500) } });
    const handler = route(async (_r, requestId) => json(action === "create" ? await db.$transaction(tx => createShare(f.ctx, f.input, requestId, tx)) : await changeShare(f.ctx, g!.id, { version: 1, email: "delay@catchsecu.test", expiresAt: g!.expiresAt, questionIds: [f.text] }, "update", requestId)));
    expect((await handler(req("/share-grants"))).status).toBe(401);
  });
  expect({ grants: await db.shareGrant.count(), jobs: await db.job.count(), audits: await db.auditEvent.count() }).toEqual(before);
  if (g) expect((await db.shareGrant.findUniqueOrThrow({ where: { id: g.id } })).version).toBe(1);
});
test("a share metadata read waits for the actual grant lock and rejects session expiry", async () => {
  const f = await fixture(), g = await ok(await create(f), 201), client = new Client({ connectionString: env.DATABASE_URL }); await client.connect();
  let response: Promise<Response> | undefined;
  try {
    await client.query('BEGIN'); await client.query('SELECT id FROM "ShareGrant" WHERE id=$1 FOR UPDATE', [g.id]);
    const deadline = new Date(Date.now() + 1600);
    await client.query('UPDATE "Session" SET "expiresAt"=$1 WHERE id=$2', [deadline.toISOString(), f.ctx.session.id]);
    // Commit the session deadline before holding the grant independently.
    await client.query('COMMIT'); expect((await db.session.findUniqueOrThrow({ where: { id: f.ctx.session.id } })).expiresAt.toISOString()).toBe(deadline.toISOString());
    await client.query('BEGIN'); await client.query('SELECT id FROM "ShareGrant" WHERE id=$1 FOR UPDATE', [g.id]);
    const handler = route(async () => json(await getShare(f.ctx, g.id))); response = handler(req("/share-grants/" + g.id));
    let waiting = 0;
    for (let i = 0; i < 60 && !waiting; i++) { await client.query('SELECT pg_stat_clear_snapshot()'); waiting = Number((await client.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%ShareGrant%'")).rows[0].count); if (!waiting) await pause(20); }
    expect(waiting).toBeGreaterThan(0); await pause(1700); await client.query('COMMIT'); const result = await response;
    barriers.push({ name: "share-wait-session", waiting, status: result.status }); expect(result.status).toBe(401);
  } finally { await client.query('ROLLBACK'); await response; await client.end(); }
});
test.each(["challenge", "grant"])("verification does not commit an already expired %s after authentication audit INSERT", async kind => {
  const f = await fixture(), g = await ok(await create(f), 201), c = await challenge(f, g);
  const before = await db.auditEvent.count({ where: { action: "share.authenticated" } });
  await delayedAudit("share.authenticated", async () => {
    const expiresAt = new Date(Date.now() + 500);
    if (kind === "challenge") await db.viewerChallenge.update({ where: { id: c.id }, data: { expiresAt } });
    else await db.shareGrant.update({ where: { id: g.id }, data: { expiresAt } });
    const response = await viewerPost(req("/viewer/challenges/" + c.id + "/verify", "POST", { code: c.code }, c.cookie));
    expect(response.status).toBe(422); expect(response.headers.getSetCookie()).toHaveLength(0);
  });
  expect(await db.viewerSession.count()).toBe(0); expect((await db.viewerChallenge.findUniqueOrThrow({ where: { id: c.id } })).consumedAt).toBeNull();
  expect(await db.auditEvent.count({ where: { action: "share.authenticated" } })).toBe(before);
});
test("manager and viewer reject unknown or duplicate queries instead of silently discarding input", async () => {
  const f = await fixture(), g = await ok(await create(f), 201), c = await challenge(f, g);
  const verified = await viewerPost(req("/viewer/challenges/" + c.id + "/verify", "POST", { code: c.code }, c.cookie)); await ok(verified); const cookie = cookieOf(verified);
  for (const [handler, path, credentials] of [
    [shareList, "/share-grants?formId=" + f.form.id + "&unknown=x", f.cookie], [shareList, "/share-grants?formId=" + f.form.id + "&page=1&page=2", f.cookie],
    [shareGet, "/share-grants/options?formId=" + f.form.id + "&formId=" + f.form.id, f.cookie], [shareGet, "/share-grants/" + g.id + "/events?search=x", f.cookie],
    [shareGet, "/share-grants/" + g.id + "?unknown=x", f.cookie], [viewerGet, "/viewer/submissions?page=1&page=2", cookie], [viewerGet, "/viewer/session?unknown=x", cookie],
  ] as const) expect((await handler(req(path, "GET", undefined, credentials))).status, path).toBe(422);
});
test("share and viewer list pagination returns the current last page after stale high-page navigation", async () => {
  const f = await fixture(), g = await ok(await create(f), 201);
  const list = await ok(await shareList(req("/share-grants?formId=" + f.form.id + "&page=999&pageSize=1", "GET", undefined, f.cookie)));
  expect(list.page).toBe(1); expect(list.items).toHaveLength(1);
  const events = await ok(await shareGet(req("/share-grants/" + g.id + "/events?page=999&pageSize=1", "GET", undefined, f.cookie))); expect(events.page).toBe(1); expect(events.items).toHaveLength(1);
  const c = await challenge(f, g), authenticated = await viewerPost(req("/viewer/challenges/" + c.id + "/verify", "POST", { code: c.code }, c.cookie)); await ok(authenticated);
  const responses = await ok(await viewerGet(req("/viewer/submissions?page=999&pageSize=1", "GET", undefined, cookieOf(authenticated)))); expect(responses.page).toBe(1); expect(responses.items).toEqual([]);
});
test("server permissions expose archived read/revoke and disable invite/edit/resend", async () => {
  const f = await fixture(), g = await ok(await create(f), 201);
  await db.form.update({ where: { id: f.form.id }, data: { status: "archived" } });
  const data = await ok(await shareList(req("/share-grants?formId=" + f.form.id, "GET", undefined, f.cookie)));
  expect(data.permissions.canCreate).toBe(false); expect(data.items[0].actions).toEqual({ edit: false, resend: false, revoke: true });
  const options = await ok(await shareGet(req("/share-grants/options?formId=" + f.form.id, "GET", undefined, f.cookie))); expect(options.permissions.canCreate).toBe(false);
  await ok(await shareDelete(req("/share-grants/" + g.id, "DELETE", undefined, f.cookie, randomUUID(), { "if-match": "1" })));
  expect((await ok(await shareGet(req("/share-grants/" + g.id, "GET", undefined, f.cookie)))).actions.revoke).toBe(false);
});
test("file capability governs selectable fields and resend while permitting removal or revoke", async () => {
  const f = await fixture(), g = await ok(await create(f, randomUUID(), { ...f.input, questionIds: [f.file] }), 201);
  await db.membership.update({ where: { id: f.ctx.member.id }, data: { role: "privacy" } });
  await db.serviceGrant.create({ data: { tenantId: f.company.id, memberId: f.ctx.member.id, serviceId: f.serviceId, capabilities: roleCapabilities("privacy").filter(c => c !== "file.read") } });
  const options = await ok(await shareGet(req("/share-grants/options?formId=" + f.form.id, "GET", undefined, f.cookie)));
  expect(options.permissions.canSelectFiles).toBe(false); expect(options.versions[0].questions.find((q: { id: string }) => q.id === f.file).selectable).toBe(false);
  const current = await ok(await shareGet(req("/share-grants/" + g.id, "GET", undefined, f.cookie))); expect(current.actions).toEqual({ edit: true, resend: false, revoke: true });
  expect((await shareAction(req("/share-grants/" + g.id + "/resend", "POST", { version: 1 }, f.cookie))).status).toBe(403);
  await ok(await shareEdit(req("/share-grants/" + g.id, "PATCH", { version: 1, email: g.email, questionIds: [f.text], expiresAt: g.expiresAt }, f.cookie)));
});
test("a captured manager Context cannot use any sharing operation after logout", async () => {
  const f = await fixture(), g = await ok(await create(f), 201); await ok(await auth.handler(req("/auth/sign-out", "POST", {}, f.cookie)));
  const operations = [() => getShare(f.ctx, g.id), () => listShares(f.ctx, f.form.id, { page: 1, pageSize: 10 }), () => shareOptions(f.ctx, f.form.id),
    () => shareEvents(f.ctx, g.id, { page: 1, pageSize: 10 }), () => changeShare(f.ctx, g.id, { version: 1 }, "revoke", randomUUID()),
    () => db.$transaction(tx => createShare(f.ctx, f.input, randomUUID(), tx))];
  for (const operation of operations) await expect(operation()).rejects.toMatchObject({ status: 401 });
  expect((await db.shareGrant.findUniqueOrThrow({ where: { id: g.id } })).revokedAt).toBeNull();
});
