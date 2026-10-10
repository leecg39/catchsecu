import { randomUUID } from "node:crypto";
import { access as fileAccess, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeEach, expect, test } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { decrypt } from "@/server/crypto";
import { runOneJob } from "@/server/jobs";
import { GET, POST } from "@/app/api/v1/subjects/[...segments]/route";
import { POST as formCreate } from "@/app/api/v1/forms/route";
import { POST as formAction } from "@/app/api/v1/forms/[...segments]/route";
import { POST as submitPublic } from "@/app/api/v1/public/forms/[...segments]/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test DB required.");
const barriers: { table: string; waiting: number; status: number }[] = [];
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function req(path: string, method = "GET", value?: unknown, cookie = "", session = "") {
  return new Request(origin + "/api/v1" + path, { method, headers: { origin, cookie, "content-type": "application/json", "idempotency-key": randomUUID(), "x-subject-session": session },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
const cookieOf = (r: Response) => r.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
async function ok(r: Response, status = 200) { expect(r.status, r.status >= 400 ? JSON.stringify(await r.clone().json()) : "").toBe(status); return r.json(); }
async function fixture() {
  const email = "subject-gate-" + randomUUID() + "@catchsecu.test", password = "Subject-gate!123";
  await ok(await auth.handler(req("/auth/sign-up/email", "POST", { email, password, name: "Subject gate" })));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const backup = await db.user.create({ data: { name: "Backup", email: randomUUID() + "@catchsecu.test", emailVerified: true } });
  const company = await db.company.create({ data: { name: "Subject gate " + randomUUID(), publicName: "Subject gate",
    policy: { create: {} }, memberships: { create: [{ userId: user.id, role: "owner" }, { userId: backup.id, role: "owner" }] },
    services: { create: { name: "Subject service", externalName: "Subject service" } } }, include: { services: true } });
  const owner = cookieOf(await auth.handler(req("/auth/sign-in/email", "POST", { email, password }))), serviceId = company.services[0].id;
  const name = randomUUID(), contactEmail = randomUUID(), secret = randomUUID();
  const form = await ok(await formCreate(req("/forms", "POST", { serviceId, title: "Subject consent", content: { body: "Synthetic consent", consentRequired: true,
    consentPurpose: "Synthetic purpose", retentionDays: 30, maxResponses: 100, questions: [
      { id: name, type: "단문형 답변", label: "Name", required: true, subjectRole: "name" },
      { id: contactEmail, type: "단문형 답변", label: "Email", required: true, subjectRole: "email" },
      { id: secret, type: "장문형 답변", label: "Secret", required: false }] } }, owner)), 201);
  const publication = await ok(await formAction(req("/forms/" + form.id + "/publish", "POST", { version: form.version }, owner)), 201);
  const contact = { name: "Subject " + randomUUID(), email: randomUUID() + "@catchsecu.test" };
  const sub = await ok(await submitPublic(req("/public/forms/" + publication.token + "/submissions", "POST", { consent: true, answers: { [name]: contact.name, [contactEmail]: contact.email, [secret]: "PRIVATE-ANSWER" } })), 201);
  return { company, serviceId, sub, contact };
}
async function access(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await POST(req("/subjects/access-requests", "POST", { ...f.contact, consent: true })); await ok(response.clone(), 202);
  const request = await db.subjectAccessRequest.findFirstOrThrow({ where: { scopes: { some: { subject: { submissions: { some: { id: f.sub.id } } } } } }, orderBy: { createdAt: "desc" } });
  const mail = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:subject-access:" + request.id } })).payloadCipher);
  const token = mail.text.match(/\/infoOwner\/agree-history\/([A-Za-z0-9_-]{43})/)![1];
  return { token, cookie: cookieOf(response), request };
}
async function login(f: Awaited<ReturnType<typeof fixture>>) {
  const a = await access(f), r = await POST(req("/subjects/sessions", "POST", { token: a.token }, a.cookie)), session = await ok(r, 201);
  return { ...session, cookie: cookieOf(r), access: a } as { id: string; cookie: string; access: typeof a };
}
type Login = Awaited<ReturnType<typeof login>>;
const subject = (s: Login, path: string, method = "GET", value?: unknown) => req("/subjects" + path, method, value, s.cookie, s.id);
async function withdrawal(s: Login, id: string) { return ok(await POST(subject(s, "/me/withdrawals", "POST", { submissionId: id, version: 1 })), 201); }
async function delay(table: "AuditEvent" | "SubjectSession", action: string, operation: () => Promise<void>, seconds = 0.8) {
  const condition = table === "AuditEvent" ? "IF NEW.action = '" + action + "' THEN PERFORM pg_sleep(" + seconds + "); END IF;" : "PERFORM pg_sleep(" + seconds + ");";
  await db.$executeRawUnsafe('CREATE FUNCTION qa_subject_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ' + condition + ' RETURN NEW; END $$');
  await db.$executeRawUnsafe('CREATE TRIGGER qa_subject_delay BEFORE INSERT ON "' + table + '" FOR EACH ROW EXECUTE FUNCTION qa_subject_delay()');
  try { await operation(); } finally { await db.$executeRawUnsafe('DROP TRIGGER qa_subject_delay ON "' + table + '"'); await db.$executeRawUnsafe('DROP FUNCTION qa_subject_delay()'); }
}
beforeEach(async () => { await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job", "SubjectAccessRequest" CASCADE'); });
afterAll(async () => { await mkdir("docs/qa/P06-T05", { recursive: true }); await writeFile("docs/qa/P06-T05/lock-barriers.json", JSON.stringify({ checkedAt: new Date().toISOString(), barriers }, null, 2) + "\n"); await db.$disconnect(); });

test.each(["consents", "events"])("%s page clamps to retained data and exposes no submitted answers", async kind => {
  const f = await fixture(), s = await login(f);
  expect((await GET(subject(s, "/me"))).status).toBe(200);
  const result = await ok(await GET(subject(s, "/me/" + kind + "?page=999&pageSize=1")));
  expect(result).toMatchObject({ page: 1, total: 1, pageSize: 1 }); expect(result.items).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("PRIVATE-ANSWER");
});
test.each(["/me?unknown=x", "/me/consents?search=x", "/me/events?sort=id", "/me/consents?page=1&page=2", "/me/events?pageSize=1&pageSize=2"])("GET rejects ignored or duplicate query %s", async path => {
  const f = await fixture(), s = await login(f); expect((await GET(subject(s, path))).status).toBe(422);
});
test.each(["request", "confirm", "cancel", "detail"])("withdrawal %s rejects unknown query before changing consent", async action => {
  const f = await fixture(), s = await login(f), w = await withdrawal(s, f.sub.id);
  const path = action === "request" ? "/me/withdrawals?unknown=x" : "/me/withdrawals/" + w.id + (action === "detail" ? "" : "/" + action) + "?unknown=x";
  const r = action === "detail" ? await GET(subject(s, path)) : await POST(subject(s, path, "POST", action === "request" ? { submissionId: f.sub.id, version: 1 } : undefined));
  expect(r.status).toBe(422); expect((await db.submission.findUniqueOrThrow({ where: { id: f.sub.id } })).status).toBe("submitted");
});
test("link expiry during actual session INSERT rolls back single-use consumption", async () => {
  const f = await fixture(), a = await access(f);
  await delay("SubjectSession", "", async () => {
    await db.subjectAccessRequest.update({ where: { id: a.request.id }, data: { expiresAt: new Date(Date.now() + 500) } });
    expect((await POST(req("/subjects/sessions", "POST", { token: a.token }, a.cookie))).status).toBe(422);
  });
  expect(await db.subjectSession.count()).toBe(0); expect((await db.subjectAccessRequest.findUniqueOrThrow({ where: { id: a.request.id } })).consumedAt).toBeNull();
});
test.each(["consents", "events", "request", "confirm", "cancel"])("session expiry during %s audit rolls back consent, events, suppression and audit", async action => {
  const f = await fixture(), s = await login(f), w = ["confirm", "cancel"].includes(action) ? await withdrawal(s, f.sub.id) : null;
  const before = { audits: await db.auditEvent.count(), withdrawals: await db.subjectWithdrawal.count(), events: await db.consentEvent.count(), suppressed: await db.suppression.count() };
  const audit = { consents: "subject.consents_viewed", events: "subject.events_viewed", request: "subject.withdrawal_requested", confirm: "subject.withdrawn", cancel: "subject.withdrawal_cancelled" }[action]!;
  await delay("AuditEvent", audit, async () => {
    await db.subjectSession.update({ where: { id: s.id }, data: { expiresAt: new Date(Date.now() + 500) } });
    const r = ["consents", "events"].includes(action) ? await GET(subject(s, "/me/" + action)) : await POST(subject(s, action === "request" ? "/me/withdrawals" : "/me/withdrawals/" + w!.id + "/" + action, "POST", action === "request" ? { submissionId: f.sub.id, version: 1 } : undefined));
    expect(r.status).toBe(401);
  });
  expect({ audits: await db.auditEvent.count(), withdrawals: await db.subjectWithdrawal.count(), events: await db.consentEvent.count(), suppressed: await db.suppression.count() }).toEqual(before);
  expect(await db.submission.findUniqueOrThrow({ where: { id: f.sub.id } })).toMatchObject({ status: "submitted", version: 1 });
  if (w) expect((await db.subjectWithdrawal.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("requested");
});
test.each(["consents", "events", "confirm"])("retention expiry during %s audit returns no record and rolls back effects", async action => {
  const f = await fixture(), s = await login(f), w = action === "confirm" ? await withdrawal(s, f.sub.id) : null;
  const before = { audits: await db.auditEvent.count(), events: await db.consentEvent.count(), suppressed: await db.suppression.count() };
  await delay("AuditEvent", action === "confirm" ? "subject.withdrawn" : "subject." + action + "_viewed", async () => {
    await db.submission.update({ where: { id: f.sub.id }, data: { retentionUntil: new Date(Date.now() + (action === "events" ? 5000 : 2000)) } });
    const observer = new Client({ connectionString: env.DATABASE_URL }); await observer.connect();
    let finished = false, sleeping = 0;
    const pending = (action === "confirm" ? POST(subject(s, "/me/withdrawals/" + w!.id + "/confirm", "POST")) : GET(subject(s, "/me/" + action)))
      .then(response => { finished = true; return response; });
    try {
      for (let i = 0; i < 250 && !finished; i++) {
        const found = await observer.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep' AND query LIKE '%AuditEvent%'");
        sleeping = found.rows[0].n; if (sleeping) break; await pause(20);
      }
      expect(sleeping).toBeGreaterThan(0);
      const r = await pending; expect(r.status, JSON.stringify(await r.clone().json())).toBe(404);
      barriers.push({ table: "AuditEvent:retention:" + action, waiting: sleeping, status: r.status });
    } finally { await pending; await observer.end(); }
  }, action === "events" ? 6 : 2.5);
  expect({ audits: await db.auditEvent.count(), events: await db.consentEvent.count(), suppressed: await db.suppression.count() }).toEqual(before);
  expect((await db.submission.findUniqueOrThrow({ where: { id: f.sub.id } })).status).toBe("submitted");
});
test.each(["Company", "Service", "Submission"] as const)("actual %s lock wait cannot authorize after session expires", async table => {
  const f = await fixture(), s = await login(f), id = table === "Company" ? f.company.id : table === "Service" ? f.serviceId : f.sub.id;
  const client = new Client({ connectionString: env.DATABASE_URL }); await client.connect(); let response: Promise<Response> | undefined;
  try {
    const deadline = new Date(Date.now() + 1400); await db.subjectSession.update({ where: { id: s.id }, data: { expiresAt: deadline } });
    await client.query("BEGIN"); await client.query('SELECT id FROM "' + table + '" WHERE id=$1 FOR UPDATE', [id]);
    response = GET(subject(s, "/me/consents"));
    let waiting = 0; for (let i = 0; i < 60; i++) { await client.query("SELECT pg_stat_clear_snapshot()"); const result = await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1", ['%FROM "' + table + '"%']); waiting = result.rows[0].n; if (waiting) break; await pause(20); }
    expect(waiting).toBeGreaterThan(0); await pause(Math.max(0, deadline.getTime() - Date.now() + 30)); await client.query("ROLLBACK");
    const r = await response; barriers.push({ table, waiting, status: r.status }); expect(r.status).toBe(401);
    expect(await db.auditEvent.count({ where: { action: "subject.consents_viewed" } })).toBe(0);
  } finally { await client.query("ROLLBACK"); if (response) await response; await client.end(); }
});
test.each(["consumed", "company", "service", "retention"])("subject authentication mail worker skips current %s before writing local mail", async kind => {
  const f = await fixture(), a = await access(f), job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:subject-access:" + a.request.id } });
  if (kind === "consumed") await ok(await POST(req("/subjects/sessions", "POST", { token: a.token }, a.cookie)), 201);
  if (kind === "company") await db.company.update({ where: { id: f.company.id }, data: { status: "suspended" } });
  if (kind === "service") await db.service.update({ where: { id: f.serviceId }, data: { status: "archived" } });
  if (kind === "retention") await db.submission.update({ where: { id: f.sub.id }, data: { retentionUntil: new Date(Date.now() - 1000) } });
  for (let i = 0; i < 20; i++) { const current = await db.job.findUniqueOrThrow({ where: { id: job.id } }); if (["done", "cancelled", "dead"].includes(current.status)) break; await runOneJob("subject-access-test"); }
  expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("cancelled");
  await expect(fileAccess(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"))).rejects.toThrow();
});
