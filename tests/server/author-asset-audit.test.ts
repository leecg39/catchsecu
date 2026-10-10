import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { parse } from "csv-parse/sync";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth } from "@/server/auth";
import { requireContext, type Context } from "@/server/context";
import { encrypt } from "@/server/crypto";
import { createForm, readForm, updateForm, publishForm } from "@/server/forms";
import { submitForm } from "@/server/submissions";
import { auditEventQuery, listAuditEvents, exportAuditEvents } from "@/server/audit-events";
import { formAuditEvents } from "@/server/form-audit-events";
import { formContentSchema, submissionInput } from "@/contracts/domains";
import type { Prisma } from "@/generated/prisma/client";

const database = new URL(env.DATABASE_URL), origin = new URL(env.BETTER_AUTH_URL).origin;
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Author asset audit fixtures require the isolated local test database.");
let ctx: Context, serviceId: string;
const query = (search = "author_asset.qa") => auditEventQuery.parse({ kind: "info", search, pageSize: 100 });
async function member(role: "owner" | "privacy", tenantId: string) {
  const email = randomUUID() + "@author-audit.example.test", password = "Author-audit-QA!123";
  const request = (path: string, body: unknown) => new Request(origin + "/api/v1/auth/" + path, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await auth.handler(request("sign-up/email", { email, password, name: "자료 감사 QA" }))).status).toBe(200);
  const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
  const membership = await db.membership.create({ data: { tenantId, userId: user.id, role } });
  const login = await auth.handler(request("sign-in/email", { email, password })); expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map(item => item.split(";", 1)[0]).join("; ");
  return { membership, cookie };
}
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Company", "User", "AuthorAssetBlob", "Verification", "RateLimit", "ApiRateLimit", "IdempotencyRecord", "Job" CASCADE');
  const company = await db.company.create({ data: { name: "작성 자료 감사 QA", publicName: "QA", policy: { create: { passwordMonths: 0 } },
    services: { create: { name: "현재 서비스", externalName: "QA" } } }, include: { services: true } });
  serviceId = company.services[0].id;
  const owner = await member("owner", company.id);
  ctx = await requireContext(new Headers({ cookie: owner.cookie }), "form.write");
});
afterAll(async () => { await db.$disconnect(); });
async function asset(scope = { tenantId: ctx.tenantId, serviceId, memberId: ctx.member.id }) {
  return db.$transaction(async tx => {
    // Graph-only fixture: no real storage/decoder/scanner execution or scan-success claim.
    const blob = await tx.authorAssetBlob.create({ data: { storageKey: randomUUID(), mime: "application/pdf", size: 4, sha256: "a".repeat(64) } });
    await tx.authorAssetBlob.update({ where: { id: blob.id }, data: { status: "uploaded", version: { increment: 1 } } });
    await tx.authorAssetBlob.update({ where: { id: blob.id }, data: { status: "ready", scanStatus: "clean", scanEngine: "Audit graph fixture; not ClamAV evidence", scannedAt: new Date(), expiresAt: null, version: { increment: 1 } } });
    return tx.authorAsset.create({ data: { blobId: blob.id, ownerKind: "company", tenantId: scope.tenantId, serviceId: scope.serviceId,
      createdById: scope.memberId, purpose: "QUESTION_MATERIAL", nameCipher: encrypt("비공개 원본 이름.pdf"), size: 4, status: "ready" } });
  });
}
function content(file?: string) {
  return formContentSchema.parse({ body: "", consentRequired: false, consentPurpose: "", retentionDays: 30, maxResponses: 100,
    questions: [{ id: randomUUID(), type: "단문형 답변", label: "내용", required: false,
      ...(file ? { materialList: [{ materialType: "FILE", orderNumber: 0, fileKey: file, linkLabel: null, linkUrl: null }] } : {}) }] });
}
const form = (file?: string, target = serviceId, title = "허용 폼") => db.$transaction(tx => createForm(ctx, { serviceId: target, title, content: content(file) }, randomUUID(), tx));
const event = (assetId: string, detail: Prisma.InputJsonObject = {}, target = serviceId, tenantId = ctx.tenantId) => db.auditEvent.create({ data: {
  tenantId, serviceId: target, actorId: ctx.user.id, resource: "author-asset", resourceId: assetId, action: "author_asset.qa",
  requestId: randomUUID(), detail: { ...detail, opaque: "never-return-detail", filename: "비공개 원본 이름.pdf" },
} });
async function formList(id: string, search = "author_asset.qa", actor = ctx) {
  const result = await formAuditEvents(actor, id, query(search), randomUUID());
  if (typeof result === "string") throw new Error("Expected audit JSON"); return result;
}

