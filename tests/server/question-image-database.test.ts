import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { db, type Transaction } from "@/server/db";
import { env } from "@/server/env";
import { encrypt } from "@/server/crypto";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test database required");
type Scope = { tenantId: string; serviceId: string; memberId: string; userId: string };
type Parent = Scope & { formId: string; versionId: string; questionId: string; questionKey: string; optionId: string; optionKey: string };
type Asset = { id: string; blobId: string; size: number; purpose: "QUESTION_MATERIAL" | "OPTION_IMAGE" | "QUESTION_IMAGE" };
let scope: Scope;
beforeEach(async () => {
  // These tests deliberately reach real tables before generated new-model delegates exist.
  // On migration123 this is a missing-field/purpose RED, not a helper import failure.
  await db.$executeRawUnsafe('TRUNCATE "Company", "User", "AuthorAssetBlob", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  scope = await company();
});
afterAll(() => db.$disconnect());
async function company(): Promise<Scope> {
  const c = await db.company.create({ data: { name: "Author asset DB QA", publicName: "QA", policy: { create: {} }, services: { create: { name: "QA", externalName: "QA" } } }, include: { services: true } });
  const u = await db.user.create({ data: { name: "QA", email: randomUUID() + "@example.test" } });
  const m = await db.membership.create({ data: { tenantId: c.id, userId: u.id, role: "owner" } });
  return { tenantId: c.id, serviceId: c.services[0].id, memberId: m.id, userId: u.id };
}
async function parent(s = scope): Promise<Parent> {
  return db.$transaction(async tx => {
    const f = await tx.form.create({ data: { tenantId: s.tenantId, serviceId: s.serviceId, ownerId: s.userId, title: "Asset DB QA" } });
    const v = await tx.formVersion.create({ data: { tenantId: s.tenantId, formId: f.id, number: 1, title: f.title } });
    const q = await tx.question.create({ data: { tenantId: s.tenantId, formVersionId: v.id, stableKey: randomUUID(), type: "객관식 답변", label: "Choice", required: false, order: 0 } });
    const o = await tx.questionOption.create({ data: { questionId: q.id, value: "one", stableKey: randomUUID(), label: "One", order: 0 } });
    return { ...s, formId: f.id, versionId: v.id, questionId: q.id, questionKey: q.stableKey, optionId: o.id, optionKey: o.stableKey! };
  });
}
async function readyBlob(tx: Transaction, purpose: Asset["purpose"] = "QUESTION_IMAGE") {
  const id = randomUUID(), storageKey = randomUUID(), mime = purpose !== "QUESTION_MATERIAL" ? "image/png" : "application/pdf";
  // Explicit database fixture evidence only: no storage write or real scan is claimed here.
  await tx.$executeRaw`INSERT INTO "AuthorAssetBlob"(id,"storageKey",mime,size,sha256,"updatedAt") VALUES(${id},${storageKey},${mime},4,${"a".repeat(64)},now())`;
  await tx.$executeRaw`UPDATE "AuthorAssetBlob" SET status='uploaded',version=version+1 WHERE id=${id}`;
  await tx.$executeRaw`UPDATE "AuthorAssetBlob" SET status='ready',"scanStatus"='clean',"scanEngine"='DB fixture, not ClamAV evidence',"scannedAt"=now(),"expiresAt"=NULL,version=version+1 WHERE id=${id}`;
  return id;
}
async function readyAsset(tx: Transaction, s: Scope | null = scope, purpose: Asset["purpose"] = "QUESTION_IMAGE", existingBlob?: string): Promise<Asset> {
  const blobId = existingBlob ?? await readyBlob(tx, purpose), id = randomUUID(), ownerKind = s ? "company" : "system";
  await tx.$executeRaw`INSERT INTO "AuthorAsset"(id,"blobId","ownerKind","tenantId","serviceId","createdById",purpose,"nameCipher",size,status,"updatedAt")
    VALUES(${id},${blobId},${ownerKind},${s?.tenantId ?? null},${s?.serviceId ?? null},${s?.memberId ?? null},${purpose},${encrypt("QA asset")},4,'ready',now())`;
  return { id, blobId, size: 4, purpose };
}
async function pin(tx: Transaction, p: Parent, a: Asset) {
  await tx.$executeRaw`INSERT INTO "AuthorAssetReference"(id,"assetId","tenantId","serviceId","formVersionId","questionId","questionKey",slot)
    VALUES(${randomUUID()},${a.id},${p.tenantId},${p.serviceId},${p.versionId},${p.questionId},${p.questionKey},'question')`;
}
async function attach(tx: Transaction, p: Parent, a: Asset, pinsFirst = false) {
  if (pinsFirst) await pin(tx, p, a);
  await tx.$executeRaw`UPDATE "Question" SET "questionImageKey"=${a.id} WHERE id=${p.questionId}`;
  await tx.$executeRaw`UPDATE "AuthorAsset" SET "expiresAt"=NULL,version=version+1 WHERE id=${a.id}`;
  if (!pinsFirst) await pin(tx, p, a);
}
async function detach(tx: Transaction, p: Parent, a: Asset) {
  await tx.$executeRaw`DELETE FROM "AuthorAssetReference" WHERE "formVersionId"=${p.versionId}`;
  await tx.$executeRaw`UPDATE "Question" SET "questionImageKey"=NULL WHERE id=${p.questionId}`;
  await tx.$executeRaw`UPDATE "AuthorAsset" SET "expiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)+interval '1 hour',version=version+1 WHERE id=${a.id}`;
}

test("legacy question image is NULL, while a new image reservation retains the millisecond one-hour default", async () => {
  const p = await parent();
  expect(await db.$queryRaw`SELECT "questionImageKey" FROM "Question" WHERE id=${p.questionId}`).toEqual([{ questionImageKey: null }]);
  const a = await db.$transaction(tx => readyAsset(tx));
  const row = await db.authorAsset.findUniqueOrThrow({ where: { id: a.id } });
  expect(row.expiresAt!.getTime() - Date.now()).toBeGreaterThan(3_500_000);
  expect(row.expiresAt!.getTime() - Date.now()).toBeLessThanOrEqual(3_600_000);
});
test("question key and exact physical/logical pin commit in either order and detach retains grace", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx));
  await db.$transaction(tx => attach(tx, p, a));
  await db.$transaction(tx => detach(tx, p, a));
  await db.$transaction(tx => attach(tx, p, a, true));
  expect(await db.authorAssetReference.findMany()).toEqual([expect.objectContaining({ assetId: a.id, slot: "question", questionId: p.questionId, questionKey: p.questionKey, optionKey: null, orderNumber: null })]);
  expect((await db.authorAsset.findUniqueOrThrow({ where: { id: a.id } })).expiresAt).toBeNull();
});
test("missing pins, missing content and mismatched physical question rollback", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx)), other = await parent();
  await expect(db.$executeRaw`UPDATE "Question" SET "questionImageKey"=${a.id} WHERE id=${p.questionId}`).rejects.toThrow();
  await expect(db.$transaction(tx => pin(tx, p, a))).rejects.toThrow();
  await expect(db.$transaction(async tx => {
    await attach(tx, p, a);
    await tx.authorAssetReference.updateMany({ where: { assetId: a.id }, data: { questionId: other.questionId } });
  })).rejects.toThrow();
  expect(await db.authorAssetReference.count()).toBe(0);
  expect((await db.question.findUniqueOrThrow({ where: { id: p.questionId } })).questionImageKey).toBeNull();
});
test("one question slot cannot have a second pin or order/option metadata", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx));
  await db.$transaction(tx => attach(tx, p, a));
  await expect(db.$transaction(tx => pin(tx, p, a))).rejects.toThrow();
  for (const data of [{ orderNumber: 0 }, { optionKey: p.optionKey }])
    await expect(db.authorAssetReference.updateMany({ where: { assetId: a.id }, data })).rejects.toThrow();
  expect(await db.authorAssetReference.count()).toBe(1);
});
test("question slot rejects material/option purpose and cross-service/cross-tenant owners", async () => {
  const p = await parent(), foreign = await company();
  const service = await db.service.create({ data: { tenantId: scope.tenantId, name: "Other", externalName: "Other" } });
  const wrong = [
    await db.$transaction(tx => readyAsset(tx, scope, "QUESTION_MATERIAL")),
    await db.$transaction(tx => readyAsset(tx, scope, "OPTION_IMAGE")),
    await db.$transaction(tx => readyAsset(tx, { ...scope, serviceId: service.id })),
    await db.$transaction(tx => readyAsset(tx, foreign)),
    await db.$transaction(tx => readyAsset(tx, null)),
  ];
  for (const a of wrong) await expect(db.$transaction(tx => attach(tx, p, a))).rejects.toThrow();
  expect(await db.authorAssetReference.count()).toBe(0);
});
test("question image SQL rejects non-image MIME and image size above 1MiB", async () => {
  const pdfBlob = await db.$transaction(tx => readyBlob(tx, "QUESTION_MATERIAL"));
  await expect(db.$transaction(tx => readyAsset(tx, scope, "QUESTION_IMAGE", pdfBlob))).rejects.toThrow(/purpose mismatch/);
  const id = randomUUID();
  await db.$executeRaw`INSERT INTO "AuthorAssetBlob"(id,"storageKey",mime,size,sha256,"updatedAt")
    VALUES(${id},${randomUUID()},'image/png',1048577,${"a".repeat(64)},now())`;
  await expect(db.$executeRaw`INSERT INTO "AuthorAsset"(id,"blobId","tenantId","serviceId","createdById",purpose,"nameCipher",size,"updatedAt")
    VALUES(${randomUUID()},${id},${scope.tenantId},${scope.serviceId},${scope.memberId},'QUESTION_IMAGE',${encrypt("large.png")},1048577,now())`).rejects.toThrow();
});
test("unscanned and expired image assets cannot become attached", async () => {
  const p = await parent(), b = await db.authorAssetBlob.create({ data: { storageKey: randomUUID(), mime: "image/png", size: 4, sha256: "a".repeat(64) } });
  const pending = await db.authorAsset.create({ data: { blobId: b.id, tenantId: scope.tenantId, serviceId: scope.serviceId, createdById: scope.memberId, purpose: "QUESTION_IMAGE", nameCipher: encrypt("pending.png"), size: 4 } });
  await expect(db.$transaction(tx => attach(tx, p, { ...pending, purpose: "QUESTION_IMAGE" }))).rejects.toThrow();
  const a = await db.$transaction(tx => readyAsset(tx));
  await db.authorAsset.update({ where: { id: a.id }, data: { expiresAt: new Date(Date.now() - 1), version: { increment: 1 } } });
  await expect(db.$transaction(tx => attach(tx, p, a))).rejects.toThrow();
});
test("published questions and pins are immutable and a pinned question image cannot enter deletion", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx));
  await db.$transaction(tx => attach(tx, p, a));
  await db.formVersion.update({ where: { id: p.versionId }, data: { status: "published" } });
  await expect(db.$transaction(tx => detach(tx, p, a))).rejects.toThrow();
  await expect(db.authorAsset.update({ where: { id: a.id }, data: { status: "deleting", version: { increment: 1 } } })).rejects.toThrow(/still referenced/);
  expect(await db.authorAssetReference.count()).toBe(1);
});
test("template JSON requires the same image pins and UUID key; system scope stays null", async () => {
  const a = await db.$transaction(tx => readyAsset(tx, null)), qid = randomUUID();
  const content = { questions: [{ id: qid, type: "short", questionImageKey: a.id }] };
  await expect(db.formTemplate.create({ data: { title: "Missing pin", category: "QA", licenseScope: "ACTIVE_SUBSCRIPTION", content } })).rejects.toThrow(/pins differ/);
  await expect(db.formTemplate.create({ data: { title: "Bad key", category: "QA", licenseScope: "ACTIVE_SUBSCRIPTION", content: { questions: [{ id: qid, questionImageKey: "https://example.test/image.png" }] } } })).rejects.toThrow(/Invalid question image/);
  const t = await db.$transaction(async tx => {
    const row = await tx.formTemplate.create({ data: { title: "System", category: "QA", licenseScope: "ACTIVE_SUBSCRIPTION", content } });
    await tx.authorAssetReference.create({ data: { assetId: a.id, templateId: row.id, questionKey: qid, slot: "question" } });
    await tx.authorAsset.update({ where: { id: a.id }, data: { expiresAt: null, version: { increment: 1 } } });
    return row;
  });
  expect(await db.authorAssetReference.findFirstOrThrow({ where: { templateId: t.id } })).toMatchObject({ tenantId: null, serviceId: null, questionId: null, orderNumber: null, optionKey: null });
});
test("quarantine preserves old question pins, rejects new pins, and repeatable-read cannot attach", async () => {
  const p = await parent(), next = await parent(), a = await db.$transaction(tx => readyAsset(tx));
  await db.$transaction(tx => attach(tx, p, a));
  await db.authorAssetBlob.update({ where: { id: a.blobId }, data: { status: "quarantined", scanStatus: "infected", version: { increment: 1 } } });
  await db.question.update({ where: { id: p.questionId }, data: { label: "Unrelated title" } });
  await expect(db.$transaction(tx => attach(tx, next, a))).rejects.toThrow();
  const clean = await db.$transaction(tx => readyAsset(tx));
  await expect(db.$transaction(tx => attach(tx, next, clean), { isolationLevel: "RepeatableRead" })).rejects.toThrow(/READ COMMITTED/);
  expect(await db.authorAssetReference.count()).toBe(1);
});
