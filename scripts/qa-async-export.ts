import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { runOneExport } from "../src/server/exports";
import { formContentSchema } from "../src/contracts/domains";
import type { FormRecord } from "../src/contracts/forms";
import type { ExportRecord } from "../src/contracts/exports";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
const phase = process.argv[2]; assert(["prepare", "finish", "verify"].includes(phase));
const prior = JSON.parse(await readFile(".local/p04-form-module-checkpoint.json", "utf8")) as { tenantId: string; formId: string; submissionId: string };
const source = JSON.parse(await readFile(".local/p03-members-fixture.json", "utf8")) as { people: { id: string; email: string; password: string }[] };
const people = [source.people[2], source.people[1]], cookies = ["", ""], cases: { label: string; status: number }[] = [], worked: { id: string; steps: number }[] = [];
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex"), digest = (value: unknown) => hash(JSON.stringify(value));
const checkpointPath = ".local/p06-async-export-checkpoint.json", output = "docs/qa/P06-T02/exports/";
async function request(label: string, path: string, actor = 0, method = "GET", input?: unknown, expected = 200, key?: string, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { cookie: cookies[actor] ?? "", ...(method === "GET" ? {} : { origin }), ...(input === undefined ? {} : { "content-type": "application/json" }), ...(method === "POST" ? { "idempotency-key": key ?? randomUUID() } : {}), ...extraHeaders }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const code = response.status >= 400 ? (await response.clone().json().catch(() => null))?.error?.code : undefined;
  assert.equal(response.status, expected, label + (code ? " " + code : "")); cases.push({ label, status: response.status }); return response;
}
async function data<T>(label: string, path: string, actor = 0, method = "GET", input?: unknown, expected = 200, key?: string) { return (await request(label, path, actor, method, input, expected, key)).json() as Promise<T>; }
async function job(formId: string, key = randomUUID()) { return data<ExportRecord>("create export", "/exports", 0, "POST", { formId, filters: {} }, 201, key); }
async function finishJob(id: string) {
  const row = await db.exportJob.findUniqueOrThrow({ where: { id } }); assert.equal(row.tenantId, prior.tenantId); assert.equal(row.requesterId, people[0].id);
  let steps = 0;
  while (steps < 10) { const current = await db.exportJob.findUniqueOrThrow({ where: { id } }); if (current.status === "ready") break; assert(["queued", "processing"].includes(current.status)); assert(await runOneExport("synthetic-http-export", new Date(), id)); steps++; }
  assert.equal((await db.exportJob.findUniqueOrThrow({ where: { id } })).status, "ready"); worked.push({ id, steps });
}
async function bytes(id: string, label: string) { const response = await request(label, "/exports/" + id + "/download"); assert(response.headers.get("content-type")?.startsWith("text/csv")); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff"); return Buffer.from(await response.arrayBuffer()); }
async function original() {
  const row = await db.submission.findUniqueOrThrow({ where: { id: prior.submissionId }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } }, files: { orderBy: { id: "asc" } } } });
  assert.equal(row.tenantId, prior.tenantId); return digest({ id: row.id, version: row.version, formVersionId: row.formVersionId, status: row.status, retentionUntil: row.retentionUntil,
    answers: row.answers.map(a => [a.id, a.valueCipher]), receipts: row.receipts.map(r => [r.id, r.pdfCipher, r.evidenceCipher]), files: row.files.map(f => [f.id, f.sha256, f.status, f.scanStatus]) });
}
type Checkpoint = { sourceJobId: string; sourceFormId: string; sourceCsvHash: string; originalHash: string; formId: string; submissionId: string; correctedJobId: string; invalidatedJobId: string; cancelledJobId: string; deletedJobId: string; correctedCsvHash: string; businessHash: string };
async function snapshot(c: Checkpoint) {
  const ids = [c.sourceJobId, c.correctedJobId, c.invalidatedJobId, c.cancelledJobId, c.deletedJobId];
  const rows = await db.exportJob.findMany({ where: { tenantId: prior.tenantId, requesterId: people[0].id, id: { in: ids } }, include: { chunks: { orderBy: { number: "asc" } }, sources: { orderBy: { rowNo: "asc" } } }, orderBy: { id: "asc" } }); assert.equal(rows.length, 5);
  const jobs = rows.map(r => ({ id: r.id, status: r.status, version: r.version, rows: r.totalRows, processed: r.processedRows, bytes: r.byteLength, expiresAt: r.expiresAt,
    resultHash: r.resultHash, filtersCipherHash: r.filtersCipher ? hash(r.filtersCipher) : null, layoutCipherHash: r.layoutCipher ? hash(r.layoutCipher) : null,
    chunks: r.chunks.map(c => [c.number, hash(c.contentCipher), c.byteLength]), sources: r.sources.map(s => [s.submissionId, s.sourceHash]) }));
  return { jobs, originalHash: await original() };
}
try {
  const company = await db.company.findUniqueOrThrow({ where: { id: prior.tenantId } }); assert(/^P04 모듈 검증 [0-9a-f-]{36}$/.test(company.name));
  for (let actor = 0; actor < 2; actor++) {
    const person = people[actor]; assert(/^p03-(foreign|member)-.+@catchsecu\.local\.test$/.test(person.email)); const user = await db.user.findUniqueOrThrow({ where: { id: person.id } }); assert(user.status === "active" && user.emailVerified && !user.platformAdmin);
    const login = await request("synthetic login " + actor, "/auth/sign-in/email", actor, "POST", { email: person.email, password: person.password }); cookies[actor] = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert(cookies[actor]);
    await request("synthetic company " + actor, "/context", actor, "POST", { companyId: prior.tenantId });
  }
  let c: Checkpoint;
  if (phase === "prepare") {
    const previous = await db.form.findMany({ where: { tenantId: prior.tenantId, ownerId: people[0].id, status: { not: "archived" }, title: { startsWith: "비동기 내보내기 검증 " } }, select: { id: true, title: true, version: true } });
    for (const f of previous) {
      assert(/^비동기 내보내기 검증 [0-9a-f-]{36}$/.test(f.title));
      const jobs = await db.exportJob.findMany({ where: { tenantId: prior.tenantId, requesterId: people[0].id, formId: f.id, status: { not: "deleted" } }, select: { id: true, version: true } });
      for (const row of jobs) await request("delete failed synthetic export", "/exports/" + row.id, 0, "DELETE", { version: row.version }, 204);
      await request("archive failed synthetic form", "/forms/" + f.id, 0, "DELETE", undefined, 204, undefined, { "if-match": String(f.version) });
    }
    const initialHash = await original(), form = await data<FormRecord>("source archived form", "/forms/" + prior.formId);
    const policy = await data<{ requireApproval: boolean }>("current policy", "/security/policy"); assert.equal(policy.requireApproval, false);
    const key = randomUUID(), first = await job(form.id, key), replay = await data<ExportRecord>("same key", "/exports", 0, "POST", { formId: form.id, filters: {} }, 201, key); assert.equal(replay.id, first.id);
    await request("same key changed filter", "/exports", 0, "POST", { formId: form.id, filters: { search: "changed" } }, 409, key);
    await request("not ready", "/exports/" + first.id + "/download", 0, "GET", undefined, 409); await finishJob(first.id);
    const sourceCsv = await bytes(first.id, "source nine-type CSV"), direct = await request("same immediate CSV", "/forms/" + form.id + "/submissions/export"); assert(sourceCsv.equals(Buffer.from(await direct.arrayBuffer()))); await writeFile(output + "nine-type-source.csv", sourceCsv);
    await request("editor denied", "/exports/" + first.id + "/download", 1, "GET", undefined, 403); await request("anonymous denied", "/exports/" + first.id + "/download", 2, "GET", undefined, 401);
    const q = { id: randomUUID(), type: "단문형 답변", label: "합성 값", required: true }, content = formContentSchema.parse({ body: "합성 비동기 검증", questions: [q], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10 });
    const independent = await data<FormRecord>("independent form", "/forms", 0, "POST", { serviceId: form.serviceId, title: "비동기 내보내기 검증 " + randomUUID(), content }, 201);
    const published = await data<{ token: string }>("independent publish", "/forms/" + independent.id + "/publish", 0, "POST", { version: independent.version }, 201);
    const marker = "정정 전 " + randomUUID(), sub = await data<{ id: string }>("actual public response", "/public/forms/" + published.token + "/submissions", 2, "POST", { consent: true, answers: { [q.id]: marker } }, 201);
    const old = await job(independent.id); await finishJob(old.id); assert((await bytes(old.id, "before correction")).toString().includes(marker));
    await request("actual correction", "/submissions/" + sub.id, 0, "PATCH", { version: 1, reason: "합성 내보내기 정정", answers: { [q.id]: "정정 후 " + randomUUID() } });
    const invalidated = await data<ExportRecord>("invalidated metadata", "/exports/" + old.id); assert.equal(invalidated.status, "invalidated"); await request("invalidated blocked", "/exports/" + old.id + "/download", 0, "GET", undefined, 410);
    assert.equal(await db.exportChunk.count({ where: { jobId: old.id } }), 0); const cleared = await db.exportJob.findUniqueOrThrow({ where: { id: old.id } }); assert.equal(cleared.filtersCipher, null); assert.equal(cleared.layoutCipher, null);
    const corrected = await job(independent.id); await finishJob(corrected.id); const correctedCsv = await bytes(corrected.id, "after correction"); assert(!correctedCsv.toString().includes(marker)); await writeFile(output + "corrected-response.csv", correctedCsv);
    const cancel = await job(independent.id); await request("cancel", "/exports/" + cancel.id + "/cancel", 0, "POST", { version: cancel.version }); assert.equal(await runOneExport("cancelled-synthetic", new Date(), cancel.id), false);
    await request("cancelled blocked", "/exports/" + cancel.id + "/download", 0, "GET", undefined, 410);
    const deletionKey = randomUUID(), removed = await job(independent.id, deletionKey); await request("delete", "/exports/" + removed.id, 0, "DELETE", { version: removed.version }, 204);
    await request("deleted key stays closed", "/exports", 0, "POST", { formId: independent.id, filters: {} }, 410, deletionKey);
    const now = await data<FormRecord>("archive independent metadata", "/forms/" + independent.id); await request("archive independent", "/forms/" + independent.id, 0, "DELETE", undefined, 204, undefined, { "if-match": String(now.version) });
    c = { sourceJobId: first.id, sourceFormId: form.id, sourceCsvHash: hash(sourceCsv), originalHash: initialHash, formId: independent.id, submissionId: sub.id, correctedJobId: corrected.id, invalidatedJobId: old.id, cancelledJobId: cancel.id, deletedJobId: removed.id, correctedCsvHash: hash(correctedCsv), businessHash: "" };
    c.businessHash = digest(await snapshot(c)); await writeFile(checkpointPath, JSON.stringify(c), { mode: 0o600 });
  } else c = JSON.parse(await readFile(checkpointPath, "utf8")) as Checkpoint;
  assert.equal(await original(), c.originalHash); assert.equal(hash(await bytes(c.sourceJobId, "original CSV after archive/restart")), c.sourceCsvHash); assert.equal(hash(await bytes(c.correctedJobId, "corrected CSV after archive/restart")), c.correctedCsvHash);
  const csvRows = parse((await readFile(output + "nine-type-source.csv")).toString(), { bom: true }) as string[][]; assert(csvRows.length >= 2); assert(csvRows[0].some(x => x.includes("행 1")));
  const listing = await data<{ items: ExportRecord[]; page: number }>("page clamp", "/exports?formId=" + c.formId + "&page=999"); assert.equal(listing.page, 1); assert(listing.items.every(x => !JSON.stringify(x).includes("Cipher")));
  for (const id of [c.invalidatedJobId, c.cancelledJobId, c.deletedJobId]) await request("closed result after restart", "/exports/" + id + "/download", 0, "GET", undefined, 410);
  await request("current role denied after restart", "/exports/" + c.sourceJobId + "/download", 1, "GET", undefined, 403);
  const state = await snapshot(c); assert.equal(digest(state), c.businessHash); assert.equal(state.originalHash, c.originalHash);
  for (let actor = 0; actor < 2; actor++) { await request("synthetic logout " + actor, "/auth/sign-out", actor, "POST", {}); cookies[actor] = ""; }
  await writeFile(output + "http-" + phase + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), phase, result: "passed", cases, scopedWorkerSteps: worked, sourceCsvHash: c.sourceCsvHash, correctedCsvHash: c.correctedCsvHash,
    businessDatabase: state, originalSubmissionUnchanged: true, businessSnapshotMatches: true, matchesAfterRestart: phase !== "prepare", syntheticSessionsClosed: true, userAdminAccountUntouched: true, globalProductionWorkerExecuted: false, actualUiVerified: false, externalDeliveryVerified: false }, null, 2) + "\n");
  console.info(JSON.stringify({ phase, result: "passed", cases: cases.length, originalSubmissionUnchanged: true, businessSnapshotMatches: true }));
} finally { for (let actor = 0; actor < 2; actor++) if (cookies[actor]) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { origin, cookie: cookies[actor], "content-type": "application/json" }, body: "{}" }).catch(() => undefined); await db.$disconnect(); }
