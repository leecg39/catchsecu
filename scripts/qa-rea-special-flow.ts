import { legacyFormLanguageColumn } from "./qa-legacy-language";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import type { FormRecord } from "../src/contracts/forms";
const origin = "http://localhost:3100", url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(url.hostname));
const directory = ".local/rea-fullstack/special-questions", output = "docs/qa/R08-T02/special-questions/flow", file = directory + "/fixture.json";
type Fixture = { email: string; password: string; cookie: string; companyId: string; formId: string; questionIds: string[]; token?: string; submissionId?: string; hash?: string };
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
    preferences: await tx.marketingPreference.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    subjects: await tx.dataSubject.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    audits: await tx.auditEvent.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
  }), { isolationLevel: "RepeatableRead" });
}
try {
  await mkdir(directory, { recursive: true, mode: 0o700 }); await mkdir(output, { recursive: true }); const mode = process.argv[2];
  if (mode === "prepare") {
    if (await access(file).then(() => true, () => false)) {
      f = JSON.parse(await readFile(file, "utf8")); assert(!f.hash && !f.companyId && !f.formId);
      assert.equal(await db.user.count({ where: { email: f.email } }), 0, "Preparation already wrote data; inspect instead of replaying");
    } else {
      f = { email: "rea-special-" + randomUUID().slice(0, 8) + "@example.test", password: randomBytes(20).toString("hex") + "Aa!1", cookie: "", companyId: "", formId: "", questionIds: Array.from({ length: 6 }, () => randomUUID()) }; await save();
    }
    await request("register QA owner", "/auth/sign-up/email", 200, { email: f.email, password: f.password, name: "특수 질문 검증 소유자" });
    await db.user.update({ where: { email: f.email }, data: { emailVerified: true } }); // Local setup, not external email acceptance.
    const login = await request("login QA owner", "/auth/sign-in/email", 200, { email: f.email, password: f.password });
    f.cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); await save();
    f.companyId = (await request<{ id: string }>("create isolated QA company", "/companies", 201, { name: "특수 질문 검증", publicName: "특수 질문 QA" })).value.id;
    const service = await db.service.findFirstOrThrow({ where: { tenantId: f.companyId } }); await save();
    const labels = ["이름", "국내 연락처", "이메일", "직접 입력 이메일", "생년월일", "알림톡 연락처"];
    f.formId = (await request("create draft for Ego type editing", "/forms", 201, { serviceId: service.id, title: "특수 질문 검증", content: {
      body: "연락처·이메일·생년월일 실제 입력 시험", consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 20,
      marketing: { purpose: "새 소식 수신동의", nameQuestionId: f.questionIds[0], emailQuestionId: f.questionIds[2], smsQuestionId: f.questionIds[1], kakaoQuestionId: f.questionIds[5] },
      questions: f.questionIds.map((id, i) => ({ id, type: "단문형 답변", label: labels[i], required: i < 3, ...(i === 0 ? { subjectRole: "name" } : i === 2 ? { subjectRole: "email" } : {}) })) } })).value.id; await save();
  } else {
    f = JSON.parse(await readFile(file, "utf8")); assert(!f.hash || mode === "verify", "Frozen fixture is verify-only");
    if (mode === "publish") {
      const form = (await request("read Ego-saved special types", "/forms/" + f.formId, 200)).value;
      assert.deepEqual(form.content.questions.map(q => q.type), ["단문형 답변", "연락처", "이메일", "이메일 직접 입력", "생년월일", "연락처"]);
      assert.equal(form.content.questions[2].subjectRole, "email");
      await request("publish special questions", "/forms/" + f.formId + "/publish", 201, { version: form.version });
      f.token = decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: f.formId } })).tokenCipher); await save();
      const values = ["합성 사용자", "010-1234-5678", "qa@example.test", "direct@example.test", "20000229", "010-9876-5432"];
      for (const [i, value] of [[1, "01012345678"], [2, "bad@"], [3, "bad@"], [4, "20260229"]] as const)
        await request("reject invalid special question " + i, "/public/forms/" + f.token + "/submissions", 422, { answers: Object.fromEntries(f.questionIds.map((id, j) => [id, i === j ? value : values[j]])), consent: false });
      assert.equal(await db.submission.count({ where: { tenantId: f.companyId } }), 0);
    } else if (mode === "verify-flow") {
      const rows = await db.submission.findMany({ where: { tenantId: f.companyId }, include: { answers: { include: { question: true } } } }); assert.equal(rows.length, 1);
      const values = ["합성 사용자", "010-1234-5678", "qa@example.test", "direct@example.test", "20000229", "010-9876-5432"];
      for (const [i, value] of values.entries()) assert.equal(decrypt<string>(rows[0].answers.find(a => a.question.stableKey === f.questionIds[i])!.valueCipher), value);
      assert(rows[0].subjectId); f.submissionId = rows[0].id; await save();
      const prefs = await db.marketingPreference.findMany({ where: { sourceSubmissionId: f.submissionId }, orderBy: { channel: "asc" } });
      assert.deepEqual(prefs.map(p => p.channel), ["email", "kakao", "sms"]); assert(prefs.every(p => p.status === "granted"));
      assert.equal(decrypt<{ contact: string }>(prefs[0].contactCipher!).contact, "qa@example.test");
      assert.equal(decrypt<{ contact: string }>(prefs[1].contactCipher!).contact, "+821098765432");
      assert.equal(decrypt<{ contact: string }>(prefs[2].contactCipher!).contact, "+821012345678");
      await request("reject invalid correction", "/submissions/" + f.submissionId, 422, { version: 1, reason: "잘못된 생년월일", answers: { [f.questionIds[4]]: "20260229" } }, "PATCH");
      assert.equal(await db.correction.count({ where: { submissionId: f.submissionId } }), 0);
      await writeFile(output + "/responses.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", responses: 1, scalarValuesMatch: true, subjectBound: true, grantedChannels: prefs.map(p => p.channel), rejectedCorrectionAbsent: true }, null, 2) + "\n");
    } else if (mode === "verify-correction") {
      assert(f.submissionId);
      const row = await db.submission.findUniqueOrThrow({ where: { id: f.submissionId }, include: { answers: { include: { question: true } } } });
      assert.equal(row.version, 2); assert.equal(decrypt(row.answers.find(a => a.question.stableKey === f.questionIds[4])!.valueCipher), "19990730");
      const expected = ["합성 사용자", "010-1234-5678", "qa@example.test", "direct@example.test", "19990730", "010-9876-5432"];
      for (const [i, value] of expected.entries()) assert.equal(decrypt(row.answers.find(a => a.question.stableKey === f.questionIds[i])!.valueCipher), value);
      assert.equal(await db.correction.count({ where: { submissionId: f.submissionId } }), 1);
      const correction = await db.correction.findFirstOrThrow({ where: { submissionId: f.submissionId }, include: { payload: true } }); assert(correction.payload);
      assert.deepEqual(correction.changedFields, [f.questionIds[4]]);
      assert.equal(decrypt<{ answers: Record<string, string> }>(correction.payload.beforeCipher).answers[f.questionIds[4]], "20000229");
      assert.equal(decrypt<Record<string, string>>(correction.payload.afterCipher)[f.questionIds[4]], "19990730");
      assert.equal(await db.marketingPreference.count({ where: { sourceSubmissionId: f.submissionId, status: "granted" } }), 3);
      await writeFile(output + "/correction.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", version: row.version, corrections: 1, encryptedBeforeAfterMatch: true, unrelatedAnswersPreserved: 5, unrelatedMarketingGrantsPreserved: 3 }, null, 2) + "\n");
    } else if (mode === "freeze" || mode === "verify") {
      const state = await snapshot(), hash = createHash("sha256").update(JSON.stringify(state, legacyFormLanguageColumn)).digest("hex");
      if (mode === "freeze") { assert(!f.hash); f.hash = hash; await save(); } else assert.equal(hash, f.hash);
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", hash, forms: state.forms.length, submissions: state.submissions.length, corrections: state.corrections.length, preferences: state.preferences.length, subjects: state.subjects.length, audits: state.audits.length }, null, 2) + "\n");
    } else throw new Error("Unknown mode");
  }
  if (checks.length) await writeFile(output + "/" + mode + "-http.json", JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", mode, checks: checks.length, formId: f.formId }));
} finally { await db.$disconnect(); }
