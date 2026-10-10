import assert from "node:assert/strict";
import { legacyQuestionPersonalInformationColumn } from "./qa-legacy-language";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import type { FormRecord } from "../src/contracts/forms";

const origin = "http://localhost:3100", database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname));
const directory = ".local/rea-fullstack/question-materials", output = "docs/qa/R08-T02/question-metadata/reference-link/flow", file = directory + "/fixture.json";
const originalMaterials = [
  { materialType: "LINK", orderNumber: 0, fileKey: null, linkLabel: "검증용 개인정보 안내", linkUrl: "http://localhost:3100/legal/privacy?qa=reference-A#notice" },
  { materialType: "LINK", orderNumber: 1, fileKey: null, linkLabel: "참고 <script>window.__qaMaterial = 1</script>", linkUrl: "https://example.test/자료?mode=first&x=1" },
];
const revisedMaterials = [{ materialType: "LINK", orderNumber: 0, fileKey: null, linkLabel: "개정된 참고 자료", linkUrl: "https://example.test/자료?mode=revised" }];
type Fixture = { email: string; password: string; cookie: string; companyId: string; formId: string; questionIds: string[];
  originalMaterials: typeof originalMaterials; revisedMaterials: typeof revisedMaterials; token?: string; revisionToken?: string; submissionId?: string; receiptHash?: string; hash?: string };
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
      f = { email: "rea-materials-" + randomUUID().slice(0, 8) + "@example.test", password: randomBytes(20).toString("hex") + "Aa!1", cookie: "", companyId: "", formId: "",
        questionIds: Array.from({ length: 3 }, () => randomUUID()), originalMaterials, revisedMaterials }; await save();
    }
    await request("register isolated QA owner", "/auth/sign-up/email", 200, { email: f.email, password: f.password, name: "참고 링크 검증 소유자" });
    await db.user.update({ where: { email: f.email }, data: { emailVerified: true } });
    const login = await request("login isolated QA owner", "/auth/sign-in/email", 200, { email: f.email, password: f.password });
    f.cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); await save();
    f.companyId = (await request<{ id: string }>("create isolated QA company", "/companies", 201, { name: "질문 참고 링크 검증", publicName: "참고 링크 QA" })).value.id; await save();
    const service = await db.service.findFirstOrThrow({ where: { tenantId: f.companyId } });
    f.formId = (await request("create draft for actual Ego materials editing", "/forms", 201, { serviceId: service.id, title: "질문 참고 링크 검증", content: {
      body: "참고 링크 저장·공개·이전 게시본 유지 확인", formLanguage: "ko", consentRequired: true, consentPurpose: "질문 참고 링크 기능 검증", retentionDays: 30, maxResponses: 20,
      questions: [{ id: f.questionIds[0], type: "객관식 답변", label: "표시 조건", required: true, options: ["보기", "숨기기"] },
        { id: f.questionIds[1], type: "단문형 답변", label: "링크 확인", required: true, condition: { questionId: f.questionIds[0], operator: "equals", value: "보기" } },
        { id: f.questionIds[2], type: "단문형 답변", label: "참고 자료 제거 확인", required: false }] } })).value.id; await save();
  } else {
    f = JSON.parse(await readFile(file, "utf8")); assert(!f.hash || mode === "verify", "Frozen fixture is verify-only");
    if (mode === "publish" || mode === "publish-revision") {
      const revision = mode === "publish-revision"; assert(revision ? f.token && !f.revisionToken : !f.token);
      const form = (await request("read actual Ego-saved materials", "/forms/" + f.formId, 200)).value;
      assert.deepEqual(form.content.questions[1].materialList, revision ? revisedMaterials : originalMaterials);
      assert(!form.content.questions[2].materialList, "Explicitly removed materials must remain empty");
      const before = await db.formVersion.findFirst({ where: { formId: f.formId, status: "published" }, include: { questions: true } });
      if (revision) assert.deepEqual(before?.questions.find(q => q.stableKey === f.questionIds[1])?.materialList, originalMaterials);
      await request("publish " + (revision ? "new" : "first") + " materials version", "/forms/" + f.formId + "/publish", 201, { version: form.version });
      const token = decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: f.formId, status: "active" }, orderBy: { createdAt: "desc" } })).tokenCipher);
      if (revision) f.revisionToken = token; else f.token = token; await save();
    } else if (mode === "verify-submission" || mode === "verify-correction") {
      const corrected = mode === "verify-correction";
      const rows = await db.submission.findMany({ where: { tenantId: f.companyId }, include: { formVersion: { include: { questions: true } }, answers: { include: { question: true } }, receipts: true } });
      assert.equal(rows.length, 1); const row = rows[0]; assert.equal(row.version, corrected ? 2 : 1); assert.equal(row.formVersion.number, 1);
      assert.deepEqual(row.formVersion.questions.find(q => q.stableKey === f.questionIds[1])?.materialList, originalMaterials);
      const values = Object.fromEntries(row.answers.map(a => [a.question.stableKey, decrypt(a.valueCipher)]));
      assert.deepEqual(values, { [f.questionIds[0]]: "보기", [f.questionIds[1]]: corrected ? "정정된 답변" : "최초 답변", [f.questionIds[2]]: "" });
      assert.equal(row.receipts.length, 1); const receipt = row.receipts[0]; assert(receipt.pdfCipher && receipt.pdfHash);
      assert.equal(createHash("sha256").update(Buffer.from(decrypt<string>(receipt.pdfCipher), "base64")).digest("hex"), receipt.pdfHash);
      if (f.receiptHash) assert.equal(receipt.pdfHash, f.receiptHash); else { assert(!corrected); f.receiptHash = receipt.pdfHash; }
      assert.equal(await db.correction.count({ where: { submissionId: row.id } }), corrected ? 1 : 0);
      f.submissionId = row.id; await save();
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", responses: 1,
        version: row.version, sourceFormVersion: row.formVersion.number, originalMaterialsExact: true, receiptPdfHash: receipt.pdfHash, corrections: corrected ? 1 : 0 }, null, 2) + "\n");
    } else if (mode === "freeze" || mode === "verify") {
      const state = await snapshot(), hash = createHash("sha256").update(JSON.stringify(state, legacyQuestionPersonalInformationColumn)).digest("hex");
      if (mode === "freeze") { assert(f.submissionId && f.revisionToken); f.hash = hash; await save(); } else assert.equal(hash, f.hash);
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", hash,
        forms: state.forms.length, versions: state.forms.flatMap(form => form.versions).length, submissions: state.submissions.length, corrections: state.corrections.length, audits: state.audits.length }, null, 2) + "\n");
    } else throw new Error("Unknown mode");
  }
  if (checks.length) await writeFile(output + "/" + mode + "-http.json", JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", mode, checks: checks.length }));
} finally { await db.$disconnect(); }
