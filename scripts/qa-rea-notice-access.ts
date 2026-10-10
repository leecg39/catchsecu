import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { contentDto, versionInclude } from "../src/server/forms";
import type { FormRecord } from "../src/contracts/forms";
import { richDocumentImages, richDocumentText } from "../src/contracts/rich-content";

const mode = process.argv[2];
const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_test");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
assert.ok(["prepare", "verify"].includes(mode));

const directory = resolve(".local/rea-fullstack/notice-access");
const fixturePath = `${directory}/fixture.json`;
const evidence = resolve("docs/qa/R08-T02/body-images/notice-access/browser");
const completionText = "BI05c 완료 안내 브라우저 검증";
const closedText = "BI05c 마감 안내 브라우저 검증";

type Fixture = {
  email: string;
  password: string;
  companyId: string;
  serviceId: string;
  formId: string;
  questionId: string;
  images: { completion: string; closed: string };
  preparedAt: string;
};

async function request<T>(path: string, options: RequestInit = {}, cookie = "") {
  const response = await fetch(origin + "/api/v1" + path, {
    ...options,
    redirect: "error",
    headers: {
      origin,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(body)}`);
  return { response, body: body as T };
}

async function login(fixture: Pick<Fixture, "email" | "password">) {
  const result = await request("/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: fixture.email, password: fixture.password }),
  });
  return result.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
}

try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await mkdir(evidence, { recursive: true });
  if (mode === "prepare") {
    const email = `notice-access-${randomUUID().slice(0, 8)}@example.test`;
    const password = randomBytes(24).toString("hex") + "Aa!1";
    await request("/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email, password, name: "완료 마감 화면 검증 소유자" }),
    });
    await db.user.update({ where: { email }, data: { emailVerified: true } });
    const cookie = await login({ email, password });
    const company = await request<{ id: string }>("/companies", {
      method: "POST",
      headers: { "idempotency-key": randomUUID() },
      body: JSON.stringify({ name: "완료 마감 화면 검증", publicName: "Notice Access QA" }),
    }, cookie);
    const service = await db.service.findFirstOrThrow({
      where: { tenantId: company.body.id },
      orderBy: { createdAt: "asc" },
    });
    const questionId = randomUUID();
    const form = await request<FormRecord>("/forms", {
      method: "POST",
      headers: { "idempotency-key": randomUUID() },
      body: JSON.stringify({
        serviceId: service.id,
        title: "완료 마감 화면 실제 검증",
        content: {
          body: "완료 및 마감 안내를 독립적으로 검증합니다.",
          formLanguage: "ko",
          consentRequired: false,
          consentPurpose: "완료 마감 화면 검증",
          retentionDays: 30,
          maxResponses: 5,
          showSubmitNotice: true,
          completionPage: { mode: "default" },
          closedPage: { mode: "default" },
          questions: [{ id: questionId, type: "단문형 답변", label: "검증 답변", required: true, textMaxLength: 100 }],
        },
      }),
    }, cookie);
    const images = {
      completion: `${directory}/completion-blue.png`,
      closed: `${directory}/closed-amber.png`,
    };
    await writeFile(images.completion, await sharp({ create: { width: 720, height: 360, channels: 3, background: "#2563eb" } }).png().toBuffer(), { mode: 0o600 });
    await writeFile(images.closed, await sharp({ create: { width: 720, height: 360, channels: 3, background: "#d97706" } }).png().toBuffer(), { mode: 0o600 });
    const fixture: Fixture = {
      email,
      password,
      companyId: company.body.id,
      serviceId: service.id,
      formId: form.body.id,
      questionId,
      images,
      preparedAt: new Date().toISOString(),
    };
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    const report = { result: "passed", mode, at: new Date().toISOString(), origin, formId: fixture.formId, images: 2 };
    await writeFile(`${evidence}/prepare.json`, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } else {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
    await login(fixture);
    const form = await db.form.findUniqueOrThrow({
      where: { id: fixture.formId },
      include: { versions: { include: versionInclude, orderBy: { number: "desc" } }, publications: { orderBy: { createdAt: "desc" } } },
    });
    const content = contentDto(form.versions[0]);
    assert.equal(content.completionPage?.mode, "custom");
    assert.equal(content.closedPage?.mode, "custom");
    assert(content.completionPage?.mode === "custom" && content.closedPage?.mode === "custom");
    assert.match(richDocumentText(content.completionPage.bodyRich!), new RegExp(completionText));
    assert.match(richDocumentText(content.closedPage.bodyRich!), new RegExp(closedText));
    const completionImages = richDocumentImages(content.completionPage.bodyRich!);
    const closedImages = richDocumentImages(content.closedPage.bodyRich!);
    assert.equal(completionImages.length, 1);
    assert.equal(closedImages.length, 1);
    assert.match(completionImages[0].alt, /완료/);
    assert.match(closedImages[0].alt, /마감/);
    const assets = await db.authorAsset.findMany({
      where: { id: { in: [completionImages[0].assetId, closedImages[0].assetId] } },
      include: { blob: true, references: true },
      orderBy: { purpose: "asc" },
    });
    assert.deepEqual(assets.map(asset => asset.purpose).sort(), ["END_PAGE_CONTENT_IMAGE", "PRIVATE_PAGE_CONTENT_IMAGE"]);
    assert(assets.every(asset => asset.status === "ready" && asset.blob.scanStatus === "clean"));
    assert(assets.some(asset => asset.references.some(reference => reference.slot === "end_page_content" && reference.documentKey === "completion")));
    assert(assets.some(asset => asset.references.some(reference => reference.slot === "private_page_content" && reference.documentKey === "closed")));
    const publication = form.publications[0];
    assert(publication, "Browser must publish the form");
    assert.equal(form.status, "paused");
    assert.equal(publication.status, "active");
    const submissions = await db.submission.findMany({ where: { publicationId: publication.id } });
    assert.equal(submissions.length, 1);
    const report = {
      result: "passed",
      mode,
      at: new Date().toISOString(),
      origin,
      formId: form.id,
      version: form.version,
      publication: { id: publication.id, formStatus: form.status, immutableStatus: publication.status,
        publicPath: `/projects/${decrypt<string>(publication.tokenCipher)}/form` },
      notices: {
        completion: { text: completionText, assets: completionImages.length },
        closed: { text: closedText, assets: closedImages.length },
      },
      assets: assets.map(asset => ({ id: asset.id, purpose: asset.purpose, status: asset.status, scanStatus: asset.blob.scanStatus, pins: asset.references.length })),
      submissions: submissions.length,
    };
    await writeFile(`${evidence}/browser-db.json`, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  }
} finally {
  await db.$disconnect();
}
