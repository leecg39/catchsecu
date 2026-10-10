import sharp from "sharp";
import { choiceTypes, matrixTypes, questionTypes } from "@/contracts/questions";
import { submissionInput } from "@/contracts/domains";
import { initAuthorAssetUpload, putAuthorAssetContent, completeAuthorAssetUpload } from "@/server/author-asset-uploads";
import { importSystemAuthorAsset } from "@/server/author-asset-system-import";
import { memberAuthorAssets, publicAuthorAssets } from "@/server/author-asset-reads";
import type { AuthorAssetManifest } from "@/contracts/author-assets";
import { privateFiles } from "@/server/file-storage";
import { publicForm, submitForm } from "@/server/submissions";
import { activePublicForm } from "../helpers/public-form";
import { getSubmission, correctSubmission } from "@/server/submission-management";
import { createShare, changeShare } from "@/server/sharing";
import { startViewerChallenge, verifyViewerChallenge, sharedAuthorAssets, listSharedSubmissions } from "@/server/viewer";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { encrypt, decrypt } from "@/server/crypto";
import { createForm, readForm, updateForm, publishForm, reviseForm, copyForm, purgeForm, versionInclude } from "@/server/forms";
import { createTemplate, updateTemplate, deleteTemplate, useTemplate } from "@/server/templates";
import { requestApproval } from "@/server/approvals";
import { fileQuotaUsage } from "@/server/file-quota";
import { withAuthorAssetReferences } from "@/server/author-asset-references";
import { formContentSchema } from "@/contracts/domains";
import type { FormContent } from "@/contracts/forms";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test database required");
let ctx: Context, serviceId: string, cookie: string;
type Purpose = "QUESTION_MATERIAL" | "OPTION_IMAGE" | "QUESTION_IMAGE" | "FORM_CONTENT_IMAGE" | "PAGE_CONTENT_IMAGE" | "END_PAGE_CONTENT_IMAGE" | "PRIVATE_PAGE_CONTENT_IMAGE";
type Scope = { tenantId: string; serviceId: string; memberId: string };
const ownScope = (): Scope => ({ tenantId: ctx.tenantId, serviceId, memberId: ctx.member.id });
async function dropAuditFailure() {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS qa_question_image_audit ON "AuditEvent"');
  await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS qa_question_image_audit()');
}
beforeEach(async () => {
  await dropAuditFailure();
  await clearStored();
  await db.$executeRawUnsafe('TRUNCATE "Company", "User", "AuthorAssetBlob", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "Author reference QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const email = randomUUID() + "@references.example.test", password = "Author-reference-QA!123";
  const authReq = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(authReq("sign-up/email", { email, password, name: "QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  await db.membership.create({ data: { tenantId: company.id, userId: user.id, role: "owner" } });
  const login = await auth.handler(authReq("sign-in/email", { email, password })); expect(login.status).toBe(200);
  cookie = login.headers.getSetCookie().map(item => item.split(";", 1)[0]).join("; ");
  ctx = await requireContext(new Headers({ cookie }), "form.write");
});
afterAll(async () => { await dropAuditFailure(); await clearStored(); await db.$disconnect(); });
async function asset(purpose: Purpose = "QUESTION_IMAGE", scope: Scope | null = ownScope()) {
  return db.$transaction(async tx => {
    // Database graph fixture only. No real storage, validation or ClamAV success is claimed.
    const blob = await tx.authorAssetBlob.create({ data: { storageKey: randomUUID(), mime: purpose !== "QUESTION_MATERIAL" ? "image/png" : "application/pdf", size: 4, sha256: "a".repeat(64) } });
    await tx.authorAssetBlob.update({ where: { id: blob.id }, data: { status: "uploaded", version: { increment: 1 } } });
    await tx.authorAssetBlob.update({ where: { id: blob.id }, data: { status: "ready", scanStatus: "clean", scanEngine: "DB fixture, not ClamAV evidence", scannedAt: new Date(), expiresAt: null, version: { increment: 1 } } });
    return tx.authorAsset.create({ data: { blobId: blob.id, ownerKind: scope ? "company" : "system", tenantId: scope?.tenantId, serviceId: scope?.serviceId,
      createdById: scope?.memberId, purpose, nameCipher: encrypt(purpose !== "QUESTION_MATERIAL" ? "보기.png" : "자료.pdf"), size: 4, status: "ready" } });
  });
}
function content(image?: string): FormContent {
  return formContentSchema.parse({ body: "Question image QA", questions: [
    { id: randomUUID(), type: "단문형 답변", label: "Visible", required: false, ...(image ? { questionImageKey: image } : {}) },
    { id: randomUUID(), type: "단문형 답변", label: "Other", required: false },
  ], verify: false, consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100 });
}
const create = (value: FormContent, target = serviceId) => db.$transaction(tx => createForm(ctx, { serviceId: target, title: "작성 자료 QA", content: value }, randomUUID(), tx));
const stored = (formId: string, status: "draft" | "published" = "draft") => db.formVersion.findFirstOrThrow({ where: { formId, status }, include: versionInclude, orderBy: { number: "desc" } });
const current = async (id: string) => (await readForm(ctx, id)).content!;
const refs = (assetId?: string) => db.authorAssetReference.findMany({ where: assetId ? { assetId } : {}, orderBy: { id: "asc" } });
const publish = (id: string, version = 1) => db.$transaction(tx => publishForm(tx, ctx, id, { version }, randomUUID()));
const template = (value: FormContent) => db.$transaction(tx => createTemplate(ctx, { serviceId, title: "작성 자료 양식", category: "QA", content: value }, randomUUID(), tx));
async function auditFailure() {
  await db.$executeRawUnsafe("CREATE FUNCTION qa_question_image_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'author_asset.%' THEN RAISE EXCEPTION 'injected question image audit'; END IF; RETURN NEW; END $$");
  await db.$executeRawUnsafe('CREATE TRIGGER qa_question_image_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION qa_question_image_audit()');
}


async function clearStored() {
  for (const row of await db.authorAssetBlob.findMany({ select: { storageKey: true } })) await privateFiles.remove(row.storageKey);
}
async function uploadedImage(purpose: Exclude<Purpose, "QUESTION_MATERIAL"> = "QUESTION_IMAGE", background = "#3280aa") {
  const bytes = await sharp({ create: { width: 8, height: 5, channels: 3, background } }).png().toBuffer();
  const item = (await initAuthorAssetUpload(ctx, { serviceId, purpose, name: purpose.toLowerCase() + ".png", mime: "image/png", size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") }, randomUUID(), randomUUID())).body;
  await putAuthorAssetContent(ctx, item.id, new Request(origin + "/upload", { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array(bytes) }), randomUUID());
  return { item: await completeAuthorAssetUpload(ctx, item.id, randomUUID()), bytes };
}
async function manifest(value: Promise<AuthorAssetManifest | Response>) {
  const result = await value; expect(result).not.toBeInstanceOf(Response); return result as AuthorAssetManifest;
}
test("all sixteen question types persist a single question image with exact pins and no answer/schema narrowing", async () => {
  const image = await asset(), value = content();
  value.questions = questionTypes.map(type => ({ id: randomUUID(), type, label: type, required: false, questionImageKey: image.id,
    ...(choiceTypes.includes(type) ? { options: ["yes", "no"] } : {}),
    ...(matrixTypes.includes(type) ? { rows: [{ id: randomUUID(), label: "Row" }] } : {}) }));
  const form = await create(value), dto = await current(form.id), row = await stored(form.id);
  expect(dto.questions).toHaveLength(16);
  expect(dto.questions.map(q => q.questionImageKey)).toEqual(Array(16).fill(image.id));
  expect(row.questions.map(q => q.questionImageKey)).toEqual(Array(16).fill(image.id));
  expect(await refs()).toHaveLength(16);
  expect((await refs()).every(r => r.slot === "question" && r.orderNumber === null && r.optionKey === null)).toBe(true);
  expect(await db.$transaction(tx => fileQuotaUsage(tx, ctx.tenantId))).toMatchObject({ usedBytes: 4 });
  await publish(form.id);
});
test("legacy absent image stays omitted, title-only save preserves physical rows and pins", async () => {
  const plain = await create(content());
  expect((await current(plain.id)).questions.every(q => !("questionImageKey" in q))).toBe(true);
  const image = await asset(), form = await create(content(image.id)), before = await stored(form.id), oldPins = await refs();
  await updateForm(ctx, form.id, { version: 1, title: "Title only" }, randomUUID());
  expect((await stored(form.id)).questions).toEqual(before.questions); expect(await refs()).toEqual(oldPins);
});
test("current omission inherits, null removes, stale history omission cannot resurrect, and new logical IDs do not inherit", async () => {
  const image = await asset(), form = await create(content(image.id)), value = await current(form.id);
  delete value.questions[0].questionImageKey;
  await updateForm(ctx, form.id, { version: 1, content: value }, randomUUID());
  expect((await current(form.id)).questions[0].questionImageKey).toBe(image.id);
  value.questions[0].questionImageKey = null;
  await updateForm(ctx, form.id, { version: 2, content: value }, randomUUID());
  delete value.questions[0].questionImageKey;
  await updateForm(ctx, form.id, { version: 3, content: value }, randomUUID());
  expect((await current(form.id)).questions[0]).not.toHaveProperty("questionImageKey");
  value.questions[0].questionImageKey = image.id;
  await updateForm(ctx, form.id, { version: 4, content: value }, randomUUID());
  value.questions[0] = { ...value.questions[0], id: randomUUID() }; delete value.questions[0].questionImageKey;
  await updateForm(ctx, form.id, { version: 5, content: value }, randomUUID());
  expect((await current(form.id)).questions[0]).not.toHaveProperty("questionImageKey"); expect(await refs()).toHaveLength(0);
});
test("image survives valid question type conversion; deleting its question releases pins before restrictive FK deletion", async () => {
  const image = await asset(), form = await create(content(image.id)), value = await current(form.id);
  value.questions[0].type = "날짜";
  await updateForm(ctx, form.id, { version: 1, content: value }, randomUUID());
  expect((await current(form.id)).questions[0].questionImageKey).toBe(image.id);
  value.questions = value.questions.slice(1);
  await updateForm(ctx, form.id, { version: 2, content: value }, randomUUID());
  expect(await refs()).toHaveLength(0);
  expect((await db.authorAsset.findUniqueOrThrow({ where: { id: image.id } })).expiresAt!.getTime()).toBeGreaterThan(Date.now());
});
test("typed-server wrong purpose, foreign scope, expiry and unknown UUID fail atomically", async () => {
  const other = await db.service.create({ data: { tenantId: ctx.tenantId, name: "Other", externalName: "Other" } });
  const wrong = await asset("OPTION_IMAGE"), material = await asset("QUESTION_MATERIAL");
  const foreign = await asset("QUESTION_IMAGE", { ...ownScope(), serviceId: other.id }), expired = await asset();
  await db.authorAsset.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1), version: { increment: 1 } } });
  for (const [id, status] of [[wrong.id, 422], [material.id, 422], [foreign.id, 404], [expired.id, 410], [randomUUID(), 404]] as const)
    await expect(create(content(id))).rejects.toMatchObject({ status });
  const invalid = content(); invalid.questions[0].questionImageKey = "https://example.test/foreign.png";
  await expect(create(invalid)).rejects.toThrow();
  expect(await db.form.count()).toBe(0); expect(await refs()).toHaveLength(0);
});
test("replacement 409 and audit failure roll back image references, quota, physical question and expiry", async () => {
  const first = await asset(), second = await asset(), form = await create(content(first.id));
  const prior = await stored(form.id), oldPins = await refs(), oldAssets = await db.authorAsset.findMany({ orderBy: { id: "asc" } });
  const next = await current(form.id); next.questions[0].questionImageKey = second.id;
  await expect(updateForm(ctx, form.id, { version: 99, content: next }, randomUUID())).rejects.toMatchObject({ status: 409 });
  await auditFailure();
  try { await expect(updateForm(ctx, form.id, { version: 1, content: next }, randomUUID())).rejects.toThrow(/injected question image audit/); }
  finally { await dropAuditFailure(); }
  expect(await refs()).toEqual(oldPins); expect(await stored(form.id)).toEqual(prior);
  expect(await db.authorAsset.findMany({ orderBy: { id: "asc" } })).toEqual(oldAssets);
});
test("revise reuses assets with independent immutable published pins; draft removal cannot change old content/hash", async () => {
  const image = await asset(), form = await create(content(image.id)); await publish(form.id);
  const old = await stored(form.id, "published"), oldPins = await refs();
  const version = (await db.form.findUniqueOrThrow({ where: { id: form.id } })).version;
  const revised = await db.$transaction(tx => reviseForm(tx, ctx, form.id, version, randomUUID()));
  const next = await current(form.id); next.questions[0].questionImageKey = null;
  await updateForm(ctx, form.id, { version: revised.version, content: next }, randomUUID());
  expect(await stored(form.id, "published")).toEqual(old); expect(await refs()).toEqual(oldPins);
  expect(await db.authorAsset.count()).toBe(1); expect((await db.authorAsset.findUniqueOrThrow({ where: { id: image.id } })).expiresAt).toBeNull();
});
test("approval snapshot retains independent question pin after draft removal and cannot mutate its image", async () => {
  const image = await asset(), form = await create(content(image.id));
  await db.securityPolicy.update({ where: { tenantId: ctx.tenantId }, data: { requireApproval: true, approvalRoles: ["owner"] } });
  const a = await db.$transaction(tx => requestApproval(tx, ctx, form.id, { version: 1, message: "Review", reference: "QA" }, randomUUID()));
  const old = await db.approvalRequest.findUniqueOrThrow({ where: { id: a.id } }), next = await current(form.id);
  next.questions[0].questionImageKey = null;
  await updateForm(ctx, form.id, { version: 2, content: next }, randomUUID());
  expect(await refs()).toEqual([expect.objectContaining({ approvalId: a.id, slot: "question", questionId: null })]);
  expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: a.id } })).snapshot).toEqual(old.snapshot);
  await expect(db.authorAssetReference.deleteMany({ where: { approvalId: a.id } })).rejects.toThrow();
});
test("explicit same-service copy remaps one distinct asset per source ID while sharing immutable bytes and charging once", async () => {
  const image = await asset(), value = content(image.id); value.questions[1].questionImageKey = image.id;
  const form = await create(value), copy = await db.$transaction(tx => copyForm(tx, ctx, form.id, undefined, randomUUID()));
  const key = copy.content!.questions[0].questionImageKey!;
  expect(key).not.toBe(image.id); expect(copy.content!.questions[1].questionImageKey).toBe(key);
  expect(copy.content!.questions[0].id).not.toBe(value.questions[0].id);
  expect(await db.authorAsset.findUniqueOrThrow({ where: { id: key } })).toMatchObject({ blobId: image.blobId, serviceId, createdById: ctx.member.id, expiresAt: null });
  expect(await db.authorAsset.count()).toBe(2); expect(await db.authorAssetBlob.count()).toBe(1);
  expect(await db.$transaction(tx => fileQuotaUsage(tx, ctx.tenantId))).toMatchObject({ usedBytes: 8 });
});
test("template omission preserves its current key, cross-service use copies ownership, null/delete/purge release only their pins", async () => {
  const image = await asset(), saved = await template(content(image.id)), target = await db.service.create({ data: { tenantId: ctx.tenantId, name: "Target", externalName: "Target" } });
  const next = structuredClone(saved.content); delete next.questions[0].questionImageKey;
  const updated = await updateTemplate(ctx, saved.id, { version: 1, content: next }, randomUUID());
  expect(updated.content.questions[0].questionImageKey).toBe(image.id);
  const used = await db.$transaction(tx => useTemplate(ctx, saved.id, { serviceId: target.id, version: 2 }, randomUUID(), tx));
  const newKey = used.content!.questions[0].questionImageKey!;
  expect(await db.authorAsset.findUniqueOrThrow({ where: { id: newKey } })).toMatchObject({ serviceId: target.id, blobId: image.blobId });
  next.questions[0].questionImageKey = null;
  await updateTemplate(ctx, saved.id, { version: 2, content: next }, randomUUID());
  await deleteTemplate(ctx, saved.id, 3, randomUUID()); await purgeForm(ctx, used.id, used.version, randomUUID());
  expect(await refs()).toHaveLength(0); expect((await db.authorAsset.findMany()).every(a => a.expiresAt !== null)).toBe(true);
});
test("quarantined historical question pins survive editing but publishing or copying them is rejected", async () => {
  const image = await asset(), form = await create(content(image.id)), old = await refs();
  await db.authorAssetBlob.update({ where: { id: image.blobId }, data: { status: "quarantined", scanStatus: "infected", version: { increment: 1 } } });
  const next = await current(form.id); next.questions[0].label = "Label only";
  await updateForm(ctx, form.id, { version: 1, content: next }, randomUUID()); expect(await refs()).toEqual(old);
  await expect(publish(form.id, 2)).rejects.toMatchObject({ status: 409 });
  await expect(db.$transaction(tx => copyForm(tx, ctx, form.id, undefined, randomUUID()))).rejects.toMatchObject({ status: 409 });
});
test("current authority revocation blocks stale-context image changes and copies", async () => {
  const first = await asset(), second = await asset(), form = await create(content(first.id)), old = await refs();
  const backup = await db.user.create({ data: { name: "Backup", email: randomUUID() + "@example.test" } });
  await db.membership.create({ data: { tenantId: ctx.tenantId, userId: backup.id, role: "owner" } });
  const next = await current(form.id); next.questions[0].questionImageKey = second.id;
  await db.membership.update({ where: { id: ctx.member.id }, data: { role: "viewer" } });
  await expect(updateForm(ctx, form.id, { version: 1, content: next }, randomUUID())).rejects.toMatchObject({ status: 403 });
  await expect(db.$transaction(tx => copyForm(tx, ctx, form.id, undefined, randomUUID()))).rejects.toMatchObject({ status: 403 });
  expect(await refs()).toEqual(old); expect(await db.form.count()).toBe(1);
});
test("real PNG upload scans clean, downloads inline by current public scope, and old submission retains image and receipt bytes after revision/correction", async () => {
  const { item, bytes } = await uploadedImage(), value = content(item.id);
  value.consentRequired = true; value.consentPurpose = "Evidence preservation";
  const form = await create(value), pub = await publish(form.id);
  expect((await activePublicForm(pub.token)).content.questions[0].questionImageKey).toBe(item.id);
  const storedAsset = await db.authorAsset.findUniqueOrThrow({ where: { id: item.id }, include: { blob: true } });
  expect(storedAsset.blob.scanEngine).toMatch(/^ClamAV /);
  const download = await publicAuthorAssets(pub.token, randomUUID(), item.id) as Response;
  expect(download.headers.get("content-type")).toBe("image/png"); expect(download.headers.get("content-disposition")).toMatch(/^inline;/);
  expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
  const submitted = await submitForm(pub.token, submissionInput.parse({ answers: { [value.questions[0].id]: "Before" }, consent: true }), randomUUID(), randomUUID());
  const receipt = await db.consentReceipt.findFirstOrThrow({ where: { submissionId: submitted.body.id } });
  const row = await db.form.findUniqueOrThrow({ where: { id: form.id } });
  const revised = await db.$transaction(tx => reviseForm(tx, ctx, form.id, row.version, randomUUID()));
  const next = await current(form.id); next.questions[0].questionImageKey = null;
  await updateForm(ctx, form.id, { version: revised.version, content: next }, randomUUID());
  await correctSubmission(ctx, submitted.body.id, { version: 1, reason: "Correction", answers: { [value.questions[0].id]: "After" } }, randomUUID());
  expect((await getSubmission(ctx, submitted.body.id, randomUUID())).questions[0].questionImageKey).toBe(item.id);
  expect(await db.consentReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(receipt);
  const history = await memberAuthorAssets(ctx, { kind: "submission", id: submitted.body.id }, randomUUID(), item.id) as Response;
  expect(Buffer.from(await history.arrayBuffer())).toEqual(bytes);
  const latest = await db.form.findUniqueOrThrow({ where: { id: form.id } });
  expect((await manifest(memberAuthorAssets(ctx, { kind: "form", id: form.id, version: latest.version }, randomUUID()))).items).toHaveLength(0);
});
test("real system image ingestion binds null-scope template and use issues fresh company ownership", async () => {
  const bytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: "#ccbb11" } }).jpeg().toBuffer();
  const system = await importSystemAuthorAsset({ purpose: "QUESTION_IMAGE", name: "system.jpg", bytes });
  const value = content(system.id);
  const saved = await db.$transaction(async tx => {
    const t = await tx.formTemplate.create({ data: { title: "System question", category: "QA", licenseScope: "ACTIVE_SUBSCRIPTION", content: value } });
    await withAuthorAssetReferences(tx, { tenantId: null, serviceId: null, memberId: null }, { kind: "template", id: t.id }, value, randomUUID(), async () => undefined);
    return t;
  });
  const trialVersion = await db.billingPlanVersion.create({ data: { planId: "trial", number: Math.floor(Math.random() * 1000000000) + 100,
    cycle: "trial", priceKrw: 0, features: {} } }), trialStart = new Date(Date.now() - 1000);
  await db.billingSubscription.create({ data: { tenantId: ctx.tenantId, planId: "trial", planVersionId: trialVersion.id,
    status: "trialing", activationSource: "trial", priceKrw: 0, periodStart: trialStart,
    periodEnd: new Date(trialStart.getTime() + 7 * 86400000) } });
  const used = await db.$transaction(tx => useTemplate(ctx, saved.id, { serviceId, version: saved.version }, randomUUID(), tx));
  const key = used.content!.questions[0].questionImageKey!;
  expect(key).not.toBe(system.id);
  expect(await db.authorAsset.findUniqueOrThrow({ where: { id: key } })).toMatchObject({ tenantId: ctx.tenantId, serviceId, purpose: "QUESTION_IMAGE" });
  const response = await memberAuthorAssets(ctx, { kind: "form", id: used.id, version: used.version }, randomUUID(), key) as Response;
  expect(response.headers.get("content-type")).toBe("image/jpeg"); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
});
test("viewer projection and manifest expose only selected question image, and revocation blocks old URLs", async () => {
  const first = await uploadedImage(), second = await uploadedImage(), value = content(first.item.id); value.questions[1].questionImageKey = second.item.id;
  const form = await create(value), pub = await publish(form.id), submitted = await submitForm(pub.token, submissionInput.parse({ answers: {}, consent: false }), randomUUID(), randomUUID());
  const live = await db.form.findUniqueOrThrow({ where: { id: form.id } });
  const share = await db.$transaction(tx => createShare(ctx, { formId: form.id, formVersionId: live.publishedVersionId!, questionIds: [value.questions[0].id],
    email: "image-viewer@example.test", expiresAt: new Date(Date.now() + 86400000).toISOString() }, randomUUID(), tx));
  const invitation = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + share.id + ":invite:1" } })).payloadCipher);
  const challenge = await startViewerChallenge({ formCode: form.id, invitationCode: invitation.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)![1], email: "image-viewer@example.test", consent: true }, randomUUID());
  const mail = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: "mail:share:" + share.id + ":challenge:" + challenge.id } })).payloadCipher);
  const session = await verifyViewerChallenge(challenge.id, mail.text.match(/인증코드: (\d{6})/)![1], challenge.client, randomUUID());
  const page = await listSharedSubmissions(session.token, 1, 20, randomUUID());
  expect(page.viewer.questions).toHaveLength(1); expect(page.viewer.questions[0].questionImageKey).toBe(first.item.id);
  expect((await manifest(sharedAuthorAssets(session.token, submitted.body.id, randomUUID()))).items.map(a => a.id)).toEqual([first.item.id]);
  await expect(sharedAuthorAssets(session.token, submitted.body.id, randomUUID(), second.item.id)).rejects.toMatchObject({ status: 404 });
  const response = await sharedAuthorAssets(session.token, submitted.body.id, randomUUID(), first.item.id) as Response;
  expect(Buffer.from(await response.arrayBuffer())).toEqual(first.bytes);
  await changeShare(ctx, share.id, { version: share.version }, "revoke", randomUUID());
  await expect(sharedAuthorAssets(session.token, submitted.body.id, randomUUID(), first.item.id)).rejects.toMatchObject({ status: 401 });
});

