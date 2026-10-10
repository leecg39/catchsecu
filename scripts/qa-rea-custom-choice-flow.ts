import { legacyQuestionAuthorAssetColumn } from "./qa-legacy-language";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { parse as parseCsv } from "csv-parse/sync";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import type { FormRecord } from "../src/contracts/forms";
import type { AnswerValue, QuestionDefinition } from "../src/contracts/questions";

const origin = "http://localhost:3100", database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(database.hostname));
const directory = ".local/rea-fullstack/custom-choice", output = "docs/qa/R08-T02/custom-choice/flow", file = directory + "/fixture.json";
const types = ["객관식 답변", "체크박스", "드롭다운"] as const;
const labels = ["단일 선택", "복수 선택", "드롭다운 선택"];
const originalTexts = ["  직접 <script>window.__qaOther=1</script>\n둘째 |, 줄  ", "복수 입력, | 값", "드롭다운 입력, | 값"];
const correctedTexts = ["  정정 <script>window.__qaOther=2</script>\n둘째 |, 줄  ", "", "정정 드롭다운 입력, | 값"];
type Fixture = { email: string; password: string; cookie: string; companyId: string; formId: string; questionIds: string[];
  originalTexts: string[]; correctedTexts: string[]; originalQuestions?: QuestionDefinition[]; token?: string; revisionToken?: string;
  submissionId?: string; receiptHash?: string; hash?: string; shareId?: string; viewerEmail?: string; invitationCode?: string; viewerCode?: string };
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
    shares: await tx.shareGrant.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: { fields: { orderBy: { questionId: "asc" } }, challenges: { orderBy: { id: "asc" } }, sessions: { orderBy: { id: "asc" } } } }),
  }), { isolationLevel: "RepeatableRead" });
}
function expectedAnswers(corrected: boolean): Record<string, AnswerValue> {
  assert(f.originalQuestions); const q = f.originalQuestions;
  const custom = (index: number) => { const option = q[index].optionDefinitions!.find(item => item.isCustomValue)!; return {
    kind: "custom-choice" as const, selectedValues: index === 1 ? [q[index].options![0], option.value] : [option.value],
    custom: { optionId: option.id, text: (corrected ? f.correctedTexts : f.originalTexts)[index] },
  }; };
  return { [q[0].id]: custom(0), [q[1].id]: corrected ? q[1].options!.slice(0, 2) : custom(1), [q[2].id]: custom(2),
    [q[3].id]: corrected ? "정정 분기 답변" : "기타 분기 답변", [q[4].id]: "" };
}
try {
  await mkdir(directory, { recursive: true, mode: 0o700 }); await mkdir(output, { recursive: true }); const mode = process.argv[2];
  if (mode === "prepare") {
    if (await access(file).then(() => true, () => false)) {
      f = JSON.parse(await readFile(file, "utf8")); assert(!f.companyId && !f.formId && !f.hash);
      assert.equal(await db.user.count({ where: { email: f.email } }), 0, "Inspect partial preparation; never duplicate it");
    } else {
      f = { email: "rea-custom-choice-" + randomUUID().slice(0, 8) + "@example.test", password: randomBytes(20).toString("hex") + "Aa!1", cookie: "", companyId: "", formId: "",
        questionIds: Array.from({ length: 5 }, () => randomUUID()), originalTexts, correctedTexts }; await save();
    }
    await request("register isolated QA owner", "/auth/sign-up/email", 200, { email: f.email, password: f.password, name: "기타 직접입력 검증 소유자" });
    await db.user.update({ where: { email: f.email }, data: { emailVerified: true } });
    const login = await request("login isolated QA owner", "/auth/sign-in/email", 200, { email: f.email, password: f.password });
    f.cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); await save();
    f.companyId = (await request<{ id: string }>("create isolated QA company", "/companies", 201, { name: "기타 직접입력 검증", publicName: "기타 QA" })).value.id; await save();
    const service = await db.service.findFirstOrThrow({ where: { tenantId: f.companyId } });
    f.formId = (await request("create draft for Ego option editing", "/forms", 201, { serviceId: service.id, title: "기타 직접입력 검증", content: {
      body: "선택 보기·직접입력·분기·정정·CSV 검증", formLanguage: "ko", consentRequired: true, consentPurpose: "기타 직접입력 저장 기능 검증", retentionDays: 30, maxResponses: 20,
      questions: [...types.map((type, i) => { const values = ["A|literal,text", "B"]; return { id: f.questionIds[i], type, label: labels[i], required: true,
        options: values, optionDefinitions: values.map((value, j) => ({ id: randomUUID(), value, label: j ? "일반 B" : "일반 A" })),
        ...(i === 1 ? { selectionLimits: { mode: "exact", min: 2, max: 2 } } : {}) }; }),
      { id: f.questionIds[3], type: "단문형 답변", label: "기타 분기", required: true },
      { id: f.questionIds[4], type: "객관식 답변", label: "편집 전환 검증", required: false, options: ["legacy", "normal"],
        optionDefinitions: [{ id: randomUUID(), value: "legacy", label: "😀".repeat(500) }, { id: randomUUID(), value: "normal", label: "일반 보기" }] }] } })).value.id; await save();
  } else {
    f = JSON.parse(await readFile(file, "utf8")); assert(!f.hash || mode === "verify", "Frozen fixture is verify-only");
    if (mode === "configure-branch") {
      assert(!f.token); const form = (await request("read Ego-saved custom options", "/forms/" + f.formId, 200)).value;
      for (const q of form.content!.questions.slice(0, 3)) { assert.equal(q.optionDefinitions!.filter(o => o.isCustomValue).length, 1); assert.equal(q.optionDefinitions!.at(-1)!.isCustomValue, true); }
      const option = form.content!.questions[0].optionDefinitions!.find(o => o.isCustomValue)!;
      form.content!.questions[3].condition = { questionId: f.questionIds[0], operator: "equals", value: option.value, optionId: option.id };
      await request("link branch to actual Ego-created custom stable ID", "/forms/" + f.formId, 200, { version: form.version, content: form.content }, "PATCH");
    } else if (mode === "publish" || mode === "publish-revision") {
      const revision = mode === "publish-revision"; assert(revision ? f.token && !f.revisionToken : !f.token);
      const form = (await request("read actual Ego-saved custom choices", "/forms/" + f.formId, 200)).value;
      if (!revision) { f.originalQuestions = form.content!.questions; for (const q of f.originalQuestions.slice(0, 3)) assert.equal(q.optionDefinitions!.at(-1)!.isCustomValue, true); }
      else { assert.equal(form.content!.questions[0].optionDefinitions!.at(-1)!.label, "개정 기타"); assert(!form.content!.questions[1].optionDefinitions!.some(o => o.isCustomValue)); }
      await request("publish " + (revision ? "revised" : "first") + " custom-choice version", "/forms/" + f.formId + "/publish", 201, { version: form.version });
      const token = decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: f.formId, status: "active" }, orderBy: { createdAt: "desc" } })).tokenCipher);
      if (revision) f.revisionToken = token; else f.token = token; await save();
    } else if (mode === "reject-invalid") {
      assert(f.token && f.originalQuestions); const q = f.originalQuestions;
      const before = await db.submission.count({ where: { tenantId: f.companyId } });
      const cases: { action: string; answers: Record<string, unknown>; code: string }[] = [];
      for (const text of ["", "   ", "😀".repeat(50) + "x", "x\0y", "x\ud800y"]) {
        const answers = expectedAnswers(false); Object.assign(answers[q[0].id] as object, { custom: { optionId: q[0].optionDefinitions!.at(-1)!.id, text } });
        cases.push({ action: "reject malformed custom text " + cases.length, answers, code: "VALIDATION_ERROR" });
      }
      const wrongId = expectedAnswers(false); Object.assign(wrongId[q[0].id] as object, { custom: { optionId: q[1].optionDefinitions!.at(-1)!.id, text: "wrong owner" } });
      cases.push({ action: "reject foreign question custom ID", answers: wrongId, code: "INVALID_CUSTOM_CHOICE" });
      const hidden = expectedAnswers(false); hidden[q[0].id] = q[0].options![0];
      cases.push({ action: "reject hidden branch answer", answers: hidden, code: "HIDDEN_ANSWER" });
      const count = expectedAnswers(false); Object.assign(count[q[1].id] as object, { selectedValues: [q[1].options!.at(-1)!] });
      cases.push({ action: "reject exact count including one custom choice", answers: count, code: "SELECTION_COUNT" });
      for (const item of cases) {
        const result: { response: Response; value: { error: { code: string } } } = await request<{ error: { code: string } }>(item.action, "/public/forms/" + f.token + "/submissions", 422, { answers: item.answers, consent: true });
        assert.equal(result.value.error.code, item.code);
      }
      assert.equal(await db.submission.count({ where: { tenantId: f.companyId } }), before);
    } else if (mode === "revise") {
      assert(f.token && !f.revisionToken); const form = (await request("read version before revision", "/forms/" + f.formId, 200)).value;
      await request("create draft revision preserving published custom choices", "/forms/" + f.formId + "/revise", 201, { version: form.version });
    } else if (mode === "verify-submission" || mode === "verify-correction") {
      const corrected = mode === "verify-correction";
      const rows = await db.submission.findMany({ where: { tenantId: f.companyId }, include: { formVersion: { include: { questions: { include: { options: true } } } }, answers: { include: { question: true } }, receipts: true } });
      assert.equal(rows.length, 1); const row = rows[0]; assert.equal(row.version, corrected ? 2 : 1); assert.equal(row.formVersion.number, 1);
      for (const q of row.formVersion.questions.filter(q => types.includes(q.type as typeof types[number]) && q.stableKey !== f.questionIds[4])) assert.equal(q.options.filter(o => o.isCustomValue).length, 1);
      assert.deepEqual(Object.fromEntries(row.answers.map(a => [a.question.stableKey, decrypt(a.valueCipher)])), expectedAnswers(corrected));
      assert.equal(row.receipts.length, 1); const receipt = row.receipts[0]; assert(receipt.pdfCipher && receipt.pdfHash);
      assert.equal(createHash("sha256").update(Buffer.from(decrypt<string>(receipt.pdfCipher), "base64")).digest("hex"), receipt.pdfHash);
      if (f.receiptHash) assert.equal(receipt.pdfHash, f.receiptHash); else { assert(!corrected); f.receiptHash = receipt.pdfHash; }
      assert.equal(await db.correction.count({ where: { submissionId: row.id } }), corrected ? 1 : 0);
      f.submissionId = row.id; await save();
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", responses: 1,
        version: row.version, sourceFormVersion: row.formVersion.number, originalOptionsExact: true, literalTextExact: true, receiptPdfHash: receipt.pdfHash, corrections: corrected ? 1 : 0 }, null, 2) + "\n");
    } else if (mode === "verify-downloads") {
      assert(f.receiptHash && f.submissionId && f.originalQuestions); const pdf = await readFile(output + "/receipt.pdf"), csv = await readFile(output + "/responses.csv");
      assert.equal(createHash("sha256").update(pdf).digest("hex"), f.receiptHash);
      const rows = parseCsv(csv, { bom: true }) as string[][]; assert.equal(rows.length, 2); assert.equal(rows[1][0], f.submissionId);
      for (const i of [0, 2]) {
        const q: QuestionDefinition = f.originalQuestions[i];
        const option = q.optionDefinitions!.find(o => o.isCustomValue)!;
        const column = rows[0].indexOf(`[v1 · 질문 ${i + 1}] ${q.label}`); assert(column >= 0);
        assert.deepEqual(JSON.parse(rows[1][column]), { kind: "custom-choice", selected: [{ optionId: option.id, value: option.value, label: option.label }], custom: { optionId: option.id, text: f.correctedTexts[i] } });
      }
      assert.equal(rows[1][rows[0].indexOf("[v1 · 질문 2] 복수 선택")], JSON.stringify(["일반 A", "일반 B"]));
      await writeFile(output + "/download-verification.json", JSON.stringify({ result: "passed", sourceVersion: 1, originalLabelsAndRawText: true,
        pdfBytes: pdf.length, pdfSha256: f.receiptHash, csvBytes: csv.length, csvSha256: createHash("sha256").update(csv).digest("hex") }, null, 2) + "\n");
    } else if (mode === "share-prepare") {
      assert(f.submissionId && !f.shareId); const version = await db.formVersion.findFirstOrThrow({ where: { formId: f.formId, number: 1 }, include: { questions: true } });
      f.viewerEmail = "custom-choice-viewer@example.test";
      const shared = await request<{ id: string }>("create isolated local test viewer for first published custom field", "/share-grants", 201, {
        formId: f.formId, formVersionId: version.id, questionIds: [version.questions.find(q => q.stableKey === f.questionIds[0])!.stableKey],
        email: f.viewerEmail, expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      f.shareId = shared.value.id; await save();
      const invitation = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + f.shareId + ":invite:1" } })).payloadCipher);
      f.invitationCode = invitation.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)![1]; await save();
    } else if (mode === "viewer-code") {
      assert(f.shareId); const challenge = await db.viewerChallenge.findFirstOrThrow({ where: { grantId: f.shareId }, orderBy: { createdAt: "desc" } });
      const mail = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + f.shareId + ":challenge:" + challenge.id } })).payloadCipher);
      f.viewerCode = mail.text.match(/인증코드: (\d{6})/)![1]; await save();
    } else if (mode === "share-revoke") {
      assert(f.shareId); const response = await fetch(origin + "/api/v1/share-grants/" + f.shareId, { method: "DELETE", headers: { origin, cookie: f.cookie, "if-match": "1" } });
      assert.equal(response.status, 200); assert((await db.shareGrant.findUniqueOrThrow({ where: { id: f.shareId } })).revokedAt);
      checks.push({ action: "revoke isolated local viewer", status: response.status });
    } else if (mode === "freeze" || mode === "verify") {
      const state = await snapshot(), hash = createHash("sha256").update(JSON.stringify(state, legacyQuestionAuthorAssetColumn)).digest("hex");
      if (mode === "freeze") { assert(f.submissionId && f.revisionToken); f.hash = hash; await save(); } else assert.equal(hash, f.hash);
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", hash,
        forms: state.forms.length, versions: state.forms.flatMap(form => form.versions).length, submissions: state.submissions.length, corrections: state.corrections.length, audits: state.audits.length }, null, 2) + "\n");
    } else throw new Error("Unknown mode");
  }
  if (checks.length) await writeFile(output + "/" + mode + "-http.json", JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", mode, checks: checks.length }));
} finally { await db.$disconnect(); }
