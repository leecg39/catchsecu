/** Independent local HTTP/DB verification. Never print subject tokens or cookies. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { subjectHashes } from "../src/server/subject-identity";
import { enqueueServiceMail } from "../src/server/jobs";
import type { SubjectConsent, SubjectEvent, SubjectPage, SubjectSessionInfo, SubjectWithdrawalRecord } from "../src/contracts/subjects";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL), phase = process.argv[2];
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(env.MAIL_TRANSPORT, "local"); assert(["prepare", "finish", "database"].includes(phase));
const output = "docs/qa/P06-T05/", checkpoint = ".local/p06-subject-access-checkpoint.json", cases: { label: string; status: number }[] = [];
const hash = (value: string) => createHash("sha256").update(value).digest("hex"), digest = (value: unknown) => hash(JSON.stringify(value));
type State = { email: string; password: string; userId: string; companyId: string; serviceId: string; otherServiceId: string; formId: string;
  first: string; second: string; secret: string; subjectName: string; subjectEmail: string; otherName: string; otherEmail: string;
  submissionId: string; otherSubmissionId: string; foreignSubmissionId: string; sessionId: string; sessionCookie: string; extraCookies: string[];
  completedId: string; cancelledId: string; staleId: string; pendingId: string; preservedHash: string; businessHash: string; receiptHash: string; queuedId: string; ownerCookie?: string };
let cookie = "", state: State | undefined;
const cookies = (r: Response) => r.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
async function call(label: string, path: string, options: { method?: string; value?: unknown; cookie?: string; expected?: number | number[]; session?: string; headers?: Record<string, string> } = {}) {
  const method = options.method ?? "GET", expected = options.expected ?? 200;
  const response = await fetch(origin + path, { method, redirect: "manual", headers: { cookie: options.cookie ?? cookie,
    ...(method === "GET" ? {} : { origin }), ...(options.value === undefined ? {} : { "content-type": "application/json" }),
    ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}), ...(options.session ? { "x-subject-session": options.session } : {}), ...options.headers },
    ...(options.value === undefined ? {} : { body: JSON.stringify(options.value) }) });
  assert((Array.isArray(expected) ? expected : [expected]).includes(response.status), label + ": " + response.status); cases.push({ label, status: response.status }); return response;
}
const api = (label: string, path: string, options: Parameters<typeof call>[2] = {}) => call(label, "/api/v1" + path, options);
const subject = (s: State, label: string, path: string, options: Parameters<typeof call>[2] = {}) => api(label, "/subjects" + path, { cookie: s.sessionCookie, session: s.sessionId, ...options });
async function persist(s: State) { await writeFile(checkpoint, JSON.stringify(s), { mode: 0o600 }); assert.equal((await lstat(checkpoint)).mode & 0o777, 0o600); }
async function login(s: State) { cookie = cookies(await api("synthetic owner login", "/auth/sign-in/email", { method: "POST", cookie: "", value: { email: s.email, password: s.password } })); }
async function preserved() {
  const values = [];
  for (const file of [".local/p04-form-module-checkpoint.json", ".local/p06-file-access-checkpoint.json", ".local/p06-share-management-checkpoint.json"]) {
    const old = JSON.parse(await readFile(file, "utf8")) as { submissionId: string };
    values.push(await db.submission.findUniqueOrThrow({ where: { id: old.submissionId }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } }, files: { orderBy: { id: "asc" } } } }));
  }
  return digest(values);
}
async function snapshot(s: State) {
  const submissions = await db.submission.findMany({ where: { tenantId: s.companyId }, orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" }, include: { events: { orderBy: { id: "asc" } } } }, subjectWithdrawals: { orderBy: { id: "asc" } } } });
  const identities = await db.dataSubject.findMany({ where: { tenantId: s.companyId }, orderBy: { id: "asc" } });
  const suppression = await db.suppression.findMany({ where: { tenantId: s.companyId }, orderBy: { id: "asc" } });
  const form = await db.form.findUniqueOrThrow({ where: { id: s.formId }, include: { versions: { orderBy: { number: "asc" } }, publications: { orderBy: { id: "asc" } } } });
  return { hash: digest({ submissions, identities, suppression, form }), submissions: submissions.length, identities: identities.length, suppression: suppression.length };
}
async function authenticate(s: State, other = false) {
  const contact = other ? { name: s.otherName, email: s.otherEmail } : { name: s.subjectName, email: s.subjectEmail };
  const response = await api("request own fixed subject scopes", "/subjects/access-requests", { method: "POST", cookie: "", expected: 202, value: { ...contact, consent: true } });
  assert.deepEqual(await response.json(), { accepted: true }); assert(response.headers.getSetCookie().some(v => v.includes("HttpOnly") && v.includes("SameSite=Strict") && v.includes("Max-Age=600")));
  const subId = other ? s.foreignSubmissionId : s.submissionId;
  const access = await db.subjectAccessRequest.findFirstOrThrow({ where: { scopes: { some: { subject: { submissions: { some: { id: subId } } } } } }, orderBy: { createdAt: "desc" } });
  const mail = decrypt<{ to: string; text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:subject-access:" + access.id } })).payloadCipher);
  assert.equal(mail.to, contact.email); const token = mail.text.match(/\/infoOwner\/agree-history\/([A-Za-z0-9_-]{43})/)![1];
  await call("email-link GET renders without consuming token", "/infoOwner/agree-history/" + token, { cookie: "" }); assert.equal((await db.subjectAccessRequest.findUniqueOrThrow({ where: { id: access.id } })).consumedAt, null);
  await api("other browser cannot consume subject token", "/subjects/sessions", { method: "POST", cookie: "", expected: 422, value: { token } });
  const r = await api("consume own one-use browser-bound email link", "/subjects/sessions", { method: "POST", cookie: cookies(response), expected: 201, value: { token } });
  const session = await r.json() as SubjectSessionInfo; assert(r.headers.getSetCookie().some(v => /^cs_subject=/.test(v) && v.includes("HttpOnly") && v.includes("SameSite=Strict")));
  await api("one-use link cannot create another session", "/subjects/sessions", { method: "POST", cookie: cookies(response), expected: 422, value: { token } });
  assert.equal(await db.subjectSession.count({ where: { requestId: access.id } }), 1);
  return { id: session.id, cookie: cookies(r), accessId: access.id };
}
async function start(s: State, submissionId: string, version = 1) { return (await subject(s, "request own withdrawal confirmation", "/me/withdrawals", { method: "POST", expected: 201, value: { submissionId, version } })).json() as Promise<SubjectWithdrawalRecord>; }
try {
  if (phase === "prepare") {
    const before = await preserved(), email = "p06-subject-owner-" + randomUUID() + "@catchsecu.local.test", password = "P06-subject!" + randomUUID();
    await api("create independent synthetic owner", "/auth/sign-up/email", { method: "POST", cookie: "", value: { name: "P06 Subject QA", email, password } });
    const jobs = await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" }, take: 30 });
    const mail = jobs.map(j => decrypt<{ to: string; subject: string; text: string }>(j.payloadCipher)).find(v => v.to === email && v.subject === "이메일 인증"); assert(mail);
    const link = new URL(mail.text.match(/https?:\/\/\S+/)![0]); assert.equal(link.origin, origin); assert.equal(link.pathname, "/api/v1/auth/verify-email");
    await call("verify own owner account email", link.pathname + link.search, { cookie: "", expected: [200, 302] });
    const user = await db.user.findUniqueOrThrow({ where: { email } }); assert(user.emailVerified && !user.platformAdmin);
    cookie = cookies(await api("login own verified owner", "/auth/sign-in/email", { method: "POST", cookie: "", value: { email, password } }));
    const company = await (await api("create synthetic company", "/companies", { method: "POST", expected: 201, value: { name: "P06 Subject " + randomUUID(), publicName: "Synthetic Subject QA" } })).json() as { id: string };
    const context = await (await api("current company/service context", "/context")).json() as { company: { id: string }; services: { id: string }[] }; assert.equal(context.company.id, company.id);
    const otherService = await (await api("create independent comparison service", "/services", { method: "POST", expected: 201, value: { name: "Subject comparison", externalName: "Subject comparison" } })).json() as { id: string };
    const s: State = state = { email, password, userId: user.id, companyId: company.id, serviceId: context.services[0].id, otherServiceId: otherService.id,
      formId: "", first: randomUUID(), second: randomUUID(), secret: randomUUID(), subjectName: "Subject " + randomUUID(), subjectEmail: randomUUID() + "@catchsecu.local.test",
      otherName: "Other " + randomUUID(), otherEmail: randomUUID() + "@catchsecu.local.test", submissionId: "", otherSubmissionId: "", foreignSubmissionId: "", sessionId: "", sessionCookie: "", extraCookies: [],
      completedId: "", cancelledId: "", staleId: "", pendingId: "", preservedHash: before, businessHash: "", receiptHash: "", queuedId: "", ownerCookie: cookie }; await persist(s);
    const form = await (await api("create explicit identity form", "/forms", { method: "POST", expected: 201, value: { serviceId: s.serviceId, title: "P06 Subject consent QA", content: {
      body: "Synthetic local-only consent", consentRequired: true, consentPurpose: "Synthetic subject QA", retentionDays: 30, maxResponses: 10, questions: [
        { id: s.first, label: "Name", type: "단문형 답변", required: true, subjectRole: "name" }, { id: s.second, label: "Email", type: "단문형 답변", required: true, subjectRole: "email" },
        { id: s.secret, label: "Private answer", type: "장문형 답변", required: false }] } } })).json() as { id: string; version: number }; s.formId = form.id;
    const publication = await (await api("publish identity form", "/forms/" + form.id + "/publish", { method: "POST", expected: 201, value: { version: form.version } })).json() as { token: string };
    for (const kind of ["submissionId", "otherSubmissionId", "foreignSubmissionId"] as const) {
      const other = kind === "foreignSubmissionId", sub = await (await api("submit independent retained consent", "/public/forms/" + publication.token + "/submissions", { method: "POST", cookie: "", expected: 201,
        value: { consent: true, answers: { [s.first]: other ? s.otherName : s.subjectName, [s.second]: other ? s.otherEmail : s.subjectEmail, [s.secret]: "PRIVATE-ANSWER-" + randomUUID() } } })).json() as { id: string }; s[kind] = sub.id;
    }
    await persist(s); s.receiptHash = digest(await db.consentReceipt.findMany({ where: { submission: { tenantId: s.companyId } }, orderBy: { id: "asc" } }));
    const count = await db.subjectAccessRequest.count(), absent = await api("unknown identity receives identical generic acceptance", "/subjects/access-requests", { method: "POST", cookie: "", expected: 202, value: { name: "Absent " + randomUUID(), email: s.subjectEmail, consent: true } });
    assert.deepEqual(await absent.json(), { accepted: true }); assert.equal(await db.subjectAccessRequest.count(), count);
    const session = await authenticate(s); s.sessionId = session.id; s.sessionCookie = session.cookie; await persist(s);
    const page = await (await subject(s, "server clamps stale consent page", "/me/consents?page=999&pageSize=1")).json() as SubjectPage<SubjectConsent>; assert.equal(page.page, 2); assert.equal(page.total, 2); assert.equal(page.items.length, 1);
    assert(!JSON.stringify(page).includes("PRIVATE-ANSWER") && !JSON.stringify(page).includes(s.subjectEmail));
    for (const path of ["/me?unknown=x", "/me/consents?page=1&page=2", "/me/events?pageSize=1&pageSize=2", "/me/consents?search=x"]) await subject(s, "strict subject query denied", path, { expected: 422 });
    await subject(s, "URL session id alone cannot authenticate", "/me", { cookie: "", expected: 401 }); await subject(s, "another session UUID cannot authenticate", "/me", { session: randomUUID(), expected: 401 });
    await subject(s, "another subject response cannot start withdrawal", "/me/withdrawals", { method: "POST", expected: 404, value: { submissionId: s.foreignSubmissionId, version: 1 } });
    const first = await start(s, s.submissionId), repeated = await start(s, s.submissionId); assert.equal(first.id, repeated.id); s.cancelledId = first.id;
    const other = await authenticate(s, true); s.extraCookies.push(other.cookie); await persist(s);
    await subject(s, "other verified subject cannot read withdrawal", "/me/withdrawals/" + first.id, { cookie: other.cookie, session: other.id, expected: 404 });
    await subject(s, "other verified subject cannot confirm withdrawal", "/me/withdrawals/" + first.id + "/confirm", { method: "POST", cookie: other.cookie, session: other.id, expected: 404 });
    await subject(s, "strict confirmation query changes nothing", "/me/withdrawals/" + first.id + "/confirm?unknown=x", { method: "POST", expected: 422 });
    await subject(s, "cancel withdrawal keeps consent", "/me/withdrawals/" + first.id + "/cancel", { method: "POST" });
    await subject(s, "cancelled request retry is idempotent", "/me/withdrawals/" + first.id + "/cancel", { method: "POST" });
    await subject(s, "cancelled request cannot confirm", "/me/withdrawals/" + first.id + "/confirm", { method: "POST", expected: 409 });
    const active = await start(s, s.submissionId); assert.notEqual(active.id, first.id); s.completedId = active.id;
    const queued = await enqueueServiceMail({ to: s.subjectEmail, subject: "Synthetic pre-withdrawal queue", text: "Local QA only" }, { tenantId: s.companyId, serviceId: s.serviceId }); assert(queued.id); s.queuedId = queued.id;
    await subject(s, "confirm atomic withdrawal", "/me/withdrawals/" + active.id + "/confirm", { method: "POST" });
    await subject(s, "lost confirmation success retry returns same completed request", "/me/withdrawals/" + active.id + "/confirm", { method: "POST" });
    assert.deepEqual(await enqueueServiceMail({ to: s.subjectEmail, subject: "Synthetic future queue", text: "Must be blocked" }, { tenantId: s.companyId, serviceId: s.serviceId }), { id: null, suppressed: true });
    assert((await enqueueServiceMail({ to: s.subjectEmail, subject: "Comparison service", text: "Local QA only" }, { tenantId: s.companyId, serviceId: s.otherServiceId })).id);
    const events = await (await subject(s, "withdrawn and granted events use corrected page", "/me/events?page=999&pageSize=1")).json() as SubjectPage<SubjectEvent>; assert.equal(events.page, 3); assert.equal(events.total, 3);
    const stale = await start(s, s.otherSubmissionId); s.staleId = stale.id;
    await api("owner corrects another retained response", "/submissions/" + s.otherSubmissionId, { method: "PATCH", value: { version: 1, reason: "Synthetic correction", answers: { [s.secret]: "CORRECTED-PRIVATE" } } });
    await subject(s, "stale confirmation cannot withdraw corrected response", "/me/withdrawals/" + stale.id + "/confirm", { method: "POST", expected: 409 });
    const renewed = await start(s, s.otherSubmissionId, 2); assert.notEqual(renewed.id, stale.id);
    await subject(s, "cancel renewed request", "/me/withdrawals/" + renewed.id + "/cancel", { method: "POST" });
    const pending = await start(s, s.otherSubmissionId, 2); s.pendingId = pending.id;
    const short = await authenticate(s); s.extraCookies.push(short.cookie); await persist(s);
    const deadline = new Date(Date.now() + 2000); await db.subjectSession.update({ where: { id: short.id, requestId: short.accessId }, data: { expiresAt: deadline } });
    const started = Date.now(); await setTimeout(Math.max(0, deadline.getTime() - Date.now() + 40)); const actualExpiryWaitMs = Date.now() - started;
    await subject(s, "actual-time session expiry denies captured cookie", "/me", { cookie: short.cookie, session: short.id, expected: 401 });
    assert.equal(s.receiptHash, digest(await db.consentReceipt.findMany({ where: { submission: { tenantId: s.companyId } }, orderBy: { id: "asc" } })));
    for (const path of ["/infoOwner/find", "/infoOwner/find/complete", "/infoOwner/agree-history/" + s.sessionId, "/infoOwner/action-history/" + s.sessionId, "/infoOwner/form-interrupt?session=" + s.sessionId + "&request=" + pending.id, "/infoOwner/formComplete?session=" + s.sessionId + "&request=" + active.id]) await call("public subject HTML route", path, { cookie: "" });
    const snap = await snapshot(s); s.businessHash = snap.hash; assert.equal(await preserved(), s.preservedHash); await persist(s);
    await writeFile(output + "http-prepare.json", JSON.stringify({ checkedAt: new Date().toISOString(), cases, passed: cases.length, snapshot: snap, receiptUnchanged: true, preservedOriginalsUnchanged: true, actualExpiryWaitMs,
      shortenedOwnSyntheticSessionOnly: true, globalMailWorkerRun: false, mailEvidence: "own encrypted queued payload; SMTP and production delivery unverified", htmlIsBrowserVerification: false }, null, 2) + "\n");
  } else {
    const s: State = state = JSON.parse(await readFile(checkpoint, "utf8")); assert(s.email.startsWith("p06-subject-owner-") && s.email.endsWith("@catchsecu.local.test"));
    const user = await db.user.findUniqueOrThrow({ where: { id: s.userId } }); assert.equal(user.email, s.email); assert(!user.platformAdmin);
    if (phase === "finish") {
      assert.equal((await snapshot(s)).hash, s.businessHash); assert.equal(await preserved(), s.preservedHash);
      if (s.ownerCookie) await api("close preparation owner after restart", "/auth/sign-out", { method: "POST", cookie: s.ownerCookie, value: {} });
      await login(s);
      const page = await (await subject(s, "retained consent history survives Next restart", "/me/consents?page=999&pageSize=1")).json() as SubjectPage<SubjectConsent>; assert.equal(page.total, 2); assert.equal(page.page, 2);
      const completed = await (await subject(s, "completed withdrawal survives restart", "/me/withdrawals/" + s.completedId)).json() as SubjectWithdrawalRecord; assert.equal(completed.status, "completed");
      const pending = await (await subject(s, "pending withdrawal survives restart", "/me/withdrawals/" + s.pendingId)).json() as SubjectWithdrawalRecord; assert.equal(pending.status, "requested");
      const events = await (await subject(s, "event history survives restart", "/me/events")).json() as SubjectPage<SubjectEvent>; assert.equal(events.items.filter(e => e.type === "withdrawn").length, 1);
      assert.deepEqual(await enqueueServiceMail({ to: s.subjectEmail, subject: "Restart suppression", text: "Must be blocked" }, { tenantId: s.companyId, serviceId: s.serviceId }), { id: null, suppressed: true });
      for (const value of [s.sessionCookie, ...s.extraCookies]) await api("close own synthetic subject session", "/subjects/logout", { method: "POST", cookie: value, expected: 204 });
      await subject(s, "logged-out cookie cannot read retained data", "/me/consents", { expected: 401 });
      await api("close own synthetic owner session", "/auth/sign-out", { method: "POST", value: {} });
      const snap = await snapshot(s); assert.equal(snap.hash, s.businessHash); assert.equal(await preserved(), s.preservedHash);
      await writeFile(output + "http-restart.json", JSON.stringify({ checkedAt: new Date().toISOString(), cases, passed: cases.length, snapshot: snap, businessUnchanged: true, preservedOriginalsUnchanged: true, futureServiceMailBlocked: true, testSessionsClosed: true }, null, 2) + "\n");
    } else {
      const snap = await snapshot(s); assert.equal(snap.hash, s.businessHash); assert.equal(await preserved(), s.preservedHash);
      const subjects = await db.dataSubject.findMany({ where: { tenantId: s.companyId } }); assert.equal(subjects.length, 2);
      for (const row of subjects) { const contact = decrypt<{ name: string; email: string }>(row.contactCipher), values = subjectHashes(contact.name, contact.email); assert.equal(values.nameHash, row.nameHash); assert.equal(values.emailHash, row.emailHash); assert.equal(values.identityHash, row.identityHash); assert(!row.contactCipher.includes(contact.email)); }
      assert(await db.subjectWithdrawal.count({ where: { tenantId: s.companyId, status: "cancelled" } }) >= 3);
      assert.equal(await db.subjectWithdrawal.count({ where: { tenantId: s.companyId, status: "completed" } }), 1); assert.equal(await db.subjectWithdrawal.count({ where: { tenantId: s.companyId, status: "requested" } }), 1);
      const first = await db.submission.findUniqueOrThrow({ where: { id: s.submissionId } }); assert.equal(first.status, "withdrawn"); assert.equal(first.version, 2);
      assert.equal(await db.consentEvent.count({ where: { tenantId: s.companyId, type: "withdrawn" } }), 1); assert.equal(await db.suppression.count({ where: { tenantId: s.companyId, serviceId: s.serviceId } }), 1);
      const scopes = await db.subjectAccessScope.findMany({ where: { tenantId: s.companyId }, select: { requestId: true } }); const requests = [...new Set(scopes.map(r => r.requestId))];
      assert.equal(await db.subjectSession.count({ where: { requestId: { in: requests }, revokedAt: null, expiresAt: { gt: new Date() } } }), 0); assert.equal(await db.session.count({ where: { userId: s.userId } }), 0);
      const rows = await db.$queryRawUnsafe<{ migration_name: string; checksum: string }[]>('SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name');
      const migrations = (await readdir("prisma/migrations", { withFileTypes: true })).filter(v => v.isDirectory()).map(v => v.name).sort(); assert.equal(rows.length, migrations.length);
      for (const row of rows) assert.equal(hash(await readFile("prisma/migrations/" + row.migration_name + "/migration.sql", "utf8")), row.checksum, row.migration_name);
      assert.equal(s.receiptHash, digest(await db.consentReceipt.findMany({ where: { submission: { tenantId: s.companyId } }, orderBy: { id: "asc" } })));
      const audit = await db.auditEvent.findMany({ where: { tenantId: s.companyId, resource: "subject" } }); assert(!JSON.stringify(audit).includes(s.subjectEmail) && !JSON.stringify(audit).includes(s.subjectName));
      await writeFile(output + "database.json", JSON.stringify({ checkedAt: new Date().toISOString(), snapshot: snap, identities: subjects.length, requests: requests.length, liveSubjectSessions: 0, ownerSessions: 0,
        receipts: await db.consentReceipt.count({ where: { tenantId: s.companyId } }), consentEvents: await db.consentEvent.count({ where: { tenantId: s.companyId } }), completed: 1, cancelled: 3, requested: 1,
        contactEncrypted: true, identityHmacVerified: true, immutableReceiptHashUnchanged: true, subjectAuditContainsNoContact: true, migrationChecksumsMatched: rows.length, checkpointMode: (await lstat(checkpoint)).mode & 0o777,
        preservedOriginalsUnchanged: true, globalMailWorkerRun: false, queuedBeforeWithdrawalStillPending: (await db.job.findUniqueOrThrow({ where: { id: s.queuedId } })).status }, null, 2) + "\n");
    }
  }
  console.log(JSON.stringify({ phase, passed: cases.length, result: "PASS" }));
} catch (error) {
  if (state && phase !== "database") { for (const value of [state.sessionCookie, ...state.extraCookies].filter(Boolean)) await fetch(origin + "/api/v1/subjects/logout", { method: "POST", headers: { origin, cookie: value } }).catch(() => {}); }
  if (cookie) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: "{}" }).catch(() => {});
  await writeFile(output + "http-" + phase + "-failed.json", JSON.stringify({ checkedAt: new Date().toISOString(), cases, passedBeforeFailure: cases.length, error: error instanceof Error ? error.message : "Unknown failure", syntheticSessionsCleanupAttempted: phase !== "database" }, null, 2) + "\n"); throw error;
} finally { await db.$disconnect(); }