test("completion, closed, active and viewer surfaces expose only their exact rich-content assets", async () => {
  const root = await uploadedImage("FORM_CONTENT_IMAGE", "#a11111"), pageImage = await uploadedImage("PAGE_CONTENT_IMAGE", "#11a111");
  const completion = await uploadedImage("END_PAGE_CONTENT_IMAGE", "#1111a1"), closed = await uploadedImage("PRIVATE_PAGE_CONTENT_IMAGE", "#a1a111");
  const selected = await uploadedImage("QUESTION_IMAGE", "#11a1a1"), unselected = await uploadedImage("QUESTION_IMAGE", "#a111a1");
  const firstPage = randomUUID(), selectedPage = randomUUID();
  const rich = (text: string, assetId: string) => ({ schemaVersion: 1 as const, blocks: [
    { type: "paragraph" as const, children: [{ type: "text" as const, text }] },
    { type: "image" as const, nodeId: randomUUID(), assetId, alt: text, alignment: "center" as const, width: { unit: "percent" as const, value: 75 } },
  ] });
  const selectedQuestion = randomUUID(), otherQuestion = randomUUID();
  const value = formContentSchema.parse({ body: "Root notice\n", bodyRich: rich("Root notice", root.item.id),
    sections: [
      { id: firstPage, title: "", body: "", defaultDestination: { kind: "page", pageId: selectedPage }, allowBack: false },
      { id: selectedPage, title: "Selected page", body: "Page notice\n", bodyRich: rich("Page notice", pageImage.item.id), defaultDestination: { kind: "consent" }, allowBack: true },
    ],
    completionPage: { mode: "custom", body: "Completion notice\n", bodyRich: rich("Completion notice", completion.item.id) },
    closedPage: { mode: "custom", body: "Closed notice\n", bodyRich: rich("Closed notice", closed.item.id) },
    questions: [
      { id: selectedQuestion, pageId: selectedPage, type: "단문형 답변", label: "Selected", required: false, questionImageKey: selected.item.id },
      { id: otherQuestion, pageId: firstPage, type: "단문형 답변", label: "Other", required: false, questionImageKey: unselected.item.id },
    ], verify: false, consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 1, showSubmitNotice: true });
  const form = await create(value), pub = await publish(form.id), active = await activePublicForm(pub.token);
  expect(active.content).not.toHaveProperty("completionPage"); expect(active.content).not.toHaveProperty("closedPage");
  expect((await manifest(publicAuthorAssets(pub.token, randomUUID()))).items.map(item => item.id).sort())
    .toEqual([root.item.id, pageImage.item.id, selected.item.id, unselected.item.id].sort());
  await expect(publicAuthorAssets(pub.token, randomUUID(), completion.item.id)).rejects.toMatchObject({ status: 404 });
  await expect(publicAuthorAssets(pub.token, randomUUID(), closed.item.id, { surface: "closed" })).rejects.toMatchObject({ status: 410 });

  const receipt = await submitForm(pub.token, submissionInput.parse({ answers: {}, consent: false }), randomUUID(), randomUUID());
  expect(receipt.body.completionPage).toMatchObject({ mode: "custom", body: "Completion notice\n" });
  expect(receipt.body.completionProof).toBeTruthy();
  const completionScope = { surface: "completion" as const, proof: receipt.body.completionProof! };
  expect((await manifest(publicAuthorAssets(pub.token, randomUUID(), undefined, completionScope))).items.map(item => item.id)).toEqual([completion.item.id]);
  expect(Buffer.from(await ((await publicAuthorAssets(pub.token, randomUUID(), completion.item.id, completionScope)) as Response).arrayBuffer())).toEqual(completion.bytes);
  const closedView = await publicForm(pub.token); expect(closedView.closed).toBe(true);
  if (!closedView.closed) throw new Error("Expected closed response-limit fixture");
  expect(closedView.closedPage).toMatchObject({ mode: "custom", body: "Closed notice\n" });
  expect(JSON.stringify(closedView)).not.toContain("Root notice"); expect(JSON.stringify(closedView)).not.toContain("Completion notice");
  expect((await manifest(publicAuthorAssets(pub.token, randomUUID(), undefined, { surface: "closed" }))).items.map(item => item.id)).toEqual([closed.item.id]);
  expect(Buffer.from(await ((await publicAuthorAssets(pub.token, randomUUID(), closed.item.id, { surface: "closed" })) as Response).arrayBuffer())).toEqual(closed.bytes);
  await expect(publicAuthorAssets(pub.token, randomUUID(), root.item.id)).rejects.toMatchObject({ status: 410 });
  await expect(publicAuthorAssets(pub.token, randomUUID(), completion.item.id, { surface: "completion", proof: "invalid" })).rejects.toMatchObject({ status: 404 });

  const live = await db.form.findUniqueOrThrow({ where: { id: form.id } });
  async function viewerSession(email: string, shareFormBody: boolean) {
    const share = await db.$transaction(tx => createShare(ctx, { formId: form.id, formVersionId: live.publishedVersionId!, questionIds: [selectedQuestion],
      email, shareFormBody, expiresAt: new Date(Date.now() + 86400000).toISOString() }, randomUUID(), tx));
    const invitation = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: `mail:share:${share.id}:invite:1` } })).payloadCipher);
    const challenge = await startViewerChallenge({ formCode: form.id, invitationCode: invitation.text.match(/열람자 인증코드: ([A-Za-z0-9_-]{43})/)![1], email, consent: true }, randomUUID());
    const mail = decrypt<{ text: string }>((await db.job.findUniqueOrThrow({ where: { dedupeKey: `mail:share:${share.id}:challenge:${challenge.id}` } })).payloadCipher);
    return verifyViewerChallenge(challenge.id, mail.text.match(/인증코드: (\d{6})/)![1], challenge.client, randomUUID());
  }
  const restricted = await viewerSession("notice-viewer@example.test", false), restrictedPage = await listSharedSubmissions(restricted.token, 1, 20, randomUUID());
  expect(restrictedPage.viewer.formBody).toBeUndefined(); expect(restrictedPage.viewer.pages).toEqual([expect.objectContaining({ id: selectedPage, title: "Selected page", body: "Page notice\n" })]);
  expect((await manifest(sharedAuthorAssets(restricted.token, receipt.body.id, randomUUID()))).items.map(item => item.id).sort())
    .toEqual([pageImage.item.id, selected.item.id].sort());
  for (const denied of [root.item.id, unselected.item.id, completion.item.id, closed.item.id])
    await expect(sharedAuthorAssets(restricted.token, receipt.body.id, randomUUID(), denied)).rejects.toMatchObject({ status: 404 });
  const withRoot = await viewerSession("notice-body-viewer@example.test", true), bodyPage = await listSharedSubmissions(withRoot.token, 1, 20, randomUUID());
  expect(bodyPage.viewer.formBody).toMatchObject({ body: "Root notice\n" });
  expect((await manifest(sharedAuthorAssets(withRoot.token, receipt.body.id, randomUUID()))).items.map(item => item.id).sort())
    .toEqual([root.item.id, pageImage.item.id, selected.item.id].sort());

  await db.publication.update({ where: { id: pub.id }, data: { responseCount: 0 } });
  await db.form.update({ where: { id: form.id }, data: { status: "paused" } });
  const paused = await publicForm(pub.token); expect(paused.closed).toBe(true);
  expect(Buffer.from(await ((await publicAuthorAssets(pub.token, randomUUID(), closed.item.id, { surface: "closed" })) as Response).arrayBuffer())).toEqual(closed.bytes);
  await expect(publicAuthorAssets(pub.token, randomUUID(), root.item.id)).rejects.toMatchObject({ status: 410 });
  await db.form.update({ where: { id: form.id }, data: { status: "published" } });
  await db.publication.update({ where: { id: pub.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  const expired = await publicForm(pub.token); expect(expired.closed).toBe(true);
  expect(Buffer.from(await ((await publicAuthorAssets(pub.token, randomUUID(), closed.item.id, { surface: "closed" })) as Response).arrayBuffer())).toEqual(closed.bytes);
  await expect(publicAuthorAssets(pub.token, randomUUID(), completion.item.id, completionScope)).rejects.toMatchObject({ status: 410 });

  await db.publication.update({ where: { id: pub.id }, data: { expiresAt: new Date(Date.now() + 250) } });
  const read = privateFiles.read.bind(privateFiles), spy = vi.spyOn(privateFiles, "read").mockImplementationOnce(async key => {
    const result = await read(key); await new Promise(resolve => setTimeout(resolve, 300)); return result;
  });
  try { await expect(publicAuthorAssets(pub.token, randomUUID(), completion.item.id, completionScope)).rejects.toMatchObject({ status: 410 }); }
  finally { spy.mockRestore(); }
  await db.publication.update({ where: { id: pub.id }, data: { expiresAt: null } });
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const raceSpy = vi.spyOn(privateFiles, "read").mockImplementationOnce(async key => { const result = await read(key); entered(); await gate; return result; });
  const reading = publicAuthorAssets(pub.token, randomUUID(), completion.item.id, completionScope) as Promise<Response>;
  await ready; let revoked = false;
  const revoking = db.publication.update({ where: { id: pub.id }, data: { status: "revoked" } }).then(() => { revoked = true; });
  await new Promise(resolve => setTimeout(resolve, 80)); expect(revoked).toBe(false);
  release(); expect(Buffer.from(await (await reading).arrayBuffer())).toEqual(completion.bytes); await revoking; raceSpy.mockRestore();
  await expect(publicForm(pub.token)).rejects.toMatchObject({ status: 410 });
  await expect(publicAuthorAssets(pub.token, randomUUID(), closed.item.id, { surface: "closed" })).rejects.toMatchObject({ status: 410 });
  await expect(publicAuthorAssets(pub.token, randomUUID(), completion.item.id, completionScope)).rejects.toMatchObject({ status: 410 });
});
