import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import type { VerificationState } from "../src/contracts/verification";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_dev" || !["localhost", "127.0.0.1"].includes(database.hostname) || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Local development HTTP QA only.");
const phase = process.argv[2], output = "docs/qa/P06-T06/", checkpoint = ".local/p06-verification-configuration-checkpoint.json";
if (!["prepare", "finish", "database"].includes(phase)) throw new Error("prepare, finish or database required.");
const cases: { label: string; status: number }[] = [], config = { identityProvider: "synthetic_identity", signatureProvider: "synthetic_signature", environment: "sandbox", status: "pending" };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
type State = { email: string; password: string; userId: string; companyId: string; serviceId: string; otherServiceId: string; integrationId: string; version: number; formId: string; submissionId: string; ownerCookie: string; businessHash: string; preservedHash: string };
let cookie = "";
async function call(label: string, path: string, options: { method?: string; value?: unknown; cookie?: string; expected?: number | number[]; headers?: Record<string, string> } = {}) {
  const method = options.method ?? "GET", expected = options.expected ?? 200;
  const response = await fetch(origin + path, { method, redirect: "manual", headers: { cookie: options.cookie ?? cookie,
    ...(method === "GET" ? {} : { origin }), ...(options.value !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(method === "POST" ? { "Idempotency-Key": randomUUID() } : {}), ...options.headers }, ...(options.value !== undefined ? { body: JSON.stringify(options.value) } : {}) });
  assert((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${label}: ${response.status}`);
  cases.push({ label, status: response.status }); return response;
}
const api = (label: string, path: string, options: Parameters<typeof call>[2] = {}) => call(label, "/api/v1" + path, options);
async function configuration(path: string) {
  const response = await api("current safe configuration", path), state = await response.json() as VerificationState;
  assert.equal(state.readiness.ready, false); assert.equal(state.readiness.sandboxVerified, false);
  assert(!/Cipher|secret|cookie|requestHash|tenantId|providerRequest/.test(JSON.stringify(state))); return state;
}
async function preserved() {
  const records = [];
  for (const file of [".local/p04-form-module-checkpoint.json", ".local/p06-file-access-checkpoint.json", ".local/p06-share-management-checkpoint.json"]) {
    const old = JSON.parse(await readFile(file, "utf8")) as { submissionId: string };
    records.push(await db.submission.findUniqueOrThrow({ where: { id: old.submissionId }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } }, files: { orderBy: { id: "asc" } } } }));
  }
  const old = JSON.parse(await readFile(".local/p06-subject-access-checkpoint.json", "utf8")) as { companyId: string };
  records.push(await db.submission.findMany({ where: { tenantId: old.companyId }, orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" }, include: { events: { orderBy: { id: "asc" } } } }, files: { orderBy: { id: "asc" } }, subjectWithdrawals: { orderBy: { id: "asc" } } } }));
  return digest(records);
}
async function snapshot(s: State) {
  const integrations = await db.verificationIntegration.findMany({ where: { tenantId: s.companyId }, orderBy: { id: "asc" }, include: { revisions: { orderBy: { version: "asc" } } } });
  const forms = await db.form.findMany({ where: { tenantId: s.companyId }, orderBy: { id: "asc" }, include: { versions: { orderBy: { number: "asc" }, include: { questions: { orderBy: { id: "asc" } } } }, publications: { orderBy: { id: "asc" } } } });
  const submissions = await db.submission.findMany({ where: { tenantId: s.companyId }, orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } } } });
  return { hash: digest({ integrations, forms, submissions }), integrations: integrations.length, revisions: integrations.reduce((total, row) => total + row.revisions.length, 0), forms: forms.length, submissions: submissions.length };
}
async function persist(s: State) { await writeFile(checkpoint, JSON.stringify(s), { mode: 0o600 }); assert.equal((await lstat(checkpoint)).mode & 0o777, 0o600); }
await mkdir(output, { recursive: true });
try {
  if (phase === "prepare") {
    const before = await preserved(), email = "p06-verification-owner-" + randomUUID() + "@catchsecu.local.test", password = "P06-Verification!" + randomUUID();
    await api("register independent synthetic owner", "/auth/sign-up/email", { method: "POST", cookie: "", value: { name: "Verification QA", email, password } });
    const jobs = await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" }, take: 30 });
    const mail = jobs.map(job => decrypt<{ to: string; subject: string; text: string }>(job.payloadCipher)).find(value => value.to === email && value.subject === "이메일 인증"); assert(mail);
    const link = new URL(mail.text.match(/https?:\/\/\S+/)![0]); assert.equal(link.origin, origin); assert.equal(link.pathname, "/api/v1/auth/verify-email");
    await call("verify own account using own queued token", link.pathname + link.search, { cookie: "", expected: [200, 302] });
    cookie = cookies(await api("login own verified account", "/auth/sign-in/email", { method: "POST", cookie: "", value: { email, password } }));
    const user = await db.user.findUniqueOrThrow({ where: { email } }); assert(user.emailVerified && !user.platformAdmin);
    const company = await (await api("create isolated company", "/companies", { method: "POST", expected: 201, value: { name: "P06 Verification " + randomUUID(), publicName: "Verification QA" } })).json() as { id: string };
    const context = await (await api("select own current company service", "/context")).json() as { company: { id: string }; services: { id: string }[] }; assert.equal(context.company.id, company.id);
    const service = await (await api("create comparison service", "/services", { method: "POST", expected: 201, value: { name: "Verification comparison", externalName: "Verification comparison" } })).json() as { id: string };
    const s: State = { email, password, userId: user.id, companyId: company.id, serviceId: context.services[0].id, otherServiceId: service.id, integrationId: "", version: 0, formId: "", submissionId: "", ownerCookie: cookie, businessHash: "", preservedHash: before }; await persist(s);
    const path = `/services/${s.serviceId}/verification`, otherPath = `/services/${s.otherServiceId}/verification`;
    assert.equal((await configuration(path)).integration, null); assert.equal((await configuration(otherPath)).integration, null);
    const key = randomUUID(), value = await (await api("create supplier configuration", path, { method: "POST", value: config, expected: 201, headers: { "Idempotency-Key": key } })).json() as VerificationState;
    s.integrationId = value.integration!.id;
    const replay = await (await api("repeat same create without duplicate history", path, { method: "POST", value: config, expected: 201, headers: { "Idempotency-Key": key } })).json() as VerificationState; assert.equal(replay.integration!.id, s.integrationId); assert.equal(replay.history.length, 1);
    await api("duplicate fresh create is rejected", path, { method: "POST", value: config, expected: 409 });
    await api("same key different configuration is rejected", path, { method: "POST", value: { ...config, environment: "production" }, expected: 409, headers: { "Idempotency-Key": key } });
    for (const value of [{ ...config, ready: true }, { ...config, status: "ready" }, { ...config, secret: "not-a-secret" }, { ...config, identityProvider: "https://example.test" }]) await api("invalid client activation or supplier input is rejected", path, { method: "POST", value, expected: 422 });
    await api("unknown query is rejected", path + "?ready=true", { expected: 422 }); await api("duplicate query is rejected", path + "?page=1&page=2", { expected: 422 });
    await api("anonymous config cannot be read", path, { cookie: "", expected: 401 });
    await api("invalid mutation origin is rejected", path, { method: "PATCH", value: { ...config, version: 1 }, expected: 403, headers: { origin: "https://example.test" } });
    const disabled = await (await api("disable configuration", path, { method: "PATCH", value: { ...config, status: "disabled", version: 1 } })).json() as VerificationState; assert.equal(disabled.integration!.version, 2); assert.equal(disabled.readiness.reason, "DISABLED");
    await api("stale patch is rejected", path, { method: "PATCH", value: { ...config, version: 1 }, expected: 409 });
    await api("changed create replay is tombstoned", path, { method: "POST", value: config, expected: 410, headers: { "Idempotency-Key": key } });
    await api("stale delete is rejected", path, { method: "DELETE", expected: 409, headers: { "If-Match": "1" } });
    await api("delete current configuration", path, { method: "DELETE", expected: 204, headers: { "If-Match": "2" } });
    const deleted = await configuration(path); assert.equal(deleted.integration!.version, 3); assert.equal(deleted.integration!.identityProvider, null); assert.equal(deleted.readiness.reason, "NOT_CONFIGURED");
    const restored = await (await api("restore as new production generation", path, { method: "POST", value: { ...config, environment: "production" }, expected: 201 })).json() as VerificationState;
    assert.equal(restored.integration!.id, s.integrationId); assert.equal(restored.integration!.version, 4); assert.equal(restored.history.length, 4); assert.equal(restored.readiness.ready, false); s.version = 4;
    assert.equal((await configuration(otherPath)).integration, null);
    const question = randomUUID(), content = { body: "Synthetic local verification QA", questions: [{ id: question, type: "단문형 답변", label: "Synthetic value", required: true }], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10 };
    const form = await (await api("create verification-enabled form", "/forms", { method: "POST", expected: 201, value: { serviceId: s.serviceId, title: "Provider connection required", content: { ...content, verify: true } } })).json() as { id: string; version: number }; s.formId = form.id;
    await api("production labels do not unblock verified publication", `/forms/${form.id}/publish`, { method: "POST", value: { version: form.version }, expected: 503 });
    const ordinary = await (await api("create ordinary regression form", "/forms", { method: "POST", expected: 201, value: { serviceId: s.serviceId, title: "Ordinary regression", content } })).json() as { id: string; version: number };
    const publication = await (await api("publish ordinary form", `/forms/${ordinary.id}/publish`, { method: "POST", expected: 201, value: { version: ordinary.version } })).json() as { token: string };
    const submission = await (await api("ordinary public submission still works", `/public/forms/${publication.token}/submissions`, { method: "POST", cookie: "", expected: 201, value: { consent: true, answers: { [question]: "Synthetic QA answer" } } })).json() as { id: string }; s.submissionId = submission.id;
    await call("form editor route HTTP is reachable without claiming UI inspection", `/form/ai/create?formId=${form.id}`);
    const snap = await snapshot(s); s.businessHash = snap.hash; assert.equal(await preserved(), before); await persist(s);
    await writeFile(output + "http-prepare.json", JSON.stringify({ checkedAt: new Date().toISOString(), cases, passed: cases.length, snapshot: snap, preservedOriginalsUnchanged: true, providerSandboxVerified: false, browserInspected: false }, null, 2) + "\n");
  } else {
    const s = JSON.parse(await readFile(checkpoint, "utf8")) as State;
    assert.equal((await snapshot(s)).hash, s.businessHash); assert.equal(await preserved(), s.preservedHash);
    if (phase === "finish") {
      await api("close prepared synthetic owner session after restart", "/auth/sign-out", { method: "POST", cookie: s.ownerCookie, value: {} });
      cookie = cookies(await api("fresh synthetic login after restart", "/auth/sign-in/email", { method: "POST", cookie: "", value: { email: s.email, password: s.password } }));
      const current = await configuration(`/services/${s.serviceId}/verification`); assert.equal(current.integration!.id, s.integrationId); assert.equal(current.integration!.version, s.version); assert.equal(current.history.length, 4);
      assert.equal((await configuration(`/services/${s.otherServiceId}/verification`)).integration, null);
      await api("ordinary retained submission is readable after restart", `/submissions/${s.submissionId}`);
      await api("close fresh synthetic owner session", "/auth/sign-out", { method: "POST", value: {} });
      await api("closed session cannot read configuration", `/services/${s.serviceId}/verification`, { expected: 401 }); cookie = "";
      assert.equal((await snapshot(s)).hash, s.businessHash); assert.equal(await preserved(), s.preservedHash);
      await writeFile(output + "http-restart.json", JSON.stringify({ checkedAt: new Date().toISOString(), cases, passed: cases.length, businessUnchanged: true, preservedOriginalsUnchanged: true, syntheticSessionsClosed: true, providerSandboxVerified: false }, null, 2) + "\n");
    } else {
      const revisions = await db.verificationIntegrationRevision.findMany({ where: { integrationId: s.integrationId }, orderBy: { version: "asc" } }); assert.deepEqual(revisions.map(row => row.status), ["pending", "disabled", "deleted", "pending"]);
      const count = await db.session.count({ where: { userId: s.userId, expiresAt: { gt: new Date() } } }); assert.equal(count, 0);
      const migrations = await db.$queryRaw<{ migration_name: string; checksum: string }[]>`SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
      for (const row of migrations) assert.equal(createHash("sha256").update(await readFile(`prisma/migrations/${row.migration_name}/migration.sql`)).digest("hex"), row.checksum);
      assert.equal(migrations.length, 61);
      const audit = await db.auditEvent.findMany({ where: { tenantId: s.companyId, resource: "VerificationIntegration" } }); assert(!/synthetic_identity|synthetic_signature|not-a-secret/.test(JSON.stringify(audit)));
      const caches = await db.idempotencyRecord.findMany({ where: { tenantId: s.companyId, resourceType: "verificationIntegration" } }); assert.equal(caches.filter(row => row.invalidatedAt && !row.responseCipher && !row.requestHash).length, 1);
      assert.equal(await db.verificationAttempt.count({ where: { tenantId: s.companyId } }), 0); assert.equal(await db.verificationReceipt.count({ where: { tenantId: s.companyId } }), 0);
      await writeFile(output + "database.json", JSON.stringify({ checkedAt: new Date().toISOString(), snapshot: await snapshot(s), syntheticSessions: count, auditEvents: audit.length, revisionStatuses: revisions.map(row => row.status), migrationChecksumsMatched: migrations.length,
        checkpointMode: (await lstat(checkpoint)).mode & 0o777, preservedOriginalsUnchanged: true, attempts: 0, receipts: 0, externalProviderVerified: false, globalMailWorkerRun: false }, null, 2) + "\n");
    }
  }
  console.log(JSON.stringify({ phase, passed: cases.length, result: "passed", externalProviderVerified: false }));
} catch (error) {
  await writeFile(output + `http-${phase}-failed.json`, JSON.stringify({ checkedAt: new Date().toISOString(), cases, result: "failed", error: error instanceof Error ? error.message : "unknown" }, null, 2) + "\n");
  if (phase === "prepare" && cookie) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { origin, cookie, "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
  throw error;
} finally { await db.$disconnect(); }
