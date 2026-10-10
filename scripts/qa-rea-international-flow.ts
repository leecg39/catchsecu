import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { parse } from "csv-parse/sync";
import { emptyForeignAddress } from "../src/contracts/address-questions";
import type { FormRecord } from "../src/contracts/forms";
import { legacyQuestionExplanationColumn } from "./qa-legacy-language";
const origin = "http://localhost:3100", url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(url.hostname));
const directory = ".local/rea-fullstack/international-contact", output = "docs/qa/R08-T02/international-contact/flow", file = directory + "/fixture.json";
type Fixture = { email: string; password: string; cookie: string; companyId: string; formId: string; questionIds: string[]; token?: string; submissionId?: string; hash?: string; arabicFormId?: string; arabicToken?: string };
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
const labels = ["Required phone", "Optional phone", "Optional address", "Memo"];
const values = () => ["+1 2025550101", "", emptyForeignAddress(), "International form check"];
const correctedValues = () => ["+1 2025550123", "", emptyForeignAddress(), "International form corrected"];
const expectedAnswers = (items: unknown[]) => Object.fromEntries(f.questionIds.map((id, i) => [id, items[i]]));
try {
  await mkdir(directory, { recursive: true, mode: 0o700 }); await mkdir(output, { recursive: true }); const mode = process.argv[2];
  if (mode === "prepare") {
    if (await access(file).then(() => true, () => false)) {
      f = JSON.parse(await readFile(file, "utf8")); assert(!f.hash && !f.companyId && !f.formId);
      assert.equal(await db.user.count({ where: { email: f.email } }), 0, "Preparation already wrote data; inspect instead of replaying");
    } else {
      f = { email: "rea-international-" + randomUUID().slice(0, 8) + "@example.test", password: randomBytes(20).toString("hex") + "Aa!1", cookie: "", companyId: "", formId: "", questionIds: Array.from({ length: 4 }, () => randomUUID()) }; await save();
    }
    await request("register QA owner", "/auth/sign-up/email", 200, { email: f.email, password: f.password, name: "국제 연락처 검증 소유자" });
    await db.user.update({ where: { email: f.email }, data: { emailVerified: true } });
    const login = await request("login QA owner", "/auth/sign-in/email", 200, { email: f.email, password: f.password });
    f.cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); await save();
    f.companyId = (await request<{ id: string }>("create isolated QA company", "/companies", 201, { name: "국제 연락처 검증", publicName: "국제 연락처 QA" })).value.id;
    const service = await db.service.findFirstOrThrow({ where: { tenantId: f.companyId } }); await save();
    f.formId = (await request("create domestic draft for Ego language editing", "/forms", 201, { serviceId: service.id, title: "국제 연락처 검증", content: {
      body: "International phone and language verification", consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 20,
      questions: f.questionIds.map((id, i) => ({ id, type: i < 2 ? "연락처" : i === 2 ? "주소" : "단문형 답변", label: labels[i], required: i === 0 })) } })).value.id; await save();
  } else {
    f = JSON.parse(await readFile(file, "utf8")); assert(!f.hash || mode === "verify", "Frozen fixture is verify-only");
    if (mode === "prepare-arabic") {
      assert(!f.arabicToken, "Arabic fixture already published");
      const service = await db.service.findFirstOrThrow({ where: { tenantId: f.companyId } });
      const form = f.arabicFormId
        ? (await request("resume existing Arabic RTL draft after PDF repair", "/forms/" + f.arabicFormId, 200)).value
        : (await request("create Arabic RTL QA form", "/forms", 201, { serviceId: service.id, title: "اختبار الاتصال الدولي", content: {
        formLanguage: "ar", body: "اختبار", consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10,
        questions: [{ id: randomUUID(), type: "연락처", label: "الهاتف", required: true }] } })).value;
      f.arabicFormId = form.id; await save();
      assert.equal(form.content.formLanguage, "ar"); assert.equal(!!form.content.verify, false);
      assert.equal(form.title, "اختبار الاتصال الدولي"); assert.equal(form.content.body, "اختبار");
      assert.deepEqual(form.content.questions.map(question => question.type), ["연락처"]);
      await request("publish Arabic RTL QA form", "/forms/" + form.id + "/publish", 201, { version: form.version });
      f.arabicToken = decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: form.id } })).tokenCipher); await save();
    } else if (mode === "publish") {
      const form = (await request("read Ego-saved language and converted address", "/forms/" + f.formId, 200)).value;
      assert.equal(form.content.formLanguage, "en");
      assert.deepEqual(form.content.questions.map(q => q.type), ["연락처", "연락처", "해외 주소", "단문형 답변"]);
      await request("publish international questions", "/forms/" + f.formId + "/publish", 201, { version: form.version });
      f.token = decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: f.formId } })).tokenCipher); await save();
      for (const [label, value] of [["too short", "+1 12345"], ["unknown country code", "+9999 123456"], ["country only", "+1 "], ["domestic phone", "010-1234-5678"], ["object injection", { countryCode: "US", extraNumber: "2025550101" }]] as const) {
        const answers = expectedAnswers(values()); answers[f.questionIds[0]] = value;
        await request("reject " + label, "/public/forms/" + f.token + "/submissions", 422, { answers, consent: false });
      }
      assert.equal(await db.submission.count({ where: { tenantId: f.companyId } }), 0);
    } else if (mode === "verify-arabic") {
      assert(f.arabicFormId && f.arabicToken);
      const rows = await db.submission.findMany({ where: { tenantId: f.companyId, formVersion: { formId: f.arabicFormId } }, include: { answers: true, formVersion: true } });
      assert.equal(rows.length, 1); const row = rows[0]; assert.equal(row.answers.length, 1);
      assert.equal(row.formVersion.formLanguage, "ar"); assert.equal(row.formVersion.title, "اختبار الاتصال الدولي");
      assert.equal(decrypt(row.answers[0].valueCipher), "+966 501234567"); assert(!row.answers[0].valueCipher.includes("501234567"));
      await writeFile(output + "/verify-arabic.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", language: "ar", originalArabicTitlePreserved: true,
        responses: 1, internationalStringExact: true, encrypted: true, version: row.version }, null, 2) + "\n");
    } else if (mode === "verify-flow" || mode === "verify-correction") {
      const rows = await db.submission.findMany({ where: { tenantId: f.companyId, formVersion: { formId: f.formId } }, include: { answers: { include: { question: true } } } }); assert.equal(rows.length, 1);
      const row = rows[0], items = mode === "verify-flow" ? values() : correctedValues();
      for (const [i, expected] of items.entries()) assert.deepEqual(decrypt(row.answers.find(a => a.question.stableKey === f.questionIds[i])!.valueCipher), expected);
      f.submissionId = row.id; await save();
      assert.equal(row.version, mode === "verify-flow" ? 1 : 2);
      const corrections = await db.correction.findMany({ where: { submissionId: row.id }, include: { payload: true } });
      assert.equal(corrections.length, mode === "verify-flow" ? 0 : 1);
      if (mode === "verify-correction") {
        assert(corrections[0].payload); assert.deepEqual(new Set(corrections[0].changedFields), new Set([f.questionIds[0], f.questionIds[3]]));
        const before = decrypt<{ answers: Record<string, unknown> }>(corrections[0].payload.beforeCipher).answers;
        const after = decrypt<Record<string, unknown>>(corrections[0].payload.afterCipher);
        for (const i of [0, 3]) { assert.deepEqual(before[f.questionIds[i]], values()[i]); assert.deepEqual(after[f.questionIds[i]], items[i]); }
      }
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", responses: 1, version: row.version, corrections: corrections.length, internationalStringExact: true, sharedCallingCodePreserved: true, optionalContactEmpty: true, encrypted: row.answers.every(a => !a.valueCipher.includes("20255501")) }, null, 2) + "\n");
    } else if (mode === "verify-csv") {
      const rows: string[][] = parse(await readFile(directory + "/responses.csv", "utf8"), { bom: true });
      assert.equal(rows.length, 2);
      for (const [i, expected] of correctedValues().entries()) {
        const column = rows[0].findIndex(value => value === "[v1 · 질문 " + (i + 1) + "] " + labels[i]); assert(column >= 0);
        const cell = rows[1][column];
        if (typeof expected !== "string" && Object.values(expected).every(value => value === "")) assert.equal(cell, "", "An entirely empty structured address exports as an empty CSV cell");
        else assert.deepEqual(typeof expected === "string" ? (expected.startsWith("+") ? cell.replace(/^'/, "") : cell) : JSON.parse(cell), expected);
      }
      await writeFile(output + "/csv.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", source: "Ego browser download", rows: 1, internationalStringExact: true, csvFormulaEscapingAccepted: true, optionalEmptyPreserved: true }, null, 2) + "\n");
    } else if (mode === "freeze" || mode === "verify") {
      const state = await snapshot(), hash = createHash("sha256").update(JSON.stringify(state, legacyQuestionExplanationColumn)).digest("hex");
      if (mode === "freeze") { assert(!f.hash); f.hash = hash; await save(); } else assert.equal(hash, f.hash);
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", hash, forms: state.forms.length, submissions: state.submissions.length, corrections: state.corrections.length, audits: state.audits.length }, null, 2) + "\n");
    } else throw new Error("Unknown mode");
  }
  if (checks.length) await writeFile(output + "/" + mode + "-http.json", JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", mode, checks: checks.length, formId: f.formId }));
} finally { await db.$disconnect(); }
