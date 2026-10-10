import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { db, type Transaction } from "@/server/db";
import { env } from "@/server/env";
import { encrypt } from "@/server/crypto";

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Isolated test database required");
type Scope = { tenantId: string; serviceId: string; memberId: string; userId: string };
type Parent = Scope & { formId: string; versionId: string; questionId: string; questionKey: string; optionId: string; optionKey: string };
type Asset = { id: string; blobId: string; size: number; purpose: "QUESTION_MATERIAL" | "OPTION_IMAGE" };
let scope: Scope;
beforeEach(async () => {
  // These tests deliberately reach real tables before generated new-model delegates exist.
  // On migration121 this is a missing-schema RED, not an unresolved helper/import failure.
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
async function readyBlob(tx: Transaction, purpose: Asset["purpose"] = "QUESTION_MATERIAL") {
  const id = randomUUID(), storageKey = randomUUID(), mime = purpose === "OPTION_IMAGE" ? "image/png" : "application/pdf";
  // Explicit database fixture evidence only: no storage write or real scan is claimed here.
  await tx.$executeRaw`INSERT INTO "AuthorAssetBlob"(id,"storageKey",mime,size,sha256,"updatedAt") VALUES(${id},${storageKey},${mime},4,${"a".repeat(64)},now())`;
  await tx.$executeRaw`UPDATE "AuthorAssetBlob" SET status='uploaded',version=version+1 WHERE id=${id}`;
  await tx.$executeRaw`UPDATE "AuthorAssetBlob" SET status='ready',"scanStatus"='clean',"scanEngine"='DB fixture, not ClamAV evidence',"scannedAt"=now(),"expiresAt"=NULL,version=version+1 WHERE id=${id}`;
  return id;
}
async function readyAsset(tx: Transaction, s: Scope | null = scope, purpose: Asset["purpose"] = "QUESTION_MATERIAL", existingBlob?: string): Promise<Asset> {
  const blobId = existingBlob ?? await readyBlob(tx, purpose), id = randomUUID(), ownerKind = s ? "company" : "system";
  await tx.$executeRaw`INSERT INTO "AuthorAsset"(id,"blobId","ownerKind","tenantId","serviceId","createdById",purpose,"nameCipher",size,status,"updatedAt")
    VALUES(${id},${blobId},${ownerKind},${s?.tenantId ?? null},${s?.serviceId ?? null},${s?.memberId ?? null},${purpose},${encrypt("QA asset")},4,'ready',now())`;
  return { id, blobId, size: 4, purpose };
}
const material = (id: string, orderNumber = 0) => ({ materialType: "FILE", orderNumber, fileKey: id, linkLabel: null, linkUrl: null });
async function pin(tx: Transaction, p: Parent, a: Asset, order = 0) {
  await tx.$executeRaw`INSERT INTO "AuthorAssetReference"(id,"assetId","tenantId","serviceId","formVersionId","questionId","questionKey",slot,"orderNumber")
    VALUES(${randomUUID()},${a.id},${p.tenantId},${p.serviceId},${p.versionId},${p.questionId},${p.questionKey},'material',${order})`;
}
async function attach(tx: Transaction, p: Parent, a: Asset) {
  await tx.$executeRaw`UPDATE "Question" SET "materialList"=${JSON.stringify([material(a.id)])}::jsonb WHERE id=${p.questionId}`;
  await tx.$executeRaw`UPDATE "AuthorAsset" SET "expiresAt"=NULL,version=version+1 WHERE id=${a.id}`;
  await pin(tx, p, a);
}
async function attachImage(tx: Transaction, p: Parent, a: Asset) {
  await tx.$executeRaw`UPDATE "QuestionOption" SET "optionImageKey"=${a.id} WHERE id=${p.optionId}`;
  await tx.$executeRaw`UPDATE "AuthorAsset" SET "expiresAt"=NULL,version=version+1 WHERE id=${a.id}`;
  await tx.$executeRaw`INSERT INTO "AuthorAssetReference"(id,"assetId","tenantId","serviceId","formVersionId","questionId","questionKey",slot,"optionKey")
    VALUES(${randomUUID()},${a.id},${p.tenantId},${p.serviceId},${p.versionId},${p.questionId},${p.questionKey},'option',${p.optionKey})`;
}
async function detach(tx: Transaction, p: Parent, a: Asset) {
  await tx.$executeRaw`UPDATE "Question" SET "materialList"=NULL WHERE id=${p.questionId}`;
  await tx.$executeRaw`DELETE FROM "AuthorAssetReference" WHERE "formVersionId"=${p.versionId}`;
  await tx.$executeRaw`UPDATE "AuthorAsset" SET "expiresAt"=now()+interval '1 hour',version=version+1 WHERE id=${a.id}`;
}
const assets = () => db.$queryRaw<{ id: string; blobId: string; status: string; size: number; expiresAt: Date | null }[]>`SELECT id,"blobId",status,size,"expiresAt" FROM "AuthorAsset" ORDER BY id`;

test("fresh schema keeps old option image NULL and reserves one hour without rewriting legacy question material", async () => {
  const p = await parent();
  expect(await db.$queryRaw`SELECT "optionImageKey" FROM "QuestionOption" WHERE id=${p.optionId}`).toEqual([{ optionImageKey: null }]);
  expect((await db.question.findUniqueOrThrow({ where: { id: p.questionId } })).materialList).toBeNull();
  await db.$transaction(tx => readyAsset(tx));
  const [a] = await assets(); expect(a.expiresAt!.getTime() - Date.now()).toBeGreaterThan(3_500_000); expect(a.expiresAt!.getTime() - Date.now()).toBeLessThanOrEqual(3_600_000);
});
test("millisecond one-hour defaults repeatedly succeed while explicit longer reservations are rejected", async () => {
  const blobId = await db.$transaction(tx => readyBlob(tx)), nameCipher = encrypt("precision QA");
  // Autocommit exercises the default timestamp rounding, without an artificial delay
  // between transaction start and the guard that would conceal the migration122 bug.
  for (let i = 0; i < 100; i++) {
    await db.$executeRaw`INSERT INTO "AuthorAsset"(id,"blobId","tenantId","serviceId","createdById",purpose,"nameCipher",size,status,"updatedAt")
      VALUES(${randomUUID()},${blobId},${scope.tenantId},${scope.serviceId},${scope.memberId},'QUESTION_MATERIAL',${nameCipher},4,'ready',now())`;
  }
  expect(await db.$queryRaw`SELECT count(*)::int AS count FROM "AuthorAsset" WHERE "expiresAt" IS NOT NULL
    AND "expiresAt"<=((clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)+interval '1 hour')`).toEqual([{ count: 100 }]);
  await expect(db.$executeRaw`INSERT INTO "AuthorAsset"(id,"blobId","tenantId","serviceId","createdById",purpose,"nameCipher",size,status,"expiresAt","updatedAt")
    VALUES(${randomUUID()},${blobId},${scope.tenantId},${scope.serviceId},${scope.memberId},'QUESTION_MATERIAL',${nameCipher},4,'ready',
      (clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour 1 second',now())`).rejects.toThrow(/cannot exceed one hour/);
  expect(await db.$queryRaw`SELECT count(*)::int AS count FROM "AuthorAsset"`).toEqual([{ count: 100 }]);
});
test("pending or unscanned bytes cannot become ready assets or pins by direct SQL", async () => {
  const p = await parent(), blobId = randomUUID(), assetId = randomUUID();
  await db.$executeRaw`INSERT INTO "AuthorAssetBlob"(id,"storageKey",mime,size,sha256,"updatedAt") VALUES(${blobId},${randomUUID()},'application/pdf',4,${"a".repeat(64)},now())`;
  await expect(db.$transaction(tx => readyAsset(tx, scope, "QUESTION_MATERIAL", blobId))).rejects.toThrow();
  await db.$executeRaw`INSERT INTO "AuthorAsset"(id,"blobId","tenantId","serviceId","createdById",purpose,"nameCipher",size,"updatedAt")
    VALUES(${assetId},${blobId},${scope.tenantId},${scope.serviceId},${scope.memberId},'QUESTION_MATERIAL',${encrypt("pending")},4,now())`;
  await expect(db.$transaction(tx => attach(tx, p, { id: assetId, blobId, purpose: "QUESTION_MATERIAL", size: 4 }))).rejects.toThrow();
  await db.$executeRaw`UPDATE "AuthorAssetBlob" SET status='uploaded',version=version+1 WHERE id=${blobId}`;
  await expect(db.$executeRaw`UPDATE "AuthorAssetBlob" SET status='ready',version=version+1 WHERE id=${blobId}`).rejects.toThrow();
});
test("direct SQL gives body images 14 MiB while preserving material and question image limits", async () => {
  for (const size of [0, 14680065]) await expect(db.$executeRaw`INSERT INTO "AuthorAssetBlob"(id,"storageKey",mime,size,sha256,"updatedAt")
    VALUES(${randomUUID()},${randomUUID()},'application/pdf',${size},${"a".repeat(64)},now())`).rejects.toThrow();
  await expect(db.$executeRaw`INSERT INTO "AuthorAssetBlob"(id,"storageKey",mime,size,sha256,"updatedAt")
    VALUES(${randomUUID()},${randomUUID()},'application/pdf',1,'bad',now())`).rejects.toThrow();
  const materialBlob = randomUUID();
  await db.$executeRaw`INSERT INTO "AuthorAssetBlob"(id,"storageKey",mime,size,sha256,"updatedAt") VALUES(${materialBlob},${randomUUID()},'application/pdf',5242881,${"a".repeat(64)},now())`;
  await expect(db.$executeRaw`INSERT INTO "AuthorAsset"(id,"blobId","tenantId","serviceId","createdById",purpose,"nameCipher",size,"updatedAt")
    VALUES(${randomUUID()},${materialBlob},${scope.tenantId},${scope.serviceId},${scope.memberId},'QUESTION_MATERIAL',${encrypt("oversize material")},5242881,now())`).rejects.toThrow();
  const blobId = randomUUID();
  await db.$executeRaw`INSERT INTO "AuthorAssetBlob"(id,"storageKey",mime,size,sha256,"updatedAt") VALUES(${blobId},${randomUUID()},'image/png',1048577,${"a".repeat(64)},now())`;
  await expect(db.$executeRaw`INSERT INTO "AuthorAsset"(id,"blobId","tenantId","serviceId","createdById",purpose,"nameCipher",size,"updatedAt")
    VALUES(${randomUUID()},${blobId},${scope.tenantId},${scope.serviceId},${scope.memberId},'OPTION_IMAGE',${encrypt("oversize")},1048577,now())`).rejects.toThrow();
  const bodyBlob = randomUUID();
  await db.$executeRaw`INSERT INTO "AuthorAssetBlob"(id,"storageKey",mime,size,sha256,"updatedAt") VALUES(${bodyBlob},${randomUUID()},'image/png',14680064,${"b".repeat(64)},now())`;
  const bodyPurposes = ["FORM_CONTENT_IMAGE", "PAGE_CONTENT_IMAGE", "END_PAGE_CONTENT_IMAGE", "PRIVATE_PAGE_CONTENT_IMAGE"];
  for (const purpose of bodyPurposes) await db.$executeRaw`INSERT INTO "AuthorAsset"(id,"blobId","tenantId","serviceId","createdById",purpose,"nameCipher",size,"updatedAt")
    VALUES(${randomUUID()},${bodyBlob},${scope.tenantId},${scope.serviceId},${scope.memberId},${purpose},${encrypt("body.png")},14680064,now())`;
  expect(await db.$queryRaw`SELECT purpose,size FROM "AuthorAsset" WHERE "blobId"=${bodyBlob} ORDER BY purpose`).toEqual(bodyPurposes.sort().map(purpose => ({ purpose, size: 14680064 })));
  const pdfBlob = randomUUID();
  await db.$executeRaw`INSERT INTO "AuthorAssetBlob"(id,"storageKey",mime,size,sha256,"updatedAt") VALUES(${pdfBlob},${randomUUID()},'application/pdf',4,${"c".repeat(64)},now())`;
  await expect(db.$executeRaw`INSERT INTO "AuthorAsset"(id,"blobId","tenantId","serviceId","createdById",purpose,"nameCipher",size,"updatedAt")
    VALUES(${randomUUID()},${pdfBlob},${scope.tenantId},${scope.serviceId},${scope.memberId},'PAGE_CONTENT_IMAGE',${encrypt("wrong.png")},4,now())`).rejects.toThrow();
});
test("content and pin may be written in either order but must agree by transaction commit", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx));
  await db.$transaction(tx => attach(tx, p, a));
  expect((await assets())[0].expiresAt).toBeNull();
  await db.$transaction(tx => detach(tx, p, a));
  await db.$transaction(async tx => {
    await pin(tx, p, a);
    await tx.$executeRaw`UPDATE "Question" SET "materialList"=${JSON.stringify([material(a.id)])}::jsonb WHERE id=${p.questionId}`;
    await tx.$executeRaw`UPDATE "AuthorAsset" SET "expiresAt"=NULL,version=version+1 WHERE id=${a.id}`;
  });
});
test("JSON without pins, pins without JSON and foreign logical/physical question keys rollback", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx));
  await expect(db.$executeRaw`UPDATE "Question" SET "materialList"=${JSON.stringify([material(a.id)])}::jsonb WHERE id=${p.questionId}`).rejects.toThrow();
  await expect(db.$transaction(async tx => { await pin(tx, p, a); await tx.$executeRaw`UPDATE "AuthorAsset" SET "expiresAt"=NULL,version=version+1 WHERE id=${a.id}`; })).rejects.toThrow();
  await expect(db.$transaction(tx => attach(tx, { ...p, questionKey: randomUUID() }, a))).rejects.toThrow();
  expect((await db.question.findUniqueOrThrow({ where: { id: p.questionId } })).materialList).toBeNull();
  expect(await db.$queryRaw`SELECT id FROM "AuthorAssetReference"`).toEqual([]);
});
test("scope and member FK reject cross-company, cross-service and user-id-as-member injection", async () => {
  const p = await parent(), foreign = await company(), a = await db.$transaction(tx => readyAsset(tx, foreign));
  await expect(db.$transaction(tx => attach(tx, p, a))).rejects.toThrow();
  const second = await db.service.create({ data: { tenantId: scope.tenantId, name: "Other", externalName: "Other" } });
  const b = await db.$transaction(tx => readyAsset(tx, { ...scope, serviceId: second.id }));
  await expect(db.$transaction(tx => attach(tx, p, b))).rejects.toThrow();
  await expect(db.$transaction(tx => readyAsset(tx, { ...scope, memberId: scope.userId }))).rejects.toThrow();
});
test("system assets require null tenant, service and creator and cannot attach directly to a company form", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx, null));
  await expect(db.$transaction(tx => attach(tx, p, a))).rejects.toThrow();
  await expect(db.$executeRaw`INSERT INTO "AuthorAsset"(id,"blobId","ownerKind","createdById",purpose,"nameCipher",size,status,"updatedAt")
    VALUES(${randomUUID()},${a.blobId},'system',${scope.memberId},'QUESTION_MATERIAL',${encrypt("bad")},4,'ready',now())`).rejects.toThrow();
});
test("asset byte size/purpose and blob metadata are immutable; a new scoped copy may share the blob", async () => {
  const a = await db.$transaction(tx => readyAsset(tx)), other = await company();
  for (const query of [db.$executeRaw`UPDATE "AuthorAsset" SET size=5,version=version+1 WHERE id=${a.id}`,
    db.$executeRaw`UPDATE "AuthorAsset" SET "nameCipher"=${encrypt("renamed")},version=version+1 WHERE id=${a.id}`,
    db.$executeRaw`UPDATE "AuthorAssetBlob" SET sha256=${"b".repeat(64)},version=version+1 WHERE id=${a.blobId}`]) await expect(query).rejects.toThrow();
  await expect(db.$transaction(tx => readyAsset(tx, scope, "OPTION_IMAGE", a.blobId))).rejects.toThrow();
  const b = await db.$transaction(tx => readyAsset(tx, other, "QUESTION_MATERIAL", a.blobId));
  expect(b.id).not.toBe(a.id); expect(b.blobId).toBe(a.blobId);
  expect((await assets()).reduce((sum, row) => sum + row.size, 0)).toBe(8);
});
test("multiple pins do not duplicate logical asset quota and final ref removal restores expiry", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx));
  await db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Question" SET "materialList"=${JSON.stringify([material(a.id, 0), material(a.id, 1)])}::jsonb WHERE id=${p.questionId}`;
    await tx.$executeRaw`UPDATE "AuthorAsset" SET "expiresAt"=NULL,version=version+1 WHERE id=${a.id}`;
    await pin(tx, p, a, 0); await pin(tx, p, a, 1);
  });
  expect(await db.$queryRaw`SELECT sum(size)::int AS used FROM "AuthorAsset" WHERE status<>'deleted'`).toEqual([{ used: 4 }]);
  await db.$transaction(tx => detach(tx, p, a)); expect((await assets())[0].expiresAt).not.toBeNull();
});
test("quarantine preserves old pins but rejects new pins and new ownership copies", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx)); await db.$transaction(tx => attach(tx, p, a));
  await db.$executeRaw`UPDATE "AuthorAssetBlob" SET status='quarantined',"scanStatus"='infected',version=version+1 WHERE id=${a.blobId}`;
  expect(await db.$queryRaw`SELECT "assetId" FROM "AuthorAssetReference"`).toEqual([{ assetId: a.id }]);
  await expect(db.$transaction(tx => readyAsset(tx, scope, "QUESTION_MATERIAL", a.blobId))).rejects.toThrow();
  const p2 = await parent(); await expect(db.$transaction(tx => attach(tx, p2, a))).rejects.toThrow();
});
test("published version pins cannot be inserted, edited or deleted after publication", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx)); await db.$transaction(tx => attach(tx, p, a));
  await db.formVersion.update({ where: { id: p.versionId }, data: { status: "published", publishedAt: new Date() } });
  await expect(db.$executeRaw`DELETE FROM "AuthorAssetReference" WHERE "formVersionId"=${p.versionId}`).rejects.toThrow();
  await expect(db.$executeRaw`UPDATE "AuthorAssetReference" SET "orderNumber"=1 WHERE "formVersionId"=${p.versionId}`).rejects.toThrow();
  await expect(db.$transaction(tx => pin(tx, p, a, 1))).rejects.toThrow();
  await expect(db.$executeRaw`UPDATE "QuestionOption" SET "optionImageKey"=NULL WHERE id=${p.optionId}`).rejects.toThrow();
});
async function template(tx: Transaction, a: Asset, s: Scope | null = scope) {
  const q = randomUUID(), content = { questions: [{ id: q, type: "단문형 답변", materialList: [material(a.id)] }] };
  const t = await tx.formTemplate.create({ data: { tenantId: s?.tenantId, serviceId: s?.serviceId,
    ...(s ? {} : { licenseScope: "ACTIVE_SUBSCRIPTION" }), title: randomUUID(), category: "QA", content } });
  await tx.$executeRaw`UPDATE "AuthorAsset" SET "expiresAt"=NULL,version=version+1 WHERE id=${a.id}`;
  await tx.$executeRaw`INSERT INTO "AuthorAssetReference"(id,"assetId","tenantId","serviceId","templateId","questionKey",slot,"orderNumber")
    VALUES(${randomUUID()},${a.id},${s?.tenantId ?? null},${s?.serviceId ?? null},${t.id},${q},'material',0)`;
  return t;
}
test("template JSON has exact pins; public templates accept system assets only", async () => {
  const a = await db.$transaction(tx => readyAsset(tx)), system = await db.$transaction(tx => readyAsset(tx, null));
  await expect(db.$transaction(tx => template(tx, a, null))).rejects.toThrow();
  await db.$transaction(tx => template(tx, system, null));
  const t = await db.$transaction(tx => template(tx, a));
  await expect(db.formTemplate.update({ where: { id: t.id }, data: { content: { questions: [] } } })).rejects.toThrow();
  await db.$transaction(async tx => {
    await tx.$executeRaw`DELETE FROM "AuthorAssetReference" WHERE "templateId"=${t.id}`;
    await tx.formTemplate.delete({ where: { id: t.id } });
    await tx.$executeRaw`UPDATE "AuthorAsset" SET "expiresAt"=now()+interval '1 hour',version=version+1 WHERE id=${a.id}`;
  });
});
test("approval snapshot pins stay immutable after the mutable draft removes its own material", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx)); await db.$transaction(tx => attach(tx, p, a));
  const approval = await db.$transaction(async tx => {
    const row = await tx.approvalRequest.create({ data: { tenantId: p.tenantId, formId: p.formId, formVersionId: p.versionId, formRevision: 1, policyRevision: 1,
      contentHash: "a".repeat(64), requestedBy: p.memberId, requestCipher: encrypt({}), snapshot: { content: { questions: [{ id: p.questionKey, type: "객관식 답변", materialList: [material(a.id)] }] } } } });
    await tx.$executeRaw`INSERT INTO "AuthorAssetReference"(id,"assetId","tenantId","serviceId","approvalId","questionKey",slot,"orderNumber")
      VALUES(${randomUUID()},${a.id},${p.tenantId},${p.serviceId},${row.id},${p.questionKey},'material',0)`;
    return row;
  });
  await db.$transaction(async tx => { await tx.$executeRaw`UPDATE "Question" SET "materialList"=NULL WHERE id=${p.questionId}`; await tx.$executeRaw`DELETE FROM "AuthorAssetReference" WHERE "formVersionId"=${p.versionId}`; });
  await expect(db.$executeRaw`DELETE FROM "AuthorAssetReference" WHERE "approvalId"=${approval.id}`).rejects.toThrow();
  await expect(db.$executeRaw`UPDATE "AuthorAsset" SET status='deleting',version=version+1 WHERE id=${a.id}`).rejects.toThrow();
  expect((await assets())[0].expiresAt).toBeNull();
});
test("option image FK, parent type, custom flag and metadata pin must all agree", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx, scope, "OPTION_IMAGE"));
  await expect(db.$executeRaw`UPDATE "QuestionOption" SET "optionImageKey"=${randomUUID()} WHERE id=${p.optionId}`).rejects.toThrow();
  await expect(db.$executeRaw`UPDATE "QuestionOption" SET "optionImageKey"=${a.id} WHERE id=${p.optionId}`).rejects.toThrow();
  await db.$transaction(tx => attachImage(tx, p, a));
  await expect(db.question.update({ where: { id: p.questionId }, data: { type: "드롭다운" } })).rejects.toThrow();
  await expect(db.questionOption.update({ where: { id: p.optionId }, data: { isCustomValue: true } })).rejects.toThrow();
  expect((await db.question.findUniqueOrThrow({ where: { id: p.questionId } })).type).toBe("객관식 답변");
});
test("twenty images succeed and the twenty-first rolls back the complete option/pin batch", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx, scope, "OPTION_IMAGE"));
  const add = async (tx: Transaction, order: number) => {
    const optionKey = randomUUID();
    // Canonical option identity requires its label together with stableKey (20261025000000).
    const o = await tx.questionOption.create({ data: { questionId: p.questionId, stableKey: optionKey, label: "Image " + order, value: "image-" + order, order } });
    await attachImage(tx, { ...p, optionId: o.id, optionKey }, a);
  };
  await db.$transaction(async tx => { for (let i = 1; i <= 20; i++) await add(tx, i); }, { timeout: 15000 });
  await expect(db.$transaction(tx => add(tx, 21))).rejects.toThrow();
  expect(await db.questionOption.count({ where: { questionId: p.questionId } })).toBe(21);
  expect(await db.$queryRaw`SELECT count(*)::int AS count FROM "AuthorAssetReference"`).toEqual([{ count: 20 }]);
});
test("expired reservations cannot be revived by clearing expiry just before binding", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx));
  await db.$executeRaw`UPDATE "AuthorAsset" SET "expiresAt"=now()-interval '1 second',version=version+1 WHERE id=${a.id}`;
  await expect(db.$transaction(tx => attach(tx, p, a))).rejects.toThrow();
});
test("GC refuses referenced assets and live blob owners, then allows tombstones after final release", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx)), other = await company();
  const b = await db.$transaction(tx => readyAsset(tx, other, "QUESTION_MATERIAL", a.blobId));
  await db.$transaction(tx => attach(tx, p, a));
  await expect(db.$executeRaw`UPDATE "AuthorAsset" SET status='deleting',version=version+1 WHERE id=${a.id}`).rejects.toThrow();
  await db.$transaction(tx => detach(tx, p, a));
  await db.$executeRaw`UPDATE "AuthorAsset" SET status='deleting',version=version+1 WHERE id=${a.id}`;
  await db.$executeRaw`UPDATE "AuthorAsset" SET status='deleted',"nameCipher"=NULL,version=version+1 WHERE id=${a.id}`;
  await expect(db.$executeRaw`UPDATE "AuthorAssetBlob" SET status='deleting',version=version+1 WHERE id=${a.blobId}`).rejects.toThrow();
  await db.$executeRaw`UPDATE "AuthorAsset" SET status='deleting',version=version+1 WHERE id=${b.id}`;
  await db.$executeRaw`UPDATE "AuthorAsset" SET status='deleted',"nameCipher"=NULL,version=version+1 WHERE id=${b.id}`;
  await db.$executeRaw`UPDATE "AuthorAssetBlob" SET status='deleting',version=version+1 WHERE id=${a.blobId}`;
  await db.$executeRaw`UPDATE "AuthorAssetBlob" SET status='deleted',version=version+1 WHERE id=${a.blobId}`;
  await expect(db.$executeRaw`DELETE FROM "AuthorAssetBlob" WHERE id=${a.blobId}`).rejects.toThrow();
});
test("fixed snapshot mutations are explicitly rejected rather than relying on stale deferred reads", async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx));
  for (const isolationLevel of ["RepeatableRead", "Serializable"] as const) {
    await expect(db.$transaction(tx => attach(tx, p, a), { isolationLevel })).rejects.toThrow(/READ COMMITTED/);
  }
});

