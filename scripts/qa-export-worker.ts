import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import type { ExportRecord } from "../src/contracts/exports";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev");
assert(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
const fixture = JSON.parse(await readFile(".local/p03-members-fixture.json", "utf8")) as { people: { id: string; email: string; password: string }[] };
const prior = JSON.parse(await readFile(".local/p04-form-module-checkpoint.json", "utf8")) as { tenantId: string; submissionId: string };
const checkpoint = JSON.parse(await readFile(".local/p06-async-export-checkpoint.json", "utf8")) as { sourceFormId: string; sourceCsvHash: string };
const person = fixture.people[2], cases: { label: string; status: number }[] = [];
let cookie = "", created: ExportRecord | undefined;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
async function request(label: string, path: string, method = "GET", input?: unknown, expected = 200) {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { cookie,
    ...(method === "GET" ? {} : { origin }), ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
    ...(input === undefined ? {} : { "content-type": "application/json" }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  assert.equal(response.status, expected, label); cases.push({ label, status: response.status }); return response;
}
async function originalHash() {
  const row = await db.submission.findUniqueOrThrow({ where: { id: prior.submissionId }, include: {
    answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } }, files: { orderBy: { id: "asc" } } } });
  assert.equal(row.tenantId, prior.tenantId);
  return hash(JSON.stringify({ id: row.id, version: row.version, formVersionId: row.formVersionId, status: row.status, retentionUntil: row.retentionUntil,
    answers: row.answers.map(a => [a.id, a.valueCipher]), receipts: row.receipts.map(r => [r.id, r.pdfCipher, r.evidenceCipher]),
    files: row.files.map(f => [f.id, f.sha256, f.status, f.scanStatus]) }));
}
try {
  assert(/^p03-(foreign|member)-.+@catchsecu\.local\.test$/.test(person.email));
  const user = await db.user.findUniqueOrThrow({ where: { id: person.id } }); assert(user.status === "active" && user.emailVerified && !user.platformAdmin);
  const company = await db.company.findUniqueOrThrow({ where: { id: prior.tenantId } }); assert(/^P04 모듈 검증 [0-9a-f-]{36}$/.test(company.name));
  const beforeHash = await originalHash();
  const login = await request("synthetic login", "/auth/sign-in/email", "POST", { email: person.email, password: person.password });
  cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert(cookie);
  await request("synthetic company", "/context", "POST", { companyId: prior.tenantId });
  const startedAt = Date.now();
  created = await (await request("enqueue through HTTP", "/exports", "POST", { formId: checkpoint.sourceFormId, filters: {} }, 201)).json() as ExportRecord;
  let current = created; const states = [current.status];
  while (current.status !== "ready" && Date.now() - startedAt < 30000) {
    assert(["queued", "processing"].includes(current.status), "automatic export failed");
    await new Promise(resolve => setTimeout(resolve, 300));
    current = await (await request("poll automatic progress", "/exports/" + created.id)).json() as ExportRecord;
    if (states.at(-1) !== current.status) states.push(current.status);
  }
  assert.equal(current.status, "ready"); assert.equal(current.processedRows, current.totalRows);
  const response = await request("download automatic result", "/exports/" + created.id + "/download");
  assert(response.headers.get("content-type")?.startsWith("text/csv")); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const csvHash = hash(Buffer.from(await response.arrayBuffer())); assert.equal(csvHash, checkpoint.sourceCsvHash);
  const elapsedMs = Date.now() - startedAt;
  await request("delete only automatic synthetic job", "/exports/" + created.id, "DELETE", { version: current.version }, 204);
  await request("deleted automatic result blocked", "/exports/" + created.id + "/download", "GET", undefined, 410);
  const tombstone = await db.exportJob.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(tombstone.status, "deleted"); assert.equal(tombstone.filtersCipher, null); assert.equal(tombstone.layoutCipher, null);
  assert.equal(await db.exportChunk.count({ where: { jobId: created.id } }), 0);
  assert.equal(await db.exportSource.count({ where: { jobId: created.id, sourceHash: { not: null } } }), 0);
  assert.equal(await originalHash(), beforeHash);
  await request("synthetic logout", "/auth/sign-out", "POST", {}); cookie = "";
  const report = { checkedAt: new Date().toISOString(), result: "passed", cases, states, elapsedMs, jobId: created.id, rows: current.totalRows,
    sourceCsvHash: csvHash, originalSubmissionUnchanged: true, originalHash: beforeHash, encryptedCopyRemoved: true,
    syntheticSessionClosed: true, userAdminAccountUntouched: true, manuallyInvokedWorker: false,
    automaticExportOnlyWorker: true, globalProductionWorkerExecuted: false, actualUiVerified: false, externalDeliveryVerified: false };
  await writeFile("docs/qa/P06-T02/exports/http-automatic.json", JSON.stringify(report, null, 2) + "\n");
  console.info(JSON.stringify({ result: report.result, cases: cases.length, states, elapsedMs, rows: current.totalRows, automaticExportOnlyWorker: true }));
} finally {
  if (cookie) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
  await db.$disconnect();
}
