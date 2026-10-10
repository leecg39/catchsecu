import { legacyFormLanguageColumn } from "./qa-legacy-language";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import type { FormRecord, TemplateRecord } from "../src/contracts/forms";

// Frozen pre-113 snapshots: assert the additive column was not backfilled, then hash their original columns.
function legacyTextColumn(key: string, value: unknown) {
  if (key === "textMaxLength") { assert.equal(value, null, "Frozen question acquired a text limit"); return undefined; }
  return legacyFormLanguageColumn(key, value);
}
const origin = "http://localhost:3100", url = new URL(process.env.DATABASE_URL!);
assert.equal(url.pathname, "/catchsecu_dev"); assert(["localhost", "127.0.0.1"].includes(url.hostname));
const privateDir = ".local/rea-fullstack/option-identities", output = "docs/qa/R08-T02/identities/flow", file = privateDir + "/fixture.json";
type Fixture = { tag: string; email: string; password: string; cookie: string; companyId: string; serviceId: string; formId: string; templateId: string;
  questions: string[]; optionIds: string[]; optionValues: string[]; physicalQuestions: string[]; physicalOptions: string[]; publicToken?: string;
  publishedVersionId?: string; submissionId?: string; oldEvidenceHash?: string; hash?: string };
let f: Fixture;
const checks: { action: string; status: number; code?: string }[] = [];
const save = () => writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value, legacyTextColumn)).digest("hex");
async function request<T = FormRecord>(action: string, path: string, expected: number, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(origin + "/api/v1" + path, { method, headers: { origin, cookie: f.cookie, "idempotency-key": randomUUID(),
    ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json().catch(() => null);
  checks.push({ action, status: response.status, code: value?.error?.code });
  assert.equal(response.status, expected, action + ": " + (value?.error?.code ?? ""));
  return { response, value: value as T };
}
const form = async () => (await request("read form", "/forms/" + f.formId, 200)).value;
const draft = () => db.formVersion.findFirstOrThrow({ where: { formId: f.formId, status: "draft" }, include: { questions: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } } } });
const oldEvidence = async () => ({ version: await db.formVersion.findUniqueOrThrow({ where: { id: f.publishedVersionId! }, include: { questions: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } } } }),
  submission: await db.submission.findUniqueOrThrow({ where: { id: f.submissionId! }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } } } }) });
