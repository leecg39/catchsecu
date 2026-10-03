/** Actual subject withdrawal + queued delivery, isolated localhost test DB only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { enqueueServiceMail, runOneJob } from "../src/server/jobs";
import { POST as subject } from "../src/app/api/v1/subjects/[...segments]/route";
import { POST as createForm } from "../src/app/api/v1/forms/route";
import { POST as formAction } from "../src/app/api/v1/forms/[...segments]/route";
import { POST as submit } from "../src/app/api/v1/public/forms/[...segments]/route";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
assert.equal(database.pathname, "/catchsecu_test"); assert(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
const cases: { label: string; status: number }[] = [];
const cookieOf = (r: Response) => r.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
function req(path: string, value: unknown, cookie = "", session = "") { return new Request(origin + "/api/v1" + path, { method: "POST", headers: { origin, cookie, "content-type": "application/json", "x-subject-session": session, "idempotency-key": randomUUID() }, body: JSON.stringify(value) }); }
async function ok(label: string, r: Response, status = 200) { assert.equal(r.status, status, label); cases.push({ label, status }); return status === 204 ? undefined : r.json(); }
async function settle(id: string) {
  for (let i = 0; i < 500; i++) { const row = await db.job.findUniqueOrThrow({ where: { id } }); if (["done", "cancelled", "dead"].includes(row.status)) return row; assert(await runOneJob("subject-withdrawal-isolated-worker")); }
  throw new Error("Isolated queue did not settle.");
}
try {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Company", "User", "Verification", "RateLimit", "IdempotencyRecord", "ApiRateLimit", "Job", "SubjectAccessRequest" CASCADE');
  const email = "subject-queue-" + randomUUID() + "@catchsecu.test", password = "Subject-queue!123";
  await ok("synthetic test owner signup", await auth.handler(req("/auth/sign-up/email", { name: "Subject queue", email, password })));
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const backup = await db.user.create({ data: { name: "Backup", email: randomUUID() + "@catchsecu.test", emailVerified: true } });
  const company = await db.company.create({ data: { name: "Subject queue " + randomUUID(), publicName: "Subject queue", policy: { create: {} },
    memberships: { create: [{ userId: user.id, role: "owner" }, { userId: backup.id, role: "owner" }] }, services: { create: { name: "Subject queue", externalName: "Subject queue" } } }, include: { services: true } });
  const signed = await auth.handler(req("/auth/sign-in/email", { email, password })); await ok("synthetic test owner login", signed); const owner = cookieOf(signed), serviceId = company.services[0].id;
  const comparison = await db.service.create({ data: { tenantId: company.id, name: "Comparison", externalName: "Comparison" } });
  const nameId = randomUUID(), emailId = randomUUID(), contact = { name: "Subject " + randomUUID(), email: randomUUID() + "@catchsecu.test" };
  const form = await ok("explicit name/email form", await createForm(req("/forms", { serviceId, title: "Subject queue consent", content: { body: "Synthetic consent", consentRequired: true, consentPurpose: "Synthetic queue", retentionDays: 30, maxResponses: 10,
    questions: [{ id: nameId, type: "단문형 답변", label: "Name", required: true, subjectRole: "name" }, { id: emailId, type: "단문형 답변", label: "Email", required: true, subjectRole: "email" }] } }, owner)), 201);
  const publication = await ok("publish subject queue form", await formAction(req("/forms/" + form.id + "/publish", { version: form.version }, owner)), 201);
  const submission = await ok("subject grants retained consent", await submit(req("/public/forms/" + publication.token + "/submissions", { answers: { [nameId]: contact.name, [emailId]: contact.email }, consent: true })), 201);
  const browser = await subject(req("/subjects/access-requests", { ...contact, consent: true })); await ok("subject requests own authentication", browser, 202);
  const accessRow = await db.subjectAccessRequest.findFirstOrThrow({ where: { scopes: { some: { subject: { submissions: { some: { id: submission.id } } } } } }, orderBy: { createdAt: "desc" } });
  const authJob = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:subject-access:" + accessRow.id } });
  assert.equal((await settle(authJob.id)).status, "done");
  const linkMail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, authJob.id + ".json"), "utf8")); assert.equal(linkMail.to, contact.email);
  const token = linkMail.text.match(/\/infoOwner\/agree-history\/([A-Za-z0-9_-]{43})/)![1];
  const response = await subject(req("/subjects/sessions", { token }, cookieOf(browser))), session = await ok("subject authenticates actual local email", response, 201), cookie = cookieOf(response);
  const input = { to: contact.email, subject: "Synthetic follow-up", text: "Must be blocked after subject withdrawal" };
  const before = await enqueueServiceMail(input, { tenantId: company.id, serviceId }); assert(before.id && !before.suppressed);
  const request = await ok("subject requests withdrawal", await subject(req("/subjects/me/withdrawals", { submissionId: submission.id, version: 1 }, cookie, session.id)), 201);
  await ok("subject confirms atomic withdrawal", await subject(req("/subjects/me/withdrawals/" + request.id + "/confirm", {}, cookie, session.id)));
  const queued = await settle(before.id); assert.equal(queued.status, "cancelled"); assert.equal(queued.lastError, "SUPPRESSED");
  await assert.rejects(() => access(resolve(env.LOCAL_MAIL_DIR, before.id + ".json")));
  assert.deepEqual(await enqueueServiceMail(input, { tenantId: company.id, serviceId }), { id: null, suppressed: true });
  const other = await enqueueServiceMail(input, { tenantId: company.id, serviceId: comparison.id }); assert(other.id); assert.equal((await settle(other.id)).status, "done");
  const otherMail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, other.id + ".json"), "utf8")); assert.equal(otherMail.to, contact.email);
  const essential = await subject(req("/subjects/access-requests", { ...contact, consent: true })); await ok("withdrawn subject can request essential authentication", essential, 202);
  const next = await db.subjectAccessRequest.findFirstOrThrow({ where: { scopes: { some: { subject: { submissions: { some: { id: submission.id } } } } } }, orderBy: { createdAt: "desc" } });
  const nextJob = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:subject-access:" + next.id } }); assert.equal((await settle(nextJob.id)).status, "done");
  const essentialMail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, nextJob.id + ".json"), "utf8")); assert.equal(essentialMail.to, contact.email); assert(decrypt<{ text: string }>(nextJob.payloadCipher).text.includes("/infoOwner/agree-history/"));
  assert.equal((await db.submission.findUniqueOrThrow({ where: { id: submission.id } })).status, "withdrawn"); assert.equal(await db.consentEvent.count({ where: { receipt: { submissionId: submission.id }, type: "withdrawn" } }), 1);
  await ok("close isolated subject session", await subject(req("/subjects/logout", {}, cookie)), 204);
  await ok("close isolated owner session", await auth.handler(req("/auth/sign-out", {}, owner)));
  await writeFile("docs/qa/P06-T05/subject-queue-worker.json", JSON.stringify({ checkedAt: new Date().toISOString(), cases, passedEndpoints: cases.length, result: "PASS", isolatedLocalTestDatabase: true,
    actualLocalAuthenticationMailDelivered: true, subjectWithdrawalCommitted: true, previouslyQueuedMailCancelledByWorker: true, queuedMailLastError: queued.lastError, cancelledMailFileAbsent: true,
    futureSameServiceMailBlocked: true, otherServiceMailDelivered: true, essentialSubjectAuthenticationDelivered: true, immutableWithdrawalEvents: 1, productionWorkerRun: false }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "PASS", passedEndpoints: cases.length, subjectQueueSuppressed: true }));
} finally { await db.$disconnect(); }
