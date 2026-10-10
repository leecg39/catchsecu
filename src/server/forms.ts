import { authorAssetScope, assertAuthorAssetReferences, copyAuthorAssets, withAuthorAssetReferences } from "./author-asset-references";
import { lockFileQuota } from "./file-quota";
import { marketingConfig, validateMarketingConfig } from "@/contracts/marketing";
import { checkSubjectQuestions } from "@/contracts/subjects";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { requireFileScanner } from "./file-scanner";
import { isFileQuestion } from "@/contracts/drawing-questions";
import { companyRetentionDays, lockPolicy } from "./security-policy";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { type Transaction } from "./db";
import { type Context } from "./context";
import { type Capability, roleCan } from "./permissions";
import { fail, listQuery } from "./http";
import { audit } from "./audit";
import { decrypt, encrypt, opaqueToken, tokenHash } from "./crypto";
import { formContentSchema, formInput, validateFormForPublish } from "@/contracts/domains";
import { consentBundle, consentVersionInclude, writeFormConsent, validateFormDocuments, bindingMaximumRetention } from "./form-documents";
import { formScope, lockFormService, formTransaction, withFormAccess } from "./form-access";
import { cloneFormContent } from "@/contracts/form-copy";
import { conditionSchema, rowSchema, selectionLimitsSchema, validateQuestionDefinitions } from "@/contracts/questions";
import { preflightConsentReceipt } from "./consent-receipts";
import { assertQuota } from "./entitlements";
import { invalidateFormCache } from "./form-cache";
import type { FormActions } from "@/contracts/forms";
import { retentionDesignationInput } from "@/contracts/forms";
import { checkedQuestionOptions, storedOptionDefinitions } from "./question-options";
import { formLanguageSchema, validateFormLanguageVerification } from "@/contracts/form-language";
import { normalizeQuestionExplanations } from "@/contracts/question-explanations";
import { normalizeQuestionImages } from "@/contracts/question-images";
import { normalizeQuestionMaterials, questionMaterialsSchema } from "@/contracts/question-materials";
import { normalizeQuestionPersonalInformation, questionPersonalInformationSchema, questionPersonalInformationError } from "@/contracts/question-personal-information";
import { infoPatternIdSchema } from "@/contracts/question-patterns";
import { richDocumentSchema, richDocumentText } from "@/contracts/rich-content";
import { normalizeFormContentRichBody } from "./form-rich-body";
import { FormPresentationError, formNoticeSchema, formSectionSchema, normalizeFormPresentation } from "@/contracts/form-sections";
import { defaultParticipationAccessPolicy } from "@/contracts/form-participation-access";

export type FormContent = z.infer<typeof formContentSchema>;
export const versionInclude = { ...consentVersionInclude,
  sections: { orderBy: { order: "asc" as const } },
  questions: { orderBy: { order: "asc" as const }, include: { options: { orderBy: { order: "asc" as const } } } } };
