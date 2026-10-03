import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { formContentSchema } from "../src/contracts/domains";
import { PublicSubmissionSession } from "../src/lib/public-submission";
import type { FormRecord } from "../src/contracts/forms";
import type { SubmissionReceipt } from "../src/contracts/public-forms";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
const phase = process.argv[2]; assert(["prepare", "finish"].includes(phase));
const prior = JSON.parse(await readFile(".local/p04-form-module-checkpoint.json", "utf8")) as { tenantId: string; formId: string; submissionId: string };
const fixture = JSON.parse(await readFile(".local/p03-members-fixture.json", "utf8")) as { people: { id: string; email: string; password: string }[] };
const person = fixture.people[2], output = "docs/qa/P06-T01/", checkpointPath = ".local/p06-public-submission-checkpoint.json";
const cases: { label: string; status: number }[] = []; let cookie = "";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex"), digest = (value: unknown) => hash(JSON.stringify(value));
type Options = { method?: string; input?: unknown; expected?: number | number[]; owner?: boolean; key?: string; headers?: Record<string, string> };
async function call(label: string, path: string, options: Options = {}) {
  const { method = "GET", input, expected = 200, owner = false, key = randomUUID(), headers = {} } = options;
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { ...(owner ? { cookie } : {}), ...(method === "GET" ? {} : { origin }),
    ...(method === "POST" ? { "idempotency-key": key } : {}), ...(input === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  assert((Array.isArray(expected) ? expected : [expected]).includes(response.status), label + " " + response.status); cases.push({ label, status: response.status }); return response;
}
async function originalHash() {
  const row = await db.submission.findUniqueOrThrow({ where: { id: prior.submissionId }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } }, files: { orderBy: { id: "asc" } } } });
  assert.equal(row.tenantId, prior.tenantId); return digest({ id: row.id, version: row.version, formVersionId: row.formVersionId, status: row.status, retentionUntil: row.retentionUntil,
    answers: row.answers.map(a => [a.id, a.valueCipher]), receipts: row.receipts.map(r => [r.id, r.pdfCipher, r.evidenceCipher]), files: row.files.map(f => [f.id, f.sha256, f.status, f.scanStatus]) });
}
type Checkpoint = { formId: string; token: string; expiredFormId: string; expiredToken: string; submissionId: string; fileId: string; fileQuestionId: string; fileHash: string;
  receiptId: string; pdfHash: string; originalHash: string; businessHash: string; csvHash: string };
