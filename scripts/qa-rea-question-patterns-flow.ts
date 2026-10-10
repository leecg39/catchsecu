import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { formContentSchema } from "../src/contracts/domains";

const mode = process.argv[2];
assert(["prepare", "state", "freeze", "verify"].includes(mode));
const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
assert.equal(origin, "http://localhost:3116");
const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_test"); assert(["localhost", "127.0.0.1"].includes(database.hostname));
const localDirectory = resolve(".local/rea-fullstack/question-patterns");
const fixturePath = resolve(localDirectory, "fixture.json");
const evidenceDirectory = resolve("docs/qa/R08-T02/question-patterns");
type Fixture = { format: 1; email: string; password: string; tenantId: string; serviceId: string; formId: string; questionId: string;
  createdAt: string; publicToken?: string; submissionId?: string; frozenAt?: string; frozenHash?: string };
type Options = { method?: string; body?: unknown; expected?: number };
async function request<T>(path: string, cookie = "", options: Options = {}) {
  const response = await fetch(origin + "/api/v1" + path, { method: options.method ?? (options.body === undefined ? "GET" : "POST"), redirect: "error",
    headers: { origin, ...(cookie ? { cookie } : {}), ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.method === "POST" ? { "idempotency-key": randomUUID() } : {}) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const body = await response.json().catch(() => null);
  assert.equal(response.status, options.expected ?? 200, `${path}: ${response.status} ${JSON.stringify(body)}`);
  return { response, body: body as T };
}
async function login(fixture: Pick<Fixture, "email" | "password">) {
  const result = await request("/auth/sign-in/email", "", { method: "POST", body: { email: fixture.email, password: fixture.password } });
  return result.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
}
async function snapshot(fixture: Fixture) {
  const form = await db.form.findUniqueOrThrow({ where: { id: fixture.formId }, include: {
    versions: { orderBy: { number: "asc" }, include: { questions: { orderBy: { order: "asc" } },
      submissions: { orderBy: { submittedAt: "asc" }, include: { answers: true } } } },
    publications: { orderBy: { createdAt: "asc" } },
  } });
  const submissions = form.versions.flatMap(version => version.submissions);
  return { form: { id: form.id, status: form.status, version: form.version },
    versions: form.versions.map(version => ({ id: version.id, number: version.number, status: version.status,
      questions: version.questions.map(question => ({ id: question.id, stableKey: question.stableKey, type: question.type, infoPatternId: question.infoPatternId })) })),
    publications: form.publications.map(publication => ({ id: publication.id, formVersionId: publication.formVersionId, status: publication.status,
      token: decrypt<string>(publication.tokenCipher), responseCount: publication.responseCount })),
    submissions: submissions.map(submission => ({ id: submission.id, status: submission.status, version: submission.version,
      answers: Object.fromEntries(submission.answers.map(answer => [answer.questionId, decrypt(answer.valueCipher)])) })),
  };
}
let fixture: Fixture | undefined;
try {
  await mkdir(localDirectory, { recursive: true, mode: 0o700 }); await chmod(localDirectory, 0o700); await mkdir(evidenceDirectory, { recursive: true });
  if (mode === "prepare") {
    const email = `pattern-browser-${randomUUID().slice(0, 8)}@example.test`, password = randomBytes(24).toString("base64url") + "Aa!1";
    await request("/auth/sign-up/email", "", { method: "POST", body: { email, password, name: "입력 형식 브라우저 검증" }, expected: 200 });
    await db.user.update({ where: { email }, data: { emailVerified: true } });
    const cookie = await login({ email, password });
    const company = await request<{ id: string }>("/companies", cookie, { method: "POST", body: { name: "입력 형식 검증 회사", publicName: "Pattern Browser QA" }, expected: 201 });
    const service = await db.service.findFirstOrThrow({ where: { tenantId: company.body.id }, orderBy: { createdAt: "asc" } });
    const questionId = randomUUID();
    const content = formContentSchema.parse({ body: "입력 형식 실제 브라우저 검증", questions: [{ id: questionId, type: "단문형 답변", label: "식별번호", required: true,
      infoPatternId: 1, textMaxLength: 100 }], consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 10 });
    const form = await request<{ id: string }>("/forms", cookie, { method: "POST", body: { serviceId: service.id, title: "입력 형식 브라우저 검증", content }, expected: 201 });
    fixture = { format: 1, email, password, tenantId: company.body.id, serviceId: service.id, formId: form.body.id, questionId, createdAt: new Date().toISOString() };
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    await writeFile(resolve(evidenceDirectory, "browser-prepare.json"), JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed",
      formId: fixture.formId, questionId, initialPatternId: 1, credentialsStoredOnlyInIgnoredFixture: true }, null, 2) + "\n");
    console.log(JSON.stringify({ result: "passed", formId: fixture.formId, questionId }));
  } else {
    fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
    assert.equal(fixture.format, 1); assert(!fixture.frozenHash || ["state", "verify"].includes(mode), "Frozen fixture is read-only");
    const state = await snapshot(fixture), latest = state.versions.at(-1)!;
    if (mode !== "state") {
      assert.equal(state.form.status, "published"); assert.equal(latest.status, "published");
      assert.equal(latest.questions[0].stableKey, fixture.questionId); assert.equal(latest.questions[0].infoPatternId, 3);
      assert.equal(state.publications.at(-1)?.status, "active"); assert.equal(state.submissions.length, 1);
      assert.equal(Object.values(state.submissions[0].answers)[0], "900101-1234567");
    }
    const publicToken = state.publications.at(-1)?.token, submissionId = state.submissions[0]?.id;
    const digest = createHash("sha256").update(JSON.stringify(state)).digest("hex");
    if (mode === "freeze") {
      fixture = { ...fixture, publicToken, submissionId, frozenAt: new Date().toISOString(), frozenHash: digest };
      await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    }
    if (mode === "verify") assert.equal(digest, fixture.frozenHash);
    const report = { checkedAt: new Date().toISOString(), result: "passed", mode, formId: fixture.formId, questionId: fixture.questionId,
      status: state.form.status, versions: state.versions.length, patternId: latest.questions[0].infoPatternId,
      publications: state.publications.length, submissions: state.submissions.length, frozenHash: mode === "state" ? undefined : digest };
    await writeFile(resolve(evidenceDirectory, `browser-${mode}.json`), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  }
} finally { await db.$disconnect(); }
