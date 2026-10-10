import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { formContentSchema } from "../src/contracts/domains";
import { defaultParticipationAccessPolicy } from "../src/contracts/form-participation-access";
import { decrypt } from "../src/server/crypto";
import { db } from "../src/server/db";

const mode = process.argv[2];
assert(["prepare", "otp", "state", "freeze", "verify"].includes(mode));
const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
assert.equal(origin, "http://localhost:3119");
const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_test"); assert(["localhost", "127.0.0.1"].includes(database.hostname));
const localDirectory = resolve(".local/rea-fullstack/participation-access"), fixturePath = resolve(localDirectory, "fixture.json");
const evidenceDirectory = resolve("docs/qa/R08-T02/participation-access");
type Fixture = { format: 1; email: string; password: string; participantEmail: string; tenantId: string; serviceId: string;
  formId: string; token: string; questionId: string; createdAt: string; frozenHash?: string };
type Options = { method?: string; body?: unknown; expected?: number; headers?: Record<string, string> };
async function request<T>(path: string, cookie = "", options: Options = {}) {
  const response = await fetch(origin + "/api/v1" + path, { method: options.method ?? (options.body === undefined ? "GET" : "POST"), redirect: "error",
    headers: { origin, ...(cookie ? { cookie } : {}), ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.method === "POST" ? { "idempotency-key": randomUUID() } : {}), ...options.headers },
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
    versions: { orderBy: { number: "asc" } }, publications: { orderBy: { createdAt: "asc" } },
  } });
  const publicationIds = form.publications.map(row => row.id);
  const submissions = await db.submission.findMany({ where: { publicationId: { in: publicationIds } }, orderBy: { submittedAt: "asc" },
    select: { id: true, status: true, participantId: true, submittedAt: true } });
  const participants = await db.publicationParticipant.findMany({ where: { formId: fixture.formId }, orderBy: { createdAt: "asc" },
    select: { id: true, method: true, provider: true, submissionCount: true, lastSubmittedAt: true } });
  const sessions = await db.participationSession.findMany({ where: { publicationId: { in: publicationIds } }, orderBy: { createdAt: "asc" },
    select: { id: true, participantId: true, expiresAt: true, revokedAt: true } });
  return { form: { id: form.id, status: form.status, version: form.version, publishedVersionId: form.publishedVersionId },
    versions: form.versions.map(row => ({ id: row.id, number: row.number, status: row.status,
      participationAccessSchemaVersion: row.participationAccessSchemaVersion, useParticipationAccess: row.useParticipationAccess,
      participationAccessMethod: row.participationAccessMethod, participationTargetScope: row.participationTargetScope,
      participationUseOtp: row.participationUseOtp, restrictDuplicateReplies: row.restrictDuplicateReplies })),
    publications: form.publications.map(row => ({ id: row.id, status: row.status, responseCount: row.responseCount })),
    submissions, participants, sessions };
}

let fixture: Fixture | undefined;
try {
  await mkdir(localDirectory, { recursive: true, mode: 0o700 }); await chmod(localDirectory, 0o700);
  await mkdir(evidenceDirectory, { recursive: true });
  if (mode === "prepare") {
    const email = `participation-browser-${randomUUID().slice(0, 8)}@example.test`, password = "Participation-browser!12345";
    const participantEmail = `respondent-${randomUUID().slice(0, 8)}@example.test`;
    await request("/auth/sign-up/email", "", { method: "POST", body: { email, password, name: "참여 인증 브라우저 검증" } });
    await db.user.update({ where: { email }, data: { emailVerified: true } });
    const cookie = await login({ email, password });
    const company = await request<{ id: string }>("/companies", cookie, { method: "POST",
      body: { name: "참여 인증 브라우저 검증", publicName: "Participation Browser QA" }, expected: 201 });
    const service = await db.service.findFirstOrThrow({ where: { tenantId: company.body.id }, orderBy: { createdAt: "asc" } });
    const questionId = randomUUID();
    const content = formContentSchema.parse({ body: "이메일 인증 뒤에만 보이는 실제 설문입니다.", questions: [
      { id: questionId, type: "단문형 답변", label: "브라우저 확인 메모", required: true } ],
      consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 5,
      participationAccess: { ...defaultParticipationAccessPolicy(), enabled: true, useOtp: true, limitDuplicate: true } });
    const form = await request<{ id: string; version: number }>("/forms", cookie, { method: "POST",
      body: { serviceId: service.id, title: "참여 인증 브라우저 검증", content }, expected: 201 });
    const publication = await request<{ token: string }>(`/forms/${form.body.id}/publish`, cookie,
      { method: "POST", body: { version: form.body.version }, expected: 201 });
    fixture = { format: 1, email, password, participantEmail, tenantId: company.body.id, serviceId: service.id,
      formId: form.body.id, token: publication.body.token, questionId, createdAt: new Date().toISOString() };
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    await writeFile(resolve(evidenceDirectory, "browser-prepare.json"), JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed",
      mode, formId: fixture.formId, settingsPath: `/form/ai/setting?formId=${fixture.formId}`,
      publicPath: "[redacted public token path]", credentialsStoredOnlyInIgnoredFixture: true }, null, 2) + "\n");
    console.log(JSON.stringify({ result: "passed", email, password, participantEmail, formId: fixture.formId,
      settingsPath: `/form/ai/setting?formId=${fixture.formId}`, publicPath: `/projects/${fixture.token}/form` }));
  } else {
    fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture; assert.equal(fixture.format, 1);
    if (mode === "otp") {
      const publication = await db.publication.findFirstOrThrow({ where: { formId: fixture.formId, status: "active" }, orderBy: { createdAt: "desc" } });
      const challenge = await db.participationChallenge.findFirstOrThrow({ where: { publicationId: publication.id }, orderBy: { createdAt: "desc" } });
      const job = await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:participation:" + challenge.id } });
      const code = decrypt<{ text: string }>(job.payloadCipher).text.match(/참여 인증번호: (\d{6})/)?.[1]; assert(code);
      console.log(JSON.stringify({ result: "passed", code }));
    } else {
      const state = await snapshot(fixture), digest = createHash("sha256").update(JSON.stringify(state)).digest("hex");
      if (mode === "state") {
        assert.equal(state.versions.at(-1)?.participationAccessSchemaVersion, 1);
        assert.equal(state.versions.at(-1)?.useParticipationAccess, true);
      }
      if (["freeze", "verify"].includes(mode)) {
        assert.equal(state.form.status, "published"); assert.equal(state.submissions.length, 1);
        assert.equal(state.participants.length, 1); assert.equal(state.participants[0].submissionCount, 1);
      }
      if (mode === "freeze") { fixture.frozenHash = digest; await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 }); }
      if (mode === "verify") assert.equal(digest, fixture.frozenHash);
      const report = { checkedAt: new Date().toISOString(), result: "passed", mode, ...state,
        frozenHash: ["freeze", "verify"].includes(mode) ? digest : undefined };
      await writeFile(resolve(evidenceDirectory, `browser-${mode}.json`), JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify({ result: "passed", mode, submissions: state.submissions.length,
        participants: state.participants.length, sessions: state.sessions.length, frozenHash: report.frozenHash }));
    }
  }
} finally { await db.$disconnect(); }