export const formInclude = {
  service: { select: { name: true, status: true } },
  owner: { select: { user: { select: { name: true } } } },
  versions: { orderBy: { number: "desc" as const }, take: 2, include: versionInclude },
  publications: { where: { status: "active" }, orderBy: { createdAt: "desc" as const }, take: 1 },
  favorites: true,
};
type StoredForm = Prisma.FormGetPayload<{ include: typeof formInclude }>;
type StoredVersion = Prisma.FormVersionGetPayload<{ include: typeof versionInclude }>;
export function contentDto(version: StoredVersion): FormContent {
  const bodyRich = version.bodyRich !== null ? richDocumentSchema.parse(version.bodyRich) : undefined;
  if (bodyRich && richDocumentText(bodyRich) !== version.body) throw new Error("Stored rich body text projection does not match body");
  const pageIds = new Map(version.sections.map(section => [section.id, section.pageKey]));
  const notice = (mode: string | null, body: string | null, storedRich: Prisma.JsonValue | null, label: string) => {
    if (mode === null) return undefined;
    if (mode === "default") return formNoticeSchema.parse({ mode });
    const bodyRich = storedRich !== null ? richDocumentSchema.parse(storedRich) : undefined;
    if (bodyRich && richDocumentText(bodyRich) !== body) throw new Error(`Stored ${label} text projection does not match body`);
    return formNoticeSchema.parse({ mode, body, ...(bodyRich ? { bodyRich } : {}) });
  };
  const completionPage = notice(version.completionPageMode, version.completionPageBody, version.completionPageBodyRich, "completion page");
  const closedPage = notice(version.closedPageMode, version.closedPageBody, version.closedPageBodyRich, "closed page");
  const sections = version.sectionSchemaVersion === 1 ? version.sections.map(section => formSectionSchema.parse({
    id: section.pageKey, title: section.title, body: section.body,
    ...(section.bodyRich !== null ? { bodyRich: richDocumentSchema.parse(section.bodyRich) } : {}),
    defaultDestination: section.destinationKind === "page"
      ? { kind: "page", pageId: pageIds.get(section.destinationSectionId ?? "") }
      : { kind: section.destinationKind },
    allowBack: section.allowBack,
  })) : undefined;
  return {
    ...(version.formLanguage ? { formLanguage: formLanguageSchema.parse(version.formLanguage) } : {}),
    marketing: version.marketing ? marketingConfig.parse(version.marketing) : null,
    body: version.body,
    ...(bodyRich ? { bodyRich } : {}),
    ...(sections ? { sections } : {}),
    ...(completionPage ? { completionPage } : {}),
    ...(closedPage ? { closedPage } : {}),
    questions: version.questions.map(question => ({
      id: question.stableKey, type: question.type as FormContent["questions"][number]["type"], label: question.label,
      ...(version.sectionSchemaVersion === 1 && question.sectionId ? { pageId: pageIds.get(question.sectionId) } : {}),
      required: question.required, ...(question.subjectRole ? { subjectRole: question.subjectRole as "name" | "email" } : {}), options: question.options.map(option => option.value),
      ...(question.condition ? { condition: conditionSchema.parse(question.condition) } : {}),
      ...(question.matrixRows ? { rows: rowSchema.array().parse(question.matrixRows) } : {}),
      ...(question.selectionLimits ? { selectionLimits: selectionLimitsSchema.parse(question.selectionLimits) } : {}),
      optionDefinitions: storedOptionDefinitions(question.options, pageIds),
      ...(question.infoPatternId !== null ? { infoPatternId: infoPatternIdSchema.parse(question.infoPatternId) } : {}),
      ...(question.textMaxLength !== null ? { textMaxLength: question.textMaxLength } : {}),
      ...(question.additionalExplanation !== null ? { additionalExplanation: question.additionalExplanation } : {}),
      ...(question.questionImageKey != null ? { questionImageKey: question.questionImageKey } : {}),
      ...(question.materialList != null ? { materialList: questionMaterialsSchema.parse(question.materialList) } : {}),
      ...(question.catchFormPersonalInformationRequests != null ? { catchFormPersonalInformationRequests: questionPersonalInformationSchema.parse(question.catchFormPersonalInformationRequests) } : {}),
    })), verify: version.verify, font: version.font as FormContent["font"], bold: version.bold,
    consentRequired: version.consentRequired, consentPurpose: version.consentPurpose, retentionDays: version.retentionDays,
    maxResponses: version.maxResponses, showSubmitNotice: version.showSubmitNotice,
    ...(version.collectionWindowSchemaVersion === 1 ? {
      collectionOpenAt: version.collectionOpenAt?.toISOString() ?? null,
      collectionCloseAt: version.collectionCloseAt?.toISOString() ?? null,
    } : {}),
    ...(version.participationAccessSchemaVersion === 1 ? { participationAccess: {
      enabled: version.useParticipationAccess,
      method: version.participationAccessMethod as "EMAIL" | "SOCIAL",
      targetScope: version.participationTargetScope as "ALL" | "WHITELIST",
      useOtp: version.participationUseOtp,
      socialProvider: version.participationSocialProvider as "KAKAO" | "NAVER",
      limitDuplicate: version.restrictDuplicateReplies,
    } } : {}),
    ...([1, 2].includes(version.receiptEvidenceVersion) ? { documentConsents: version.documentBindings.map(binding => ({ documentVersionId: binding.documentVersionId,
      required: binding.required, kind: binding.kind as "collection" | "third_party" })) } : {}),
  };
}
export function formDto(form: StoredForm, ctx: Context) {
  const current = form.versions.find(version => version.status === "draft") ?? form.versions[0];
  const publication = form.publications[0];
  return {
    id: form.id, serviceId: form.serviceId, serviceName: form.service.name, ownerName: form.owner.user.name,
    title: form.title, status: form.status, version: form.version, sourceType: form.sourceType,
    createdAt: form.createdAt, updatedAt: form.updatedAt,
    content: current ? { ...contentDto(current), retentionDays: current.retentionDays ?? form.designatedRetentionDays } : null,
    consentBundle: current ? consentBundle(current) : null,
    draftNumber: current?.number, hasDraft: current?.status === "draft", published: form.status === "published",
    favorite: form.favorites.some(item => item.memberId === ctx.member.id),
    publication: publication ? { id: publication.id, responseCount: publication.responseCount,
      maxResponses: publication.maxResponses, opensAt: publication.opensAt, expiresAt: publication.expiresAt,
      token: roleCan(ctx.member.role, "form.publish") && (["owner", "admin"].includes(ctx.member.role) || ctx.member.grants.some(grant => grant.serviceId === form.serviceId && grant.capabilities.includes("form.publish"))) ? decrypt<string>(publication.tokenCipher) : undefined } : null,
  };
}
// 보유 기간을 지정하지 않은 초안은 지문 계산 시점의 회사 기본 보유 기간으로 반영한다.
// 회사 기본값이 바뀌면 지문이 달라져 진행 중 승인이 자동으로 무효화된다.
export function fingerprint(version: StoredVersion, policyRetentionDays?: number) {
  const content = contentDto(version);
  // Old approval hashes must remain byte-for-byte valid until the draft is edited.
  if (version.optionSchemaVersion === 0) for (const question of content.questions) delete question.optionDefinitions;
  return createHash("sha256").update(JSON.stringify({ title: version.title,
    content: { ...content, ...(version.retentionDays === null && policyRetentionDays !== undefined ? { retentionDays: policyRetentionDays } : {}) },
    ...([1, 2].includes(version.receiptEvidenceVersion) ? { consentBundle: consentBundle(version) } : {}) })).digest("hex");
}
function memberCan(ctx: Context, serviceId: string, capability: Capability) {
  return roleCan(ctx.member.role, capability) && (["owner", "admin"].includes(ctx.member.role) ||
    ctx.member.grants.some(grant => grant.serviceId === serviceId && grant.capabilities.includes(capability)));
}
function formReadDto(form: StoredForm, ctx: Context) {
  const writable = form.sourceType === "form" && form.service.status === "active" && memberCan(ctx, form.serviceId, "form.write");
  const publishable = form.sourceType === "form" && form.service.status === "active" && memberCan(ctx, form.serviceId, "form.publish");
  const publication = form.publications[0];
  const hasLink = !!publication && publication.formVersionId === form.publishedVersionId && (!publication.expiresAt || publication.expiresAt > new Date());
  const actions: FormActions = { preview: true, responses: memberCan(ctx, form.serviceId, "submission.read"),
    edit: writable && form.status !== "archived", copy: writable, registerTemplate: writable && form.status !== "archived",
    publish: publishable && form.status !== "archived" && form.versions.some(version => version.status === "draft"),
    share: publishable && hasLink && ["published", "paused"].includes(form.status),
    pause: publishable && form.status === "published", resume: publishable && form.status === "paused" && hasLink,
    archive: writable && form.status !== "archived", checkDeletion: writable };
  return { ...formDto(form, ctx), actions };
}
export async function lockCurrentForm(tx: Transaction, ctx: Context, id: string, capability: Capability, allowArchived = false) {
  const scope = await formScope(tx, ctx, capability);
  const policy = await lockPolicy(tx, ctx.tenantId);
  await tx.$queryRaw`SELECT id FROM "Form" WHERE id = ${id} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
  const form = await tx.form.findFirst({ where: { id, tenantId: ctx.tenantId }, include: formInclude });
  if (!form) fail(404, "NOT_FOUND", "캐치폼을 찾을 수 없습니다.");
  if (form.sourceType === "import") fail(409, "IMPORT_FORM_LOCKED", "CSV 수집 양식은 변경하거나 공개할 수 없습니다.");
  const member = await tx.membership.findFirst({ where: { id: ctx.member.id, tenantId: ctx.tenantId, status: "active",
    tenant: { status: "active" }, user: { status: "active" } }, include: { grants: true } });
  if (!member || !roleCan(member.role, capability)) fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  if ((scope.id && !scope.id.in.includes(form.serviceId)) || (!["owner", "admin"].includes(member.role) && !member.grants.some(grant => grant.serviceId === form.serviceId && grant.capabilities.includes(capability))))
    fail(403, "SERVICE_FORBIDDEN", "해당 서비스에 대한 권한이 없습니다.");
  await tx.$queryRaw`SELECT id FROM "Service" WHERE id = ${form.serviceId} FOR SHARE`;
  const service = await tx.service.findUniqueOrThrow({ where: { id: form.serviceId } });
  if ((!allowArchived && form.status === "archived") || service.status !== "active") fail(409, "FORM_ARCHIVED", "보관된 서비스 또는 캐치폼은 변경할 수 없습니다.");
  return { form, policy, member };
}
async function readableForm(tx: Transaction, ctx: Context, id: string, capability: Capability) {
  await formScope(tx, ctx, capability);
  await tx.$queryRaw`SELECT id FROM "Form" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const form = await tx.form.findFirst({ where: { id, tenantId: ctx.tenantId }, include: formInclude });
  if (!form) fail(404, "NOT_FOUND", "캐치폼을 찾을 수 없습니다.");
  if (form.sourceType === "import" && ["form.write", "form.publish", "form.approve"].includes(capability)) fail(409, "IMPORT_FORM_LOCKED", "CSV 수집 양식은 변경하거나 공개할 수 없습니다.");
  const service = await lockFormService(tx, ctx, form.serviceId, capability, capability !== "form.read");
  if (service.status !== "active") {
    const member = await tx.membership.findUniqueOrThrow({ where: { id: ctx.member.id }, select: { accessKind: true } });
    if (member.accessKind === "expert") fail(404, "NOT_FOUND", "활성 서비스를 찾을 수 없습니다.");
  }
  return form;
}
export async function requireForm(ctx: Context, id: string, capability: Capability = "form.read") {
  return formTransaction(ctx, capability, tx => readableForm(tx, ctx, id, capability));
}
async function currentDtoContext(tx: Transaction, ctx: Context): Promise<Context> {
  const current = await tx.membership.findUniqueOrThrow({ where: { id: ctx.member.id }, include: { grants: true } });
  return { ...ctx, member: { ...ctx.member, ...current } };
}
export async function readForm(ctx: Context, id: string) {
  return formTransaction(ctx, "form.read", async tx => formReadDto(await readableForm(tx, ctx, id, "form.read"), await currentDtoContext(tx, ctx)));
}
function noticeVersionData(prefix: "completionPage" | "closedPage", notice: FormContent["completionPage"]) {
  const mode = `${prefix}Mode` as const, body = `${prefix}Body` as const, rich = `${prefix}BodyRich` as const;
  return notice?.mode === "custom"
    ? { [mode]: notice.mode, [body]: notice.body, [rich]: notice.bodyRich ?? Prisma.DbNull }
    : { [mode]: notice?.mode ?? null, [body]: null, [rich]: Prisma.DbNull };
}
function presentationVersionData(sections: FormContent["sections"], completionPage: FormContent["completionPage"], closedPage: FormContent["closedPage"]) {
  return { sectionSchemaVersion: sections?.length ? 1 : 0,
    ...noticeVersionData("completionPage", completionPage), ...noticeVersionData("closedPage", closedPage) };
}
function normalizePresentationForWrite(content: FormContent, current?: FormContent): FormContent {
  try { return normalizeFormPresentation(content, current) as FormContent; }
  catch (error) {
    if (error instanceof FormPresentationError) fail(422, error.code, error.message);
    throw error;
  }
}
async function prepareFormSections(tx: Transaction, tenantId: string, versionId: string, sections: FormContent["sections"]) {
  const existing = await tx.formSection.findMany({ where: { tenantId, formVersionId: versionId } });
  // Release every old self-reference before a target can be deleted. The final
  // graph is restored below and the deferred graph trigger checks the commit.
  if (existing.length) await tx.formSection.updateMany({ where: { tenantId, formVersionId: versionId },
    data: { destinationKind: "submit", destinationSectionId: null } });
  if (!sections?.length) return { sectionIds: undefined, removedIds: existing.map(section => section.id) };
  const sectionIds = new Map<string, string>();
  for (const [order, section] of sections.entries()) {
    const prior = existing.find(row => row.pageKey === section.id);
    const id = prior?.id ?? crypto.randomUUID();
    const data = { order, title: section.title, body: section.body, bodyRich: section.bodyRich ?? Prisma.DbNull,
      destinationKind: "submit", destinationSectionId: null, allowBack: section.allowBack };
    if (prior) await tx.formSection.update({ where: { id }, data });
    else await tx.formSection.create({ data: { id, tenantId, formVersionId: versionId, pageKey: section.id, ...data } });
    sectionIds.set(section.id, id);
  }
  return { sectionIds, removedIds: existing.filter(section => !sectionIds.has(section.pageKey)).map(section => section.id) };
}
async function finalizeFormSections(tx: Transaction, versionId: string, sections: FormContent["sections"], sectionIds: Map<string, string> | undefined, removedIds: string[]) {
  for (const section of sections ?? []) {
    const destination = section.defaultDestination;
    await tx.formSection.update({ where: { id: sectionIds!.get(section.id)! }, data: {
      destinationKind: destination.kind,
      destinationSectionId: destination.kind === "page" ? sectionIds!.get(destination.pageId)! : null,
    } });
  }
  if (removedIds.length) await tx.formSection.deleteMany({ where: { formVersionId: versionId, id: { in: removedIds } } });
}
async function writeFormGraph(tx: Transaction, ctx: Context, serviceId: string, versionId: string, content: FormContent, requestId: string) {
  const graph = { ...content, questions: normalizeQuestionImages(content.questions) };
  return withAuthorAssetReferences(tx, authorAssetScope(ctx, serviceId), { kind: "version", id: versionId }, graph, requestId, async () => {
    const prepared = await prepareFormSections(tx, ctx.tenantId, versionId, graph.sections);
    await writeQuestionRows(tx, ctx.tenantId, versionId, graph.questions, prepared.sectionIds);
    await finalizeFormSections(tx, versionId, graph.sections, prepared.sectionIds, prepared.removedIds);
  });
}
async function createVersion(tx: Transaction, ctx: Context, serviceId: string, formId: string, title: string, number: number, content: FormContent, requestId: string) {
  const tenantId = ctx.tenantId;
  const { questions, sections, completionPage, closedPage, documentConsents: _documents, marketing, bodyRich,
    collectionOpenAt, collectionCloseAt, participationAccess = defaultParticipationAccessPolicy(), ...settings } = content; void _documents;
  const version = await tx.formVersion.create({ data: { tenantId, formId, title, number, ...settings, optionSchemaVersion: 1,
    bodyRich: bodyRich ?? Prisma.DbNull, marketing: marketing ?? Prisma.DbNull,
    collectionWindowSchemaVersion: 1, collectionOpenAt: collectionOpenAt ? new Date(collectionOpenAt) : null,
    collectionCloseAt: collectionCloseAt ? new Date(collectionCloseAt) : null,
    participationAccessSchemaVersion: 1, useParticipationAccess: participationAccess.enabled,
    participationAccessMethod: participationAccess.method, participationTargetScope: participationAccess.targetScope,
    participationUseOtp: participationAccess.useOtp, participationSocialProvider: participationAccess.socialProvider,
    restrictDuplicateReplies: participationAccess.limitDuplicate,
    ...presentationVersionData(sections, completionPage, closedPage) } });
  await writeFormGraph(tx, ctx, serviceId, version.id, { ...content, questions: checkedQuestionOptions(questions), sections }, requestId);
  await writeFormConsent(tx, ctx, serviceId, version.id, content);
  return version;
}
async function writeQuestionRows(tx: Transaction, tenantId: string, versionId: string, questions: FormContent["questions"], sectionIds?: Map<string, string>) {
  const existing = await tx.question.findMany({ where: { tenantId, formVersionId: versionId }, include: { options: true } });
  // Release old custom flags before parent type changes, A→B swaps or label changes. The
  // final validated option graph is written below in this same transaction; published rows
  // never enter writeQuestions. Stable IDs and immutable values are not regenerated.
  const clearCustomIds = existing.flatMap(row => row.options.filter(option => option.isCustomValue === true && !questions
    .find(question => question.id === row.stableKey)?.optionDefinitions?.some(next => next.id === (option.stableKey ?? option.id) && next.isCustomValue === true)).map(option => option.id));
  if (clearCustomIds.length) await tx.questionOption.updateMany({ where: { id: { in: clearCustomIds } }, data: { isCustomValue: null } });
  await tx.question.deleteMany({ where: { tenantId, formVersionId: versionId, stableKey: { notIn: questions.map(question => question.id) } } });
  // Release changed unique roles together, then assign the final valid graph in this transaction.
  const roleChanges = existing.filter(row => row.subjectRole && questions.some(question => question.id === row.stableKey && (question.subjectRole ?? null) !== row.subjectRole));
  if (roleChanges.length) await tx.question.updateMany({ where: { tenantId, formVersionId: versionId, id: { in: roleChanges.map(row => row.id) } }, data: { subjectRole: null } });
  const newQuestions: Prisma.QuestionCreateManyInput[] = [], newOptions: Prisma.QuestionOptionCreateManyInput[] = [];
  const removedOptions: string[] = [], changedOptions: { id: string; stableKey: string; label: string; order: number; isCustomValue: true | null; optionImageKey: string | null;
    branchDestinationKind: string | null; branchDestinationSectionId: string | null }[] = [];
  for (const [order, question] of questions.entries()) {
    const prior = existing.find(row => row.stableKey === question.id);
    const materialList = question.materialList?.length ? questionMaterialsSchema.parse(question.materialList) : null;
    const personalInformation = question.catchFormPersonalInformationRequests?.length ? questionPersonalInformationSchema.parse(question.catchFormPersonalInformationRequests) : null;
    const data = { type: question.type, label: question.label, required: question.required, subjectRole: question.subjectRole ?? null,
      infoPatternId: question.infoPatternId ?? null, textMaxLength: question.textMaxLength ?? null,
      sectionId: question.pageId ? sectionIds?.get(question.pageId) ?? fail(422, "INVALID_FORM_SECTIONS", "질문 페이지를 찾을 수 없습니다.") : null,
      additionalExplanation: question.additionalExplanation === "" ? null : question.additionalExplanation ?? null, questionImageKey: question.questionImageKey ?? null, materialList: materialList ?? Prisma.DbNull, order,
      catchFormPersonalInformationRequests: personalInformation ?? Prisma.DbNull,
      condition: question.condition ?? Prisma.DbNull, matrixRows: question.rows ?? Prisma.DbNull, selectionLimits: question.selectionLimits ?? Prisma.DbNull };
    const id = prior?.id ?? crypto.randomUUID();
    if (!prior) newQuestions.push({ id, tenantId, formVersionId: versionId, stableKey: question.id, ...data });
    else if (!isDeepStrictEqual({ ...data, materialList, catchFormPersonalInformationRequests: personalInformation, condition: question.condition ?? null, matrixRows: question.rows ?? null, selectionLimits: question.selectionLimits ?? null },
      { type: prior.type, label: prior.label, required: prior.required, subjectRole: prior.subjectRole, infoPatternId: prior.infoPatternId, textMaxLength: prior.textMaxLength,
        additionalExplanation: prior.additionalExplanation, questionImageKey: prior.questionImageKey, materialList: prior.materialList, order: prior.order, sectionId: prior.sectionId,
        catchFormPersonalInformationRequests: prior.catchFormPersonalInformationRequests,
        condition: prior.condition, matrixRows: prior.matrixRows, selectionLimits: prior.selectionLimits }))
      await tx.question.update({ where: { id }, data });
    const definitions = question.optionDefinitions ?? [];
    const retained = (prior?.options ?? []).filter(option => definitions.some(definition => definition.id === (option.stableKey ?? option.id)));
    removedOptions.push(...(prior?.options ?? []).filter(option => !retained.some(item => item.id === option.id)).map(option => option.id));
    for (const [optionOrder, option] of definitions.entries()) {
      const old = retained.find(item => (item.stableKey ?? item.id) === option.id);
      const branch = option.branchDestination;
      const fields = { stableKey: option.id, label: option.label, value: option.value, order: optionOrder, isCustomValue: option.isCustomValue === true ? true as const : null, optionImageKey: option.optionImageKey ?? null,
        branchDestinationKind: branch?.kind ?? null,
        branchDestinationSectionId: branch?.kind === "page" ? sectionIds?.get(branch.pageId) ?? fail(422, "INVALID_FORM_BRANCH", "보기별 이동 페이지를 찾을 수 없습니다.") : null };
      if (!old) newOptions.push({ questionId: id, ...fields });
      else {
        if (old.value !== option.value) fail(422, "INVALID_OPTION_IDENTITIES", "기존 보기의 선택값은 변경할 수 없습니다.");
        if (old.stableKey !== option.id || old.label !== option.label || old.order !== optionOrder || old.isCustomValue !== fields.isCustomValue || old.optionImageKey !== fields.optionImageKey
          || old.branchDestinationKind !== fields.branchDestinationKind || old.branchDestinationSectionId !== fields.branchDestinationSectionId)
          changedOptions.push({ id: old.id, stableKey: option.id, label: option.label, order: optionOrder, isCustomValue: fields.isCustomValue, optionImageKey: fields.optionImageKey,
            branchDestinationKind: fields.branchDestinationKind, branchDestinationSectionId: fields.branchDestinationSectionId });
      }
    }
  }
  if (newQuestions.length) await tx.question.createMany({ data: newQuestions });
  if (removedOptions.length) await tx.questionOption.deleteMany({ where: { id: { in: removedOptions } } });
  // One bounded statement avoids thousands of round trips for a large reorder.
  if (changedOptions.length) await tx.$executeRaw`
    UPDATE "QuestionOption" AS o SET "stableKey"=v."stableKey", label=v.label, "order"=v."order", "isCustomValue"=v."isCustomValue", "optionImageKey"=v."optionImageKey",
      "branchDestinationKind"=v."branchDestinationKind", "branchDestinationSectionId"=v."branchDestinationSectionId"
    FROM jsonb_to_recordset(${JSON.stringify(changedOptions)}::jsonb) AS v(id text,"stableKey" text,label text,"order" integer,"isCustomValue" boolean,"optionImageKey" text,
      "branchDestinationKind" text,"branchDestinationSectionId" text)
    WHERE o.id=v.id`;
  if (newOptions.length) await tx.questionOption.createMany({ data: newOptions });
}
function ensureQuestionIds(content: FormContent) {
  try { validateFormLanguageVerification(content); } catch (error) { fail(422, "INVALID_FORM_LANGUAGE", (error as Error).message); }
  try { checkSubjectQuestions(content.questions); validateMarketingConfig(content.marketing, content.questions); } catch (error) { fail(422, "SUBJECT_QUESTIONS", (error as Error).message); }
  try { validateQuestionDefinitions(content.questions, false, content.marketing ? [content.marketing.nameQuestionId, content.marketing.emailQuestionId, content.marketing.smsQuestionId, content.marketing.kakaoQuestionId].filter((id): id is string => !!id) : []); }
  catch (error) { fail(422, "INVALID_QUESTIONS", (error as Error).message); }
  if (new Set(content.questions.map(question => question.id)).size !== content.questions.length) fail(422, "DUPLICATE_QUESTION", "질문 ID가 중복되었습니다.");
  for (const question of content.questions) if (question.options && new Set(question.options).size !== question.options.length) fail(422, "DUPLICATE_OPTION", "선택지가 중복되었습니다.");
}
export async function createForm(ctx: Context, data: z.infer<typeof formInput>, requestId: string, tx: Transaction) {
  return withFormAccess(tx, ctx, "form.write", async () => {
    await lockFormService(tx, ctx, data.serviceId, "form.write");
    const content = normalizePresentationForWrite(normalizeFormContentRichBody(data.content));
    ensureQuestionIds(content);
    await assertQuota(tx, ctx.tenantId, "forms");
    const form = await tx.form.create({ data: { tenantId: ctx.tenantId, serviceId: data.serviceId, ownerId: ctx.user.id, title: data.title } });
    await createVersion(tx, ctx, data.serviceId, form.id, data.title, 1, content, requestId);
    await audit(tx, ctx, requestId, "form.created", "form", form.id, ["title", "content"], data.serviceId);
    return tx.form.findUniqueOrThrow({ where: { id: form.id }, include: formInclude });
  });
}
export const formPatch = z.object({
  version: z.number().int().positive(), title: z.string().trim().min(1).max(200).optional(), content: formContentSchema.optional(),
}).strict().refine(input => input.title !== undefined || input.content !== undefined, "변경할 제목 또는 내용을 입력해주세요.");
export async function updateForm(ctx: Context, id: string, input: z.infer<typeof formPatch>, requestId: string) {
  return formTransaction(ctx, "form.write", tx => updateFormDraft(tx, ctx, id, input, requestId));
}
export async function updateFormDraft(tx: Transaction, ctx: Context, id: string, input: z.infer<typeof formPatch>, requestId: string) {
  return withFormAccess(tx, ctx, "form.write", async () => {
    if (input.content) ensureQuestionIds(input.content);
    const { form: locked } = await lockCurrentForm(tx, ctx, id, "form.write");
    const changed = await tx.form.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version },
      data: { ...(input.title ? { title: input.title } : {}), status: locked.status === "pendingApproval" ? "draft" : locked.status, version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    const stored = await tx.form.findUniqueOrThrow({ where: { id }, include: formInclude });
    const draft = stored.versions.find(item => item.status === "draft");
    const currentContent = contentDto(draft ?? stored.versions[0]);
    let content = structuredClone(input.content ?? contentDto(stored.versions[0]));
    content = normalizeFormContentRichBody(content, currentContent);
    content = normalizePresentationForWrite(content, currentContent);
    ensureQuestionIds(content);
    // Merge only the current version, not older history: cleared descriptions must never reappear.
    const currentQuestions = currentContent.questions;
    content.questions = normalizeQuestionExplanations(content.questions, currentQuestions);
    content.questions = normalizeQuestionImages(content.questions, currentQuestions);
    content.questions = normalizeQuestionMaterials(content.questions, currentQuestions);
    content.questions = normalizeQuestionPersonalInformation(content.questions, currentQuestions);
    // An old client may omit a stored classification while changing type or required.
    // Validate the merged current state inside the locked form transaction, before writing it.
    for (const question of content.questions) {
      const error = questionPersonalInformationError(question);
      if (error) fail(422, "INVALID_QUESTIONS", error);
    }
    // Older clients do not send this new setting. Their edits must not reset an explicit language.
    const currentLanguage = (draft ?? stored.versions[0]).formLanguage;
    if (content.formLanguage === undefined && currentLanguage) content.formLanguage = formLanguageSchema.parse(currentLanguage);
    // Clients released before collection scheduling do not send these keys. Preserve a
    // stored schedule when the keys are absent; an explicit null remains the clear action.
    if (input.content && !Object.hasOwn(input.content, "collectionOpenAt"))
      content.collectionOpenAt = currentContent.collectionOpenAt;
    if (input.content && !Object.hasOwn(input.content, "collectionCloseAt"))
      content.collectionCloseAt = currentContent.collectionCloseAt;
    if (input.content && !Object.hasOwn(input.content, "participationAccess"))
      content.participationAccess = currentContent.participationAccess;
    try { validateFormLanguageVerification({ ...content, verify: content.verify ?? draft?.verify }); }
    catch (error) { fail(422, "INVALID_FORM_LANGUAGE", (error as Error).message); }
    if (input.content) {
      const history = await tx.formVersion.findMany({ where: { tenantId: ctx.tenantId, formId: id }, include: versionInclude, orderBy: { number: "desc" } });
      content.questions = checkedQuestionOptions(content.questions, history.flatMap(version => contentDto(version).questions), undefined, currentQuestions);
    }
    if (draft) {
      const { questions, sections, completionPage, closedPage, documentConsents: _documents, marketing, bodyRich,
        collectionOpenAt, collectionCloseAt, participationAccess = defaultParticipationAccessPolicy(), ...settings } = content; void _documents;
      await tx.formVersion.update({ where: { id: draft.id }, data: { ...(input.content ? { ...settings,
        bodyRich: bodyRich ?? Prisma.DbNull, marketing: marketing ?? Prisma.DbNull, optionSchemaVersion: 1,
        collectionWindowSchemaVersion: 1, collectionOpenAt: collectionOpenAt ? new Date(collectionOpenAt) : null,
        collectionCloseAt: collectionCloseAt ? new Date(collectionCloseAt) : null,
        participationAccessSchemaVersion: 1, useParticipationAccess: participationAccess.enabled,
        participationAccessMethod: participationAccess.method, participationTargetScope: participationAccess.targetScope,
        participationUseOtp: participationAccess.useOtp, participationSocialProvider: participationAccess.socialProvider,
        restrictDuplicateReplies: participationAccess.limitDuplicate,
        ...presentationVersionData(sections, completionPage, closedPage) } : {}), title: input.title ?? stored.title } });
      if (input.content) {
        await writeFormGraph(tx, ctx, stored.serviceId, draft.id, { ...content, questions, sections }, requestId);
        await writeFormConsent(tx, ctx, stored.serviceId, draft.id, content);
      }
    } else await createVersion(tx, ctx, stored.serviceId, id, input.title ?? stored.title, stored.versions[0].number + 1, content, requestId);
    await tx.approvalRequest.updateMany({ where: { tenantId: ctx.tenantId, formId: id, status: { in: ["pending", "approved"] } },
      data: { status: "superseded", version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "form.draft_updated", "form", id, Object.keys(input).filter(key => key !== "version"), stored.serviceId);
    return tx.form.findUniqueOrThrow({ where: { id }, include: formInclude });
  });
}
export async function publishForm(tx: Transaction, ctx: Context, id: string, input: { version: number; expiresAt?: string }, requestId: string) {
  return withFormAccess(tx, ctx, "form.publish", async () => {
    const { policy } = await lockCurrentForm(tx, ctx, id, "form.publish");
    const changed = await tx.form.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version },
      data: { version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    const form = await tx.form.findUniqueOrThrow({ where: { id }, include: formInclude });
    const draft = form.versions.find(item => item.status === "draft");
    if (!draft) fail(409, "NO_DRAFT", "게시할 초안이 없습니다. 수정 후 다시 게시해주세요.");
    const content = contentDto(draft);
    const defaultDays = await companyRetentionDays(tx, ctx.tenantId, form.serviceId);
    const approval = await tx.approvalRequest.findFirst({ where: { tenantId: ctx.tenantId, formId: id,
      formVersionId: draft.id, status: "approved", policyRevision: policy.approvalRevision,
      contentHash: fingerprint(draft, defaultDays) }, orderBy: { createdAt: "desc" } });
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
    await preflightConsentReceipt(tx, draft, defaultDays);
    await validateFormDocuments(tx, ctx, form.serviceId, draft);
    await assertAuthorAssetReferences(tx, authorAssetScope(ctx, form.serviceId), { kind: "version", id: draft.id }, content);
    if (content.verify) {
      const integration = await tx.verificationIntegration.findUnique({ where: { tenantId_serviceId: { tenantId: ctx.tenantId, serviceId: form.serviceId } } });
      const providers = [integration?.identityProvider, integration?.signatureProvider].filter(Boolean);
      if (!integration || integration.status !== "enabled" || !providers.length)
        fail(503, "IDENTITY_PROVIDER_REQUIRED", "본인인증·전자서명 연동을 사용으로 전환한 뒤 게시할 수 있습니다.");
      if (providers.some(provider => provider !== "local") || integration.environment !== "sandbox")
        fail(503, "PROVIDER_ADAPTER_REQUIRED", "외부 검증 공급자 어댑터가 없어 게시할 수 없습니다. local sandbox 공급자만 사용할 수 있습니다.");
    }
    if (content.participationAccess?.enabled) {
      if (content.participationAccess.method === "SOCIAL")
        fail(503, "SOCIAL_PARTICIPATION_PROVIDER_REQUIRED", "카카오·네이버 참여 인증 공급자 자격증명을 연결한 뒤 게시할 수 있습니다.");
      if (content.participationAccess.targetScope === "WHITELIST" && !await tx.formAccessTarget.count({ where: { tenantId: ctx.tenantId, formId: form.id } }))
        fail(422, "PARTICIPATION_TARGET_REQUIRED", "지정 명단으로 참여를 제한하려면 이메일 대상자를 한 명 이상 등록해주세요.");
    }
    if (content.questions.some(question => isFileQuestion(question.type))) await requireFileScanner();
    const contentCloseAt = content.collectionCloseAt ? new Date(content.collectionCloseAt) : null;
    const requestedCloseAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (contentCloseAt && requestedCloseAt && contentCloseAt.getTime() !== requestedCloseAt.getTime())
      fail(409, "SCHEDULE_CONFLICT", "저장된 응답 종료 일시와 게시 요청의 만료일이 다릅니다. 최신 설정을 불러와주세요.");
    const expiresAt = requestedCloseAt ?? contentCloseAt;
    if (expiresAt && expiresAt.getTime() <= Date.now()) fail(422, "INVALID_EXPIRY", "응답 종료 일시는 현재보다 이후여야 합니다.");
    const token = opaqueToken();
    await tx.formVersion.update({ where: { id: draft.id }, data: { status: "published", publishedAt: new Date() } });
    const oldPublications = await tx.publication.findMany({ where: { tenantId: ctx.tenantId, formId: id, status: "active" }, select: { id: true } });
    await tx.publication.updateMany({ where: { tenantId: ctx.tenantId, formId: id, status: "active" }, data: { status: "revoked", version: { increment: 1 } } });
    const publication = await tx.publication.create({ data: {
      tenantId: ctx.tenantId, formId: id, formVersionId: draft.id, approvalId: approval?.id,
      tokenHash: tokenHash(token), tokenCipher: encrypt(token), maxResponses: draft.maxResponses,
      opensAt: content.collectionOpenAt ? new Date(content.collectionOpenAt) : null, expiresAt,
    } });
    await tx.fixedUrl.updateMany({ where: { tenantId: ctx.tenantId, publicationId: { in: oldPublications.map(item => item.id) }, status: "active" }, data: { publicationId: publication.id, version: { increment: 1 } } });
    if (approval) await tx.approvalRequest.update({ where: { id: approval.id }, data: { status: "consumed", version: { increment: 1 } } });
    await tx.form.update({ where: { id }, data: { status: "published", publishedVersionId: draft.id } });
    await audit(tx, ctx, requestId, "form.published", "form", id, ["publishedVersion"], form.serviceId);
    return { id: publication.id, token, version: input.version + 1, url: "/projects/" + token + "/form" };
  });
}
// 보유 기간을 지정하지 않은 폼의 사후 지정. 이미 지정된 값은 바꿀 수 없고
// 이전 제출의 원래 보유 기한은 그대로 유지되며 이후 제출부터 지정값이 적용된다.
export async function designateFormRetention(ctx: Context, id: string, input: z.infer<typeof retentionDesignationInput>, requestId: string) {
  return formTransaction(ctx, "form.write", async tx => {
    const { form, policy } = await lockCurrentForm(tx, ctx, id, "form.write", true);
    if (form.version !== input.version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    if (!policy.allowRetentionDesignation) fail(403, "RETENTION_DESIGNATION_DISABLED", "회사의 파기일정 사후 지정 정책이 꺼져 있습니다.");
    if (form.designatedRetentionDays !== null) fail(409, "RETENTION_ALREADY_SET", "이 폼에는 이미 보유 기간이 지정되어 있습니다.");
    const versions = await tx.formVersion.findMany({ where: { tenantId: ctx.tenantId, formId: id },
      include: { documentBindings: { orderBy: { order: "asc" as const }, include: { documentVersion: true } } } });
    if (versions.some(version => version.retentionDays !== null)) fail(409, "RETENTION_ALREADY_SET", "이 폼에는 이미 보유 기간이 지정되어 있습니다.");
    for (const version of versions) {
      if (!version.documentBindings.length) continue;
      const maximum = bindingMaximumRetention(version.documentBindings);
      if (maximum !== null && input.retentionDays > maximum)
        fail(422, "CONSENT_RETENTION_MISMATCH", `지정할 보유 기간을 연결된 동의서의 ${maximum}일 이내로 설정해주세요.`);
    }
    await tx.form.update({ where: { id }, data: { designatedRetentionDays: input.retentionDays, version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "form.retention_designated", "form", id, ["retentionDays"], form.serviceId);
    const stored = await tx.form.findUniqueOrThrow({ where: { id }, include: formInclude });
    return formReadDto(stored, await currentDtoContext(tx, ctx));
  }, { timeout: 15000 });
}
export async function archiveForm(ctx: Context, id: string, version: number, requestId: string) {
  return formTransaction(ctx, "form.write", async tx => {
    const { form } = await lockCurrentForm(tx, ctx, id, "form.write");
    const changed = await tx.form.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: { not: "archived" } },
      data: { status: "archived", version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "캐치폼이 이미 변경되거나 보관되었습니다.");
    await tx.publication.updateMany({ where: { tenantId: ctx.tenantId, formId: id, status: "active" }, data: { status: "revoked", version: { increment: 1 } } });
    await tx.approvalRequest.updateMany({ where: { tenantId: ctx.tenantId, formId: id, status: { in: ["pending", "approved"] } },
      data: { status: "superseded", version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "form.archived", "form", id, ["status"], form.serviceId);
  });
}
async function deletionState(tx: Transaction, ctx: Context, form: StoredForm) {
  const versions = await tx.formVersion.findMany({ where: { tenantId: ctx.tenantId, formId: form.id }, select: { id: true, status: true } });
  const ids = versions.map(version => version.id);
  const publications = await tx.publication.count({ where: { tenantId: ctx.tenantId, formId: form.id } });
  const approvals = await tx.approvalRequest.count({ where: { tenantId: ctx.tenantId, formId: form.id } });
  const submissions = await tx.submission.count({ where: { tenantId: ctx.tenantId, formVersionId: { in: ids } } });
  const shares = await tx.shareGrant.count({ where: { tenantId: ctx.tenantId, formId: form.id } });
  const imports = await tx.importJob.count({ where: { tenantId: ctx.tenantId, formVersionId: { in: ids } } });
  const files = await tx.fileObject.count({ where: { tenantId: ctx.tenantId, formVersionId: { in: ids } } });
  const service = await tx.service.findUniqueOrThrow({ where: { id: form.serviceId } });
  const member = (await currentDtoContext(tx, ctx)).member;
  const canWrite = roleCan(member.role, "form.write") && (["owner", "admin"].includes(member.role) ||
    member.grants.some(grant => grant.serviceId === form.serviceId && grant.capabilities.includes("form.write")));
  const reasons: { code: string; message: string }[] = [];
  if (!canWrite) reasons.push({ code: "WRITE_REQUIRED", message: "완전 삭제하려면 이 서비스의 작성 권한이 필요합니다." });
  if (service.status !== "active") reasons.push({ code: "SERVICE_ARCHIVED", message: "보관된 서비스의 폼은 완전 삭제할 수 없습니다." });
  if (form.sourceType === "import") reasons.push({ code: "IMPORT_FORM_LOCKED", message: "업로드 작업에서 생성된 양식은 완전 삭제할 수 없습니다." });
  if (publications || form.publishedVersionId || versions.some(version => version.status === "published"))
    reasons.push({ code: "PUBLISHED_EVIDENCE", message: "게시 이력이 있어 기존 공개·수집 증거를 유지해야 합니다. 보관할 수 있습니다." });
  if (approvals) reasons.push({ code: "APPROVAL_EVIDENCE", message: "승인 요청 이력이 있어 검토 증거를 유지해야 합니다." });
  if (submissions) reasons.push({ code: "SUBMISSION_REFERENCE", message: "수집한 응답이 있습니다. 응답 화면에서 파기 요청을 관리해주세요." });
  if (shares) reasons.push({ code: "SHARE_REFERENCE", message: "응답 공유 기록이 연결되어 있습니다." });
  if (imports) reasons.push({ code: "IMPORT_REFERENCE", message: "업로드 작업 기록이 연결되어 있습니다." });
  if (files) reasons.push({ code: "FILE_REFERENCE", message: "첨부 파일 기록이 연결되어 있습니다." });
  return { id: form.id, version: form.version, status: form.status, canPurge: reasons.length === 0,
    canReadResponses: memberCan({ ...ctx, member }, form.serviceId, "submission.read"), reasons,
    references: { publications, approvals, submissions, shares, imports, files } };
}
export async function formDeletionState(ctx: Context, id: string) {
  return formTransaction(ctx, "form.read", async tx => deletionState(tx, ctx, await readableForm(tx, ctx, id, "form.read")));
}
export async function purgeForm(ctx: Context, id: string, version: number, requestId: string) {
  return formTransaction(ctx, "form.write", async tx => {
    const { form } = await lockCurrentForm(tx, ctx, id, "form.write", true);
    if (form.version !== version) fail(409, "VERSION_CONFLICT", "캐치폼이 변경되었습니다. 삭제 조건을 다시 확인해주세요.");
    const state = await deletionState(tx, ctx, form);
    if (!state.canPurge) fail(409, "FORM_REFERENCED", state.reasons.map(reason => reason.message).join(" "));
    await invalidateFormCache(tx, ctx.tenantId, id);
    const versions = await tx.formVersion.findMany({ where: { tenantId: ctx.tenantId, formId: id }, select: { id: true } });
    const versionIds = versions.map(item => item.id);
    await tx.formAccessTarget.deleteMany({ where: { tenantId: ctx.tenantId, formId: id } });
    await tx.formAccessTargetBatch.deleteMany({ where: { tenantId: ctx.tenantId, formId: id } });
    await tx.formFavorite.deleteMany({ where: { tenantId: ctx.tenantId, formId: id } });
    await tx.formDocumentBinding.deleteMany({ where: { tenantId: ctx.tenantId, formVersionId: { in: versionIds } } });
    for (const draft of versions) await withAuthorAssetReferences(tx, authorAssetScope(ctx, form.serviceId), { kind: "version", id: draft.id }, { questions: [] }, requestId,
      async () => {
        await tx.question.deleteMany({ where: { tenantId: ctx.tenantId, formVersionId: draft.id } });
        await tx.formSection.updateMany({ where: { tenantId: ctx.tenantId, formVersionId: draft.id },
          data: { destinationKind: "submit", destinationSectionId: null } });
        await tx.formSection.deleteMany({ where: { tenantId: ctx.tenantId, formVersionId: draft.id } });
      });
    await tx.formVersion.deleteMany({ where: { tenantId: ctx.tenantId, formId: id } });
    await tx.form.delete({ where: { id } });
    await audit(tx, ctx, requestId, "form.purged", "form", id, ["draft", "questions", "favorites", "requestCache"], form.serviceId);
  }, { timeout: 15000 });
}
export async function reviseForm(tx: Transaction, ctx: Context, id: string, formVersion: number, requestId: string) {
  return withFormAccess(tx, ctx, "form.write", async () => {
    const { form } = await lockCurrentForm(tx, ctx, id, "form.write");
    if (form.version !== formVersion) fail(409, "VERSION_CONFLICT", "다른 곳에서 변경되었습니다. 최신 내용을 불러와주세요.");
    if (form.versions.some(version => version.status === "draft")) fail(409, "DRAFT_EXISTS", "이미 편집 중인 초안이 있습니다.");
    if (!["published", "paused"].includes(form.status)) fail(409, "REVISE_UNAVAILABLE", "게시된 폼만 새 초안을 만들 수 있습니다.");
    const source = form.versions.find(version => version.status === "published") ?? form.versions[0];
    const version = await createVersion(tx, ctx, form.serviceId, id, form.title, source.number + 1,
      { ...contentDto(source), retentionDays: source.retentionDays ?? form.designatedRetentionDays }, requestId);
    await tx.form.update({ where: { id }, data: { version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "form.revised", "form", id, ["draft"], form.serviceId);
    return { id, draftId: version.id, number: version.number, version: formVersion + 1 };
  });
}
export async function copyForm(tx: Transaction, ctx: Context, id: string, title: string | undefined, requestId: string) {
  await lockFileQuota(tx, ctx.tenantId); // Must precede the actor Company FOR SHARE lock.
  return withFormAccess(tx, ctx, "form.write", async () => {
    const { form } = await lockCurrentForm(tx, ctx, id, "form.write", true);
    const source = form.versions.find(version => version.status === "draft") ?? form.versions[0];
    const copiedAssets = await copyAuthorAssets(tx, ctx, form.serviceId, { kind: "version", id: source.id }, authorAssetScope(ctx, form.serviceId),
      { ...contentDto(source), retentionDays: source.retentionDays ?? form.designatedRetentionDays }, requestId);
    const content = cloneFormContent(copiedAssets);
    const copied = await createForm(ctx, { serviceId: form.serviceId, title: title ?? (form.title.slice(0, 195) + " (복사)"), content }, requestId, tx);
    await audit(tx, ctx, requestId, "form.copied", "form", copied.id, ["title", "content"], form.serviceId);
    return formDto(copied, ctx);
  });
}
export async function transitionForm(ctx: Context, id: string, version: number, action: "pause" | "resume", requestId: string) {
  return formTransaction(ctx, "form.publish", async tx => {
    const { form } = await lockCurrentForm(tx, ctx, id, "form.publish");
    if (form.version !== version) fail(409, "VERSION_CONFLICT", "다른 곳에서 변경되었습니다. 최신 내용을 불러와주세요.");
    if (form.status !== (action === "pause" ? "published" : "paused")) fail(409, "INVALID_TRANSITION", "현재 폼 상태에서는 처리할 수 없습니다.");
    const publication = form.publications[0];
    if (action === "resume" && (!publication || (publication.expiresAt && publication.expiresAt <= new Date())))
      fail(409, "PUBLICATION_CLOSED", "유효한 게시 링크가 없습니다. 다시 게시해주세요.");
    const status = action === "pause" ? "paused" : "published";
    const changed = await tx.form.update({ where: { id }, data: { status, version: { increment: 1 } }, include: formInclude });
    await audit(tx, ctx, requestId, "form." + status, "form", id, ["status"], form.serviceId);
    return formDto(changed, ctx);
  });
}
export async function setFormFavorite(ctx: Context, id: string, favorite: boolean) {
  return formTransaction(ctx, "form.read", async tx => {
    await readableForm(tx, ctx, id, "form.read");
    if (favorite) await tx.formFavorite.upsert({ where: { tenantId_memberId_formId: { tenantId: ctx.tenantId, memberId: ctx.member.id, formId: id } },
      update: {}, create: { tenantId: ctx.tenantId, memberId: ctx.member.id, formId: id } });
    else await tx.formFavorite.deleteMany({ where: { tenantId: ctx.tenantId, memberId: ctx.member.id, formId: id } });
  });
}
export const formListQuery = listQuery.extend({
  status: z.enum(["draft", "pendingApproval", "published", "paused", "archived", "all"]).optional(), serviceId: z.uuid().optional(),
  favorite: z.enum(["true", "false"]).transform(value => value === "true").optional(),
  start: z.iso.date().optional(), end: z.iso.date().optional(),
}).strict().refine(value => !value.start || !value.end || value.start <= value.end, "시작일은 종료일 이전이어야 합니다.");
export async function listForms(ctx: Context, query: { page: number; pageSize: number; search: string; status?: string; serviceId?: string;
  favorite?: boolean; start?: string; end?: string; sort?: string; direction?: "asc" | "desc" }) {
  return formTransaction(ctx, "form.read", async tx => {
  const scope = await formScope(tx, ctx, "form.read");
  const currentCtx = await currentDtoContext(tx, ctx);
  if (query.serviceId) {
    const service = await lockFormService(tx, ctx, query.serviceId, "form.read", false);
    if (currentCtx.member.accessKind === "expert" && service.status !== "active") fail(404, "NOT_FOUND", "활성 서비스를 찾을 수 없습니다.");
  }
  const accessible = await tx.service.findMany({ where: { ...scope, ...(currentCtx.member.accessKind === "expert" ? { status: "active" } : {}) }, select: { id: true, status: true } });
  const candidates = query.serviceId ? accessible.filter(service => service.id === query.serviceId) : accessible;
  const policy = await tx.securityPolicy.findUnique({ where: { tenantId: ctx.tenantId }, select: { allowRetentionDesignation: true } });
  const permissions = { canCreate: candidates.some(service => service.status === "active" && memberCan(currentCtx, service.id, "form.write")),
    canImport: candidates.some(service => service.status === "active" && memberCan(currentCtx, service.id, "import.write")),
    canViewImports: candidates.some(service => memberCan(currentCtx, service.id, "import.read")),
    canDesignateRetention: !!policy?.allowRetentionDesignation };
  const where = { tenantId: ctx.tenantId, sourceType: "form", serviceId: query.serviceId ?? { in: accessible.map(item => item.id) },
    OR: [{ title: { contains: query.search, mode: "insensitive" as const } },
      { owner: { user: { name: { contains: query.search, mode: "insensitive" as const } } } }],
    favorites: query.favorite ? { some: { memberId: ctx.member.id } } : undefined,
    createdAt: query.start || query.end ? {
      gte: query.start ? new Date(query.start + "T00:00:00+09:00") : undefined,
      lt: query.end ? new Date(new Date(query.end + "T00:00:00+09:00").getTime() + 86400000) : undefined,
    } : undefined,
    status: query.status && query.status !== "all" ? query.status : query.status === "all" ? undefined : { not: "archived" } };
  const total = await tx.form.count({ where }), page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
  const items = await tx.form.findMany({ where, include: formInclude, orderBy: [{ [query.sort === "name" ? "title" : "createdAt"]: query.direction ?? "desc" }, { id: "asc" }], take: query.pageSize, skip: (page - 1) * query.pageSize });
  return { items: items.map(item => { const value = formReadDto(item, currentCtx); if (value.publication) delete value.publication.token; return value; }), total, page, pageSize: query.pageSize, permissions };
  });
}
