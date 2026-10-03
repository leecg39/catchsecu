import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { fingerprint, versionInclude } from "../src/server/forms";
import type { FormRecord } from "../src/contracts/forms";
import { documentInput, type DocumentRecord } from "../src/contracts/documents";
import type { FormConsentBundle, ConsentEvidence } from "../src/contracts/form-documents";

const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
const phase = process.argv[2]; assert(["prepare", "finish"].includes(phase));
const source = JSON.parse(await readFile(".local/p03-members-fixture.json", "utf8")) as { people: { id: string; email: string; password: string }[] };
const people = [source.people[2], source.people[1]], cookies = ["", ""], cases: { label: string; status: number }[] = [], barriers: { label: string; waiting: number; statuses: number[] }[] = [];
const prior = JSON.parse(await readFile(".local/p04-form-module-checkpoint.json", "utf8")) as { tenantId: string; formId: string; documentId: string };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex"), byteHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function request(label: string, path: string, actor = 0, method = "GET", input?: unknown, expected: number | number[] = 200, headers: Record<string, string> = {}, raw?: Uint8Array) {
  const response = await fetch(origin + "/api/v1" + path, { method, redirect: "manual", headers: { cookie: cookies[actor] ?? "", ...(method === "GET" ? {} : { origin }),
    ...(input === undefined ? {} : { "content-type": "application/json" }), ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}), ...headers },
    ...(raw ? { body: raw as BodyInit } : input === undefined ? {} : { body: JSON.stringify(input) }) });
  const code = response.status >= 400 ? (await response.clone().json().catch(() => null))?.error?.code : undefined;
  assert((Array.isArray(expected) ? expected : [expected]).includes(response.status), label + ": HTTP " + response.status + (code ? " " + code : "")); cases.push({ label, status: response.status }); return response;
}
async function data<T>(label: string, path: string, actor = 0, method = "GET", input?: unknown, expected = 200, headers: Record<string, string> = {}) {
  return (await request(label, path, actor, method, input, expected, headers)).json() as Promise<T>;
}
const read = (id: string) => data<FormRecord>("현재 시험 폼 조회", "/forms/" + id);
async function competing(label: string, id: string, operations: (() => Promise<Response>)[]) {
  assert.equal((await db.form.findUniqueOrThrow({ where: { id } })).tenantId, prior.tenantId);
  const client = new Client({ connectionString: env.DATABASE_URL, application_name: "form-receipt-synthetic-barrier" }); await client.connect();
  try {
    await client.query("BEGIN"); await client.query('SELECT id FROM "Form" WHERE id=$1 AND "tenantId"=$2 FOR UPDATE', [id, prior.tenantId]);
    const pending = Promise.all(operations.map(operation => operation())); let waiting = 0; const until = Date.now() + 2000;
    while (Date.now() < until) {
      await client.query("SELECT pg_stat_clear_snapshot()");
      const result = await client.query<{ count: string }>(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM "Form"%' AND pid<>pg_backend_pid()`);
      waiting = Number(result.rows[0].count); if (waiting >= operations.length) break;
      await new Promise(done => setTimeout(done, 25));
    }
    await client.query("COMMIT"); const responses = await pending; assert(waiting >= operations.length, label + ": overlapping lock waits required");
    barriers.push({ label, waiting, statuses: responses.map(response => response.status) }); return responses;
  } finally { await client.query("ROLLBACK").catch(() => undefined); await client.end(); }
}
async function parsedPdf(bytes: Uint8Array) {
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }), pdf = await loading.promise;
  try {
    const lines: string[] = []; for (let page = 1; page <= pdf.numPages; page++) lines.push((await (await pdf.getPage(page)).getTextContent()).items.map(item => "str" in item ? item.str : "").join(""));
    assert.equal(await pdf.getJSActions(), null); return lines.join("").replace(/\s/g, "");
  } finally { await loading.destroy(); }
}
type Evidence = { submissionId: string; receiptId: string; fileId: string; questionId: string; fileHash: string; pdfHash: string; receiptHash: string; versionId: string; versionHash: string; answerHash: string; documentHash: string };
async function receiptState(submissionId: string) {
  const receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId } }); assert.equal(receipt.tenantId, prior.tenantId); assert.equal(receipt.evidenceVersion, 1); assert(receipt.pdfCipher && receipt.evidenceCipher);
  return { receipt, hash: digest({ id: receipt.id, documentHash: receipt.documentHash, pdfHash: receipt.pdfHash, evidenceHash: digest(receipt.evidenceCipher), pdfCipherHash: digest(receipt.pdfCipher), grantedAt: receipt.grantedAt }) };
}
async function receiptBytes(e: Pick<Evidence, "submissionId" | "receiptId" | "pdfHash">, label: string) {
  const response = await request(label, `/submissions/${e.submissionId}/receipts/${e.receiptId}/pdf`); assert(response.headers.get("content-type")?.startsWith("application/pdf"));
  const bytes = new Uint8Array(await response.arrayBuffer()); assert.equal(byteHash(bytes), e.pdfHash); assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), "%PDF"); return bytes;
}
async function submit(formId: string, token: string, title: string): Promise<Evidence> {
  const row = await read(formId), q = row.content.questions, body = await data<{ consentBundle: FormConsentBundle }>("실제 게시 동의서 조회", "/public/forms/" + token, 2);
  assert.equal(q.length, 9); const bytes = Buffer.from("영수증 실제 파일 " + randomUUID()), questionId = q[6].id, fileHash = byteHash(bytes);
  const upload = await data<{ id: string; uploadToken: string }>("필수 파일 준비 " + title, "/public/forms/" + token + "/uploads", 2, "POST", { questionId, name: "영수증-검증.txt", mime: "text/plain", size: bytes.length, sha256: fileHash }, 201);
  await request("필수 파일 원본 전송 " + title, "/uploads/" + upload.id + "/content", 2, "PUT", undefined, 200, { "content-type": "text/plain", "x-upload-token": upload.uploadToken }, new Uint8Array(bytes));
  await request("ClamAV 완료 " + title, "/uploads/" + upload.id + "/complete", 2, "POST", undefined, 200, { "x-upload-token": upload.uploadToken });
  const answers = { [q[0].id]: "합성 이름", [q[1].id]: "장문 답변", [q[2].id]: "첫째", [q[3].id]: ["첫째"], [q[4].id]: "둘째", [q[5].id]: "2026-10-03", [q[6].id]: upload.id,
    [q[7].id]: Object.fromEntries(q[7].rows!.map(r => [r.id, "첫째"])), [q[8].id]: Object.fromEntries(q[8].rows!.map(r => [r.id, ["둘째"]])) };
  const sub = await data<{ id: string }>("아홉 질문 제출 " + title, "/public/forms/" + token + "/submissions", 2, "POST", { answers, consent: true, documentConsents: body.consentBundle.documents.map(d => d.key), attachments: { [questionId]: { fileId: upload.id, token: upload.uploadToken } } }, 201);
  const { receipt, hash } = await receiptState(sub.id), stored = await db.submission.findUniqueOrThrow({ where: { id: sub.id }, include: { answers: { orderBy: { id: "asc" } } } }); assert.equal(stored.answers.length, 9);
  const evidence = decrypt<ConsentEvidence>(receipt.evidenceCipher!); assert.equal(evidence.formVersion, row.draftNumber); assert.equal(evidence.bundle.documents.length, 1);
  return { submissionId: sub.id, receiptId: receipt.id, fileId: upload.id, questionId, fileHash, pdfHash: receipt.pdfHash!, receiptHash: hash, versionId: stored.formVersionId,
    versionHash: fingerprint(await db.formVersion.findUniqueOrThrow({ where: { id: stored.formVersionId }, include: versionInclude })), answerHash: digest(stored.answers.map(a => a.valueCipher)), documentHash: evidence.bundle.documents[0].contentHash };
}
type Checkpoint = { tenantId: string; formId: string; fixedId: string; oldToken: string; newToken: string; marker: string; first: Evidence; second: Evidence; businessHash: string };
async function snapshot(c: Checkpoint) {
  const form = await db.form.findUniqueOrThrow({ where: { id: c.formId }, select: { id: true, version: true, status: true, publishedVersionId: true } });
  const versions = await db.formVersion.findMany({ where: { formId: c.formId }, include: versionInclude, orderBy: { number: "asc" } });
  const publications = await db.publication.findMany({ where: { formId: c.formId }, select: { id: true, formVersionId: true, status: true, responseCount: true }, orderBy: { id: "asc" } });
  const submissions = [];
  for (const e of [c.first, c.second]) {
    const s = await db.submission.findUniqueOrThrow({ where: { id: e.submissionId }, include: { answers: { orderBy: { id: "asc" } } } }), receipt = await receiptState(s.id);
    const file = await db.fileObject.findUniqueOrThrow({ where: { id: e.fileId }, select: { id: true, status: true, scanStatus: true, sha256: true } });
    assert.equal(s.formVersionId, e.versionId); assert.equal(digest(s.answers.map(a => a.valueCipher)), e.answerHash); assert.equal(receipt.hash, e.receiptHash);
    assert.equal(fingerprint(versions.find(v => v.id === e.versionId)!), e.versionHash);
    submissions.push({ id: s.id, formVersionId: s.formVersionId, answers: s.answers.length, answerHash: e.answerHash, receiptHash: receipt.hash, pdfHash: receipt.receipt.pdfHash, file });
  }
  const fixed = await db.fixedUrl.findUniqueOrThrow({ where: { id: c.fixedId }, select: { id: true, publicationId: true, version: true, status: true } });
  return { form, versions: versions.map(v => ({ id: v.id, number: v.number, hash: fingerprint(v) })), publications, submissions, fixed };
}
try {
  assert((await db.company.findUniqueOrThrow({ where: { id: prior.tenantId } })).name.startsWith("P04 모듈 검증 "));
  for (let actor = 0; actor < 2; actor++) {
    const person = people[actor]; assert(/^p03-(foreign|member)-.+@catchsecu\.local\.test$/.test(person.email));
    const user = await db.user.findUniqueOrThrow({ where: { id: person.id } }); assert(user.status === "active" && user.emailVerified && !user.platformAdmin);
    const response = await request("합성 로그인 " + actor, "/auth/sign-in/email", actor, "POST", { email: person.email, password: person.password }); cookies[actor] = response.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
    await request("시험 회사 선택 " + actor, "/context", actor, "POST", { companyId: prior.tenantId });
  }
  let checkpoint: Checkpoint;
  if (phase === "prepare") {
    const policy = await data<{ requireApproval: boolean }>("현재 정책 확인", "/security/policy"); assert.equal(policy.requireApproval, false);
    const unfinished = await db.form.findMany({ where: { tenantId: prior.tenantId, ownerId: people[0].id, status: { not: "archived" }, title: { startsWith: "영수증과 경합 검증 " } }, select: { id: true, title: true, version: true } });
    for (const row of unfinished) {
      assert(/^영수증과 경합 검증 [0-9a-f-]{36}$/.test(row.title));
      await request("이전 실패 합성 폼 보관", "/forms/" + row.id, 0, "DELETE", undefined, 204, { "if-match": String(row.version) });
    }
    const copied = await data<FormRecord>("보관 원본에서 독립 아홉 질문 복사", "/forms/" + prior.formId + "/copy", 0, "POST", { title: "영수증과 경합 검증 " + randomUUID() }, 201);
    const firstPublication = await data<{ id: string; token: string }>("최초 독립 폼 게시", "/forms/" + copied.id + "/publish", 0, "POST", { version: copied.version }, 201);
    const fixed = await data<{ id: string }>("독립 고정 주소 생성", "/fixed-urls", 0, "POST", { name: "영수증 경합 고정 주소", formId: copied.id }, 201);
    const first = await submit(copied.id, firstPublication.token, "최초"), beforeBytes = await receiptBytes(first, "최초 실제 영수증 PDF");
    const beforeText = await parsedPdf(beforeBytes); assert(beforeText.includes("개인정보동의영수증") && beforeText.includes(first.documentHash));
    await writeFile("docs/qa/P04-T05/concurrency/receipt-before.pdf", beforeBytes);
    const doc = await data<DocumentRecord>("원본 동의서 현재 버전", "/documents/" + prior.documentId), marker = "PDF 재게시 증거 " + randomUUID(); assert(doc.body.startsWith("합성 상담"));
    const input = documentInput.parse(Object.fromEntries(Object.keys(documentInput.shape).map(key => [key, doc[key as keyof DocumentRecord]])));
    const editedDoc = await data<{ version: number }>("원본 동의서 본문 변경", "/documents/" + prior.documentId, 0, "PATCH", { ...input, version: doc.version, body: doc.body + "\n" + marker });
    const docPublication = await data<{ number: number }>("원본 문서 새 버전 게시", "/documents/" + prior.documentId + "/publish", 0, "POST", { version: editedDoc.version, expiresAt: null }, 201);
    const docVersions = await data<{ items: { id: string; number: number }[] }>("새 문서 게시 버전 선택", "/documents/" + prior.documentId + "/versions"), documentVersion = docVersions.items.find(v => v.number === docPublication.number); assert(documentVersion);
    let current = await read(copied.id);
    const content = { ...current.content, documentConsents: [{ documentVersionId: documentVersion.id, required: true, kind: "collection" as const }], body: "영수증의 새 게시 본문" };
    const draft = await data<FormRecord>("같은 폼에 새 문서/초안 연결", "/forms/" + copied.id + "/draft", 0, "PATCH", { version: current.version, content });
    const writes = await competing("같은 version 두 저장", copied.id, ["경합 A", "경합 B"].map(body => () => request("동시 초안 저장 " + body, "/forms/" + copied.id + "/draft", 0, "PATCH", { version: draft.version, content: { ...content, body } }, [200, 409], { "idempotency-key": randomUUID() })));
    assert.deepEqual(writes.map(r => r.status).sort(), [200, 409]); current = await read(copied.id);
    const outcomes = await competing("게시와 같은 version 수정", copied.id, [
      () => request("동시 게시", "/forms/" + copied.id + "/publish", 0, "POST", { version: current.version }, [201, 409]),
      () => request("게시와 동시 수정", "/forms/" + copied.id + "/draft", 0, "PATCH", { version: current.version, content: { ...content, body: "게시 경합 후 수정" } }, [200, 409], { "idempotency-key": randomUUID() }),
    ]); assert([[201, 409], [409, 200]].some(statuses => statuses.every((status, i) => status === outcomes[i].status)));
    const secondPublication = outcomes[0].status === 201 ? await outcomes[0].json() as { id: string; token: string } : await data<{ id: string; token: string }>("수정 승자 최신 version 게시", "/forms/" + copied.id + "/publish", 0, "POST", { version: (await read(copied.id)).version }, 201);
    assert.equal((await db.fixedUrl.findUniqueOrThrow({ where: { id: fixed.id } })).publicationId, secondPublication.id);
    assert.equal((await receiptState(first.submissionId)).hash, first.receiptHash);
    const afterBytes = await receiptBytes(first, "새 문서와 폼 게시 후 최초 영수증 PDF"); assert.deepEqual(afterBytes, beforeBytes); assert(!(await parsedPdf(afterBytes)).includes(marker.replace(/\s/g, "")));
    await writeFile("docs/qa/P04-T05/concurrency/receipt-after.pdf", afterBytes);
    const second = await submit(copied.id, secondPublication.token, "새 게시"), secondBytes = await receiptBytes(second, "새 문서 버전의 실제 영수증 PDF");
    assert.notEqual(second.documentHash, first.documentHash); assert((await parsedPdf(secondBytes)).includes(marker.replace(/\s/g, ""))); await writeFile("docs/qa/P04-T05/concurrency/receipt-new-version.pdf", secondBytes);
    current = await read(copied.id); await request("시험 폼 보관", "/forms/" + copied.id, 0, "DELETE", undefined, 204, { "if-match": String(current.version) });
    checkpoint = { tenantId: prior.tenantId, formId: copied.id, fixedId: fixed.id, oldToken: firstPublication.token, newToken: secondPublication.token, marker, first, second, businessHash: "" };
    checkpoint.businessHash = digest(await snapshot(checkpoint)); await writeFile(".local/p04-receipt-race-checkpoint.json", JSON.stringify(checkpoint, null, 2) + "\n", { mode: 0o600 });
  } else checkpoint = JSON.parse(await readFile(".local/p04-receipt-race-checkpoint.json", "utf8"));
  assert.equal(checkpoint.tenantId, prior.tenantId); const business = await snapshot(checkpoint); assert.equal(digest(business), checkpoint.businessHash); assert.equal(business.form.status, "archived"); assert.equal(business.versions.length, 2);
  const before = new Uint8Array(await readFile("docs/qa/P04-T05/concurrency/receipt-before.pdf"));
  assert.deepEqual(await receiptBytes(checkpoint.first, "최종·재시작 최초 영수증 PDF"), before);
  const next = await receiptBytes(checkpoint.second, "최종·재시작 새 영수증 PDF"); assert((await parsedPdf(next)).includes(checkpoint.marker.replace(/\s/g, "")));
  for (const e of [checkpoint.first, checkpoint.second]) {
    const path = `/submissions/${e.submissionId}/receipts/${e.receiptId}/pdf`;
    await request("조회자 영수증 권한 거부", path, 1, "GET", undefined, 403); await request("미인증 영수증 권한 거부", path, 2, "GET", undefined, 401);
    const response = await request("보관 후 원본 첨부 유지", `/files/${e.fileId}/download?submissionId=${e.submissionId}&questionId=${e.questionId}`); assert.equal(byteHash(new Uint8Array(await response.arrayBuffer())), e.fileHash);
  }
  await request("이전 공개 링크 종료", "/public/forms/" + checkpoint.oldToken, 2, "GET", undefined, 410); await request("새 공개 링크 종료", "/public/forms/" + checkpoint.newToken, 2, "GET", undefined, 410);
  assert.equal(digest(await snapshot(checkpoint)), checkpoint.businessHash);
  for (let actor = 0; actor < 2; actor++) { await request("합성 세션 종료 " + actor, "/auth/sign-out", actor, "POST", {}); cookies[actor] = ""; }
  await writeFile(`docs/qa/P04-T05/concurrency/http-${phase}.json`, JSON.stringify({ phase, result: "passed", checkedAt: new Date().toISOString(), cases, barriers, businessDatabase: business,
    matchesBeforeRestart: phase === "finish", originalReceiptPdfByteIdentical: true, newReceiptContainsNewDocument: true, publicFileUploadExercised: true, userAdminAccountUntouched: true, syntheticSessionsClosed: true, actualUiVerified: false, externalDeliveryVerified: false, globalProductionWorkerExecuted: false }, null, 2) + "\n");
  console.log(JSON.stringify({ phase, result: "passed", cases: cases.length, barriers: barriers.length, versions: business.versions.length, receipts: business.submissions.length }));
} finally {
  for (const cookie of cookies.filter(Boolean)) await fetch(origin + "/api/v1/auth/sign-out", { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
  await db.$disconnect();
}
