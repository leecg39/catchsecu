import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import type { FormRecord } from "../src/contracts/forms";

const mode = process.argv[2], origin = new URL(process.env.BETTER_AUTH_URL!).origin;
const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_test"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3112"); assert.ok(["prepare", "publish", "verify"].includes(mode));
const directory = resolve(".local/rea-fullstack/page-flow"), fixturePath = `${directory}/fixture.json`;
const evidence = resolve("docs/qa/R08-T02/body-images/page-ui");
type Fixture = { email: string; password: string; companyId: string; serviceId: string; formId: string;
  questions: string[]; optionValues: string[]; publicToken?: string; publicationId?: string; preparedAt: string };
function pageKeys(value: unknown): string[] {
  assert(Array.isArray(value) && value.every(item => typeof item === "string"), "submission page path must be a string array");
  return value;
}

async function request<T>(path: string, options: RequestInit = {}, cookie = "") {
  const response = await fetch(origin + "/api/v1" + path, { ...options, redirect: "error", headers: {
    origin, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(options.headers ?? {}),
  } });
  const body = await response.json().catch(() => null);
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(body)}`);
  return { response, body: body as T };
}
async function login(fixture: Fixture) {
  const result = await request("/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: fixture.email, password: fixture.password }) });
  return result.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
}

try {
  await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700); await mkdir(evidence, { recursive: true });
  if (mode === "prepare") {
    const email = `page-flow-${randomUUID().slice(0, 8)}@example.test`, password = randomBytes(24).toString("hex") + "Aa!1";
    await request("/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name: "페이지 흐름 검증 소유자" }) });
    await db.user.update({ where: { email }, data: { emailVerified: true } });
    const partial = { email, password } as Fixture, cookie = await login(partial);
    const company = await request<{ id: string }>("/companies", { method: "POST", headers: { "idempotency-key": randomUUID() },
      body: JSON.stringify({ name: "페이지 흐름 검증", publicName: "Page Flow QA" }) }, cookie);
    const service = await db.service.findFirstOrThrow({ where: { tenantId: company.body.id }, orderBy: { createdAt: "asc" } });
    const questions = [randomUUID(), randomUUID(), randomUUID()], optionValues = [randomUUID(), randomUUID(), randomUUID()];
    const form = await request<FormRecord>("/forms", { method: "POST", headers: { "idempotency-key": randomUUID() }, body: JSON.stringify({
      serviceId: service.id, title: "페이지 분기 실제 검증", content: { body: "경로에 따라 필요한 질문만 표시합니다.", formLanguage: "ko",
        consentRequired: false, consentPurpose: "페이지 분기 검증", retentionDays: 30, maxResponses: 20, showSubmitNotice: true,
        questions: [
          { id: questions[0], type: "객관식 답변", label: "진행 경로", required: true, options: optionValues,
            optionDefinitions: optionValues.map((value, index) => ({ id: randomUUID(), value, label: ["상세", "바로", "제외"][index] })) },
          { id: questions[1], type: "단문형 답변", label: "상세 입력", required: true, textMaxLength: 100 },
          { id: questions[2], type: "단문형 답변", label: "최종 확인", required: true, textMaxLength: 100 },
        ] },
    }) }, cookie);
    const fixture: Fixture = { email, password, companyId: company.body.id, serviceId: service.id, formId: form.body.id,
      questions, optionValues, preparedAt: new Date().toISOString() };
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    const report = { result: "passed", mode, at: new Date().toISOString(), formId: fixture.formId, questions: questions.length };
    await writeFile(`${evidence}/prepare.json`, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
  } else {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture, cookie = await login(fixture);
    if (mode === "publish") {
      const form = (await request<FormRecord>(`/forms/${fixture.formId}`, {}, cookie)).body;
      assert.equal(form.content.sections?.length, 3); assert.deepEqual(form.content.questions.map(question => question.pageId), form.content.sections!.map(section => section.id));
      const route = form.content.questions[0], options = route.optionDefinitions!;
      assert.deepEqual(options.map(option => option.branchDestination?.kind), ["page", "page", "ineligible"]);
      assert.equal(options[0].branchDestination?.kind === "page" && options[0].branchDestination.pageId, form.content.sections![1].id);
      assert.equal(options[1].branchDestination?.kind === "page" && options[1].branchDestination.pageId, form.content.sections![2].id);
      await request(`/forms/${fixture.formId}/publish`, { method: "POST", headers: { "idempotency-key": randomUUID() }, body: JSON.stringify({ version: form.version }) }, cookie);
      const publication = await db.publication.findFirstOrThrow({ where: { formId: fixture.formId, status: "active" } });
      fixture.publicToken = decrypt<string>(publication.tokenCipher); fixture.publicationId = publication.id;
      await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
      const report = { result: "passed", mode, at: new Date().toISOString(), formId: fixture.formId, version: form.version,
        pageIds: form.content.sections!.map(section => section.id), publicPath: `/projects/${fixture.publicToken}/form` };
      await writeFile(`${evidence}/publish.json`, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    } else {
      assert(fixture.publicationId && fixture.publicToken);
      const version = await db.formVersion.findFirstOrThrow({ where: { form: { id: fixture.formId }, publications: { some: { id: fixture.publicationId } } },
        include: { questions: true, sections: { orderBy: { order: "asc" } } } });
      const submissions = await db.submission.findMany({ where: { publicationId: fixture.publicationId }, orderBy: { submittedAt: "asc" },
        include: { answers: { include: { question: true } } } });
      assert.equal(submissions.length, 2);
      assert.deepEqual(submissions.map(item => pageKeys(item.visitedPageKeys).length).sort(), [2, 3]);
      assert(submissions.every(item => item.pagePathVersion === 1 && item.terminationKind === "consent"));
      const short = submissions.find(item => pageKeys(item.visitedPageKeys).length === 2)!;
      assert.deepEqual(pageKeys(short.visitedPageKeys), [version.sections[0].pageKey, version.sections[2].pageKey]);
      const detail = short.answers.find(answer => answer.question.stableKey === fixture.questions[1]);
      assert(detail); assert.equal(decrypt(detail.valueCipher), "");
      const long = submissions.find(item => pageKeys(item.visitedPageKeys).length === 3)!;
      assert.equal(decrypt(long.answers.find(answer => answer.question.stableKey === fixture.questions[1])!.valueCipher), "상세 브라우저 입력");
      const report = { result: "passed", mode, at: new Date().toISOString(), formId: fixture.formId,
        submissions: submissions.map(item => ({ id: item.id, visitedPageIds: pageKeys(item.visitedPageKeys), terminal: item.terminationKind })),
        shortDetailCleared: true, storedAnswers: await db.answer.count({ where: { submissionId: { in: submissions.map(item => item.id) } } }) };
      await writeFile(`${evidence}/browser-db.json`, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
    }
  }
} finally { await db.$disconnect(); }