test("an unbound event gains only its single same-service pinned form in global/form JSON and CSV", async () => {
  const file = await asset(), pending = await event(file.id);
  expect((await listAuditEvents(ctx, query())).items.find(row => row.id === pending.id)).toMatchObject({ formName: null, submissionId: null });
  const parent = await form(file.id), listed = await listAuditEvents(ctx, query());
  expect(listed.items).toHaveLength(1); expect(listed.items[0]).toMatchObject({ id: pending.id, formName: parent.title, submissionId: null });
  const scoped = await formList(parent.id); expect(scoped.total).toBe(1); expect(scoped.items.map(row => row.id)).toEqual([pending.id]);
  const globalCsv = parse(await exportAuditEvents(ctx, query(), randomUUID()), { bom: true }) as string[][];
  const formCsv = await formAuditEvents(ctx, parent.id, query(), randomUUID(), true); expect(typeof formCsv).toBe("string");
  const rows = parse(formCsv as string, { bom: true }) as string[][];
  expect(globalCsv[1][7]).toBe(parent.title); expect(rows[1][0]).toBe(pending.id); expect(rows[1][7]).toBe(parent.title);
  expect(JSON.stringify(listed)).not.toContain("never-return-detail"); expect(JSON.stringify(listed)).not.toContain("비공개 원본 이름.pdf");
});
test("detaching the last pin retains explicit historical form association without live reference rows", async () => {
  const file = await asset(), parent = await form(file.id), before = await event(file.id);
  const next = (await readForm(ctx, parent.id)).content!; next.questions[0].materialList = [];
  await updateForm(ctx, parent.id, { version: parent.version, content: next }, randomUUID());
  expect(await db.authorAssetReference.count({ where: { assetId: file.id } })).toBe(0);
  const detached = await db.auditEvent.findFirstOrThrow({ where: { resourceId: file.id, action: "author_asset.detached" } });
  expect(detached.detail).toMatchObject({ formId: parent.id });
  expect((await listAuditEvents(ctx, query("author_asset.detached"))).items.find(row => row.id === detached.id)).toMatchObject({ formName: parent.title });
  expect((await formList(parent.id, "author_asset.detached")).items.map(row => row.id)).toContain(detached.id);
  expect((await listAuditEvents(ctx, query())).items.find(row => row.id === before.id)).toMatchObject({ formName: parent.title });
});
test("parentless events are ambiguous across two same-service forms while explicit events keep their parent", async () => {
  const file = await asset(), first = await form(file.id, serviceId, "첫 폼"), second = await form(file.id, serviceId, "둘째 폼");
  const ambiguous = await event(file.id), explicit = await event(file.id, { parentKind: "form", parentId: first.id });
  const listed = await listAuditEvents(ctx, query());
  expect(listed.items.find(row => row.id === ambiguous.id)).toMatchObject({ formName: null, submissionId: null });
  expect(listed.items.find(row => row.id === explicit.id)).toMatchObject({ formName: first.title });
  expect((await formList(first.id)).items.map(row => row.id)).toEqual([explicit.id]);
  expect((await formList(second.id)).items).toEqual([]);
});
test("foreign tenant/service IDs in malformed audit context never borrow another parent's title", async () => {
  const file = await asset(), own = await form(file.id), another = await db.service.create({ data: { tenantId: ctx.tenantId, name: "다른 서비스", externalName: "다른 서비스" } });
  const otherAsset = await asset({ tenantId: ctx.tenantId, serviceId: another.id, memberId: ctx.member.id });
  const other = await form(otherAsset.id, another.id, "다른 서비스 비공개 폼");
  const company = await db.company.create({ data: { name: "외부 회사", publicName: "외부", services: { create: { name: "외부 서비스", externalName: "외부" } } }, include: { services: true } });
  const foreignMember = await db.membership.create({ data: { tenantId: company.id, userId: ctx.user.id, role: "owner" } });
  const foreignAsset = await asset({ tenantId: company.id, serviceId: company.services[0].id, memberId: foreignMember.id });
  const foreignForm = await db.form.create({ data: { tenantId: company.id, serviceId: company.services[0].id, ownerId: ctx.user.id, title: "타회사 비공개 폼" } });
  const bad = await Promise.all([
    event(file.id, { formId: other.id }), event(file.id, { formId: foreignForm.id }),
    event(otherAsset.id, { formId: own.id }), event(foreignAsset.id, { formId: own.id }),
  ]);
  const outside = await event(foreignAsset.id, { formId: foreignForm.id }, company.services[0].id, company.id);
  const listed = await listAuditEvents(ctx, query());
  for (const row of bad) expect(listed.items.find(item => item.id === row.id)).toMatchObject({ formName: null, submissionId: null });
  expect(listed.items.map(row => row.id)).not.toContain(outside.id);
  expect(JSON.stringify(listed)).not.toContain("타회사 비공개 폼"); expect(JSON.stringify(listed)).not.toContain("다른 서비스 비공개 폼");
  expect((await formList(own.id)).items).toEqual([]); expect((await formList(other.id)).items).toEqual([]);
});
test("explicit submission context resolves its original version and cannot borrow a different form's response", async () => {
  const file = await asset(), parent = await form(file.id), sibling = await form(undefined, serviceId, "다른 폼");
  const publication = await db.$transaction(tx => publishForm(tx, ctx, parent.id, { version: parent.version }, randomUUID()));
  const questionId = (await readForm(ctx, parent.id)).content!.questions[0].id;
  const submitted = await submitForm(publication.token, submissionInput.parse({ answers: { [questionId]: "확인" }, consent: false }), randomUUID(), randomUUID());
  const first = await event(file.id, { parentKind: "submission", parentId: submitted.body.id });
  const explicitOther = await event(file.id, { formId: sibling.id, parentKind: "submission", parentId: submitted.body.id });
  const listed = await listAuditEvents(ctx, query());
  expect(listed.items.find(row => row.id === first.id)).toMatchObject({ formName: parent.title, submissionId: submitted.body.id });
  expect(listed.items.find(row => row.id === explicitOther.id)).toMatchObject({ formName: sibling.title, submissionId: null });
  expect((await formList(parent.id)).items.map(row => row.id)).toEqual([first.id]);
});
test("template context and copied source IDs never use an unrelated sole form as an implicit parent", async () => {
  const file = await asset(), parent = await form(file.id);
  const templateContext = await event(file.id, { parentKind: "template", parentId: randomUUID() });
  // No target pin: a copied event's source ID is not an authorized target-form association.
  const unattachedCopy = await asset(), copied = await event(unattachedCopy.id, { sourceKind: "version", sourceId: (await db.formVersion.findFirstOrThrow({ where: { formId: parent.id } })).id });
  const listed = await listAuditEvents(ctx, query());
  for (const id of [templateContext.id, copied.id]) expect(listed.items.find(row => row.id === id)).toMatchObject({ formName: null, submissionId: null });
  expect((await formList(parent.id)).items).toEqual([]);
});
test("limited current service authority masks parent metadata and removes even parentless upload events after grant revocation", async () => {
  const reader = await member("privacy", ctx.tenantId);
  const grant = await db.serviceGrant.create({ data: { tenantId: ctx.tenantId, memberId: reader.membership.id, serviceId, capabilities: ["service.read", "audit.read"] } });
  const limited = await requireContext(new Headers({ cookie: reader.cookie }), "audit.read");
  const file = await asset(), parent = await form(file.id), first = await event(file.id), unbound = await event((await asset()).id);
  const otherService = await db.service.create({ data: { tenantId: ctx.tenantId, name: "접근 불가", externalName: "접근 불가" } });
  const otherFile = await asset({ tenantId: ctx.tenantId, serviceId: otherService.id, memberId: ctx.member.id });
  const denied = await event(otherFile.id, {}, otherService.id);
  const listed = await listAuditEvents(limited, query());
  expect(listed.items.map(row => row.id).sort()).toEqual([first.id, unbound.id].sort());
  expect(listed.items.every(row => row.formName === null && row.submissionId === null && row.resourceId === null && row.actorName === null)).toBe(true);
  expect(listed.items.map(row => row.id)).not.toContain(denied.id);
  expect((await formList(parent.id, "author_asset.qa", limited)).items[0]).toMatchObject({ id: first.id, formName: null, submissionId: null });
  await db.serviceGrant.delete({ where: { id: grant.id } });
  expect((await listAuditEvents(limited, query())).items).toEqual([]);
  await expect(formList(parent.id, "author_asset.qa", limited)).rejects.toMatchObject({ status: 404 });
});
