import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { formContentSchema } from "../src/contracts/domains";
import type { ConsentEvidence } from "../src/contracts/form-documents";

const mode = process.argv[2];
assert(["prepare", "state", "freeze", "verify"].includes(mode));
const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
assert.equal(origin, "http://localhost:3118");
const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_test"); assert(["localhost", "127.0.0.1"].includes(database.hostname));
const localDirectory = resolve(".local/rea-fullstack/consent-items"), fixturePath = resolve(localDirectory, "fixture.json");
const evidenceDirectory = resolve("docs/qa/R08-T02/question-metadata/consent-items");
const expectedItems = [
  { type: "SENSITIVE", name: "건강정보" }, { type: "IDENTIFICATION", name: "운전면허번호" },
  { type: "SENSITIVE", name: "건강정보" },
];
type Fixture = { format: 1; email: string; password: string; tenantId: string; serviceId: string; formId: string;
  questionIds: string[]; createdAt: string; publicToken?: string; submissionId?: string; receiptId?: string; frozenAt?: string; frozenHash?: string };
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
async function pdfText(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const pdf = await task.promise; let text = "";
    for (let page = 1; page <= pdf.numPages; page++) text += (await (await pdf.getPage(page)).getTextContent()).items
      .map(item => "str" in item ? item.str : "").join(" ");
    assert.equal(await pdf.getJSActions(), null); return { pages: pdf.numPages, text };
  } finally { await task.destroy(); }
}
async function snapshot(fixture: Fixture) {
  const form = await db.form.findUniqueOrThrow({ where: { id: fixture.formId }, include: {
    versions: { orderBy: { number: "asc" }, include: { questions: { orderBy: { order: "asc" } },
      submissions: { orderBy: { submittedAt: "asc" }, include: { receipts: true } } } },
    publications: { orderBy: { createdAt: "asc" } },
  } });
  const audits = await db.auditEvent.findMany({ where: { resourceId: fixture.formId }, orderBy: { createdAt: "asc" } });
  const submissions = form.versions.flatMap(version => version.submissions), receipt = submissions.at(-1)?.receipts[0];
  const evidence = receipt?.evidenceCipher ? decrypt<ConsentEvidence>(receipt.evidenceCipher) : undefined;
  const pdfBytes = receipt?.pdfCipher ? Buffer.from(decrypt<string>(receipt.pdfCipher), "base64") : undefined;
  const parsedPdf = pdfBytes ? await pdfText(pdfBytes) : undefined;
  return {
    form: { id: form.id, status: form.status, version: form.version },
    versions: form.versions.map(version => ({ id: version.id, number: version.number, status: version.status,
      consentItemSchemaVersion: version.consentItemSchemaVersion, consentItems: version.consentItems,
      questions: version.questions.map(question => ({ stableKey: question.stableKey, classifications: question.catchFormPersonalInformationRequests })) })),
    publications: form.publications.map(publication => ({ id: publication.id, status: publication.status,
      token: decrypt<string>(publication.tokenCipher), responseCount: publication.responseCount })),
    submissions: submissions.map(submission => ({ id: submission.id, status: submission.status, receiptIds: submission.receipts.map(row => row.id) })),
    receipt: receipt ? { id: receipt.id, evidenceVersion: receipt.evidenceVersion, documentHash: receipt.documentHash,
      pdfHash: receipt.pdfHash, evidenceItems: evidence?.bundle.collectedItems, pdfBytes: pdfBytes?.length,
      pdfPages: parsedPdf?.pages, pdfContainsItems: expectedItems.every(item => parsedPdf?.text.includes(item.name)) } : null,
    audits: audits.map(event => ({ action: event.action, resourceId: event.resourceId })),
  };
}