async function snapshot() {
  return db.$transaction(async tx => ({
    forms: await tx.form.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: { versions: { orderBy: { id: "asc" }, include: {
      questions: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } }, } }, publications: { orderBy: { id: "asc" } } } }),
    templates: await tx.formTemplate.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    submissions: await tx.submission.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } }, receipts: { orderBy: { id: "asc" } } } }),
    audits: await tx.auditEvent.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
  }), { isolationLevel: "RepeatableRead" });
}
try {
  await mkdir(privateDir, { recursive: true, mode: 0o700 }); await mkdir(output, { recursive: true });
  const mode = process.argv[2];
  if (mode === "prepare") {
    assert(!await access(file).then(() => true, () => false), "Do not replace existing fixture");
    const tag = randomUUID().slice(0, 8);
    f = { tag, email: "rea-option-" + tag + "@example.test", password: randomBytes(20).toString("hex") + "Aa!1", cookie: "", companyId: "", serviceId: "", formId: "", templateId: "",
      questions: [randomUUID(), randomUUID(), randomUUID()], optionIds: [randomUUID(), randomUUID()], optionValues: [randomUUID(), randomUUID()], physicalQuestions: [], physicalOptions: [] }; await save();
    await request("register dedicated QA owner", "/auth/sign-up/email", 200, { email: f.email, password: f.password, name: "보기 식별자 검증" });
    // Explicit local QA identity setup, not evidence of real email delivery.
    await db.user.update({ where: { email: f.email }, data: { emailVerified: true } });
    const login = await request("login", "/auth/sign-in/email", 200, { email: f.email, password: f.password });
    f.cookie = login.response.headers.getSetCookie().map(item => item.split(";", 1)[0]).join("; "); await save();
    f.companyId = (await request<{ id: string }>("create QA company", "/companies", 201, { name: "보기 식별자 시험 " + tag, publicName: "보기 QA" })).value.id;
    f.serviceId = (await db.service.findFirstOrThrow({ where: { tenantId: f.companyId } })).id; await save();
    const content = { body: "보기 문구와 선택값의 독립성 검증", consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 20,
      questions: [
        { id: f.questions[0], type: "객관식 답변", label: "참여 방식", required: true, options: f.optionValues,
          optionDefinitions: f.optionIds.map((id, i) => ({ id, label: ["현장 방문", "온라인 참여"][i], value: f.optionValues[i] })) },
        { id: f.questions[1], type: "단문형 답변", label: "현장 안내", required: false, condition: { questionId: f.questions[0], operator: "equals", value: f.optionValues[0], optionId: f.optionIds[0] } },
        { id: f.questions[2], type: "체크박스", label: "관심 분야", required: false, options: ["기초", "심화"] },
      ] };
    f.formId = (await request("create canonical choices", "/forms", 201, { serviceId: f.serviceId, title: "보기 식별자 검증", content })).value.id; await save();
    const initial = await form(), stored = await draft();
    f.physicalQuestions = stored.questions.map(q => q.id); f.physicalOptions = stored.questions[0].options.map(o => o.id); await save();
    await request("title-only patch", "/forms/" + f.formId, 200, { version: initial.version, title: "보기 식별자 Ego 검증" }, "PATCH");
    assert.deepEqual((await draft()).questions.map(q => q.id), f.physicalQuestions);
    await request("stale version", "/forms/" + f.formId, 409, { version: initial.version, title: "stale" }, "PATCH");
    const bad = structuredClone(initial.content!); bad.questions[0].optionDefinitions![0].value = "위조"; bad.questions[0].options![0] = "위조";
    await request("reject changed answer value for same identity", "/forms/" + f.formId, 422, { version: 2, content: bad }, "PATCH");
    const copied = (await request("copy identity graph", "/forms/" + f.formId + "/copy", 201, {})).value;
    assert.notEqual(copied.content!.questions[0].id, f.questions[0]);
    assert.notEqual(copied.content!.questions[0].optionDefinitions![0].id, f.optionIds[0]);
    assert.equal(copied.content!.questions[1].condition!.optionId, copied.content!.questions[0].optionDefinitions![0].id);
    const template = (await request<TemplateRecord>("create template", "/templates", 201, { serviceId: f.serviceId, title: "보기 템플릿", category: "QA", content })).value;
    f.templateId = template.id; await save();
    const revised = structuredClone(template.content); revised.questions[0].optionDefinitions![0].label = "템플릿 문구 변경";
    const saved = (await request<TemplateRecord>("template label edit", "/templates/" + f.templateId, 200, { version: 1, content: revised }, "PATCH")).value;
    assert.equal(saved.content.questions[0].optionDefinitions![0].id, f.optionIds[0]);
    const used = (await request("template use", "/templates/" + f.templateId + "/use", 201, { version: 2, serviceId: f.serviceId })).value;
    assert.notEqual(used.content!.questions[0].optionDefinitions![0].id, f.optionIds[0]);
    assert.equal(used.content!.questions[0].optionDefinitions![0].label, "템플릿 문구 변경");
  } else {
    f = JSON.parse(await readFile(file, "utf8")); if (f.hash && mode !== "verify") throw new Error("Frozen fixture is verify-only");
    if (mode === "publish") {
      const current = await form(), rows = await draft();
      assert.deepEqual(rows.questions.map(q => q.id), f.physicalQuestions);
      assert.deepEqual(rows.questions[0].options.map(o => o.id), [...f.physicalOptions].reverse());
      assert.deepEqual(current.content!.questions[0].optionDefinitions!.map(o => o.id), [...f.optionIds].reverse());
      assert.equal(current.content!.questions[0].optionDefinitions![1].label, "현장 방문 (Ego)");
      assert.equal(current.content!.questions[1].condition!.optionId, f.optionIds[0]);
      await request("publish browser-edited draft", "/forms/" + f.formId + "/publish", 201, { version: current.version });
      const pub = await db.publication.findFirstOrThrow({ where: { formId: f.formId, status: "active" } });
      f.publicToken = decrypt<string>(pub.tokenCipher); f.publishedVersionId = pub.formVersionId; await save();
    } else if (mode === "revise") {
      const submissions = await db.submission.findMany({ where: { tenantId: f.companyId }, include: { answers: { include: { question: true } } } });
      assert.equal(submissions.length, 1); f.submissionId = submissions[0].id;
      assert.equal(decrypt(submissions[0].answers.find(a => a.question.stableKey === f.questions[0])!.valueCipher), f.optionValues[0]);
      f.oldEvidenceHash = hash(await oldEvidence()); await save();
      const current = await form(); await request("revise published form", "/forms/" + f.formId + "/revise", 201, { version: current.version });
      const next = await form(); assert.deepEqual(next.content!.questions.map(q => q.id), f.questions);
      assert.deepEqual(next.content!.questions[0].optionDefinitions!.map(o => o.id), [...f.optionIds].reverse());
    } else if (mode === "republish") {
      const current = await form(); assert.equal(current.content!.questions[0].optionDefinitions![1].label, "현장 방문 (개정)");
      assert.equal(hash(await oldEvidence()), f.oldEvidenceHash);
      await request("publish revised label", "/forms/" + f.formId + "/publish", 201, { version: current.version });
      const detail = (await request<{ questions: { id: string; optionDefinitions?: { label: string }[] }[] }>("read historic response", "/submissions/" + f.submissionId, 200)).value;
      assert.equal(detail.questions.find(q => q.id === f.questions[0])!.optionDefinitions![1].label, "현장 방문 (Ego)");
      const response = await fetch(origin + "/api/v1/forms/" + f.formId + "/submissions/export", { headers: { cookie: f.cookie } });
      assert.equal(response.status, 200); assert.match(response.headers.get("content-type")!, /text\/csv/);
      const csv = await response.text(); assert(csv.includes("현장 방문 (Ego)")); assert(!csv.includes("현장 방문 (개정)")); assert(!csv.includes(f.optionValues[0]));
      await writeFile(output + "/response.csv", csv); checks.push({ action: "CSV preserves historic label", status: response.status });
      assert.equal(hash(await oldEvidence()), f.oldEvidenceHash);
      const publication = await db.publication.findFirstOrThrow({ where: { formId: f.formId, status: "active" } }); f.publicToken = decrypt<string>(publication.tokenCipher); await save();
    } else if (mode === "final-http") {
      const questionIds = [randomUUID(), randomUUID()];
      const source = await form();
      const content = { ...source.content, questions: questionIds.map((id, i) => ({ id, type: "단문형 답변" as const,
        label: i === 0 ? "이름" : "이메일", required: true, subjectRole: i === 0 ? "name" as const : "email" as const })) };
      const made = (await request("final build creates role-swap form", "/forms", 201,
        { serviceId: f.serviceId, title: "최종 빌드 역할·보기 저장 검증", content })).value;
      const stored = () => db.question.findMany({ where: { formVersion: { formId: made.id, status: "draft" } }, orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } });
      const before = await stored();
      content.questions[0].subjectRole = "email"; content.questions[1].subjectRole = "name";
      const swapped = (await request("swap name/email roles atomically", "/forms/" + made.id, 200, { version: made.version, content }, "PATCH")).value;
      assert.deepEqual((await stored()).map(q => q.id), before.map(q => q.id));
      assert.deepEqual((await stored()).map(q => q.subjectRole), ["email", "name"]);
      const bad = structuredClone(swapped.content);
      bad.questions[0].options = ["수집값"];
      bad.questions[0].optionDefinitions = [{ id: randomUUID(), value: "수집값", label: "잘못된 표시" }];
      await request("reject non-choice option metadata", "/forms/" + made.id, 422, { version: swapped.version, content: bad }, "PATCH");
      const unchanged = (await request("failed write leaves version unchanged", "/forms/" + made.id, 200)).value;
      assert.equal(unchanged.version, swapped.version);
      const choices = structuredClone(swapped.content);
      choices.questions = questionIds.map((id, i) => ({ id, type: "객관식 답변", label: "선택 " + (i + 1), required: false,
        options: ["a", "b"], optionDefinitions: ["a", "b"].map(value => ({ id: randomUUID(), value, label: "보기 " + value })) }));
      const changed = (await request("create choice rows in bulk", "/forms/" + made.id, 200, { version: swapped.version, content: choices }, "PATCH")).value;
      const physical = await stored(), reordered = structuredClone(changed.content);
      for (const q of reordered.questions) { q.options!.reverse(); q.optionDefinitions!.reverse(); q.optionDefinitions![0].label = "수정된 보기"; }
      const saved = (await request("bulk reorder and relabel preserves identities", "/forms/" + made.id, 200, { version: changed.version, content: reordered }, "PATCH")).value;
      const after = await stored();
      assert.deepEqual(after.map(q => q.id), before.map(q => q.id));
      after.forEach((q, i) => assert.deepEqual(q.options.map(o => o.id), physical[i].options.map(o => o.id).reverse()));
      assert.equal(saved.content.questions[0].optionDefinitions![0].label, "수정된 보기");
      const template = (await request<TemplateRecord>("persisted Ego template label", "/templates/" + f.templateId, 200)).value;
      assert.equal(template.content.questions[0].optionDefinitions![0].label, "템플릿 보기 (Ego)");
      const historic = (await request<{ questions: { id: string; optionDefinitions?: { label: string }[] }[] }>("final build historic response", "/submissions/" + f.submissionId, 200)).value;
      assert.equal(historic.questions.find(q => q.id === f.questions[0])!.optionDefinitions![1].label, "현장 방문 (Ego)");
      assert.equal(hash(await oldEvidence()), f.oldEvidenceHash);
    } else if (mode === "freeze" || mode === "verify") {
      assert.equal(hash(await oldEvidence()), f.oldEvidenceHash);
      const state = await snapshot(), value = hash(state);
      if (mode === "freeze") { assert(!f.hash); f.hash = value; await save(); } else assert.equal(value, f.hash);
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", hash: value,
        oldEvidenceHash: f.oldEvidenceHash, forms: state.forms.length, submissions: state.submissions.length, audits: state.audits.length }, null, 2) + "\n");
    } else throw new Error("Unknown mode");
  }
  if (checks.length) await writeFile(output + "/" + mode + "-http.json", JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", mode, checks: checks.length, formId: f.formId }));
} finally { await db.$disconnect(); }
