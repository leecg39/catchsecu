import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { db } from "../src/server/db";
import { contentDto, versionInclude } from "../src/server/forms";
import { formContentSchema } from "../src/contracts/domains";
import type { FormRecord } from "../src/contracts/forms";
import { richDocumentImages, richDocumentText } from "../src/contracts/rich-content";

const mode = process.argv[2], origin = new URL(process.env.BETTER_AUTH_URL!).origin;
const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.pathname, "/catchsecu_test"); assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(origin, "http://localhost:3112"); assert.ok(["prepare", "verify"].includes(mode));
const directory = resolve(".local/rea-fullstack/rich-editor"), fixturePath = `${directory}/fixture.json`;
const evidence = resolve("docs/qa/R08-T02/body-images/rich-editor");
type Fixture = { email: string; password: string; companyId: string; serviceId: string; formId: string; images: string[]; preparedAt: string };

async function request<T>(path: string, options: RequestInit = {}, cookie = "") {
  const response = await fetch(origin + "/api/v1" + path, { ...options, redirect: "error", headers: {
    origin, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(options.headers ?? {}),
  } });
  const body = await response.json().catch(() => null);
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(body)}`);
  return { response, body: body as T };
}

try {
  await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700); await mkdir(evidence, { recursive: true });
  if (mode === "prepare") {
    const email = `rich-editor-${randomUUID().slice(0, 8)}@example.test`;
    const password = randomBytes(24).toString("hex") + "Aa!1";
    await request("/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name: "본문 편집기 검증 소유자" }) });
    await db.user.update({ where: { email }, data: { emailVerified: true } });
    const login = await request("/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
    const cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
    const company = await request<{ id: string }>("/companies", { method: "POST", headers: { "idempotency-key": randomUUID() },
      body: JSON.stringify({ name: "본문 편집기 검증", publicName: "Rich Editor QA" }) }, cookie);
    const service = await db.service.findFirstOrThrow({ where: { tenantId: company.body.id }, orderBy: { createdAt: "asc" } });
    const content = formContentSchema.parse({ body: "초기 본문", formLanguage: "ko", consentRequired: true, consentPurpose: "본문 편집기 검증",
      retentionDays: 30, maxResponses: 20, showSubmitNotice: true,
      questions: [{ id: randomUUID(), type: "단문형 답변", label: "확인 값", required: true, textMaxLength: 100 }] });
    const form = await request<FormRecord>("/forms", { method: "POST", headers: { "idempotency-key": randomUUID() },
      body: JSON.stringify({ serviceId: service.id, title: "본문 rich editor 실제 검증", content }) }, cookie);
    const images: string[] = [];
    for (const sample of [{ name: "rich-blue.png", color: "#2979ff" }, { name: "rich-green.png", color: "#22a06b" }]) {
      const path = `${directory}/${sample.name}`;
      await writeFile(path, await sharp({ create: { width: 720, height: 360, channels: 3, background: sample.color } }).png().toBuffer(), { mode: 0o600 });
      images.push(path);
    }
    const fixture: Fixture = { email, password, companyId: company.body.id, serviceId: service.id, formId: form.body.id, images, preparedAt: new Date().toISOString() };
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    const report = { result: "passed", mode, at: new Date().toISOString(), formId: fixture.formId, images: fixture.images.length };
    await writeFile(`${evidence}/prepare.json`, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
  } else {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
    const form = await db.form.findUniqueOrThrow({ where: { id: fixture.formId }, include: { versions: { include: versionInclude, orderBy: { number: "desc" } } } });
    const content = contentDto(form.versions[0]), document = content.bodyRich;
    assert(document, "Browser must persist bodyRich");
    assert.equal(richDocumentText(document), content.body); assert.match(content.body, /브라우저 편집/);
    const images = richDocumentImages(document); assert.equal(images.length, 1); assert.equal(images[0].alt, "파란 검증 이미지");
    assert.equal(images[0].alignment, "right"); assert.deepEqual(images[0].width, { unit: "percent", value: 75 });
    const asset = await db.authorAsset.findUniqueOrThrow({ where: { id: images[0].assetId }, include: { blob: true, references: true } });
    assert.equal(asset.tenantId, fixture.companyId); assert.equal(asset.serviceId, fixture.serviceId); assert.equal(asset.purpose, "FORM_CONTENT_IMAGE");
    assert.equal(asset.status, "ready"); assert.equal(asset.blob.scanStatus, "clean");
    assert.ok(asset.references.some(reference => reference.formVersionId === form.versions[0].id && reference.slot === "form_content"
      && reference.documentKey === "form" && reference.nodeKey === images[0].nodeId));
    const report = { result: "passed", mode, at: new Date().toISOString(), formId: form.id, version: form.version,
      body: content.body, images: images.map(image => ({ assetId: image.assetId, nodeId: image.nodeId, alt: image.alt, alignment: image.alignment, width: image.width })),
      asset: { id: asset.id, status: asset.status, purpose: asset.purpose, scanStatus: asset.blob.scanStatus, pins: asset.references.length } };
    await writeFile(`${evidence}/browser-db.json`, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
  }
} finally { await db.$disconnect(); }
