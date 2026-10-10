import { createHash, randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, expect, test, vi, afterEach } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { createForm, updateForm, publishForm, reviseForm } from "@/server/forms";
import { createTemplate } from "@/server/templates";
import { requestApproval } from "@/server/approvals";
import { submitForm } from "@/server/submissions";
import { createShare, changeShare } from "@/server/sharing";
import { startViewerChallenge, verifyViewerChallenge, sharedAuthorAssets, listSharedSubmissions, VIEWER_COOKIE } from "@/server/viewer";
import { decrypt } from "@/server/crypto";
import { memberAuthorAssets, publicAuthorAssets } from "@/server/author-asset-reads";
import { initAuthorAssetUpload, putAuthorAssetContent, completeAuthorAssetUpload } from "@/server/author-asset-uploads";
import { importSystemAuthorAsset } from "@/server/author-asset-system-import";
import { withAuthorAssetReferences } from "@/server/author-asset-references";
import { privateFiles } from "@/server/file-storage";
import { requireFileScanner } from "@/server/file-scanner";
import { formContentSchema, submissionInput } from "@/contracts/domains";
import type { AuthorAssetManifest } from "@/contracts/author-assets";
import { GET as memberGet } from "@/app/api/v1/author-assets/[[...segments]]/route";
import { GET as publicGet } from "@/app/api/v1/public/forms/[...segments]/route";
import { GET as viewerGet } from "@/app/api/v1/viewer/[...segments]/route";

