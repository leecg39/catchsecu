import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import type { FormRecord } from "../src/contracts/forms";
import { legacyQuestionMaterialsColumn } from "./qa-legacy-language";

const origin = "http://localhost:3100", database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname));
const directory = ".local/rea-fullstack/question-explanation", output = "docs/qa/R08-T02/question-metadata/explanation/flow", file = directory + "/fixture.json";
const originalExplanation = "  설명 첫 줄 <script>window.__qaExplanation = 1</script>\n둘째 줄 & 참고: https://example.test/path  ";
const revisedExplanation = "개정된 추가 설명\n이 안내는 새 게시본에만 표시합니다.";
type Fixture = { email: string; password: string; cookie: string; companyId: string; formId: string; questionIds: string[];
  originalExplanation: string; revisedExplanation: string; token?: string; revisionToken?: string; submissionId?: string; receiptHash?: string; hash?: string };
let f: Fixture;
const save = () => writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 });
const checks: { action: string; status: number; code?: string }[] = [];
async function request<T = FormRecord>(action: string, path: string, expected: number, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(origin + "/api/v1" + path, { method, headers: { origin, cookie: f.cookie, "idempotency-key": randomUUID(),
    ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json().catch(() => null); checks.push({ action, status: response.status, code: value?.error?.code });
  assert.equal(response.status, expected, action + ": " + (value?.error?.code ?? "")); return { response, value: value as T };
}
async function snapshot() {
  return db.$transaction(async tx => ({ forms: await tx.form.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: {
    versions: { orderBy: { id: "asc" }, include: { questions: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } } } }, publications: { orderBy: { id: "asc" } } } }),
    submissions: await tx.submission.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } } } }),
    corrections: await tx.correction.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: { payload: true } }),
    audits: await tx.auditEvent.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
  }), { isolationLevel: "RepeatableRead" });
}
try {
  await mkdir(directory, { recursive: true, mode: 0o700 }); await mkdir(output, { recursive: true }); const mode = process.argv[2];
  if (mode === "prepare") {
    if (await access(file).then(() => true, () => false)) {
      f = JSON.parse(await readFile(file, "utf8")); assert(!f.companyId && !f.formId && !f.hash);
      assert.equal(await db.user.count({ where: { email: f.email } }), 0, "Inspect partial preparation; never duplicate it");
    } else {
      f = { email: "rea-explanation-" + randomUUID().slice(0, 8) + "@example.test", password: randomBytes(20).toString("hex") + "Aa!1", cookie: "", companyId: "", formId: "",
        questionIds: Array.from({ length: 3 }, () => randomUUID()), originalExplanation, revisedExplanation }; await save();
    }
    await request("register isolated QA owner", "/auth/sign-up/email", 200, { email: f.email, password: f.password, name: "추가 설명 검증 소유자" });
    await db.user.update({ where: { email: f.email }, data: { emailVerified: true } });
    const login = await request("login isolated QA owner", "/auth/sign-in/email", 200, { email: f.email, password: f.password });
    f.cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); await save();
    f.companyId = (await request<{ id: string }>("create isolated QA company", "/companies", 201, { name: "질문 추가 설명 검증", publicName: "추가 설명 QA" })).value.id; await save();
    const service = await db.service.findFirstOrThrow({ where: { tenantId: f.companyId } });
    f.formId = (await request("create draft for actual Ego explanation editing", "/forms", 201, { serviceId: service.id, title: "질문 추가 설명 검증", content: {
      body: "추가 설명 저장·공개·이전 게시본 유지 확인", formLanguage: "ko", consentRequired: true, consentPurpose: "질문 추가 설명 기능 검증", retentionDays: 30, maxResponses: 20,
      questions: [{ id: f.questionIds[0], type: "객관식 답변", label: "표시 조건", required: true, options: ["보기", "숨기기"] },
        { id: f.questionIds[1], type: "단문형 답변", label: "설명 확인", required: true, condition: { questionId: f.questionIds[0], operator: "equals", value: "보기" } },
        { id: f.questionIds[2], type: "단문형 답변", label: "설명 제거 확인", required: false }] } })).value.id; await save();
  } else {
    f = JSON.parse(await readFile(file, "utf8")); assert(!f.hash || mode === "verify", "Frozen fixture is verify-only");
    if (mode === "publish" || mode === "publish-revision") {
      const revision = mode === "publish-revision"; assert(revision ? f.token && !f.revisionToken : !f.token);
      const form = (await request("read actual Ego-saved explanations", "/forms/" + f.formId, 200)).value;
      assert.equal(form.content.questions[1].additionalExplanation, revision ? revisedExplanation : originalExplanation);
      assert(!form.content.questions[2].additionalExplanation, "Explicitly removed explanation must remain empty");
      const before = await db.formVersion.findFirst({ where: { formId: f.formId, status: "published" }, include: { questions: true } });
      if (revision) assert.equal(before?.questions.find(q => q.stableKey === f.questionIds[1])?.additionalExplanation, originalExplanation);
      await request("publish " + (revision ? "new" : "first") + " explanation version", "/forms/" + f.formId + "/publish", 201, { version: form.version });
      const token = decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: f.formId, status: "active" }, orderBy: { createdAt: "desc" } })).tokenCipher);
      if (revision) f.revisionToken = token; else f.token = token; await save();
    } else if (mode === "verify-submission" || mode === "verify-correction") {
      const corrected = mode === "verify-correction";
      const rows = await db.submission.findMany({ where: { tenantId: f.companyId }, include: { formVersion: { include: { questions: true } }, answers: { include: { question: true } }, receipts: true } });
      assert.equal(rows.length, 1); const row = rows[0]; assert.equal(row.version, corrected ? 2 : 1); assert.equal(row.formVersion.number, 1);
      assert.equal(row.formVersion.questions.find(q => q.stableKey === f.questionIds[1])?.additionalExplanation, originalExplanation);
      const values = Object.fromEntries(row.answers.map(a => [a.question.stableKey, decrypt(a.valueCipher)]));
      assert.deepEqual(values, { [f.questionIds[0]]: "보기", [f.questionIds[1]]: corrected ? "정정된 답변" : "최초 답변", [f.questionIds[2]]: "" });
      assert.equal(row.receipts.length, 1); const receipt = row.receipts[0]; assert(receipt.pdfCipher && receipt.pdfHash);
      assert.equal(createHash("sha256").update(Buffer.from(decrypt<string>(receipt.pdfCipher), "base64")).digest("hex"), receipt.pdfHash);
      if (f.receiptHash) assert.equal(receipt.pdfHash, f.receiptHash); else { assert(!corrected); f.receiptHash = receipt.pdfHash; }
      assert.equal(await db.correction.count({ where: { submissionId: row.id } }), corrected ? 1 : 0);
      f.submissionId = row.id; await save();
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", responses: 1,
        version: row.version, sourceFormVersion: row.formVersion.number, originalExplanationExact: true, receiptPdfHash: receipt.pdfHash, corrections: corrected ? 1 : 0 }, null, 2) + "\n");
    } else if (mode === "freeze" || mode === "verify") {
      const state = await snapshot(), hash = createHash("sha256").update(JSON.stringify(state, legacyQuestionMaterialsColumn)).digest("hex");
      if (mode === "freeze") { assert(f.submissionId && f.revisionToken); f.hash = hash; await save(); } else assert.equal(hash, f.hash);
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", hash,
        forms: state.forms.length, versions: state.forms.flatMap(form => form.versions).length, submissions: state.submissions.length, corrections: state.corrections.length, audits: state.audits.length }, null, 2) + "\n");
    } else throw new Error("Unknown mode");
  }
  if (checks.length) await writeFile(output + "/" + mode + "-http.json", JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", mode, checks: checks.length }));
} finally { await db.$disconnect(); }
