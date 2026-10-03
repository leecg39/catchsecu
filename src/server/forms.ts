import { marketingConfig, validateMarketingConfig } from "@/contracts/marketing";
import { checkSubjectQuestions } from "@/contracts/subjects";
import { createHash } from "node:crypto";
import { requireFileScanner } from "./file-scanner";
import { lockPolicy } from "./security-policy";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db, type Transaction } from "./db";
import { type Context, requireService, serviceScope } from "./context";
import { type Capability, roleCan } from "./permissions";
import { fail } from "./http";
import { audit } from "./audit";
import { decrypt, encrypt, opaqueToken, tokenHash } from "./crypto";
import { formContentSchema, formInput, validateFormForPublish } from "@/contracts/domains";
import { consentBundle, consentVersionInclude, writeFormConsent, validateFormDocuments } from "./form-documents";
import { documentScope } from "./documents";
import { preflightConsentReceipt } from "./consent-receipts";
import { assertQuota } from "./entitlements";

export type FormContent = z.infer<typeof formContentSchema>;
export const versionInclude = { ...consentVersionInclude, questions: { orderBy: { order: "asc" as const }, include: { options: { orderBy: { order: "asc" as const } } } } };
export const formInclude = {
  service: { select: { name: true } },
  owner: { select: { user: { select: { name: true } } } },
  versions: { orderBy: { number: "desc" as const }, take: 2, include: versionInclude },
  publications: { where: { status: "active" }, orderBy: { createdAt: "desc" as const }, take: 1 },
  favorites: true,
};
type StoredForm = Prisma.FormGetPayload<{ include: typeof formInclude }>;
type StoredVersion = Prisma.FormVersionGetPayload<{ include: typeof versionInclude }>;
export function contentDto(version: StoredVersion): FormContent {
  return {
    marketing: version.marketing ? marketingConfig.parse(version.marketing) : null,
    body: version.body, questions: version.questions.map(question => ({
      id: question.stableKey, type: question.type as FormContent["questions"][number]["type"], label: question.label,
      required: question.required, ...(question.subjectRole ? { subjectRole: question.subjectRole as "name" | "email" } : {}), options: question.options.map(option => option.value),
    })), verify: version.verify, font: version.font as FormContent["font"], bold: version.bold,
    consentRequired: version.consentRequired, consentPurpose: version.consentPurpose, retentionDays: version.retentionDays,
    maxResponses: version.maxResponses, showSubmitNotice: version.showSubmitNotice,
    ...(version.receiptEvidenceVersion === 1 ? { documentConsents: version.documentBindings.map(binding => ({ documentVersionId: binding.documentVersionId,
      required: binding.required, kind: binding.kind as "collection" | "third_party" })) } : {}),
  };
}
export function formDto(form: StoredForm, ctx: Context) {
  const current = form.versions.find(version => version.status === "draft") ?? form.versions[0];
  const publication = form.publications[0];
  return {
    id: form.id, serviceId: form.serviceId, serviceName: form.service.name, ownerName: form.owner.user.name,
    title: form.title, status: form.status, version: form.version, sourceType: form.sourceType,
    createdAt: form.createdAt, updatedAt: form.updatedAt, content: current ? contentDto(current) : null,
    consentBundle: current ? consentBundle(current) : null,
    draftNumber: current?.number, hasDraft: current?.status === "draft", published: form.status === "published",
    favorite: form.favorites.some(item => item.memberId === ctx.member.id),
    publication: publication ? { id: publication.id, responseCount: publication.responseCount,
      maxResponses: publication.maxResponses, expiresAt: publication.expiresAt,
      token: roleCan(ctx.member.role, "form.publish") && (["owner", "admin"].includes(ctx.member.role) || ctx.member.grants.some(grant => grant.serviceId === form.serviceId && grant.capabilities.includes("form.publish"))) ? decrypt<string>(publication.tokenCipher) : undefined } : null,
  };
}
export function fingerprint(version: StoredVersion) {
  return createHash("sha256").update(JSON.stringify({ title: version.title, content: contentDto(version),
    ...(version.receiptEvidenceVersion === 1 ? { consentBundle: consentBundle(version) } : {}) })).digest("hex");
}
export async function lockCurrentForm(tx: Transaction, ctx: Context, id: string, capability: Capability) {
  await documentScope(tx, ctx, capability);
  const policy = await lockPolicy(tx, ctx.tenantId);
  await tx.$queryRaw`SELECT id FROM "Form" WHERE id = ${id} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
  const form = await tx.form.findFirst({ where: { id, tenantId: ctx.tenantId }, include: formInclude });
  if (!form) fail(404, "NOT_FOUND", "캐치폼을 찾을 수 없습니다.");
  if (form.sourceType === "import") fail(409, "IMPORT_FORM_LOCKED", "CSV 수집 양식은 변경하거나 공개할 수 없습니다.");
  const member = await tx.membership.findFirst({ where: { id: ctx.member.id, tenantId: ctx.tenantId, status: "active",
    tenant: { status: "active" }, user: { status: "active" } }, include: { grants: true } });
  if (!member || !roleCan(member.role, capability)) fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  if (!["owner", "admin"].includes(member.role) && !member.grants.some(grant => grant.serviceId === form.serviceId && grant.capabilities.includes(capability)))
    fail(403, "SERVICE_FORBIDDEN", "해당 서비스에 대한 권한이 없습니다.");
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id = ${form.serviceId} FOR SHARE`;
  const service = await tx.service.findUniqueOrThrow({ where: { id: form.serviceId } });
  if (form.status === "archived" || service.status !== "active") fail(409, "FORM_ARCHIVED", "보관된 서비스 또는 캐치폼은 변경할 수 없습니다.");
  return { form, policy, member };
}
export async function requireForm(ctx: Context, id: string, capability: Capability = "form.read") {
  const form = await db.form.findFirst({ where: { id, tenantId: ctx.tenantId }, include: formInclude });
  if (!form) fail(404, "NOT_FOUND", "캐치폼을 찾을 수 없습니다.");
  if (form.sourceType === "import" && ["form.write", "form.publish", "form.approve"].includes(capability)) fail(409, "IMPORT_FORM_LOCKED", "CSV 수집 양식은 변경하거나 공개할 수 없습니다.");
  await requireService(ctx, form.serviceId, capability);
  return form;
}
async function createVersion(tx: Transaction, ctx: Context, serviceId: string, formId: string, title: string, number: number, content: FormContent) {
  const tenantId = ctx.tenantId;
  const { questions, documentConsents: _documents, marketing, ...settings } = content; void _documents;
  const version = await tx.formVersion.create({ data: { tenantId, formId, title, number, ...settings, marketing: marketing ?? Prisma.DbNull } });
  await writeQuestions(tx, tenantId, version.id, questions);
  await writeFormConsent(tx, ctx, serviceId, version.id, content);
  return version;
}
async function writeQuestions(tx: Transaction, tenantId: string, versionId: string, questions: FormContent["questions"]) {
  const rows = questions.map((question, order) => ({ id: crypto.randomUUID(), tenantId, formVersionId: versionId,
    stableKey: question.id, type: question.type, label: question.label, required: question.required, subjectRole: question.subjectRole, order }));
  await tx.question.createMany({ data: rows });
  const options = questions.flatMap((question, index) => (question.options ?? []).map((value, order) => ({ questionId: rows[index].id, value, order })));
  if (options.length) await tx.questionOption.createMany({ data: options });
}
function ensureQuestionIds(content: FormContent) {
  try { checkSubjectQuestions(content.questions); validateMarketingConfig(content.marketing, content.questions); } catch (error) { fail(422, "SUBJECT_QUESTIONS", (error as Error).message); }
  if (new Set(content.questions.map(question => question.id)).size !== content.questions.length) fail(422, "DUPLICATE_QUESTION", "질문 ID가 중복되었습니다.");
  for (const question of content.questions) if (question.options && new Set(question.options).size !== question.options.length) fail(422, "DUPLICATE_OPTION", "선택지가 중복되었습니다.");
}
export async function createForm(ctx: Context, data: z.infer<typeof formInput>, requestId: string, tx: Transaction) {
  const scope = await documentScope(tx, ctx, "form.write");
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id=${data.serviceId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const service = await tx.service.findFirst({ where: { AND: [scope, { id: data.serviceId }] } });
  if (!service) {
    if (!await tx.service.count({ where: { id: data.serviceId, tenantId: ctx.tenantId } })) fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
    fail(403, "SERVICE_FORBIDDEN", "해당 서비스에 대한 권한이 없습니다.");
  }
  if (service.status !== "active") fail(409, "SERVICE_ARCHIVED", "보관된 서비스에는 캐치폼을 생성할 수 없습니다.");
  ensureQuestionIds(data.content);
  await assertQuota(tx, ctx.tenantId, "forms");
  const form = await tx.form.create({ data: { tenantId: ctx.tenantId, serviceId: data.serviceId, ownerId: ctx.user.id, title: data.title } });
  await createVersion(tx, ctx, data.serviceId, form.id, data.title, 1, data.content);
  await audit(tx, ctx, requestId, "form.created", "form", form.id, ["title", "content"], data.serviceId);
  return tx.form.findUniqueOrThrow({ where: { id: form.id }, include: formInclude });
}
export const formPatch = z.object({
  version: z.number().int().positive(), title: z.string().trim().min(1).max(200).optional(), content: formContentSchema.optional(),
}).strict();
export async function updateForm(ctx: Context, id: string, input: z.infer<typeof formPatch>, requestId: string) {
  if (input.content) ensureQuestionIds(input.content);
  return db.$transaction(async tx => {
    const { form: locked } = await lockCurrentForm(tx, ctx, id, "form.write");
    const changed = await tx.form.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version },
      data: { ...(input.title ? { title: input.title } : {}), status: locked.status === "pendingApproval" ? "draft" : locked.status, version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    const stored = await tx.form.findUniqueOrThrow({ where: { id }, include: formInclude });
    const draft = stored.versions.find(item => item.status === "draft");
    const content = input.content ?? contentDto(stored.versions[0]);
    if (draft) {
      const { questions, documentConsents: _documents, marketing, ...settings } = content; void _documents;
      await tx.question.deleteMany({ where: { tenantId: ctx.tenantId, formVersionId: draft.id } });
      await tx.formVersion.update({ where: { id: draft.id }, data: { ...settings, marketing: marketing ?? Prisma.DbNull, title: input.title ?? stored.title } });
      await writeQuestions(tx, ctx.tenantId, draft.id, questions);
      await writeFormConsent(tx, ctx, stored.serviceId, draft.id, content);
    } else await createVersion(tx, ctx, stored.serviceId, id, input.title ?? stored.title, stored.versions[0].number + 1, content);
    await tx.approvalRequest.updateMany({ where: { tenantId: ctx.tenantId, formId: id, status: { in: ["pending", "approved"] } },
      data: { status: "superseded", version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "form.draft_updated", "form", id, Object.keys(input).filter(key => key !== "version"), stored.serviceId);
    return tx.form.findUniqueOrThrow({ where: { id }, include: formInclude });
  });
}
export async function publishForm(tx: Transaction, ctx: Context, id: string, input: { version: number; expiresAt?: string }, requestId: string) {
  const { policy } = await lockCurrentForm(tx, ctx, id, "form.publish");
  const changed = await tx.form.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version },
    data: { version: { increment: 1 } } });
  if (!changed.count) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
  const form = await tx.form.findUniqueOrThrow({ where: { id }, include: formInclude });
  const draft = form.versions.find(item => item.status === "draft");
  if (!draft) fail(409, "NO_DRAFT", "게시할 초안이 없습니다. 수정 후 다시 게시해주세요.");
  const content = contentDto(draft);
  const approval = await tx.approvalRequest.findFirst({ where: { tenantId: ctx.tenantId, formId: id,
    formVersionId: draft.id, status: "approved", policyRevision: policy.approvalRevision,
    contentHash: fingerprint(draft) }, orderBy: { createdAt: "desc" } });
  if (policy.requireApproval && !approval) fail(409, "APPROVAL_REQUIRED", "현재 초안과 정책에 대한 게시 승인이 필요합니다.");
  if (approval) {
    const reviewer = await tx.membership.findFirst({ where: { id: approval.decidedBy!, tenantId: ctx.tenantId, status: "active" }, include: { grants: true, user: { select: { status: true } } } });
    if (!reviewer || reviewer.user.status !== "active" || !policy.approvalRoles.includes(reviewer.role)
      || !roleCan(reviewer.role, "form.approve") || (!["owner", "admin"].includes(reviewer.role)
      && !reviewer.grants.some(grant => grant.serviceId === form.serviceId && grant.capabilities.includes("form.approve"))))
      fail(409, "REVIEWER_UNAVAILABLE", "승인 담당자의 권한이 변경되었습니다. 폼을 저장한 뒤 승인을 다시 요청해주세요.");
  }
  try { validateFormForPublish(content); } catch (error) { fail(422, "INVALID_FORM", error instanceof Error ? error.message : "폼 내용을 확인해주세요."); }
  await validateFormDocuments(tx, ctx, form.serviceId, draft);
  await preflightConsentReceipt(draft);
  await validateFormDocuments(tx, ctx, form.serviceId, draft);
  if (content.verify) fail(503, "IDENTITY_PROVIDER_REQUIRED", "본인인증 공급자 연결 후 게시할 수 있습니다.");
  if (content.questions.some(question => question.type === "파일 업로드")) await requireFileScanner();
  if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) fail(422, "INVALID_EXPIRY", "만료일은 현재보다 이후여야 합니다.");
  const token = opaqueToken();
  await tx.formVersion.update({ where: { id: draft.id }, data: { status: "published", publishedAt: new Date() } });
  const oldPublications = await tx.publication.findMany({ where: { tenantId: ctx.tenantId, formId: id, status: "active" }, select: { id: true } });
  await tx.publication.updateMany({ where: { tenantId: ctx.tenantId, formId: id, status: "active" }, data: { status: "revoked", version: { increment: 1 } } });
  const publication = await tx.publication.create({ data: {
    tenantId: ctx.tenantId, formId: id, formVersionId: draft.id, approvalId: approval?.id,
    tokenHash: tokenHash(token), tokenCipher: encrypt(token), maxResponses: draft.maxResponses,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
  } });
  await tx.fixedUrl.updateMany({ where: { tenantId: ctx.tenantId, publicationId: { in: oldPublications.map(item => item.id) }, status: "active" }, data: { publicationId: publication.id, version: { increment: 1 } } });
  if (approval) await tx.approvalRequest.update({ where: { id: approval.id }, data: { status: "consumed", version: { increment: 1 } } });
  await tx.form.update({ where: { id }, data: { status: "published", publishedVersionId: draft.id } });
  await audit(tx, ctx, requestId, "form.published", "form", id, ["publishedVersion"], form.serviceId);
  return { id: publication.id, token, version: input.version + 1, url: "/projects/" + token + "/form" };
}
export async function archiveForm(ctx: Context, id: string, version: number, requestId: string) {
  const form = await requireForm(ctx, id, "form.write");
  return db.$transaction(async tx => {
    const changed = await tx.form.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: { not: "archived" } },
      data: { status: "archived", version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "캐치폼이 이미 변경되거나 보관되었습니다.");
    await tx.publication.updateMany({ where: { tenantId: ctx.tenantId, formId: id, status: "active" }, data: { status: "revoked", version: { increment: 1 } } });
    await tx.approvalRequest.updateMany({ where: { tenantId: ctx.tenantId, formId: id, status: { in: ["pending", "approved"] } },
      data: { status: "superseded", version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "form.archived", "form", id, ["status"], form.serviceId);
  });
}
export async function listForms(ctx: Context, query: { page: number; pageSize: number; search: string; status?: string; serviceId?: string;
  favorite?: boolean; start?: string; end?: string; sort?: string; direction?: "asc" | "desc" }) {
  if (query.serviceId) await requireService(ctx, query.serviceId, "form.read");
  const accessible = await db.service.findMany({ where: serviceScope(ctx, "form.read"), select: { id: true } });
  const where = { tenantId: ctx.tenantId, sourceType: "form", serviceId: query.serviceId ?? { in: accessible.map(item => item.id) },
    OR: [{ title: { contains: query.search, mode: "insensitive" as const } },
      { owner: { user: { name: { contains: query.search, mode: "insensitive" as const } } } }],
    favorites: query.favorite ? { some: { memberId: ctx.member.id } } : undefined,
    createdAt: query.start || query.end ? {
      gte: query.start ? new Date(query.start + "T00:00:00+09:00") : undefined,
      lt: query.end ? new Date(new Date(query.end + "T00:00:00+09:00").getTime() + 86400000) : undefined,
    } : undefined,
    status: query.status && query.status !== "all" ? query.status : query.status === "all" ? undefined : { not: "archived" } };
  const [items, total] = await db.$transaction([
    db.form.findMany({ where, include: formInclude, orderBy: [{ [query.sort === "name" ? "title" : "createdAt"]: query.direction ?? "desc" }, { id: "asc" }], take: query.pageSize, skip: (query.page - 1) * query.pageSize }),
    db.form.count({ where }),
  ]);
  return { items: items.map(item => formDto(item, ctx)), total, page: query.page, pageSize: query.pageSize };
}