const url = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (url.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Isolated test database required");
const pdf = Buffer.from("%PDF-1.7\n% Author reference access fixture\n%%EOF\n");
let ctx: Context, serviceId: string, cookie: string;
const req = (path: string) => new Request(origin + "/api/v1" + path, { headers: { cookie } });
async function clearStored() { for (const row of await db.authorAssetBlob.findMany({ select: { storageKey: true } })) await privateFiles.remove(row.storageKey); }
beforeAll(() => requireFileScanner());
beforeEach(async () => {
  await clearStored();
  await db.$executeRawUnsafe('TRUNCATE "Company", "User", "AuthorAssetBlob", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const c = await db.company.create({ data: { name: "Author access QA", publicName: "QA", policy: { create: { passwordMonths: 0 } }, services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } });
  serviceId = c.services[0].id;
  const email = randomUUID() + "@asset.example.test", password = "Author-access-QA!123";
  const authReq = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(authReq("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: c.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(authReq("sign-in/email", { email, password })); expect(login.status).toBe(200);
  cookie = login.headers.getSetCookie().map(item => item.split(";", 1)[0]).join("; ");
  ctx = await requireContext(new Headers({ cookie }), "form.write");
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await clearStored(); await db.$disconnect(); });
async function ready(name = "자료.pdf") {
  const a = (await initAuthorAssetUpload(ctx, { serviceId, purpose: "QUESTION_MATERIAL", name, mime: "application/pdf", size: pdf.length,
    sha256: createHash("sha256").update(pdf).digest("hex") }, randomUUID(), randomUUID())).body;
  await putAuthorAssetContent(ctx, a.id, new Request(origin + "/upload", { method: "PUT", headers: { "content-type": "application/pdf" }, body: new Uint8Array(pdf) }), randomUUID());
  return completeAuthorAssetUpload(ctx, a.id, randomUUID());
}
const material = (id: string) => ({ materialType: "FILE", orderNumber: 0, fileKey: id, linkLabel: null, linkUrl: null });
async function fixture() {
  const first = await ready("허용 자료.pdf"), second = await ready("다른 질문 자료.pdf");
  const content = formContentSchema.parse({ body: "", consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 1,
    questions: [first, second].map((asset, i) => ({ id: randomUUID(), type: "단문형 답변", label: "질문 " + i, required: false, materialList: [material(asset.id)] })) });
  const form = await db.$transaction(tx => createForm(ctx, { serviceId, title: "자료 권한", content }, randomUUID(), tx));
  return { form, content, first, second };
}
async function publish(id: string) {
  const row = await db.form.findUniqueOrThrow({ where: { id } });
  return db.$transaction(tx => publishForm(tx, ctx, id, { version: row.version }, randomUUID()));
}
async function posted(token: string, questionId: string) {
  return submitForm(token, submissionInput.parse({ answers: { [questionId]: "확인" }, consent: false }), randomUUID(), randomUUID());
}
async function manifest(value: Promise<AuthorAssetManifest | Response>) {
  const result = await value; expect(result).not.toBeInstanceOf(Response); return result as AuthorAssetManifest;
}

test("member manifest and download require the exact parent revision and reject mixed/repeated query scope", async () => {
  const f = await fixture(), scope = { kind: "form" as const, id: f.form.id, version: f.form.version };
  expect((await manifest(memberAuthorAssets(ctx, scope, randomUUID()))).items.map(a => a.id).sort()).toEqual([f.first.id, f.second.id].sort());
  const query = new URLSearchParams({ kind: "form", id: f.form.id, version: String(f.form.version) });
  expect((await memberGet(req("/author-assets?" + query))).status).toBe(200);
  expect((await memberGet(req("/author-assets/uploads/" + f.first.id))).status).toBe(200);
  expect((await memberGet(req("/author-assets/usage?serviceId=" + serviceId))).status).toBe(200);
  const response = await memberGet(req("/author-assets/" + f.first.id + "/download?" + query));
  expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf);
  for (const extra of ["&version=1", "&submissionId=" + randomUUID(), "&id=" + f.form.id])
    expect((await memberGet(req("/author-assets?" + query + extra))).status).toBe(422);
  expect((await memberGet(req("/author-assets?kind=form&id=" + f.form.id + "&version=999"))).status).toBe(409);
  const unbound = await ready();
  expect((await memberGet(req("/author-assets/" + unbound.id + "/download?" + query))).status).toBe(404);
});
test("active public assets stop at response capacity and while publication is paused", async () => {
  const f = await fixture(), pub = await publish(f.form.id);
  expect((await publicGet(req("/public/forms/" + pub.token + "/author-assets"))).status).toBe(200);
  expect((await publicGet(req("/public/forms/" + pub.token + "/author-assets/" + f.first.id + "/download"))).status).toBe(200);
  await expect(publicAuthorAssets(pub.token, randomUUID(), (await ready()).id)).rejects.toMatchObject({ status: 404 });
  await posted(pub.token, f.content.questions[0].id);
  const response = await publicGet(req("/public/forms/" + pub.token + "/author-assets/" + f.first.id + "/download"));
  expect(response.status).toBe(410);
  await db.form.update({ where: { id: f.form.id }, data: { status: "paused", version: { increment: 1 } } });
  await expect(publicAuthorAssets(pub.token, randomUUID(), f.first.id)).rejects.toMatchObject({ status: 410 });
});
test("old response references survive a later draft replacement and stop at response expiry", async () => {
  const f = await fixture(), pub = await publish(f.form.id), response = await posted(pub.token, f.content.questions[0].id);
  const form = await db.form.findUniqueOrThrow({ where: { id: f.form.id } });
  const revised = await db.$transaction(tx => reviseForm(tx, ctx, form.id, form.version, randomUUID()));
  const empty = { ...f.content, questions: f.content.questions.map(q => ({ ...q, materialList: [] })) };
  const changed = await updateForm(ctx, form.id, { version: revised.version, content: empty }, randomUUID());
  expect((await manifest(memberAuthorAssets(ctx, { kind: "form", id: form.id, version: changed.version }, randomUUID()))).items).toHaveLength(0);
  const scope = { kind: "submission" as const, id: response.body.id };
  expect((await manifest(memberAuthorAssets(ctx, scope, randomUUID()))).items).toHaveLength(2);
  expect(Buffer.from(await ((await memberAuthorAssets(ctx, scope, randomUUID(), f.first.id)) as Response).arrayBuffer())).toEqual(pdf);
  await db.submission.update({ where: { id: response.body.id }, data: { retentionUntil: new Date(Date.now() - 1000) } });
  await expect(memberAuthorAssets(ctx, scope, randomUUID(), f.first.id)).rejects.toMatchObject({ status: 410 });
});
test("approval snapshot uses independent pins after the mutable draft removes its files", async () => {
  const f = await fixture();
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireApproval: true } });
  const approval = await db.$transaction(tx => requestApproval(tx, ctx, f.form.id, { version: f.form.version, message: "QA", reference: "QA" }, randomUUID()));
  const current = await db.form.findUniqueOrThrow({ where: { id: f.form.id } });
  await updateForm(ctx, current.id, { version: current.version, content: { ...f.content, questions: f.content.questions.map(q => ({ ...q, materialList: [] })) } }, randomUUID());
  const scope = { kind: "approval" as const, id: approval.id };
  expect((await manifest(memberAuthorAssets(ctx, scope, randomUUID()))).items).toHaveLength(2);
  expect(Buffer.from(await ((await memberAuthorAssets(ctx, scope, randomUUID(), f.second.id)) as Response).arrayBuffer())).toEqual(pdf);
});
test("template manifests use their own revision and a quarantined blob cannot be downloaded", async () => {
  const f = await fixture();
  const template = await db.$transaction(tx => createTemplate(ctx, { serviceId, title: "QA template", category: "QA", content: f.content }, randomUUID(), tx));
  const scope = { kind: "template" as const, id: template.id, version: template.version };
  expect((await manifest(memberAuthorAssets(ctx, scope, randomUUID()))).items).toHaveLength(2);
  await expect(memberAuthorAssets(ctx, { ...scope, version: template.version + 1 }, randomUUID())).rejects.toMatchObject({ status: 409 });
  const asset = await db.authorAsset.findUniqueOrThrow({ where: { id: f.first.id } });
  await db.authorAssetBlob.update({ where: { id: asset.blobId }, data: { status: "quarantined", scanStatus: "infected", version: { increment: 1 } } });
  await expect(memberAuthorAssets(ctx, scope, randomUUID(), f.first.id)).rejects.toMatchObject({ status: 409 });
  expect(await db.authorAssetReference.count({ where: { assetId: f.first.id } })).toBe(2);
});
test("trusted system ingestion scans real bytes and exposes them only through its public template", async () => {
  const asset = await importSystemAuthorAsset({ name: "공용 자료.pdf", purpose: "QUESTION_MATERIAL", bytes: pdf });
  const content = formContentSchema.parse({ body: "", consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 1, questions: [{ id: randomUUID(), type: "단문형 답변", label: "QA", required: false, materialList: [material(asset.id)] }] });
  const template = await db.$transaction(async tx => {
    const row = await tx.formTemplate.create({ data: { title: "System QA", category: "QA", licenseScope: "ACTIVE_SUBSCRIPTION", content } });
    await withAuthorAssetReferences(tx, { tenantId: null, serviceId: null, memberId: null }, { kind: "template", id: row.id }, content, randomUUID(), async () => undefined);
    return row;
  });
  expect((await manifest(memberAuthorAssets(ctx, { kind: "template", id: template.id, version: template.version }, randomUUID()))).items[0].id).toBe(asset.id);
  expect((await db.authorAsset.findUniqueOrThrow({ where: { id: asset.id }, include: { blob: true } })).blob.scanEngine).toMatch(/^ClamAV /);
  expect((await memberGet(req("/author-assets/uploads/" + asset.id + "/download"))).status).toBe(404);
});
test("authenticated viewer receives only selected questions' assets and revocation immediately blocks old URLs", async () => {
  const f = await fixture(), pub = await publish(f.form.id), submitted = await posted(pub.token, f.content.questions[0].id);
  const form = await db.form.findUniqueOrThrow({ where: { id: f.form.id } });
  const share = await db.$transaction(tx => createShare(ctx, { formId: form.id, formVersionId: form.publishedVersionId!, questionIds: [f.content.questions[0].id],
    email: "asset-viewer@example.test", expiresAt: new Date(Date.now() + 86400000).toISOString() }, randomUUID(), tx));
  const invitation = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + share.id + ":invite:1" } })).payloadCipher);
  const challenge = await startViewerChallenge({ formCode: form.id, invitationCode: invitation.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)![1], email: "asset-viewer@example.test", consent: true }, randomUUID());
  const mail = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + share.id + ":challenge:" + challenge.id } })).payloadCipher);
  const session = await verifyViewerChallenge(challenge.id, mail.text.match(/인증코드: (\d{6})/)![1], challenge.client, randomUUID());
  const page = await listSharedSubmissions(session.token, 1, 20, randomUUID());
  expect(page.viewer.questions[0].materialList?.[0].fileKey).toBe(f.first.id);
  expect((await manifest(sharedAuthorAssets(session.token, submitted.body.id, randomUUID()))).items.map(a => a.id)).toEqual([f.first.id]);
  const viewerHeaders = { cookie: `${VIEWER_COOKIE}=${session.token}` };
  expect((await viewerGet(new Request(origin + "/api/v1/viewer/author-assets?submissionId=" + submitted.body.id, { headers: viewerHeaders }))).status).toBe(200);
  expect((await viewerGet(new Request(origin + "/api/v1/viewer/author-assets/" + f.first.id + "/download?submissionId=" + submitted.body.id, { headers: viewerHeaders }))).status).toBe(200);
  await expect(sharedAuthorAssets(session.token, submitted.body.id, randomUUID(), f.second.id)).rejects.toMatchObject({ status: 404 });
  await expect(sharedAuthorAssets(session.token, randomUUID(), randomUUID(), f.first.id)).rejects.toMatchObject({ status: 404 });
  expect(Buffer.from(await ((await sharedAuthorAssets(session.token, submitted.body.id, randomUUID(), f.first.id)) as Response).arrayBuffer())).toEqual(pdf);
  await changeShare(ctx, share.id, { version: share.version }, "revoke", randomUUID());
  await expect(sharedAuthorAssets(session.token, submitted.body.id, randomUUID(), f.first.id)).rejects.toMatchObject({ status: 401 });
});
test("public natural expiry is checked again after reading bytes", async () => {
  const f = await fixture(), pub = await publish(f.form.id);
  await db.publication.update({ where: { id: pub.id }, data: { expiresAt: new Date(Date.now() + 250) } });
  const read = privateFiles.read.bind(privateFiles);
  vi.spyOn(privateFiles, "read").mockImplementationOnce(async key => { const result = await read(key); await new Promise(resolve => setTimeout(resolve, 300)); return result; });
  await expect(publicAuthorAssets(pub.token, randomUUID(), f.first.id)).rejects.toMatchObject({ status: 410 });
});
