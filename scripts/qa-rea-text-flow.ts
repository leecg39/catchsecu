import { legacyFormLanguageColumn } from "./qa-legacy-language";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import type { FormRecord } from "../src/contracts/forms";
const origin = "http://localhost:3100", url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(url.hostname));
const directory = ".local/rea-fullstack/text-limits", output = "docs/qa/R08-T02/text-limits/flow", file = directory + "/fixture.json";
type Fixture = { email: string; password: string; cookie: string; companyId: string; formId: string; questionIds: string[]; token?: string; hash?: string };
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
      f = { email: "rea-text-" + randomUUID().slice(0, 8) + "@example.test", password: randomBytes(20).toString("hex") + "Aa!1", cookie: "", companyId: "", formId: "", questionIds: [randomUUID(), randomUUID()] }; await save();
    }
    await request("register QA owner", "/auth/sign-up/email", 200, { email: f.email, password: f.password, name: "글자 수 검증 소유자" });
    await db.user.update({ where: { email: f.email }, data: { emailVerified: true } }); // Local setup, not external email acceptance.
    const login = await request("login QA owner", "/auth/sign-in/email", 200, { email: f.email, password: f.password });
    f.cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); await save();
    f.companyId = (await request<{ id: string }>("create isolated QA company", "/companies", 201, { name: "글자 수 제한 검증", publicName: "글자 수 QA" })).value.id;
    const service = await db.service.findFirstOrThrow({ where: { tenantId: f.companyId } }); await save();
    f.formId = (await request("create legacy draft for Ego limit editing", "/forms", 201, { serviceId: service.id, title: "글자 수 제한 검증", content: {
      body: "단문 100자·장문 1000자 입력 시험", consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 20,
      questions: f.questionIds.map((id, i) => ({ id, type: i ? "장문형 답변" : "단문형 답변", label: i ? "상세 의견" : "짧은 의견", required: false })) } })).value.id; await save();
  } else {
    f = JSON.parse(await readFile(file, "utf8")); assert(!f.hash || mode === "verify", "Frozen fixture is verify-only");
    if (mode === "publish") {
      const form = (await request("read Ego-saved text limits", "/forms/" + f.formId, 200)).value;
      assert.deepEqual(form.content.questions.map(q => q.textMaxLength), [100, 1000]);
      await request("publish limited questions", "/forms/" + f.formId + "/publish", 201, { version: form.version });
      f.token = decrypt<string>((await db.publication.findFirstOrThrow({ where: { formId: f.formId } })).tokenCipher); await save();
      for (const [i, length] of [[0, 101], [1, 1001]]) await request("reject question " + i + " at N+1", "/public/forms/" + f.token + "/submissions", 422, { answers: { [f.questionIds[i]]: "가".repeat(length) }, consent: false });
      assert.equal(await db.submission.count({ where: { tenantId: f.companyId } }), 0);
    } else if (mode === "final-http") {
      const current = (await request("final build saved limits", "/forms/" + f.formId, 200)).value;
      assert.deepEqual(current.content.questions.map(q => q.textMaxLength), [100, 1000]);
      for (const [i, length] of [[0, 101], [1, 1001]]) await request("final build rejects N+1 question " + i, "/public/forms/" + f.token + "/submissions", 422, { answers: { [f.questionIds[i]]: "가".repeat(length) }, consent: false });
      assert.equal(await db.submission.count({ where: { tenantId: f.companyId } }), 1);
    } else if (mode === "verify-flow") {
      const rows = await db.submission.findMany({ where: { tenantId: f.companyId }, orderBy: { submittedAt: "asc" }, include: { answers: { include: { question: true } } } }); assert.equal(rows.length, 1);
      for (const [i, expected] of [100, 1000].entries()) assert.equal(decrypt<string>(rows[0].answers.find(a => a.question.stableKey === f.questionIds[i])!.valueCipher).length, expected);
      await request("reject correction at N+1", "/submissions/" + rows[0].id, 422, { version: 1, reason: "글자 수 초과 검증", answers: { [f.questionIds[0]]: "나".repeat(101) } }, "PATCH");
      assert.equal(await db.correction.count({ where: { submissionId: rows[0].id } }), 0);
      assert.equal((await db.submission.findUniqueOrThrow({ where: { id: rows[0].id } })).version, 1);
      await writeFile(output + "/responses.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", responses: 1, boundaryLengths: [100, 1000], rejectedCorrectionAbsent: true }, null, 2) + "\n");
    } else if (mode === "freeze" || mode === "verify") {
      const state = await snapshot(), hash = createHash("sha256").update(JSON.stringify(state, legacyFormLanguageColumn)).digest("hex");
      if (mode === "freeze") { assert(!f.hash); f.hash = hash; await save(); } else assert.equal(hash, f.hash);
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", hash, forms: state.forms.length, submissions: state.submissions.length, audits: state.audits.length }, null, 2) + "\n");
    } else throw new Error("Unknown mode");
  }
  if (checks.length) await writeFile(output + "/" + mode + "-http.json", JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", mode, checks: checks.length, formId: f.formId }));
} finally { await db.$disconnect(); }