function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function blocked(pid: number) {
  for (let n = 0; n < 150; n++) {
    const [row] = await db.$queryRaw<{ waiting: boolean }[]>`SELECT cardinality(pg_blocking_pids(${pid}::integer))>0 AS waiting`;
    if (row.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Expected a real PostgreSQL row-lock wait");
}
for (const firstOperation of ["attach", "delete"] as const) test(`READ COMMITTED ${firstOperation}-first row lock preserves attachment/GC exclusivity`, async () => {
  const p = await parent(), a = await db.$transaction(tx => readyAsset(tx)), entered = signal(), release = signal(), secondEntered = signal();
  let secondPid = 0;
  const deleting = (tx: Transaction) => tx.$executeRaw`UPDATE "AuthorAsset" SET status='deleting',version=version+1 WHERE id=${a.id}`;
  const first = db.$transaction(async tx => { if (firstOperation === "attach") await attach(tx, p, a); else await deleting(tx); entered.resolve(); await release.promise; }, { timeout: 15000 });
  await entered.promise;
  const second = db.$transaction(async tx => {
    const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; secondPid = row.pid; secondEntered.resolve();
    if (firstOperation === "attach") await deleting(tx); else await attach(tx, p, a);
  }, { timeout: 15000 }).then(() => ({ error: null }), error => ({ error }));
  try { await secondEntered.promise; await blocked(secondPid); }
  finally { release.resolve(); await first; }
  expect((await second).error).not.toBeNull();
  const rows = await assets(); expect(rows[0].status).toBe(firstOperation === "attach" ? "ready" : "deleting");
  expect(await db.$queryRaw`SELECT count(*)::int AS count FROM "AuthorAssetReference"`).toEqual([{ count: firstOperation === "attach" ? 1 : 0 }]);
}, 20000);
