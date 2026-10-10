import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { formContentSchema } from "../src/contracts/domains";

const mode = process.argv[2];
assert(["prepare", "state", "open", "close", "freeze", "verify"].includes(mode));
const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
assert.equal(origin, "http://localhost:3118");
const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_test"); assert(["localhost", "127.0.0.1"].includes(database.hostname));
const localDirectory = resolve(".local/rea-fullstack/collection-window"), fixturePath = resolve(localDirectory, "fixture.json");
const evidenceDirectory = resolve("docs/qa/R08-T02/collection-window");
type Fixture = { format: 1; email: string; password: string; tenantId: string; serviceId: string; formId: string;
  createdAt: string; frozenHash?: string };
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
    versions: { orderBy: { number: "asc" } }, publications: { orderBy: { createdAt: "asc" } },
    service: { select: { id: true, tenantId: true } },
  } });
  const submissions = await db.submission.findMany({ where: { publication: { formId: fixture.formId } }, orderBy: { submittedAt: "asc" },
    select: { id: true, status: true, submittedAt: true } });
  const latest = form.publications.at(-1);
  return { form: { id: form.id, status: form.status, version: form.version, publishedVersionId: form.publishedVersionId },
    versions: form.versions.map(row => ({ id: row.id, number: row.number, status: row.status,
      collectionWindowSchemaVersion: row.collectionWindowSchemaVersion, collectionOpenAt: row.collectionOpenAt,
      collectionCloseAt: row.collectionCloseAt })),
    publications: form.publications.map(row => ({ id: row.id, formVersionId: row.formVersionId, status: row.status,
      opensAt: row.opensAt, expiresAt: row.expiresAt, responseCount: row.responseCount, maxResponses: row.maxResponses })),
    submissions, publicToken: latest ? decrypt<string>(latest.tokenCipher) : undefined };
}

let fixture: Fixture | undefined;
try {
  await mkdir(localDirectory, { recursive: true, mode: 0o700 }); await chmod(localDirectory, 0o700); await mkdir(evidenceDirectory, { recursive: true });
  if (mode === "prepare") {
    const email = `collection-browser-${randomUUID().slice(0, 8)}@example.test`, password = "Collection-window-browser!12345";
    await request("/auth/sign-up/email", "", { method: "POST", body: { email, password, name: "수집 일정 브라우저 검증" } });
    await db.user.update({ where: { email }, data: { emailVerified: true } });
    const cookie = await login({ email, password });
    const company = await request<{ id: string }>("/companies", cookie, { method: "POST",
      body: { name: "수집 일정 브라우저 검증", publicName: "Collection Window Browser QA" }, expected: 201 });
    const service = await db.service.findFirstOrThrow({ where: { tenantId: company.body.id }, orderBy: { createdAt: "asc" } });
    const open = new Date(Date.now() + 86_400_000); open.setSeconds(0, 0);
    const close = new Date(Date.now() + 2 * 86_400_000); close.setSeconds(0, 0);
    const content = formContentSchema.parse({ body: "예약된 수집 일정 브라우저 검증", questions: [
      { id: randomUUID(), type: "단문형 답변", label: "확인 메모", required: true } ],
      consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 2,
      collectionOpenAt: open.toISOString(), collectionCloseAt: close.toISOString(), showSubmitNotice: true,
      closedPage: { mode: "custom", body: "수집 일정이 종료되었습니다." } });
    const form = await request<{ id: string }>("/forms", cookie, { method: "POST",
      body: { serviceId: service.id, title: "응답 수집 일정 브라우저 검증", content }, expected: 201 });
    fixture = { format: 1, email, password, tenantId: company.body.id, serviceId: service.id, formId: form.body.id, createdAt: new Date().toISOString() };
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    const report = { checkedAt: new Date().toISOString(), result: "passed", mode, formId: fixture.formId,
      collectionOpenAt: open.toISOString(), collectionCloseAt: close.toISOString(), credentialsStoredOnlyInIgnoredFixture: true };
    await writeFile(resolve(evidenceDirectory, "browser-prepare.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ result: "passed", formId: fixture.formId }));
  } else {
    fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture; assert.equal(fixture.format, 1);
    if (mode === "open") {
      const publication = await db.publication.findFirstOrThrow({ where: { formId: fixture.formId, status: "active" }, orderBy: { createdAt: "desc" } });
      await db.publication.update({ where: { id: publication.id }, data: { opensAt: new Date(Date.now() - 120_000) } });
    }
    if (mode === "close") {
      const publication = await db.publication.findFirstOrThrow({ where: { formId: fixture.formId, status: "active" }, orderBy: { createdAt: "desc" } });
      assert(publication.opensAt && publication.opensAt < new Date(Date.now() - 60_000));
      await db.publication.update({ where: { id: publication.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    }
    const state = await snapshot(fixture), publicToken = state.publicToken; delete state.publicToken;
    if (["state", "open"].includes(mode)) assert.equal(state.versions.at(-1)?.collectionWindowSchemaVersion, 1);
    if (["close", "freeze", "verify"].includes(mode)) {
      assert.equal(state.form.status, "published"); assert.equal(state.submissions.length, 1);
      assert.equal(state.publications.at(-1)?.responseCount, 1);
    }
    const digest = createHash("sha256").update(JSON.stringify(state)).digest("hex");
    if (mode === "freeze") {
      fixture.frozenHash = digest; await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    }
    if (mode === "verify") assert.equal(digest, fixture.frozenHash);
    const report = { checkedAt: new Date().toISOString(), result: "passed", mode, ...state,
      publicPath: publicToken ? `/projects/${publicToken}/form` : undefined, frozenHash: ["freeze", "verify"].includes(mode) ? digest : undefined };
    await writeFile(resolve(evidenceDirectory, `browser-${mode}.json`), JSON.stringify({ ...report, publicPath: publicToken ? "[redacted public token path]" : undefined }, null, 2) + "\n");
    console.log(JSON.stringify(report));
  }
} finally { await db.$disconnect(); }