let fixture: Fixture | undefined;
try {
  await mkdir(localDirectory, { recursive: true, mode: 0o700 }); await chmod(localDirectory, 0o700); await mkdir(evidenceDirectory, { recursive: true });
  if (mode === "prepare") {
    const email = `consent-items-${randomUUID().slice(0, 8)}@example.test`, password = randomBytes(24).toString("base64url") + "Aa!1";
    await request("/auth/sign-up/email", "", { method: "POST", body: { email, password, name: "동의 항목 브라우저 검증" } });
    await db.user.update({ where: { email }, data: { emailVerified: true } });
    const cookie = await login({ email, password });
    const company = await request<{ id: string }>("/companies", cookie, { method: "POST", body: { name: "동의 항목 검증 회사", publicName: "Consent Items QA" }, expected: 201 });
    const service = await db.service.findFirstOrThrow({ where: { tenantId: company.body.id }, orderBy: { createdAt: "asc" } });
    const questionIds = [randomUUID(), randomUUID()];
    const item = (personalInformationType: string, detectedPersonalInformation: string) => ({ nlpFeedbackId: null,
      personalInformationType, detectedPersonalInformation, personalInformationSource: "USER" });
    const content = formContentSchema.parse({ body: "자동 집계 실제 브라우저 검증", questions: [
      { id: questionIds[0], type: "단문형 답변", label: "첫 문항", required: false, catchFormPersonalInformationRequests: [
        item("SENSITIVE", "건강정보"), item("NON_PERSONAL_INFORMATION", ""), item("IDENTIFICATION", "운전면허번호") ] },
      { id: questionIds[1], type: "단문형 답변", label: "둘째 문항", required: false,
        catchFormPersonalInformationRequests: [item("SENSITIVE", "건강정보")] },
    ], consentRequired: true, consentPurpose: "상담 접수", retentionDays: 30, maxResponses: 10, showSubmitNotice: true });
    const form = await request<{ id: string }>("/forms", cookie, { method: "POST",
      body: { serviceId: service.id, title: "개인정보 자동 집계 브라우저 검증", content }, expected: 201 });
    fixture = { format: 1, email, password, tenantId: company.body.id, serviceId: service.id, formId: form.body.id, questionIds, createdAt: new Date().toISOString() };
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    const state = await snapshot(fixture); assert.deepEqual(state.versions[0].consentItems, expectedItems);
    await writeFile(resolve(evidenceDirectory, "browser-prepare.json"), JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed",
      formId: fixture.formId, questionIds, storedItems: state.versions[0].consentItems, credentialsStoredOnlyInIgnoredFixture: true }, null, 2) + "\n");
    console.log(JSON.stringify({ result: "passed", formId: fixture.formId, items: expectedItems.length }));
  } else {
    fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture; assert.equal(fixture.format, 1);
    const state = await snapshot(fixture), latest = state.versions.at(-1)!;
    assert.equal(latest.consentItemSchemaVersion, 1); assert.deepEqual(latest.consentItems, expectedItems);
    if (["freeze", "verify"].includes(mode)) {
      assert.equal(state.form.status, "published"); assert.equal(latest.status, "published"); assert.equal(state.submissions.length, 1);
      assert.deepEqual(state.receipt?.evidenceItems, expectedItems); assert.equal(state.receipt?.pdfContainsItems, true);
    }
    const digest = createHash("sha256").update(JSON.stringify(state)).digest("hex");
    if (mode === "freeze") {
      fixture = { ...fixture, publicToken: state.publications.at(-1)?.token, submissionId: state.submissions[0]?.id,
        receiptId: state.receipt?.id, frozenAt: new Date().toISOString(), frozenHash: digest };
      await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    }
    if (mode === "verify") assert.equal(digest, fixture.frozenHash);
    const report = { checkedAt: new Date().toISOString(), result: "passed", mode, formId: fixture.formId, status: state.form.status,
      versions: state.versions.length, items: latest.consentItems, submissions: state.submissions.length, receipt: state.receipt,
      frozenHash: mode === "state" ? undefined : digest };
    await writeFile(resolve(evidenceDirectory, `browser-${mode}.json`), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  }
} finally { await db.$disconnect(); }