async function snapshot(c: Checkpoint) {
  const forms = await db.form.findMany({ where: { id: { in: [c.formId, c.expiredFormId] }, tenantId: prior.tenantId }, include: { versions: { orderBy: { number: "asc" } },
    publications: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } }); assert.equal(forms.length, 2);
  const submissions = await db.submission.findMany({ where: { tenantId: prior.tenantId, formVersion: { formId: { in: [c.formId, c.expiredFormId] } } }, include: {
    answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } }, files: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } }); assert.equal(submissions.length, 3);
  return { forms: forms.map(f => ({ id: f.id, status: f.status, version: f.version, versions: f.versions.map(v => [v.id, v.number, v.status]),
    publications: f.publications.map(p => [p.id, p.formVersionId, p.status, p.responseCount, p.maxResponses, p.expiresAt]) })),
    submissions: submissions.map(s => ({ id: s.id, version: s.version, status: s.status, publicationId: s.publicationId, formVersionId: s.formVersionId, retentionUntil: s.retentionUntil,
      answers: s.answers.map(a => [a.id, hash(a.valueCipher)]), receipts: s.receipts.map(r => [r.id, r.documentHash, r.pdfHash, r.pdfCipher ? hash(r.pdfCipher) : null, r.evidenceCipher ? hash(r.evidenceCipher) : null]),
      files: s.files.map(f => [f.id, f.sha256, f.status, f.scanStatus, f.uploadTokenHash]) })), originalHash: await originalHash() };
}
async function create(content: FormRecord["content"], serviceId: string) {
  return await (await call("independent public form", "/forms", { method: "POST", owner: true, expected: 201, input: { serviceId, title: "P06 공개 접수 검증 " + randomUUID(), content } })).json() as FormRecord;
}
async function publish(form: FormRecord, expiresAt?: string) {
  return await (await call("publish independent form", "/forms/" + form.id + "/publish", { method: "POST", owner: true, expected: 201, input: { version: form.version, ...(expiresAt ? { expiresAt } : {}) } })).json() as { id: string; token: string };
}
async function upload(token: string, questionId: string) {
  const bytes = Buffer.from("공개 API 합성 첨부 " + randomUUID()), fileHash = hash(bytes);
  const file = await (await call("public file init", "/public/forms/" + token + "/uploads", { method: "POST", expected: 201, input: { questionId, name: "공개-" + randomUUID() + ".txt", mime: "text/plain", size: bytes.length, sha256: fileHash } })).json() as { id: string; uploadToken: string };
  const response = await fetch(origin + "/api/v1/uploads/" + file.id + "/content", { method: "PUT", headers: { origin, "content-type": "text/plain", "x-upload-token": file.uploadToken }, body: bytes }); assert.equal(response.status, 200); cases.push({ label: "actual public file bytes", status: response.status });
  await call("actual ClamAV complete", "/uploads/" + file.id + "/complete", { method: "POST", headers: { "x-upload-token": file.uploadToken } }); return { ...file, bytes, fileHash };
}
try {
  assert(/^p03-(foreign|member)-.+@catchsecu\.local\.test$/.test(person.email)); const user = await db.user.findUniqueOrThrow({ where: { id: person.id } }); assert(user.status === "active" && user.emailVerified && !user.platformAdmin);
  const company = await db.company.findUniqueOrThrow({ where: { id: prior.tenantId } }); assert(/^P04 모듈 검증 [0-9a-f-]{36}$/.test(company.name));
  const login = await call("synthetic login", "/auth/sign-in/email", { method: "POST", input: { email: person.email, password: person.password } }); cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert(cookie);
  await call("synthetic company", "/context", { method: "POST", owner: true, input: { companyId: prior.tenantId } });
  let c: Checkpoint;
  if (phase === "prepare") {
    const original = await originalHash(), source = await (await call("original archived metadata only", "/forms/" + prior.formId, { owner: true })).json() as FormRecord;
    assert.equal((await db.securityPolicy.findUniqueOrThrow({ where: { tenantId: prior.tenantId } })).requireApproval, false);
    const mode = randomUUID(), detail = randomUUID(), matrix = randomUUID(), row = randomUUID(), fileQuestion = randomUUID();
    const content = formContentSchema.parse({ body: "합성 공개 접수", consentRequired: true, consentPurpose: "접수 검증", retentionDays: 30, maxResponses: 2,
      questions: [{ id: mode, type: "객관식 답변", label: "방식", required: true, options: ["온라인", "현장"] },
        { id: detail, type: "단문형 답변", label: "현장 안내", required: true, condition: { questionId: mode, operator: "equals", value: "현장" } },
        { id: matrix, type: "행렬형 복수 선택", label: "행 선택", required: true, options: ["첫째", "둘째"], rows: [{ id: row, label: "행 A" }], selectionLimits: { min: 1, max: 1 } },
        { id: fileQuestion, type: "파일 업로드", label: "증빙", required: true }] });
    const form = await create(content, source.serviceId), publication = await publish(form), path = "/public/forms/" + publication.token, basic = { consent: true, answers: { [mode]: "온라인", [matrix]: { [row]: ["첫째"] } } };
    const publicData = await (await call("safe published DTO", path)).json(); assert.equal(publicData.closed, false);
    for (const hidden of [prior.tenantId, source.serviceId, form.id, publication.id, "tokenCipher", "documentVersionId"]) assert(!JSON.stringify(publicData).includes(hidden));
    const firstFile = await upload(publication.token, fileQuestion), input = { ...basic, answers: { ...basic.answers, [fileQuestion]: firstFile.id }, attachments: { [fileQuestion]: { fileId: firstFile.id, token: firstFile.uploadToken } } };
    for (const [label, payload] of [["consent rejected", { ...input, consent: false }], ["foreign actual question", { ...input, answers: { ...input.answers, [source.content.questions[0].id]: "위조" } }],
      ["hidden answer rejected", { ...input, answers: { ...input.answers, [detail]: "숨긴 정보" } }], ["foreign matrix row", { ...input, answers: { ...input.answers, [matrix]: { [randomUUID()]: ["첫째"] } } }],
      ["tenant field rejected", { ...input, tenantId: prior.tenantId }], ["option value rejected", { ...input, answers: { ...input.answers, [mode]: "위조" } }]])
      await call(String(label), path + "/submissions", { method: "POST", input: payload, expected: 422 });
    await call("missing key rejected", path + "/submissions", { method: "POST", input, key: "", expected: 400 });
    await call("foreign origin rejected", path + "/submissions", { method: "POST", input, headers: { origin: "http://foreign.invalid" }, expected: 403 });
    await call("unknown public suffix", path + "/extra", { expected: 404 }); await call("foreign token rejected", "/public/forms/" + "A".repeat(43), { expected: 404 });
    const key = randomUUID(); await call("bad upload proof rolls back", path + "/submissions", { method: "POST", input: { ...input, attachments: { [fileQuestion]: { fileId: firstFile.id, token: "A".repeat(43) } } }, key, expected: 422 });
    assert.equal(await db.submission.count({ where: { publicationId: publication.id } }), 0); assert.equal((await db.publication.findUniqueOrThrow({ where: { id: publication.id } })).responseCount, 0);
    let lost = false, clientCalls = 0;
    const session = new PublicSubmissionSession({ makeKey: () => key, send: async (payload, requestKey) => {
      clientCalls++; const result = await (await call("actual submission then lost/recovered client response", path + "/submissions", { method: "POST", input: JSON.parse(payload), key: requestKey, expected: 201 })).json();
      if (!lost) { lost = true; throw new TypeError("success response lost after real HTTP 201"); } return result;
    } });
    await assert.rejects(session.submit(JSON.stringify(input)), TypeError); assert(session.hasPending); assert.equal(await db.submission.count({ where: { publicationId: publication.id } }), 1);
    await assert.rejects(session.submit(JSON.stringify({ ...input, consent: false }))); assert.equal(clientCalls, 1);
    const receipt = await session.retry(); assert(!session.hasPending); assert.equal(clientCalls, 2);
    const secondFile = await upload(publication.token, fileQuestion), secondInput = { ...input, answers: { ...input.answers, [fileQuestion]: secondFile.id }, attachments: { [fileQuestion]: { fileId: secondFile.id, token: secondFile.uploadToken } } };
    const competing = await Promise.all([1, 2].map(n => call("last slot competitor " + n, path + "/submissions", { method: "POST", input: secondInput, expected: [201, 409] }))); assert.deepEqual(competing.map(r => r.status).sort(), [201, 409]);
    assert.equal((await db.publication.findUniqueOrThrow({ where: { id: publication.id } })).responseCount, 2); assert.equal(await db.submission.count({ where: { publicationId: publication.id } }), 2);
    assert.equal((await (await call("same key after full", path + "/submissions", { method: "POST", input, key, expected: 201 })).json() as SubmissionReceipt).id, receipt.id);
    await call("changed same key rejected", path + "/submissions", { method: "POST", key, input: { ...input, answers: { ...input.answers, [matrix]: { [row]: ["둘째"] } } }, expected: 409 });
    assert.equal((await (await call("full displayed", path)).json()).closed, true);
    const client = new Client({ connectionString: env.DATABASE_URL, application_name: "public-http-replay-barrier" }); await client.connect(); let waiting = 0;
    try {
      await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["submission:" + publication.id + ":" + key]);
      const pending = call("closed during replay wait", path + "/submissions", { method: "POST", key, input, expected: 410 });
      const until = Date.now() + 3000;
      while (Date.now() < until) { await client.query("SELECT pg_stat_clear_snapshot()"); const state = await client.query<{ count: string }>("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid() AND query LIKE '%pg_advisory_xact_lock%'"); waiting = Number(state.rows[0].count); if (waiting) break; await new Promise(resolve => setTimeout(resolve, 25)); }
      assert(waiting > 0); await call("actual pause during replay wait", "/forms/" + form.id + "/pause", { method: "POST", owner: true, input: { version: 2 } });
      await client.query("COMMIT"); await pending;
    } finally { await client.query("ROLLBACK").catch(() => undefined); await client.end(); }
    await call("actual resume", "/forms/" + form.id + "/resume", { method: "POST", owner: true, input: { version: 3 } });
    assert.equal((await (await call("same key after resume", path + "/submissions", { method: "POST", key, input, expected: 201 })).json()).id, receipt.id);
    const expiryContent = { ...content, questions: content.questions.slice(0, 3) }, expiryForm = await create(expiryContent, source.serviceId), deadline = Date.now() + 5000;
    const expiry = await publish(expiryForm, new Date(deadline).toISOString()), expiryPath = "/public/forms/" + expiry.token, expiryKey = randomUUID();
    await call("before actual expiry", expiryPath); await call("submit before actual expiry", expiryPath + "/submissions", { method: "POST", input: basic, key: expiryKey, expected: 201 });
    await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - Date.now() + 50)));
    await call("actual clock expiry read", expiryPath, { expected: 410 }); await call("actual clock expiry replay", expiryPath + "/submissions", { method: "POST", input: basic, key: expiryKey, expected: 410 });
    await call("archive only independent main form", "/forms/" + form.id, { method: "DELETE", owner: true, headers: { "if-match": "4" }, expected: 204 });
    await call("archived replay rejected", path + "/submissions", { method: "POST", input, key, expected: 410 });
    const storedReceipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: receipt.id } }); assert(storedReceipt.pdfHash);
    c = { formId: form.id, token: publication.token, expiredFormId: expiryForm.id, expiredToken: expiry.token, submissionId: receipt.id, fileId: firstFile.id,
      fileQuestionId: fileQuestion, fileHash: firstFile.fileHash, receiptId: storedReceipt.id, pdfHash: storedReceipt.pdfHash, originalHash: original, businessHash: "", csvHash: "" };
    c.businessHash = digest(await snapshot(c));
    await writeFile(output + "http-barrier.json", JSON.stringify({ checkedAt: new Date().toISOString(), waiting, status: 410, sourceCompanyOrServiceChanged: false,
      actualPauseApi: true, successResponseLostAfterHttp201: true, immutableClientCalls: clientCalls, responses: 2, actualExpiryElapsedMs: Date.now() - (deadline - 5000) }, null, 2) + "\n");
  } else c = JSON.parse(await readFile(checkpointPath, "utf8")) as Checkpoint;
  const detail = await (await call("actual archived response", "/submissions/" + c.submissionId, { owner: true })).json(); assert.equal(detail.id, c.submissionId); assert.equal(detail.receipts.length, 1);
  const file = await call("actual attached bytes after archive/restart", "/files/" + c.fileId + "/download?" + new URLSearchParams({ submissionId: c.submissionId, questionId: c.fileQuestionId }), { owner: true }); assert.equal(hash(Buffer.from(await file.arrayBuffer())), c.fileHash);
  const pdf = await call("actual consent PDF after archive/restart", "/submissions/" + c.submissionId + "/receipts/" + c.receiptId + "/pdf", { owner: true }); assert.equal(hash(Buffer.from(await pdf.arrayBuffer())), c.pdfHash);
  const csv = await call("actual archived CSV after restart", "/forms/" + c.formId + "/submissions/export", { owner: true }); assert.equal(csv.headers.get("x-export-row-count"), "2");
  const csvHash = hash(Buffer.from(await csv.arrayBuffer())); if (phase === "prepare") c.csvHash = csvHash; else assert.equal(csvHash, c.csvHash);
  await call("archived public still closed", "/public/forms/" + c.token, { expected: 410 }); await call("expired public still closed", "/public/forms/" + c.expiredToken, { expected: 410 });
  const state = await snapshot(c); assert.equal(digest(state), c.businessHash); assert.equal(state.originalHash, c.originalHash);
  await call("synthetic logout", "/auth/sign-out", { method: "POST", owner: true, input: {} }); cookie = "";
  if (phase === "prepare") await writeFile(checkpointPath, JSON.stringify(c), { mode: 0o600 });
  await writeFile(output + "http-" + phase + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), phase, result: "passed", cases, businessDatabase: state,
    businessHash: c.businessHash, originalSubmissionUnchanged: true, fileHash: c.fileHash, pdfHash: c.pdfHash, csvHash, matchesAfterRestart: phase === "finish",
    syntheticSessionClosed: true, userAdminAccountUntouched: true, globalProductionWorkerExecuted: false, actualUiVerified: false, externalDeliveryVerified: false }, null, 2) + "\n");
  console.info(JSON.stringify({ phase, result: "passed", cases: cases.length, businessSnapshotMatches: true, originalSubmissionUnchanged: true }));
} finally {
  if (cookie) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
  await db.$disconnect();
}
