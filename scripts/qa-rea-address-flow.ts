import { legacyFormLanguageColumn } from "./qa-legacy-language";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { parse } from "csv-parse/sync";
import { emptyForeignAddress, normalizeForeignAddress } from "../src/contracts/address-questions";
import type { FormRecord } from "../src/contracts/forms";
const origin = "http://localhost:3100", url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(url.hostname));
const directory = ".local/rea-fullstack/address-questions", output = "docs/qa/R08-T02/address-questions/flow", file = directory + "/fixture.json";
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
const foreign = normalizeForeignAddress({ country: "US", countryName: "", streetAddress: "1 Test Road", addressDetail: "Suite QA", city: "Test City", state: "CA", postalCode: "90001" });
const optional = { ...emptyForeignAddress(), addressDetail: "Optional suite", state: "TX", postalCode: "00000" };
const domestic = "(04524) 서울 중구 세종대로 110 검증용 101호";
const values = () => [domestic, foreign, optional, ""];
const correctedValues = () => [domestic.replace("101호", "202호"), { ...foreign, city: "Corrected City" }, optional, ""];
const expectedAnswers = (items: unknown[]) => Object.fromEntries(f.questionIds.map((id, i) => [id, items[i]]));
try {
  await mkdir(directory, { recursive: true, mode: 0o700 }); await mkdir(output, { recursive: true }); const mode = process.argv[2];
  if (mode === "prepare") {
    if (await access(file).then(() => true, () => false)) {
      f = JSON.parse(await readFile(file, "utf8")); assert(!f.hash && !f.companyId && !f.formId);
      assert.equal(await db.user.count({ where: { email: f.email } }), 0, "Preparation already wrote data; inspect instead of replaying");
    } else {
      f = { email: "rea-address-" + randomUUID().slice(0, 8) + "@example.test", password: randomBytes(20).toString("hex") + "Aa!1", cookie: "", companyId: "", formId: "", questionIds: Array.from({ length: 4 }, () => randomUUID()) }; await save();
    }
    await request("register QA owner", "/auth/sign-up/email", 200, { email: f.email, password: f.password, name: "주소 질문 검증 소유자" });
    await db.user.update({ where: { email: f.email }, data: { emailVerified: true } });
    const login = await request("login QA owner", "/auth/sign-in/email", 200, { email: f.email, password: f.password });
    f.cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); await save();
    f.companyId = (await request<{ id: string }>("create isolated QA company", "/companies", 201, { name: "주소 질문 검증", publicName: "주소 QA" })).value.id;
    const service = await db.service.findFirstOrThrow({ where: { tenantId: f.companyId } }); await save();
    const labels = ["국내 주소", "해외 주소", "선택 해외 주소", "선택 국내 주소"];
    f.formId = (await request("create draft for Ego type editing", "/forms", 201, { serviceId: service.id, title: "주소 질문 검증", content: {
      body: "주소 검색·구조화 주소 실제 입력 시험", consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 20,
      questions: f.questionIds.map((id, i) => ({ id, type: "단문형 답변", label: labels[i], required: i < 2 })) } })).value.id; await save();
  } else {
    f = JSON.parse(await readFile(file, "utf8")); assert(!f.hash || mode === "verify", "Frozen fixture is verify-only");
    if (mode === "publish") {
      const form = (await request("read Ego-saved address types", "/forms/" + f.formId, 200)).value;
      assert.deepEqual(form.content.questions.map(q => q.type), ["주소", "해외 주소", "해외 주소", "주소"]);
      await request("publish address questions", "/forms/" + f.formId + "/publish", 201, { version: form.version });
      f.token = decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: f.formId } })).tokenCipher); await save();
      for (const [label, i, value] of [["domestic malformed", 0, "서울"], ["foreign country only", 1, { ...emptyForeignAddress(), country: "US" }], ["foreign scalar injection", 1, "invalid"], ["foreign extra key", 1, { ...foreign, injected: true }]] as const) {
        const answers = expectedAnswers(values()); answers[f.questionIds[i]] = value;
        await request("reject " + label, "/public/forms/" + f.token + "/submissions", 422, { answers, consent: false });
      }
      assert.equal(await db.submission.count({ where: { tenantId: f.companyId } }), 0);
    } else if (mode === "verify-flow" || mode === "verify-correction") {
      const rows = await db.submission.findMany({ where: { tenantId: f.companyId }, include: { answers: { include: { question: true } } } }); assert.equal(rows.length, 1);
      const row = rows[0], items = mode === "verify-flow" ? values() : correctedValues();
      for (const [i, expected] of items.entries()) assert.deepEqual(decrypt(row.answers.find(a => a.question.stableKey === f.questionIds[i])!.valueCipher), expected);
      f.submissionId = row.id; await save();
      assert.equal(row.version, mode === "verify-flow" ? 1 : 2);
      const corrections = await db.correction.findMany({ where: { submissionId: row.id }, include: { payload: true } });
      assert.equal(corrections.length, mode === "verify-flow" ? 0 : 1);
      if (mode === "verify-correction") {
        assert(corrections[0].payload); assert.deepEqual(new Set(corrections[0].changedFields), new Set(f.questionIds.slice(0, 2)));
        const before = decrypt<{ answers: Record<string, unknown> }>(corrections[0].payload.beforeCipher).answers;
        const after = decrypt<Record<string, unknown>>(corrections[0].payload.afterCipher);
        for (const i of [0, 1]) { assert.deepEqual(before[f.questionIds[i]], values()[i]); assert.deepEqual(after[f.questionIds[i]], items[i]); }
      }
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", responses: 1, version: row.version, corrections: corrections.length, domesticAndForeignValuesMatch: true, optionalDetailsOnlyPreserved: true, optionalDomesticEmpty: true, encrypted: row.answers.every(a => !a.valueCipher.includes("Test Road")) }, null, 2) + "\n");
    } else if (mode === "verify-csv") {
      const rows: string[][] = parse(await readFile(directory + "/responses.csv", "utf8"), { bom: true });
      assert.equal(rows.length, 2); const labels = ["국내 주소", "해외 주소", "선택 해외 주소", "선택 국내 주소"];
      for (const [i, expected] of correctedValues().entries()) {
        const column = rows[0].findIndex(value => value === "[v1 · 질문 " + (i + 1) + "] " + labels[i]); assert(column >= 0);
        const cell = rows[1][column]; assert.deepEqual(typeof expected === "string" ? cell : JSON.parse(cell), expected);
      }
      await writeFile(output + "/csv.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", source: "Ego browser download", rows: 1, domesticStringExact: true, foreignSevenFieldJsonExact: true }, null, 2) + "\n");
    } else if (mode === "freeze" || mode === "verify") {
      const state = await snapshot(), hash = createHash("sha256").update(JSON.stringify(state, legacyFormLanguageColumn)).digest("hex");
      if (mode === "freeze") { assert(!f.hash); f.hash = hash; await save(); } else assert.equal(hash, f.hash);
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", hash, forms: state.forms.length, submissions: state.submissions.length, corrections: state.corrections.length, audits: state.audits.length }, null, 2) + "\n");
    } else throw new Error("Unknown mode");
  }
  if (checks.length) await writeFile(output + "/" + mode + "-http.json", JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", mode, checks: checks.length, formId: f.formId }));
} finally { await db.$disconnect(); }
