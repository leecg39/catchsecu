import { paymentMethodCreate, paymentMethodUpdate, paymentMethodRemove } from "../src/contracts/payment-methods";
import { ssoAccountUnlink, ssoInvitationToken, ssoInvitationStart, ssoProviderCreate, ssoProviderPatch, ssoProviderRemove, ssoProviderRecord, ssoProviderCheckedRecord, ownSsoAccounts } from "../src/contracts/sso";
import { reviewCreate, reviewAction, reviewQuery, reviewNotify, reviewDestruction } from "../src/contracts/activity-reviews";
import { contextSelectionInput } from "../src/contracts/context";
import { mfaPolicyChange,mfaExceptionCreate,mfaExceptionPatch,mfaExceptionDelete,mfaMemberQuery } from "../src/contracts/mfa-policy";
import { ipRuleInput, ipRulePatch, ipRuleDelete, ipAccessChange, ipRuleQuery } from "../src/contracts/ip-access";
import { integrationCreate, integrationPatch, integrationQuery, integrationToggle, integrationDeleteMany, notificationVersion, notificationHistoryQuery } from "../src/contracts/notifications";
import { marketingCreate, marketingChange, marketingList, marketingVersions } from "../src/contracts/marketing";
import { relayFeedback, suppressionQuery } from "../src/contracts/email-feedback";
import { subjectAccessInput, subjectSessionInput, subjectWithdrawalInput } from "../src/contracts/subjects";
import { shareCreateInput, shareUpdateInput, shareVersionInput, challengeInput, verificationInput } from "../src/contracts/sharing";
import { documentPatch, documentAction, documentPublish, clauseInput, clausePatch, clauseApply, displayInput } from "../src/contracts/documents";
import { subprocessorInput, subprocessorPatch, subprocessorNoticeInput } from "../src/contracts/subprocessors";
import { complianceExportInput, complianceExportList, complianceExportChange } from "../src/contracts/compliance-exports";
import { complianceCloseInput } from "../src/contracts/analytics";
import { kakaoChannelInput, kakaoChannelPatch, kakaoPreviewInput, kakaoReviewInput, kakaoTemplateInput, kakaoTemplatePatch } from "../src/contracts/kakao";
import { importCreate, importPatch, importAction } from "../src/contracts/imports";
import { policyPatch, policyReset, approvalRequestInput, approvalDecisionInput, approvalCancelInput, passwordDeferralInput, passwordChangeInput, passwordResetInput } from "../src/contracts/security";
import { memberInput } from "../src/server/members";
import { accountClosureInput } from "../src/contracts/account-closure";
import { formListQuery, formPatch } from "../src/server/forms";
import { actionInput, correctionInput, noteInput } from "../src/server/submission-management";
import { fixedUrlInput, fixedUrlPatch, fixedUrlQuery } from "../src/server/fixed-urls";
import { approvalQuery } from "../src/server/approvals";
import { templateInput, templatePatch, templateListQuery } from "../src/server/templates";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { noticeCreate, noticePatch } from "../src/contracts/notices";
import { guideCreate, guidePatch } from "../src/contracts/guides";
import { supportTicketCreate, supportTicketPatch, supportTicketReply, supportTicketVersion } from "../src/contracts/support-tickets";
import { accessRequestInput, accessDecisionInput } from "../src/server/access-requests";
import { createExpertInput, updateExpertInput } from "../src/server/expert-assignments";
import { purchaseRequest, cancelRequest, scheduleTrialCancelRequest } from "../src/contracts/subscriptions";
import { senderCreate, senderPatch, senderEvidenceInput, senderVersion } from "../src/contracts/senders";
import { messageContent } from "../src/contracts/message-content";
import { campaignFileInput } from "../src/contracts/campaign-files";
import { messageTemplateCreate, messageTemplatePatch, messageTemplateVersion, messageTemplateApply, messageTemplateList } from "../src/contracts/message-templates";
import { campaignCreate, campaignPatch, campaignTargets, campaignSchedule, campaignReschedule, campaignRetry, campaignVersion, campaignList, campaignSourceList, deliveryList } from "../src/contracts/campaigns";
import { z } from "zod";
import { companyInput, serviceInput, servicePatch, profilePatch } from "../src/server/schemas";
import { retentionDesignationInput } from "../src/contracts/forms";
import { formContentSchema, formInput, documentInput, invitationInput, submissionInput, fileInput } from "../src/contracts/domains";
import { submissionListQuery, submissionFilters } from "../src/contracts/submissions";
import { createExportInput, exportChangeInput, exportListQuery } from "../src/contracts/exports";
import { submissionReceiptSchema } from "../src/contracts/public-forms";
import { memberUploadInput, publicUploadInput } from "../src/contracts/files";
import { destructionAction, destructionSchedule, destructionStatuses, retentionInput } from "../src/contracts/destruction";
import { purposeInput, purposePatch, recipientInput, recipientPatch, catalogAction } from "../src/contracts/processing-catalog";
import regionCodes from "../src/data/region-codes.json";
import { rowSchema } from "../src/contracts/questions";
import { verificationCreate, verificationPatch, verificationStateSchema } from "../src/contracts/verification";

type Operation = Record<string, unknown>;
type PathItem = { parameters?: Record<string, unknown>[] } & Record<string, unknown>;
const paths: Record<string, PathItem> = {};
const schemas: Record<string, unknown> = {};
schemas.ApiError = {
  type: "object", additionalProperties: false, required: ["error"],
  properties: { error: { type: "object", additionalProperties: false, required: ["code", "message", "requestId"],
    properties: { code: { type: "string" }, message: { type: "string" }, requestId: { type: "string", format: "uuid" },
      fieldErrors: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } } } } },
};
schemas.PagedCollection = { type: "object", required: ["items", "total", "page", "pageSize"],
  properties: { items: { type: "array", items: { type: "object" } }, total: { type: "integer", minimum: 0 },
    page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1 } } };
schemas.LedgerOverview = { type: "object", additionalProperties: false,
  required: ["asOf", "currency", "available", "held", "items", "total", "page", "pageSize"],
  properties: { asOf: { type: "string", format: "date-time" }, currency: { type: "string", pattern: "^[A-Z]{3}$" },
    available: { type: "string", pattern: "^[0-9]+$" }, held: { type: "string", pattern: "^[0-9]+$" },
    items: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["id", "serviceId", "serviceName", "kind", "amount", "createdAt"],
      properties: { id: { type: "string", format: "uuid" }, serviceId: { type: ["string", "null"], format: "uuid" },
        serviceName: { type: ["string", "null"] }, kind: { type: "string", enum: ["funding", "reserve", "capture", "release"] },
        amount: { type: "string", pattern: "^[0-9]+$" }, createdAt: { type: "string", format: "date-time" } } } },
    total: { type: "integer", minimum: 0 }, page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1 } } };
const resources = [
  { name: "Company", path: "/companies", schema: companyInput, scope: "tenant", permission: "company.manage", lifecycle: "closure request", status: "implemented" },
  { name: "Service", path: "/services", schema: serviceInput, scope: "tenant", permission: "service.manage", lifecycle: "archive", status: "implemented" },
  { name: "Invitation", path: "/invitations", schema: invitationInput, scope: "tenant", permission: "member.manage", lifecycle: "revoke", status: "planned" },
  { name: "Form", path: "/forms", schema: formInput, scope: "service", permission: "form.write", lifecycle: "archive; purge only unreferenced draft", status: "planned" },
  { name: "Document", path: "/documents", schema: documentInput, scope: "service", permission: "document.write", lifecycle: "draft delete; published revoke and revision", status: "planned" },
] as const;
const errors = Object.fromEntries([[400, "요청 형식 오류"], [401, "로그인 필요"], [403, "권한 또는 Origin 거부"], [404, "현재 회사 범위에 없는 항목"],
  [409, "버전·중복·상태 전이 충돌"], [410, "회수·만료된 항목"], [413, "요청·파일 크기 초과"], [415, "지원하지 않는 전송 형식"],
  [422, "필드 검증 오류"], [429, "요청 제한"], [503, "공급자 미설정 또는 일시 장애"]].map(([code, description]) =>
  [code, { description, content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } }]));
function add(path: string, method: string, permission: string, description: string, schema?: z.ZodType, status = "planned", success = "200") {
  paths[path] ??= {};
  const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map(match => ({ in: "path", name: match[1], required: true, schema: { type: "string", ...(match[1] === "id" ? { format: "uuid" } : {}) } }));
  if (parameters.length) paths[path].parameters = parameters;
  const operation: Operation = {
    summary: description, "x-permission": permission, "x-implementation": status,
    responses: { ...errors, [success]: { description } },
  };
  if (schema) operation.requestBody = { required: true, content: { "application/json": { schema: z.toJSONSchema(schema) } } };
  if (["post", "patch", "put", "delete"].includes(method)) operation["x-origin-check"] = "exact configured application Origin";
  paths[path][method] = operation;
}
for (const resource of resources) {
  schemas[resource.name + "Input"] = z.toJSONSchema(resource.schema);
  add(resource.path, "get", resource.permission, resource.name + " 목록: items/total/page/pageSize", undefined, resource.status);
  add(resource.path, "post", resource.permission, resource.name + " 생성", resource.schema, resource.status, "201");
  add(resource.path + "/{id}", "get", resource.permission, resource.name + " 안전 DTO", undefined, resource.status);
  add(resource.path + "/{id}", "patch", resource.permission, resource.name + " 변경: optimistic version", resource.schema.partial().extend({ version: z.number().int().positive() }), resource.status);
  add(resource.path + "/{id}", "delete", resource.permission, resource.lifecycle, undefined, resource.status, "204");
  for (const endpoint of [resource.path, resource.path + "/{id}"]) paths[endpoint]["x-tenant-scope"] = resource.scope;
}
schemas.ServicePatch = z.toJSONSchema(servicePatch);
add("/context", "get", "authenticated", "현재 사용자·회사·허용 서비스·권한", undefined, "implemented");
add("/context", "post", "active membership", "현재 권한으로 회사 또는 서비스 하나를 전환하고 감사 기록", contextSelectionInput, "implemented");
add("/audit-events", "get", "audit.read for company scope; current member for own activity",
  "현재 회사·서비스 범위의 서버 생성 감사 이벤트를 안전 DTO로 조회; 상세 원문·토큰 제외", undefined, "implemented");
(paths["/audit-events"].get as Operation).parameters = [
  { in: "query", name: "scope", schema: { type: "string", enum: ["company", "mine"], default: "company" } },
  { in: "query", name: "kind", schema: { type: "string", enum: ["all", "service", "info", "marketing", "customer", "member", "authority", "external", "access", "mail"], default: "all" } },
  ...["serviceId", "actorId"].map(name => ({ in: "query", name, schema: { type: "string", format: "uuid" } })),
  { in: "query", name: "from", schema: { type: "string", format: "date-time" }, description: "포함 시작 시각" },
  { in: "query", name: "to", schema: { type: "string", format: "date-time" }, description: "미포함 종료 시각" },
  { in: "query", name: "search", schema: { type: "string", maxLength: 100 } },
  { in: "query", name: "searchField", schema: { type: "string", enum: ["action", "resource", "actor"] } },
  ...["page", "pageSize"].map(name => ({ in: "query", name, schema: { type: "integer", minimum: 1, maximum: name === "page" ? 100000 : 100 } })),
];
add("/audit-events/export", "get", "same current company/self audit scope as /audit-events",
  "동일 필터의 감사 기록 전체를 UTF-8 BOM CSV로 내려받기; 5,000건 초과 시 413; 성공 시 audit.exported 기록", undefined, "implemented");
(paths["/audit-events/export"].get as Operation).parameters = (paths["/audit-events"].get as Operation).parameters;
(paths["/audit-events/export"].get as Operation).responses = { ...errors,
  "200": { description: "UTF-8 BOM CSV attachment; formula-safe cells; private no-store",
    content: { "text/csv": { schema: { type: "string" } } } } };
add("/health", "get", "public", "실제 DB 연결 상태", undefined, "implemented");
add("/billing-history", "get", "billing.read", "현재 회사의 실제 무료 체험 시작 이력; 미승인 구매 요청과 결제 미연동 항목 제외", undefined, "implemented");
(paths["/billing-history"].get as Operation).parameters = [
  ...["fromMonth", "toMonth"].map(name => ({ in: "query", name, schema: { type: "string", pattern: "^(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])$" }, description: "한국 시간 달력 월" })),
  ...["page", "pageSize"].map(name => ({ in: "query", name, schema: { type: "integer", minimum: 1, maximum: name === "page" ? 100000 : 50 } })),
];
add("/me", "get", "self", "본인 프로필 안전 DTO", undefined, "implemented");
add("/me", "patch", "self", "프로필 수정", profilePatch, "implemented");
add("/me/sso-accounts", "get", "self + current direct company membership", "본인 회사 SSO 목록: 토큰·외부신원 제외, 사용 가능한 공급자와 해제 가능 여부", undefined, "implemented");
add("/me/sso-accounts/{id}", "delete", "self + current direct company membership + login within 5 minutes", "다른 활성 로그인 수단 확인 후 연결 해제·모든 본인 세션/대기 인증 회수·원자 감사", ssoAccountUnlink, "implemented");
add("/me/sessions", "get", "self", "본인 세션 목록: token 제외", undefined, "implemented");
add("/me/sessions/{id}", "delete", "self", "본인 세션 회수", undefined, "implemented", "204");
add("/me/closure", "get", "self", "계정 폐쇄 조건·소유 회사·운영 권한 인계 상태", undefined, "implemented");
add("/me/closure", "post", "self + current password + ownership handoff", "계정 폐쇄·모든 세션/인증 정보/회사 권한 회수·불변 이력", accountClosureInput, "implemented");
add("/me/audit-events", "get", "self", "회사 소속 없이 본인 활동의 안전 필드·기간·검색·페이지 조회", undefined, "implemented");
add("/me/audit-events/export", "get", "self", "본인 활동 동일 필터 CSV·5,000건 상한·수식 방어", undefined, "implemented");
for (const path of ["/me/audit-events", "/me/audit-events/export"]) (paths[path].get as Operation).parameters =
  ((paths["/audit-events"].get as Operation).parameters as { name: string }[]).filter(parameter => !["scope", "serviceId", "actorId"].includes(parameter.name))
    .map(parameter => parameter.name === "searchField" ? { ...parameter, schema: { type: "string", enum: ["action", "resource"] } } : parameter);
add("/uploads/init", "post", "own service file.write OR submission.write + file.read; service grant", "암호화 비공개 파일 준비·회사 용량 예약", memberUploadInput, "implemented", "201");
add("/public/forms/{token}/uploads", "post", "active publication + file question + rate limit", "일회성 업로드 권한 발급·회사 용량 예약", publicUploadInput, "implemented", "201");
add("/uploads/{id}", "get", "uploader OR unconsumed X-Upload-Token", "업로드·검사 상태 확인", undefined, "implemented");
add("/uploads/{id}", "delete", "uploader OR unconsumed X-Upload-Token; If-Match", "제출 전 업로드 취소·비공개 파일 삭제", undefined, "implemented", "204");
add("/uploads/{id}/content", "put", "uploader OR unconsumed X-Upload-Token", "1~10MB 제한·확장자/시그니처/SHA-256 검사·암호화 저장", undefined, "implemented");
add("/uploads/{id}/complete", "post", "uploader OR unconsumed X-Upload-Token", "ClamAV 검사; 미설정/오래된 정의/오류는 차단", undefined, "implemented");
add("/files", "get", "submission.read + file.read + service grant", "submissionId 범위의 첨부·정정 이력 파일 목록", undefined, "implemented");
add("/files/{id}", "get", "file.read + tenant/service/submission/question binding", "검사·만료·권한을 확인한 파일 메타데이터", undefined, "implemented");
add("/files/{id}", "patch", "own unattached member upload + file.write", "첨부 전 파일 이름 변경·버전 검사", z.object({ name: fileInput.shape.name, version: z.number().int().positive() }).strict(), "implemented");
add("/files/{id}", "delete", "own unattached member upload + If-Match", "제출 전 파일 삭제; 첨부된 증거는 개별 삭제 금지", undefined, "implemented", "204");
add("/files/{id}/download", "get", "file.read + current session/policy + tenant/service/submission/question binding", "비공개 다운로드·감사; 저장소 읽기 후 세션·보유 기한을 다시 확인하고 만료 응답은 감사와 함께 롤백", undefined, "implemented");
for (const path of ["/uploads/init", "/public/forms/{token}/uploads"]) (paths[path].post as Operation).parameters = [
  { in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 16, maxLength: 128 } }];
for (const path of ["/uploads/{id}", "/uploads/{id}/content", "/uploads/{id}/complete"]) paths[path].parameters = [
  ...(paths[path].parameters ?? []), { in: "header", name: "X-Upload-Token", required: false, description: "공개 업로드에 필수. 제출 완료 시 회수되며 다운로드 권한으로 사용할 수 없다.", schema: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" } }];
(paths["/uploads/{id}/content"].put as Operation).requestBody = { required: true, content: Object.fromEntries(
  ["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"].map(mime => [mime, { schema: { type: "string", format: "binary", maxLength: 10485760 } }])) };
for (const path of ["/files/{id}", "/files/{id}/download"]) (paths[path].get as Operation).parameters = ["submissionId", "questionId"].map(name =>
  ({ in: "query", name, required: false, description: "응답 첨부파일은 두 값 모두 필수. questionId는 질문 stableKey이다. 중복·알 수 없는 쿼리는 422.", schema: { type: "string", format: "uuid" } }));
(paths["/files"].get as Operation).parameters = [{ in: "query", name: "submissionId", required: true, schema: { type: "string", format: "uuid" } }];
for (const path of ["/uploads/{id}", "/files/{id}"]) (paths[path].delete as Operation).parameters = [
  { in: "header", name: "If-Match", required: true, schema: { type: "integer", minimum: 1 } }];
(paths["/files/{id}/download"].get as Operation).responses = { ...errors, "200": {
  description: "권한 확인 후 내려받는 원본 바이트; Content-Disposition: attachment 및 private,no-store",
  content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } } };
add("/security/policy", "get", "security.read", "실제로 집행되는 정책");
add("/security/policy", "patch", "security.write", "정책 변경·감사 기록", policyPatch);
add("/public/forms/{token}", "get", "active publication grant", "게시 당시 질문과 동의문 표시");
add("/public/services/{serviceId}/documents", "get", "public active service", "게시 중인 문서의 제목·버전·해시·공개 경로만 반환. 초안·회수·만료·응답 원문 제외. category/agreement/domestic 허용값 외에는 422", undefined, "implemented");
(paths["/public/services/{serviceId}/documents"].get as Operation).parameters = [
  { in: "query", name: "view", required: true, schema: { type: "string", enum: ["collection", "recipients", "overseas", "resident"] } },
  { in: "query", name: "category", schema: { type: "string", enum: ["items"] } },
  { in: "query", name: "agreement", schema: { type: "string", enum: ["required"] } },
  { in: "query", name: "domestic", schema: { type: "string", enum: ["domestic"] } },
  { in: "query", name: "recipient", schema: { type: "string", format: "uuid" } },
  { in: "query", name: "country", schema: { type: "string" } },
];
add("/public/forms/{token}/submissions", "post", "active publication grant + idempotency + rate limit", "응답 타입·한도·동의 검증 후 원자 저장", submissionInput, "planned", "201");
for (const action of ["publish", "copy", "pause", "revise"]) add("/forms/{id}/" + action, "post", "form.publish or form.write", "폼 상태 전이 " + action, z.object({ version: z.number().int().positive() }).strict());
for (const action of ["corrections", "withdrawals", "destruction"]) add("/submissions/{id}/" + action, "post", "submission.write or submission.destroy", "증거를 보존하는 " + action);
const readOnly = [
  ["audit-events", "audit.read"], ["forms/{id}/submissions", "submission.read"], ["submissions/{id}", "submission.read"],
  ["ledger", "billing.read"], ["usage-events", "billing.read"], ["invoices", "billing.read"],
  ["analytics/privacy", "submission.read"], ["analytics/marketing", "submission.read"], ["compliance", "security.read"],
];
for (const [path, permission] of readOnly) add("/" + path, "get", permission, "권한 범위 내 원천 데이터 조회. 사용자 임의 UPDATE/DELETE 없음.");
add("/ledger", "get", "billing.read", "현재 회사의 통화별 가용·예약 잔액과 불변 원장 거래. 원천 ID 제외; 충전·차감 쓰기 API는 외부 검증 전까지 제공하지 않음", undefined, "implemented");
(paths["/ledger"].get as Operation).parameters = [
  { in: "query", name: "currency", schema: { type: "string", pattern: "^[A-Z]{3}$", default: "KRW" } },
  { in: "query", name: "serviceId", schema: { type: "string", format: "uuid" }, description: "거래만 서비스 필터; 잔액은 회사 공용" },
  ...["page", "pageSize"].map(name => ({ in: "query", name, schema: { type: "integer", minimum: 1, maximum: name === "page" ? 100000 : 100 } })),
];
(paths["/ledger"].get as Operation).responses = { ...errors, "200": { description: "회사 크레딧 계정과 거래 페이지",
  content: { "application/json": { schema: { $ref: "#/components/schemas/LedgerOverview" } } } } };
const domainContracts = [
  ["form-templates", "form.write", "archive"], ["fixed-urls", "form.publish", "revoke"],
  ["processing-purposes", "document.write", "archive if referenced"], ["recipients", "document.write", "archive if referenced"],
  ["clause-templates", "document.write", "archive"], ["share-grants", "submission.read", "revoke"],
  ["retention-rules", "security.write", "archive if referenced"], ["senders", "message.manage", "disable if referenced"],
  ["campaigns", "message.send", "draft delete; scheduled cancel"], ["message-templates", "message.manage", "archive"],
  ["kakao/channels", "message.manage", "disable if referenced"], ["kakao/templates", "message.manage", "draft delete; approved deactivate"],
  ["integrations", "service.manage", "disable then revoke secret"], ["security/ip-rules", "security.write", "delete with lockout protection"],
  ["admin/plans", "platform-admin", "archive; sold price immutable"],
  ["admin/notices", "platform-admin", "archive"], ["admin/guides", "platform-admin", "archive"], ["feedback", "self", "own draft delete"],
];
// Proposed resource inputs remain explicitly marked planned until their handlers and QA exist.
const proposedInputs: Record<string, { create: z.ZodType; patch: z.ZodType }> = {
  "retention-rules": {
    create: z.object({ serviceId: z.uuid(), retentionDays: z.number().int().min(1).max(36500),
      reason: z.string().trim().min(1).max(1000) }).strict(),
    patch: z.object({ version: z.number().int().positive(), retentionDays: z.number().int().min(1).max(36500).optional(),
      reason: z.string().trim().min(1).max(1000).optional() }).strict(),
  },
  "kakao/channels": {
    create: z.object({ serviceId: z.uuid(), providerChannelId: z.string().trim().min(1).max(100),
      name: z.string().trim().min(1).max(100) }).strict(),
    patch: z.object({ version: z.number().int().positive(), name: z.string().trim().min(1).max(100).optional() }).strict(),
  },
  "kakao/templates": {
    create: z.object({ serviceId: z.uuid(), channelId: z.uuid(), code: z.string().trim().min(1).max(100),
      content: z.string().trim().min(1).max(10000), buttons: z.array(z.object({
        label: z.string().trim().min(1).max(100), url: z.url().max(2000) }).strict()).max(5) }).strict(),
    patch: z.object({ version: z.number().int().positive(), content: z.string().trim().min(1).max(10000).optional(),
      buttons: z.array(z.object({ label: z.string().trim().min(1).max(100), url: z.url().max(2000) }).strict()).max(5).optional() }).strict(),
  },
  "security/ip-rules": {
    create: z.object({ cidr: z.string().trim().min(3).max(49), description: z.string().trim().max(200),
      enabled: z.boolean() }).strict(),
    patch: z.object({ version: z.number().int().positive(), cidr: z.string().trim().min(3).max(49).optional(),
      description: z.string().trim().max(200).optional(), enabled: z.boolean().optional() }).strict(),
  },
  "admin/plans": {
    create: z.object({ code: z.string().trim().min(1).max(100), currency: z.string().regex(/^[A-Z]{3}$/),
      amount: z.number().int().nonnegative(), period: z.enum(["month", "year"]), features: z.array(z.string().trim().min(1).max(100)).max(100) }).strict(),
    patch: z.object({ version: z.number().int().positive(), amount: z.number().int().nonnegative().optional(),
      features: z.array(z.string().trim().min(1).max(100)).max(100).optional() }).strict(),
  },
  "admin/notices": { create: noticeCreate, patch: noticePatch },
  "admin/guides": { create: guideCreate, patch: guidePatch },
  feedback: { create: supportTicketCreate, patch: supportTicketPatch },
};
for (const [name, permission, lifecycle] of domainContracts) {
  const proposal = proposedInputs[name];
  add("/" + name, "get", permission, name + " 목록");
  add("/" + name, "post", permission, name + " 생성", proposal?.create, "planned", "201");
  add("/" + name + "/{id}", "get", permission, name + " 상세: 비밀·민감 필드 제한");
  add("/" + name + "/{id}", "patch", permission, name + " 허용 필드·version 검사 후 변경", proposal?.patch);
  add("/" + name + "/{id}", "delete", permission, lifecycle, undefined, "planned", "204");
  (paths["/" + name + "/{id}"].delete as Operation).parameters = [
    { in: "header", name: "If-Match", required: true, schema: { type: "string", pattern: "^[1-9][0-9]*$" } }];
}
for (const endpoint of ["sign-up/email", "sign-in/email", "request-password-reset", "reset-password", "change-password", "sign-out", "two-factor/enable", "two-factor/verify-totp", "two-factor/send-otp", "two-factor/verify-otp", "two-factor/verify-backup-code", "two-factor/disable"]) {
  add("/auth/" + endpoint, "post", "Better Auth endpoint contract", "Better Auth 1.7.7 고정 버전의 인증 계약", undefined, "implemented");
}
add("/auth/get-session", "get", "Better Auth session", "현재 인증 세션", undefined, "implemented");
add("/auth/change-password", "post", "self + current password", "회사별 최소 길이·최근 비밀번호 검사; 계정별 잠금과 원자적 변경; 기존 세션·재설정 링크 회수", passwordChangeInput, "implemented");
add("/auth/reset-password", "post", "valid unused reset proof", "동일 비밀번호 규칙으로 재설정; 실패 시 링크 복원; 성공 시 기존 세션·남은 링크 회수", passwordResetInput, "implemented");
add("/me/password-policy", "get", "self", "현재 회사의 비밀번호 만료·유예와 모든 활성 소속의 최소 길이·재사용 규칙", undefined, "implemented");
add("/me/password-policy", "post", "self + matching tenant and password revision", "현재 로그인 또는 다음 변경 주기까지 변경 유예; 회사 정책이 허용할 때만 적용", passwordDeferralInput, "implemented");

// Concrete contracts for the routes that now have implementation and integration evidence.
const version = z.object({ version: z.number().int().positive() }).strict();
for (const path of ["/services", "/services/{id}"]) (paths[path].get as Operation)["x-permission"] = "service.read";
add("/services/{id}", "patch", "service.manage", "서비스 허용 필드 변경", servicePatch, "implemented");
add("/services/{id}/verification", "get", "form.read + current service grant", "본인인증/전자서명 연동 설정·준비 상태·최근 20개 불변 설정 이력; 준비 완료와 sandbox 성공은 항상 false", undefined, "implemented");
add("/services/{id}/verification", "post", "integration.manage + current service grant", "공급자 식별자·환경·대기/중지 설정 생성·삭제 후 새 세대로 재등록; 고객 입력으로 ready/인증 성공 설정 금지", verificationCreate, "implemented", "201");
add("/services/{id}/verification", "patch", "integration.manage + current service grant", "version 비교·불변 설정 이력·이전 요청 취소·이전 생성 키 응답 tombstone", verificationPatch, "implemented");
add("/services/{id}/verification", "delete", "integration.manage + current service grant", "If-Match 버전 확인 후 설정 삭제 상태·공급자 식별자 제거; 이력 보존·대기 요청 취소", undefined, "implemented", "204");
(paths["/services/{id}/verification"].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" } }];
(paths["/services/{id}/verification"].delete as Operation).parameters = [{ in: "header", name: "If-Match", required: true, schema: { type: "string", pattern: "^[1-9][0-9]*$" } }];
schemas.VerificationState = z.toJSONSchema(verificationStateSchema);
for (const method of ["get", "post", "patch"]) (paths["/services/{id}/verification"][method] as Operation).responses = { ...errors,
  [method === "post" ? "201" : "200"]: { description: "현재 서비스의 안전한 설정·준비 대기·권한·이력", content: { "application/json": { schema: { $ref: "#/components/schemas/VerificationState" } } } } };
add("/companies", "get", "authenticated + active own membership", "소속 회사 검색·페이지 목록; 현재 역할에 따른 안전 DTO", undefined, "implemented");
add("/companies", "post", "verified active account", "회사·소유자·기본 서비스·정책·무료 체험·현재 회사 선택 생성", companyInput, "implemented", "201");
add("/companies/{id}", "get", "active current company membership", "현재 회사 기본 정보; 관리자에게만 사업자등록증·폐쇄 사유 공개", undefined, "implemented");
add("/companies/{id}", "delete", "company.manage + owner", "폐쇄 요청 접수", version.extend({
  confirmation: z.string().max(100), reason: z.string().trim().min(1).max(1000),
}), "implemented", "204");
add("/companies/{id}/closure", "post", "company.manage + owner", "회사 폐쇄 요청 취소", version.extend({ action: z.literal("cancel") }), "implemented", "204");
add("/companies/{id}/business-file", "get", "company.manage", "사업자등록증 다운로드", undefined, "implemented");
add("/companies/{id}/business-file", "post", "company.manage", "검사된 사업자등록증 첨부·교체", undefined, "implemented", "201");
add("/companies/{id}/business-file", "delete", "company.manage", "사업자등록증 삭제", undefined, "implemented", "204");
const matchVersion = { name: "If-Match", in: "header", required: true, schema: { type: "integer", minimum: 1 } };
(paths["/companies/{id}/business-file"].get as Operation).parameters = [
  { name: "fileId", in: "query", required: false, schema: { type: "string", format: "uuid" } },
];
(paths["/companies/{id}/business-file"].post as Operation).parameters = [
  { name: "name", in: "query", required: true, schema: { type: "string", minLength: 1, maxLength: 200 } },
  { name: "size", in: "query", required: true, schema: { type: "integer", minimum: 1, maximum: 10485760 } }, matchVersion,
];
(paths["/companies/{id}/business-file"].post as Operation).requestBody = {
  required: true, content: Object.fromEntries(["application/pdf", "image/png", "image/jpeg"].map(mime => [mime, { schema: { type: "string", format: "binary" } }])),
};
(paths["/companies/{id}/business-file"].get as Operation).responses = { ...errors, "200": {
  description: "원본 바이트 다운로드; attachment; private no-store",
  content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
} };
(paths["/companies/{id}/business-file"].delete as Operation).parameters = [matchVersion];
(paths["/companies"].get as Operation).parameters = [
  { name: "search", in: "query", schema: { type: "string", maxLength: 100 } },
  ...["page", "pageSize"].map(name => ({ name, in: "query", schema: { type: "integer", minimum: 1, maximum: name === "page" ? 100000 : 100 } })),
];
for (const path of ["/forms", "/forms/{id}"]) add(path, "get", "form.read + service grant", "캐치폼 안전 DTO 또는 서버 목록", undefined, "implemented");
const actionNames = ["preview", "responses", "edit", "copy", "registerTemplate", "publish", "share", "pause", "resume", "archive", "checkDeletion"];
schemas.FormReadActions = { type: "object", additionalProperties: false, required: actionNames,
  properties: Object.fromEntries(actionNames.map(name => [name, { type: "boolean" }])) };
const formStatuses = ["draft", "pendingApproval", "published", "paused", "archived"];
schemas.FormRead = { type: "object", additionalProperties: false,
  required: ["id", "serviceId", "serviceName", "ownerName", "title", "status", "version", "sourceType", "createdAt", "updatedAt", "content", "consentBundle", "hasDraft", "published", "favorite", "publication", "actions"],
  properties: { id: { type: "string", format: "uuid" }, serviceId: { type: "string", format: "uuid" }, serviceName: { type: "string" }, ownerName: { type: "string" },
    title: { type: "string" }, status: { type: "string", enum: formStatuses }, version: { type: "integer", minimum: 1 }, sourceType: { type: "string", enum: ["form", "import"] },
    createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, content: { anyOf: [z.toJSONSchema(formContentSchema), { type: "null" }] },
    consentBundle: { type: ["object", "null"] }, draftNumber: { type: "integer", minimum: 1 }, hasDraft: { type: "boolean" }, published: { type: "boolean" }, favorite: { type: "boolean" },
    actions: { $ref: "#/components/schemas/FormReadActions" }, publication: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false,
      required: ["id", "responseCount", "maxResponses", "expiresAt"], properties: { id: { type: "string", format: "uuid" }, responseCount: { type: "integer", minimum: 0 }, maxResponses: { type: "integer", minimum: 1 },
        expiresAt: { type: ["string", "null"], format: "date-time" }, token: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" } } }] } } };
schemas.FormListPermissions = { type: "object", additionalProperties: false, required: ["canCreate", "canImport", "canViewImports"],
  properties: Object.fromEntries(["canCreate", "canImport", "canViewImports"].map(name => [name, { type: "boolean" }])) };
schemas.FormPage = { type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize", "permissions"],
  properties: { items: { type: "array", items: { $ref: "#/components/schemas/FormRead" } }, total: { type: "integer", minimum: 0 }, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 },
    permissions: { $ref: "#/components/schemas/FormListPermissions" } } };
for (const [path, response] of [["/forms", "FormPage"], ["/forms/{id}", "FormRead"]] as const)
  (paths[path].get as Operation).responses = { ...errors, "200": { description: "현재 서비스 권한·상태의 폼/작업 DTO", content: { "application/json": { schema: { $ref: "#/components/schemas/" + response } } } } };
(paths["/forms"].get as Operation).parameters = Object.entries(z.toJSONSchema(formListQuery, { io: "input" }).properties!).map(([name, schema]) => ({ in: "query", name, schema }));
(paths["/forms"].get as Operation)["x-query-additional-properties"] = false;
(paths["/forms"].get as Operation).description = "현재 계정·세션·구성원·전문가·서비스 권한을 transaction에서 재검사합니다. 전문가는 배정된 활성 서비스만 조회합니다. 한국 날짜 기간·제목/생성자·상태·본인 즐겨찾기·정렬을 적용하고 범위 밖 page를 마지막 페이지로 보정합니다. 빈 목록은 page=1이며 공유 토큰을 포함하지 않습니다. actions는 현재 역할·서비스 grant·상태를 따르고 permissions는 선택 서비스의 생성/업로드 권한입니다. 작업 권한은 GET에서 계산하고 생성/저장 멱등 캐시에 포함하지 않습니다.";
(paths["/forms/{id}"].get as Operation).description = "현재 조회 권한과 계정·세션을 재검사합니다. 공유 토큰은 현재 form.publish 권한이 있을 때만 반환합니다. 작업 actions는 현재 서비스 grant·보관/가져오기 양식·공개 링크 만료를 반영합니다. publish는 활성 서비스의 게시 grant와 초안 유무이며 실제 게시에서 승인·질문·문서·파일 공급자를 재검사합니다. 작성 grant 없이 게시 grant만 가진 구성원도 저장된 초안을 게시할 수 있습니다. checkDeletion은 삭제 조건을 조회할 권한이며 실제 삭제 가능 여부는 /deletion에서 다시 확인합니다.";
add("/forms", "post", "form.write + service grant", "질문·선택지·초안 생성", formInput, "implemented", "201");
add("/forms/{id}", "patch", "form.write + service grant", "초안 변경; 게시본 불변", formPatch, "implemented");
add("/forms/{id}/retention", "patch", "form.write + current service grant", "보유 기간을 비운 폼의 사후 지정. 이미 지정된 폼은 409이며 기존 응답의 보유 기한은 유지한다", retentionDesignationInput, "implemented");
add("/forms/{id}/draft", "patch", "form.write + current service grant", "자동저장 초안; version 충돌·게시본 불변·동일 키 재시도는 한 번만 저장", formPatch, "implemented");
for (const path of ["/forms/{id}", "/forms/{id}/draft"]) (paths[path].patch as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: false,
  schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" }, description: "자동저장은 매 저장의 키를 보냅니다. 동일 본문·키 재전송은 현재 권한 검사 후 기존 결과를 반환합니다." }];
for (const path of ["/forms/{id}", "/forms/{id}/draft"]) {
  const formUpdateSchema = (paths[path].patch as Operation).requestBody as { content: { "application/json": { schema: Record<string, unknown> } } };
  formUpdateSchema.content["application/json"].schema.anyOf = ["title", "content"].map(name => ({ required: [name] }));
  (paths[path].patch as Operation).description = "초안 저장 응답은 공유 토큰을 포함하지 않습니다. 기존 캐시를 재전송할 때도 토큰을 제거합니다. 공유 화면은 현재 form.publish 권한으로 GET /forms/{id}를 조회합니다.";
}
add("/forms/{id}", "delete", "form.write + service grant", "공개 종료와 보관", undefined, "implemented", "204");
add("/forms/{id}/deletion", "get", "form.read + current service grant", "완전 삭제 조건·현재 version·참조 사유 확인", undefined, "implemented");
schemas.FormDeletionState = { type: "object", additionalProperties: false, required: ["id", "version", "status", "canPurge", "canReadResponses", "reasons", "references"],
  properties: { id: { type: "string", format: "uuid" }, version: { type: "integer", minimum: 1 }, status: { type: "string", enum: formStatuses }, canPurge: { type: "boolean" }, canReadResponses: { type: "boolean" },
    reasons: { type: "array", items: { type: "object", additionalProperties: false, required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } },
    references: { type: "object", additionalProperties: false, required: ["publications", "approvals", "submissions", "shares", "imports", "files"],
      properties: Object.fromEntries(["publications", "approvals", "submissions", "shares", "imports", "files"].map(name => [name, { type: "integer", minimum: 0 }])) } } };
(paths["/forms/{id}/deletion"].get as Operation).responses = { ...errors, "200": { description: "현재 삭제 조건·사유·응답 조회 권한", content: { "application/json": { schema: { $ref: "#/components/schemas/FormDeletionState" } } } } };
add("/forms/{id}/purge", "delete", "form.write + current service grant + active service + If-Match", "미게시·미참조 초안의 영구 삭제; 게시·승인·응답 증거 참조 시 409; 요청 캐시 내용 제거·감사 유지", undefined, "implemented", "204");
(paths["/forms/{id}/purge"].delete as Operation).parameters = [matchVersion];
(paths["/forms/{id}/purge"].delete as Operation).description = "현재 권한·version·참조 상태를 폼 잠금 아래 다시 검사합니다. 질문·선택지·초안의 문서 연결·즐겨찾기·폼과 해당 생성/저장 캐시를 한 transaction에서 제거합니다. 게시 문서와 독립 복사본은 유지합니다. 삭제된 폼의 생성 키 재전송은 410입니다.";
add("/forms/{id}/publish", "post", "form.publish + service grant", "검증된 초안 게시; 승인·본인인증·첨부 연동 미충족 시 차단", version.extend({ expiresAt: z.iso.datetime().optional() }), "implemented", "201");
add("/forms/{id}/copy", "post", "form.write + service grant", "전체 폼 복사", z.object({ title: z.string().trim().min(1).max(200).optional() }).strict(), "implemented", "201");
for (const action of ["pause", "resume"]) add("/forms/{id}/" + action, "post", "form.publish + service grant", "공개 " + action, version, "implemented");
add("/forms/{id}/favorite", "put", "form.read + service grant", "본인 즐겨찾기 등록", undefined, "implemented");
add("/forms/{id}/favorite", "delete", "form.read + service grant", "본인 즐겨찾기 해제", undefined, "implemented", "204");
add("/forms/{id}/submissions", "get", "submission.read + service grant", "암호화 응답을 권한 범위에서 조회·감사; 보유 기한 종료 또는 파기 시작 뒤 원문 제외", undefined, "implemented");
add("/forms/{id}/submissions/export", "get", "submission.read + current tenant/service/user/session/expert grant", "동일 기간·상태·응답 ID 필터의 UTF-8 BOM CSV; 게시 버전·행렬 행별 열; 5,000건·1,000열·20MB 상한; 다운로드 감사", undefined, "implemented");
for (const [path, query] of [["/forms/{id}/submissions", submissionListQuery], ["/forms/{id}/submissions/export", submissionFilters]] as const) {
  const properties = z.toJSONSchema(query).properties!;
  (paths[path].get as Operation).parameters = Object.entries(properties).map(([name, schema]) => ({ in: "query", name, schema }));
  (paths[path].get as Operation)["x-query-additional-properties"] = false;
}
(paths["/forms/{id}/submissions/export"].get as Operation).responses = { ...errors, "200": { description: "attachment CSV; private no-store; masked unavailable content; safe file names with file.read",
  headers: { "X-Export-Row-Count": { schema: { type: "integer", minimum: 0 } } }, content: { "text/csv": { schema: { type: "string" } } } } };
add("/public/forms/{token}", "get", "current active company/service/publication grant", "현재 공개 상태를 잠금 후 재확인해 게시 당시 질문·동의만 제공; 응답 한도 도달은 closed 표시", undefined, "implemented");
add("/public/forms/{token}/submissions", "post", "current active publication + idempotency + rate limit", "한도·필수항목·동의·파일 검증 후 원자 저장; 성공 재전송은 현재 공개 상태 재검사와 기존 응답만 반환", submissionInput, "implemented", "201");
schemas.PublicSubmissionReceipt = z.toJSONSchema(submissionReceiptSchema);
(paths["/public/forms/{token}/submissions"].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true,
  schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" } }];
paths["/public/forms/{token}"].parameters = paths["/public/forms/{token}/submissions"].parameters = [{ in: "path", name: "token", required: true,
  schema: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" } }];
(paths["/public/forms/{token}/submissions"].post as Operation).responses = { ...errors, "201": { description: "접수 당시 ID·시각·상태; 같은 키의 정상 재시도는 같은 값", content: { "application/json": { schema: { $ref: "#/components/schemas/PublicSubmissionReceipt" } } } } };
add("/submissions/{id}", "get", "submission.read + service grant", "응답·변경 이력·메모·동의 영수증; contentAvailable=false이면 원문·첨부 제외", undefined, "implemented");
add("/submissions/{id}", "patch", "submission.write + service grant", "응답 정정; 암호화된 이전 값 보존", correctionInput, "implemented");
for (const action of ["withdraw", "destruction-request", "hold"]) add("/submissions/{id}/" + action, "post",
  action === "withdraw" ? "submission.write + service grant" : "submission.destroy + service grant",
  action === "destruction-request" ? "파기 요청 등록; 실제 파기 완료 아님" : "응답 상태 변경 " + action,
  action === "hold" ? actionInput.extend({ hold: z.boolean() }) : actionInput, "implemented");
add("/submissions/{id}/notes", "post", "submission.write + service grant", "암호화 메모 생성", noteInput, "implemented", "201");
add("/submissions/{id}/notes/{noteId}", "patch", "submission.write + service grant", "메모 변경", noteInput.extend({ version: z.number().int().positive() }), "implemented");
add("/submissions/{id}/notes/{noteId}", "delete", "submission.write + service grant", "메모 물리 삭제 및 감사", undefined, "implemented", "204");
for (const path of ["/submissions/{id}/corrections", "/submissions/{id}/withdrawals", "/submissions/{id}/destruction"]) delete paths[path];
add("/submissions/{id}/retention", "patch", "submission.destroy + current service grant + allowRetentionAdjustment", "만료 전 원래 동의 기한 이내로 보유 기한 변경; 보존 조치·진행 중 파기 거부", retentionInput, "implemented");
add("/destruction-requests", "get", "submission.destroy + current service grant/session/expert scope", "현재 작업 권한·검색·정렬·페이지 보정을 포함한 파기 요청 이력; 중복/미지원 쿼리 거부", undefined, "implemented");
for (const action of ["approve", "reject", "cancel", "retry", "reschedule"]) add("/destruction-requests/{id}/" + action, "post",
  "submission.destroy + current service grant" + (["approve", "reject"].includes(action) ? " + active owner/admin" : ""),
  ({ approve: "보존 조치를 확인하고 파기 예약 승인; 실행 시 승인 권한 재검사", reject: "실행 전 파기 요청 반려",
    cancel: "실행 전 파기 예약 취소; 만료된 원문 열람은 계속 차단", retry: "실패한 파기 재시도 허용; 시작된 원문 접근은 계속 차단",
    reschedule: "보유 기한 이내의 일정 변경과 기존 승인 무효화" } as Record<string, string>)[action],
  action === "reschedule" ? destructionSchedule : destructionAction, "implemented");
add("/destruction-certificates", "get", "audit.read + current service grant/session/expert scope", "원문 삭제가 완료된 증명서 검색·정렬·페이지 보정; 연결된 본인인증/전자서명 삭제 건수", undefined, "implemented");
add("/destruction-certificates/{id}", "get", "audit.read + current service grant", "현재 DB·비공개 파일 파기 수량과 HMAC 무결성; 백업·WAL·외부 사본 제외", undefined, "implemented");
add("/destruction-certificates/{id}/download", "get", "audit.read + current service grant", "파기 증명서 JSON 다운로드·열람 감사", undefined, "implemented");
for (const path of ["/destruction-requests", "/destruction-certificates"]) (paths[path].get as Operation).parameters = [
  ...["serviceId", "submissionId"].map(name => ({ in: "query", name, schema: { type: "string", format: "uuid" } })),
  { in: "query", name: "page", schema: { type: "integer", minimum: 1, maximum: 100000, default: 1 }, description: "마지막 유효 페이지로 보정" },
  { in: "query", name: "pageSize", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
  { in: "query", name: "search", schema: { type: "string", maxLength: 100, default: "" }, description: "폼·서비스 이름 또는 요청/증명서·응답 ID" },
  { in: "query", name: "sort", schema: { type: "string", enum: ["createdAt", "name", path === "/destruction-requests" ? "dueAt" : "completedAt"], default: "createdAt" }, description: "증명서 createdAt는 completedAt와 같은 의미" },
  { in: "query", name: "direction", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
  ...(path === "/destruction-requests" ? [{ in: "query", name: "status", schema: { type: "string", enum: destructionStatuses } }] : []),
];
(paths["/destruction-certificates/{id}/download"].get as Operation).responses = { ...errors, "200": {
  description: "Content-Disposition: attachment; private,no-store; integrityVerified=true인 증명서",
  content: { "application/json": { schema: { type: "object" } } } } };
add("/fixed-urls", "get", "form.read + service grant", "고정 URL 목록", undefined, "implemented");
add("/fixed-urls", "post", "form.publish + service grant", "게시된 폼에 고정 URL 연결", fixedUrlInput, "implemented", "201");
add("/fixed-urls/{id}", "get", "form.read + service grant", "고정 URL 조회", undefined, "implemented");
add("/fixed-urls/{id}", "patch", "form.publish + current source/target service grants", "연결 대상·이름 변경; 현재 권한·게시본을 잠금 안에서 검사", fixedUrlPatch, "implemented");
const fixedUpdateSchema=(paths["/fixed-urls/{id}"].patch as Operation).requestBody as { content:{ "application/json":{ schema:Record<string,unknown> } } };
fixedUpdateSchema.content["application/json"].schema.anyOf=["name","formId"].map(name => ({ required:[name] }));
add("/fixed-urls/{id}", "delete", "form.publish + service grant", "고정 URL 회수", undefined, "implemented", "204");
add("/public/urls/{slug}", "get", "active fixed URL", "유효한 공개 폼 연결", undefined, "implemented");

add("/members", "get", "member.manage", "회사 구성원 검색·상태·페이지 목록", undefined, "implemented");
add("/members/{id}", "get", "member.manage", "회사 구성원 상세", undefined, "implemented");
add("/members/{id}", "patch", "member.manage + role ceiling", "역할·서비스 권한·정지 상태 변경", memberInput, "implemented");
const memberUpdateSchema = (paths["/members/{id}"].patch as { requestBody: { content: { "application/json": { schema: Record<string, unknown> } } } }).requestBody.content["application/json"].schema;
memberUpdateSchema.anyOf = ["role", "serviceIds", "status"].map(name => ({ required: [name] }));
add("/members/{id}", "delete", "member.manage + role ceiling", "구성원 제외·권한/세션 회수; 기록 유지", undefined, "implemented", "204");
add("/members/{id}/transfer", "post", "owner + current password", "소유권 이전; 마지막 소유자 DB 보호", version.extend({ password: z.string().min(1).max(128) }), "implemented");
add("/invitations", "get", "member.manage", "초대 이력과 만료 상태", undefined, "implemented");
add("/invitations", "post", "member.manage + role ceiling", "초대 생성과 암호화 메일 작업", invitationInput, "implemented", "201");
delete paths["/invitations/{id}"].get; delete paths["/invitations/{id}"].patch;
add("/invitations/{id}", "delete", "member.manage + role ceiling", "초대 취소; 갱신한 DTO 반환", undefined, "implemented");
add("/invitations/{id}/resend", "post", "member.manage + role ceiling", "토큰 교체와 초대 재발송", version, "implemented");
const tokenInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
add("/invitations/preview", "post", "verified matching email", "초대 미리보기; 토큰을 URL 조회 API에 전달하지 않음", tokenInput, "implemented");
add("/invitations/accept", "post", "verified matching email", "초대 한 번 소비·소속/서비스 권한 생성", tokenInput, "implemented");
add("/invitations/sso/options", "post", "valid bearer invitation + active company + allowed IP", "유효 초대의 활성 공급자 id/name/protocol만 조회", ssoInvitationToken, "implemented");
add("/invitations/sso/start", "post", "valid bearer invitation + same-company provider + allowed IP", "초대 token hash/version을 SSO state에 바인딩하고 IdP redirect 반환; 수락은 검증된 콜백에서 수행", ssoInvitationStart, "implemented");

for (const path of ["/form-templates", "/form-templates/{id}"]) delete paths[path];
add("/templates", "get", "form.read + service grant", "공용·허용 서비스 템플릿 검색·페이지 목록", undefined, "implemented");
add("/templates", "post", "form.write + service grant", "완전한 질문·동의·설정 템플릿 생성", templateInput, "implemented", "201");
add("/templates/{id}", "get", "form.read + service grant", "템플릿 전체 내용 조회", undefined, "implemented");
add("/templates/{id}", "patch", "form.write + service grant; public read-only", "템플릿 편집", templatePatch, "implemented");
const templateUpdateSchema = (paths["/templates/{id}"].patch as Operation).requestBody as { content: { "application/json": { schema: Record<string, unknown> } } };
templateUpdateSchema.content["application/json"].schema.anyOf = ["title", "category", "content"].map(name => ({ required: [name] }));
add("/templates/{id}", "delete", "form.write + service grant; public read-only", "템플릿 물리 삭제; 기존 복제 폼 유지", undefined, "implemented", "204");
add("/templates/{id}/use", "post", "form.write + target service grant", "전체 내용 복제와 새 질문 ID 생성", version.extend({ serviceId: z.uuid(), title: z.string().trim().min(1).max(200).optional() }), "implemented", "201");
(paths["/templates"].post as Operation).description += "; 생성 캐시는 회사·템플릿에 연결; 삭제 후 기존 생성 키는410";
(paths["/templates/{id}"].delete as Operation).description += "; 캐시 내용·요청 해시를 같은 transaction에서 삭제; 이전 형식은 회사 구성원 범위에서 검사; 독립 생성 폼은 유지";
{
  const querySchema = z.toJSONSchema(templateListQuery);
  (paths["/templates"].get as Operation).parameters = Object.entries(querySchema.properties ?? {}).map(([name, schema]) => ({ in: "query", name, required: false, schema }));
  schemas.TemplateReadActions = { type: "object", additionalProperties: false, required: ["preview", "use", "edit", "remove"], properties: Object.fromEntries(["preview", "use", "edit", "remove"].map(name => [name, { type: "boolean" }])) };
  schemas.TemplatePermissions = { type: "object", additionalProperties: false, required: ["canCreate", "targets"], properties: {
    canCreate: { type: "boolean" }, targets: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "name"], properties: { id: { type: "string", format: "uuid" }, name: { type: "string" } } } },
  } };
  schemas.TemplateRead = { type: "object", required: ["id", "serviceId", "serviceName", "scope", "title", "category", "content", "version", "createdAt", "updatedAt", "actions"], properties: {
    id: { type: "string", format: "uuid" }, serviceId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] }, serviceName: { type: ["string", "null"] }, scope: { enum: ["company", "public"] },
    title: { type: "string" }, category: { type: "string" }, content: z.toJSONSchema(formContentSchema), version: { type: "integer", minimum: 1 }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, actions: { $ref: "#/components/schemas/TemplateReadActions" },
  } };
  schemas.TemplatePage = { type: "object", required: ["items", "total", "page", "pageSize", "permissions"], properties: {
    items: { type: "array", items: { $ref: "#/components/schemas/TemplateRead" } }, total: { type: "integer", minimum: 0 }, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 }, permissions: { $ref: "#/components/schemas/TemplatePermissions" },
  } };
  for (const [path, schema] of [["/templates", "TemplatePage"], ["/templates/{id}", "TemplateRead"]]) {
    const operation = paths[path].get as Operation;
    operation.description += "; 현재 역할·grant·세션·전문가 배정·서비스 상태 검사; 보관 서비스는 직접 구성원만 읽기; GET 작업 권한·활성 생성 대상; 생성/수정/사용 멱등 응답에 권한 캐시 없음";
    (operation.responses as Record<string, unknown>)["200"] = { description: "현재 권한 검사 후 조회", content: { "application/json": { schema: { $ref: "#/components/schemas/" + schema } } } };
  }
}

for (const path of ["/services/{id}", "/forms/{id}", "/fixed-urls/{id}", "/members/{id}", "/invitations/{id}", "/templates/{id}", "/submissions/{id}/notes/{noteId}"]) {
  (paths[path].delete as Operation).parameters = [{ in: "header", name: "If-Match", required: true, schema: { type: "string", pattern: "^[1-9][0-9]*$" } }];
}
for (const path of ["/forms", "/forms/{id}/copy", "/forms/{id}/publish", "/public/forms/{token}/submissions", "/submissions/{id}/notes", "/fixed-urls", "/invitations", "/invitations/accept", "/templates", "/templates/{id}/use"]) {
  (paths[path].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" } }];
}
for (const [path, item] of Object.entries(paths)) if (path.startsWith("/public/") || path === "/health")
  for (const method of ["get", "post"]) if (item[method]) (item[method] as Operation).security = [];

add("/security/policy", "get", "security.read", "현재 회사의 비밀번호·세션·2FA·게시 승인·유한 보유 기한 파기 정책", undefined, "implemented");
add("/security/policy", "patch", "owner + current password + matching tenant", "정책 변경·경합 검사·진행 중 승인 무효화", policyPatch, "implemented");
add("/security/policy", "delete", "owner + current password + matching tenant", "비밀번호 12자·3개월·현재 암호 재사용 금지·유예 없음·세션 30분·2FA/승인 선택으로 기본값 복원", policyReset, "implemented");
add("/forms/{id}/approvals", "get", "form.read + service grant", "승인 이력·검토본·현재 승인 정책 및 권한", undefined, "implemented");
add("/forms/{id}/approvals", "post", "form.write + service grant", "현재 초안의 전체 검토본을 고정하고 승인 요청", approvalRequestInput, "implemented", "201");
add("/approvals", "get", "form.read + service grant", "서비스·제목·상태별 승인 이력과 페이지 목록", undefined, "implemented");
add("/approvals/{id}", "get", "form.read + service grant", "요청·결정 내용과 검토 당시 질문/설정", undefined, "implemented");
add("/approvals/{id}", "delete", "requester or owner + form.write + service grant", "대기 중 요청 취소; 증거는 유지", approvalCancelInput, "implemented");
add("/approvals/{id}/decision", "post", "configured approval role + form.approve + service grant", "변경되지 않은 검토본의 승인/반려; 동시 결정 하나만 허용", approvalDecisionInput, "implemented");
(paths["/forms/{id}/approvals"].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" } }];
for (const [path,query] of [["/fixed-urls",fixedUrlQuery],["/approvals",approvalQuery]] as const) {
  (paths[path].get as Operation).parameters=Object.entries(z.toJSONSchema(query).properties!).map(([name,schema]) => ({ in:"query",name,schema }));
  (paths[path].get as Operation)["x-query-additional-properties"]=false;
  (paths[path].get as Operation).description="현재 계정/세션/전문가/서비스 범위를 transaction 안에서 검사하며 범위를 벗어난 page는 마지막 페이지로 보정합니다.";
}
for (const path of ["/forms/{id}/publish","/forms/{id}/approvals","/fixed-urls"]) (paths[path].post as Operation).description="같은 키의 재전송에도 현재 계정·세션·전문가·서비스 권한과 서비스/폼 활성 상태를 검사한 뒤 기존 결과를 반환합니다.";

for (const [path, title, input, patch] of [
  ["/processing-purposes", "수집 목적", purposeInput, purposePatch],
  ["/recipients", "제공·수탁자", recipientInput, recipientPatch],
] as const) {
  add(path, "get", "document.read + current service grant", title + " 검색·상태 필터·안정 페이지 목록", undefined, "implemented");
  add(path, "post", "document.write + current service grant + active service", title + " 생성과 불변 개정본·감사 원자 저장", input, "implemented", "201");
  add(path + "/{id}", "get", "document.read + current service grant", title + " 상세; 연결된 제공자의 현재 값 포함", undefined, "implemented");
  add(path + "/{id}", "patch", "document.write + current service grant + active service", title + " 전체 허용 필드 교체·version 충돌 검사; 서비스 변경 금지", patch, "implemented");
  add(path + "/{id}", "delete", "document.write + current service grant + active service", title + " 보관; 사용 중인 목적에 연결된 제공자 차단·이력 유지", undefined, "implemented", "204");
  add(path + "/{id}/restore", "post", "document.write + current service grant + active service", title + " 복원; 이름 중복·보관된 연결 자료 검사", catalogAction, "implemented");
  add(path + "/{id}/history", "get", "document.read + current service grant", title + " 불변 개정본을 version 내림차순으로 페이지 조회", undefined, "implemented");
  (paths[path].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" } }];
  (paths[path + "/{id}"].delete as Operation).parameters = [{ in: "header", name: "If-Match", required: true, schema: { type: "integer", minimum: 1 } }];
  (paths[path].get as Operation).parameters = [
    { in: "query", name: "serviceId", schema: { type: "string", format: "uuid" } },
    { in: "query", name: "status", schema: { type: "string", enum: ["active", "archived", "all"], default: "active" } },
    { in: "query", name: "search", schema: { type: "string", maxLength: 100 } },
    { in: "query", name: "sort", schema: { type: "string", enum: ["createdAt", "name"], default: "createdAt" } },
    { in: "query", name: "direction", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
  ];
  for (const operation of [paths[path].get, paths[path + "/{id}/history"].get] as Operation[]) operation.parameters = [
    ...((operation.parameters ?? []) as unknown[]),
    { in: "query", name: "page", schema: { type: "integer", minimum: 1, maximum: 100000, default: 1 } },
    { in: "query", name: "pageSize", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
  ];
  for (const operation of [paths[path].post, paths[path + "/{id}"].patch] as Operation[]) operation["x-validation"] =
    "days=1..36500; 다른 기간 유형은 days=null 및 종료/보존 기준 필수. 항목 이름 NFKC·공백·대소문자 정규화 중복 거부. 회사·서비스 복합 FK. 비동의 근거 설명 필수. 국외 제공/수탁은 연락처·방법·시기·거부 안내 필수.";
}
schemas.ProcessingPurposeInput = z.toJSONSchema(purposeInput);
schemas.RecipientInput = z.toJSONSchema(recipientInput);
for (const operation of [paths["/recipients"].post, paths["/recipients/{id}"].patch] as { requestBody: { content: { "application/json": { schema: { properties: { countryCode: object } } } } } }[])
  operation.requestBody.content["application/json"].schema.properties.countryCode = { type: "string", enum: regionCodes, description: "고정 Unicode CLDR regular 국가·지역 코드 257개" };

add("/imports", "get", "import.read + current service grant + final session deadline", "회사·서비스별 업로드 제목/ID 검색·상태·정렬·보정 페이지; 중복/미지원 쿼리 거절", undefined, "implemented");
add("/imports", "post", "import.write + current service grant + Idempotency-Key", "CSV 작업·용량 예약·24시간 원본 업로드 생성", importCreate, "implemented", "201");
add("/imports/options", "get", "import.read + current service grant", "동일 서비스의 사용 중인 수집 목적·원자료 제공자", undefined, "implemented");
add("/imports/{id}", "get", "import.read + current service grant + final session deadline", "현재 역할·서비스·작업 상태별 permissions, 진행·설정·계수; 만료 원문/파일명 제외", undefined, "implemented");
add("/imports/{id}", "patch", "import.write + current service grant + version", "수집 근거·컬럼 설정 수정; 기존 검증 무효화", importPatch, "implemented");
add("/imports/{id}", "delete", "import.write + current service grant + If-Match", "임시 자료 삭제 및 취소/보관; 반영된 응답 유지", undefined, "implemented");
for (const [action, summary] of [["inspect", "안전 검사한 CSV의 헤더·행 수 확인"], ["validate", "행별 타입·동의·기한·중복 검증; 응답 생성 0"],
  ["commit", "검증 당시 근거 확인 후 비동기 반영 요청"], ["retry", "권한 재확인 후 중단 작업 재시도"]])
  add("/imports/{id}/" + action, "post", "import.write + current service grant + version", summary, importAction, "implemented", ["commit", "retry"].includes(action) ? "202" : "200");
add("/imports/{id}/rows", "get", "import.read + current service grant; unexpired staging", "행 미리보기·페이지·오류 필터; 파기/만료 응답 원문 차단", undefined, "implemented");
add("/imports/{id}/errors.csv", "get", "import.read + current service grant; unexpired staging", "실패행 CSV·수식 시작 문자 방어·다운로드 감사", undefined, "implemented");
for (const path of ["/imports", "/imports/options"]) (paths[path].get as Operation).parameters = [
  { in: "query", name: "serviceId", required: true, schema: { type: "string", format: "uuid" } }];
(paths["/imports"].get as Operation).parameters = [...((paths["/imports"].get as Operation).parameters as object[]),
  ...["page", "pageSize"].map(name => ({ in: "query", name, schema: { type: "integer", minimum: 1, maximum: name === "page" ? 100000 : 100, default: name === "page" ? 1 : 20 } })),
  { in: "query", name: "search", schema: { type: "string", maxLength: 100 } },
  { in: "query", name: "sort", schema: { type: "string", enum: ["createdAt", "name"], default: "createdAt" } },
  { in: "query", name: "direction", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
  { in: "query", name: "status", schema: { type: "string", enum: ["uploading", "draft", "validated", "committing", "retry", "failed", "completed", "partialFailed", "cancelled", "expired", "archived"] } }];
(paths["/imports/{id}/rows"].get as Operation).parameters = [
  { in: "query", name: "page", schema: { type: "integer", minimum: 1, maximum: 100000, default: 1 } },
  { in: "query", name: "pageSize", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
  { in: "query", name: "errorsOnly", schema: { type: "string", enum: ["true", "false"], default: "false" } }];
(paths["/imports"].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 16, maxLength: 128 } }];
(paths["/imports/{id}"].delete as Operation).parameters = [{ in: "header", name: "If-Match", required: true, schema: { type: "string", pattern: "^[1-9][0-9]*$", description: "현재 version의 안전한 정수 십진 표현" } }];
(paths["/imports/{id}/errors.csv"].get as Operation).responses = { "200": { description: "UTF-8 BOM CSV attachment", content: { "text/csv": { schema: { type: "string" } } } } };
schemas.ImportCreate = z.toJSONSchema(importCreate); schemas.ImportPatch = z.toJSONSchema(importPatch);

for (const [path, label, input, patch] of [["/documents", "문서", documentInput, documentPatch], ["/clause-templates", "문구", clauseInput, clausePatch]] as const) {
  add(path, "get", "document.read + current service grant", label + " 서비스·제목·유형·상태별 페이지 조회", undefined, "implemented");
  add(path, "post", "document.write + current service grant", label + " 생성·감사 원자 저장", input, "implemented", "201");
  add(path + "/{id}", "get", "document.read + current service grant", label + " 상세 조회", undefined, "implemented");
  add(path + "/{id}", "patch", "document.write + current service grant", label + " 수정; 서비스·유형 불변", patch, "implemented");
  add(path + "/{id}", "delete", "document.write + current service grant", label + " 보관; 게시 버전 유지·공개 링크 회수", undefined, "implemented", "204");
  add(path + "/{id}/restore", "post", "document.write + current service grant", label + " 복원; 회수한 공개 링크는 유지", documentAction, "implemented");
  (paths[path].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 16, maxLength: 128 } }];
  (paths[path + "/{id}"].delete as Operation).parameters = [{ in: "header", name: "If-Match", required: true, schema: { type: "integer", minimum: 1 } }];
  (paths[path].get as Operation).parameters = [
    { in: "query", name: "serviceId", schema: { type: "string", format: "uuid" } },
    { in: "query", name: "type", schema: { type: "string", enum: ["consent", "privacy_policy", "overseas_transfer"] } },
    { in: "query", name: "status", schema: { type: "string", enum: path === "/documents" ? ["all", "draft", "published", "private", "archived"] : ["all", "active", "archived"] } },
    { in: "query", name: "search", schema: { type: "string", maxLength: 100 } },
    { in: "query", name: "page", schema: { type: "integer", minimum: 1, maximum: 100000, default: 1 } },
    { in: "query", name: "pageSize", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
  ];
}
add("/documents/options", "get", "document.read + current service grant", "사용 중인 수집 목적·제공/수탁자·문구·게시 처리방침 선택 목록", undefined, "implemented");
(paths["/documents/options"].get as Operation).parameters = [{ in: "query", name: "serviceId", required: true, schema: { type: "string", format: "uuid" } }];
add("/documents/{id}/preview", "get", "document.read + current service grant", "저장된 초안과 현재 기초 자료의 텍스트 미리보기·게시 검증", undefined, "implemented");
add("/documents/{id}/versions", "get", "document.read + current service grant", "불변 게시 버전·비교용 본문·SHA-256·링크 목록; 유효한 공유 주소는 쓰기 권한에만 제공", undefined, "implemented");
add("/documents/{id}/publish", "post", "document.write + current service grant", "본문·수집 자료 스냅샷과 공개 링크 생성; 최신 게시 버전의 링크가 닫히면 동일 내용 재게시 허용·과거 버전 유지", documentPublish, "implemented", "201");
add("/documents/{id}/unpublish", "post", "document.write + current service grant", "모든 공개 링크 회수; 서비스에 연결된 처리방침은 차단", documentAction, "implemented");
add("/documents/{id}/revoke", "post", "document.write + current service grant", "지정한 게시 링크 회수", documentAction.extend({ publicationId: z.uuid() }), "implemented");
add("/documents/{id}/apply-clause", "post", "document.write + current service grant", "동일 서비스·유형의 선택 버전 문구를 초안 본문에 복사", clauseApply, "implemented");
add("/public/documents/{token}", "get", "active company/service/document/publication + expiry", "공개 필드만 포함한 고정 버전 조회; 비인증 허용", undefined, "implemented");
(paths["/public/documents/{token}"].get as Operation).security = [];
for (const path of ["/documents/{id}/versions/{number}/pdf", "/public/documents/{token}/pdf"]) {
  add(path, "get", path.startsWith("/public/") ? "active company/service/document/publication + expiry" : "document.read + current service grant", "게시 버전의 고정 PDF 바이트; 최초 생성 후 불변 보존·한글 글꼴 포함", undefined, "implemented");
  const operation = paths[path].get as Operation;
  operation.responses = { ...errors, "200": { description: "PDF 파일. attachment, no-store, nosniff, X-PDF-SHA256, X-Document-SHA256", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } } };
  if (path.startsWith("/public/")) operation.security = [];
}
add("/services/{id}/consent-display/{kind}", "get", "service.manage + current service grant", "collection/third_party 표시 설정·회사/서비스 공개명 조회", undefined, "implemented");
add("/services/{id}/consent-display/{kind}", "patch", "service.manage + current service grant", "표시 문구·HTTPS 외부 주소 또는 동일 서비스 처리방침 게시 버전 저장; 최초 version=0", displayInput, "implemented");
add("/services/{id}/subprocessors", "get", "service.manage + current service grant", "현재 서비스의 재위탁 수신자 목록. 암호문 제외", undefined, "implemented");
add("/services/{id}/subprocessors", "post", "service.manage + current service grant", "재위탁 수신자 등록. 같은 이메일 중복과 보관 수신자 재등록 거부", subprocessorInput, "implemented", "201");
add("/services/{id}/subprocessors/{subId}", "get", "service.manage + current service grant", "현재 재위탁 수신자 상세와 version 조회", undefined, "implemented");
add("/services/{id}/subprocessors/{subId}", "patch", "service.manage + current service grant", "재위탁 수신자 수정·보관·복원. version 충돌 검사", subprocessorPatch, "implemented");
add("/services/{id}/subprocessor-notices", "get", "service.manage + current service grant", "재위탁 안내 발송 이력. 본문 암호문 제외", undefined, "implemented");
add("/services/{id}/subprocessor-notices", "post", "service.manage + current service grant", "확인한 수신자 version으로 재위탁 안내를 메일 대기열에 기록. 주소 변경 충돌과 같은 수신자·제목·본문 재발송 거부", subprocessorNoticeInput, "implemented", "201");
schemas.DocumentInput = z.toJSONSchema(documentInput); schemas.ClauseInput = z.toJSONSchema(clauseInput); schemas.ServiceConsentDisplayInput = z.toJSONSchema(displayInput);
schemas.DocumentRecord = z.toJSONSchema(documentInput.extend({ id: z.uuid(), version: z.number().int().positive(), draftRevision: z.number().int().positive(),
  status: z.enum(["draft", "published", "private", "archived"]), serviceName: z.string(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  latestNumber: z.number().int().nonnegative(), hasUnpublishedChanges: z.boolean(), hasActivePublication: z.boolean().describe("최신 게시 버전에 활성·미만료 공개 링크가 있는지 여부") }));
const documentRef = { $ref: "#/components/schemas/DocumentRecord" };
const documentReply = { description: "현재 초안과 유효 공개 링크 여부. 내부 토큰·암호문 제외.", content: { "application/json": { schema: documentRef } } };
for (const [path, method, status] of [["/documents", "post", "201"], ["/documents/{id}", "get", "200"], ["/documents/{id}", "patch", "200"],
  ["/documents/{id}/restore", "post", "200"], ["/documents/{id}/unpublish", "post", "200"], ["/documents/{id}/revoke", "post", "200"], ["/documents/{id}/apply-clause", "post", "200"]] as const)
  (paths[path][method] as Operation).responses = { ...errors, [status]: documentReply };
(paths["/documents"].get as Operation).responses = { ...errors, "200": { description: "현재 권한 범위의 문서 목록", content: { "application/json": { schema: {
  type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize"], properties: { items: { type: "array", items: documentRef },
    total: { type: "integer", minimum: 0 }, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 } },
} } } } };
(paths["/documents/{id}/publish"].post as Operation).responses = { ...errors, "201": { description: "새 불변 게시 버전과 공개 링크", content: { "application/json": { schema: {
  type: "object", additionalProperties: false, required: ["document", "number", "publicationId", "url"], properties: { document: documentRef,
    number: { type: "integer", minimum: 1 }, publicationId: { type: "string", format: "uuid" }, url: { type: "string", pattern: "^/document/view/[A-Za-z0-9_-]{43}$" } },
} } } } };

add("/forms/document-options", "get", "form.read + document.read + current service grant", "같은 서비스에서 공개 중인 동의서 게시 버전 검색·페이지 목록", undefined, "implemented");
(paths["/forms/document-options"].get as Operation).parameters = [
  { in: "query", name: "serviceId", required: true, schema: { type: "string", format: "uuid" } },
  { in: "query", name: "search", schema: { type: "string" } },
  ...["page", "pageSize"].map(name => ({ in: "query", name, schema: { type: "integer", minimum: 1 } })),
];
add("/submissions/{id}/receipts/{receiptId}/pdf", "get", "submission.read + current service grant + unexpired or held submission", "제출 당시 암호화해 보관한 동의 영수증 PDF; 파기 후 접근 차단", undefined, "implemented");
(paths["/submissions/{id}/receipts/{receiptId}/pdf"].get as Operation).responses = { ...errors, "200": { description: "저장한 PDF 바이트. no-store, X-PDF-SHA256, X-Document-SHA256", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } } };

add("/share-grants", "get", "share.manage + submission.read + current session/service grant", "formId의 외부 공유 목록; 이메일 전체 일치 검색·상태·페이지 보정·현재 작업 권한; 중복/미지정 쿼리422", undefined, "implemented");
add("/share-grants", "post", "share.manage + submission.read (+ file.read for file fields) + active form/service/current session", "지정 게시 버전/필드의 초대; 재전송도 현재 권한/기한 검사; 변경·재발송·회수 후 신규/이전 캐시 원문 제거", shareCreateInput, "implemented", "201");
add("/share-grants/options", "get", "share.manage + submission.read + current session/service grant", "게시 버전·질문 선택 목록; 현재 초대/파일 권한과 선택 가능 여부", undefined, "implemented");
add("/share-grants/{id}", "get", "share.manage + submission.read + current service grant", "외부 공유 안전 DTO", undefined, "implemented");
add("/share-grants/{id}", "patch", "share.manage + submission.read + current service grant", "이메일·필드·기한 변경, 초대 코드 교체·세션 무효화·새 메일", shareUpdateInput, "implemented");
add("/share-grants/{id}", "delete", "share.manage + submission.read + If-Match", "공유 회수; 현재 세션·인증코드·파일 접근 차단", undefined, "implemented");
add("/share-grants/{id}/resend", "post", "share.manage + submission.read (+ file.read for file fields) + active form/service/current session", "초대 재발송·이전 코드와 세션/생성 캐시 무효화; 성공 감사 저장 후 실제 세션/공유 기한 검사", shareVersionInput, "implemented");
add("/share-grants/{id}/events", "get", "share.manage + submission.read", "개인정보 값·코드 없는 열람 로그 페이지", undefined, "implemented");
(paths["/share-grants"].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 16, maxLength: 128 } }];
(paths["/share-grants/{id}"].delete as Operation).parameters = [{ in: "header", name: "If-Match", required: true, schema: { type: "integer", minimum: 1 } }];
for (const path of ["/share-grants", "/share-grants/options"]) (paths[path].get as Operation).parameters = [{ in: "query", name: "formId", required: true, schema: { type: "string", format: "uuid" } }];
const sharingPagination = [{ in: "query", name: "page", schema: { type: "integer", minimum: 1, maximum: 100000, default: 1 } },
  { in: "query", name: "pageSize", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }];
(paths["/share-grants"].get as Operation).parameters = [...((paths["/share-grants"].get as Operation).parameters as unknown[]), ...sharingPagination,
  { in: "query", name: "status", schema: { type: "string", enum: ["all", "active", "expired", "revoked"], default: "all" } },
  { in: "query", name: "search", schema: { type: "string", maxLength: 254, default: "" } }];
(paths["/share-grants/{id}/events"].get as Operation).parameters = sharingPagination;
const sharedQuestionProperties = { id: { type: "string", format: "uuid" }, label: { type: "string" }, type: { type: "string" }, rows: z.toJSONSchema(rowSchema.array(), { target: "draft-7" }) };
schemas.SharedQuestion = { type: "object", additionalProperties: false, required: ["id", "label", "type"], properties: sharedQuestionProperties };
schemas.SharePermissions = { type: "object", additionalProperties: false, required: ["canCreate", "canSelectFiles", "reason"],
  properties: { canCreate: { type: "boolean" }, canSelectFiles: { type: "boolean" }, reason: { type: ["string", "null"] } } };
schemas.ShareActions = { type: "object", additionalProperties: false, required: ["edit", "resend", "revoke"],
  properties: { edit: { type: "boolean" }, resend: { type: "boolean" }, revoke: { type: "boolean" } } };
schemas.ShareRecord = { type: "object", additionalProperties: false, required: ["id", "formId", "formVersionId", "formTitle", "formNumber", "email", "questionIds", "questions", "expiresAt", "status", "version", "createdAt", "actions"],
  properties: { id: { type: "string", format: "uuid" }, formId: { type: "string", format: "uuid" }, formVersionId: { type: "string", format: "uuid" },
    formTitle: { type: "string" }, formNumber: { type: "integer", minimum: 1 }, email: { type: "string", format: "email" }, questionIds: { type: "array", uniqueItems: true, items: { type: "string", format: "uuid" } },
    questions: { type: "array", items: { $ref: "#/components/schemas/SharedQuestion" } }, expiresAt: { type: "string", format: "date-time" }, createdAt: { type: "string", format: "date-time" },
    status: { type: "string", enum: ["active", "expired", "revoked"] }, version: { type: "integer", minimum: 1 }, actions: { $ref: "#/components/schemas/ShareActions" } } };
schemas.SharePage = { type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize", "permissions"], properties: {
  items: { type: "array", items: { $ref: "#/components/schemas/ShareRecord" } }, total: { type: "integer", minimum: 0 }, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 }, permissions: { $ref: "#/components/schemas/SharePermissions" } } };
schemas.ShareOptions = { type: "object", additionalProperties: false, required: ["formCode", "permissions", "versions"], properties: {
  formCode: { type: "string", format: "uuid" }, permissions: { $ref: "#/components/schemas/SharePermissions" }, versions: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["id", "number", "title", "questions"], properties: { id: { type: "string", format: "uuid" }, number: { type: "integer", minimum: 1 }, title: { type: "string" },
      questions: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "label", "type", "selectable"], properties: { ...sharedQuestionProperties, selectable: { type: "boolean" } } } } } } } } };
for (const [path, method, status, schema] of [["/share-grants", "get", "200", "SharePage"], ["/share-grants", "post", "201", "ShareRecord"],
  ["/share-grants/options", "get", "200", "ShareOptions"], ["/share-grants/{id}", "get", "200", "ShareRecord"], ["/share-grants/{id}", "patch", "200", "ShareRecord"],
  ["/share-grants/{id}", "delete", "200", "ShareRecord"], ["/share-grants/{id}/resend", "post", "200", "ShareRecord"]])
  (paths[path][method] as Operation).responses = { ...errors, [status]: { description: "현재 공유 상태/권한 DTO. private, no-store.", content: { "application/json": { schema: { $ref: "#/components/schemas/" + schema } } } } };
add("/viewer/challenges", "post", "invitation code + form code + email + consent; rate limit", "이메일 인증 요청; 유효/무효 조합에 동일 응답, 브라우저 바인딩 쿠키 설정", challengeInput, "implemented", "202");
add("/viewer/challenges/{challengeId}/verify", "post", "HttpOnly browser challenge cookie", "6자리 일회용 코드 검증; 5회 제한·10분 만료·30분 열람 세션; 성공 감사 저장 후 기한 종료 시422/인증 세션·감사 롤백", verificationInput, "implemented");
add("/viewer/session", "get", "active viewer + fresh grant/scope/creator permission", "외부 열람 세션·기한·허용 필드", undefined, "implemented");
add("/viewer/logout", "post", "viewer cookie", "열람 세션 회수·쿠키 만료", undefined, "implemented", "204");
add("/viewer/submissions", "get", "active viewer + fresh grant/scope/creator permission", "허용 게시 버전·필드의 현재 응답; 철회·파기·만료는 제외", undefined, "implemented");
add("/viewer/submissions/{id}", "get", "active viewer + fresh grant + bound version", "허용 필드만 포함한 응답; 메모·정정 이력·영수증 제외", undefined, "implemented");
(paths["/viewer/submissions"].get as Operation).parameters = sharingPagination;
add("/viewer/files", "get", "active viewer + selected file question + current answer", "공유 응답의 현재 첨부파일 목록", undefined, "implemented");
add("/viewer/files/{id}", "get", "active viewer + exact submission/question/file binding", "허용된 현재 첨부파일 메타", undefined, "implemented");
add("/viewer/files/{id}/download", "get", "active viewer + exact submission/question/file binding", "공유·응답·파일 잠금 아래 비공개 다운로드; 읽기 후 발급자·공유·열람 세션·응답 기한을 재검사", undefined, "implemented");
for (const [path, item] of Object.entries(paths).filter(([path]) => path.startsWith("/viewer/"))) {
  for (const method of ["get", "post"]) if (item[method]) (item[method] as Operation).security = path === "/viewer/challenges" ? [] :
    path.includes("/verify") ? [{ viewerChallenge: [] }] : [{ viewerSession: [] }];
}
for (const path of ["/viewer/files", "/viewer/files/{id}", "/viewer/files/{id}/download"]) (paths[path].get as Operation).parameters =
  (path === "/viewer/files" ? ["submissionId"] : ["submissionId", "questionId"]).map(name => ({ in: "query", name, required: true, schema: { type: "string", format: "uuid" } }));
(paths["/viewer/files/{id}/download"].get as Operation).responses = { ...errors, "200": { description: "첨부파일 원본. attachment, private/no-store, nosniff, sandbox CSP", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } } };
for (const path of ["/files", "/viewer/files"]) (paths[path].get as Operation).parameters = [
  ...((paths[path].get as Operation).parameters as unknown[]),
  { in: "query", name: "page", schema: { type: "integer", minimum: 1, maximum: 100000, default: 1 } },
  { in: "query", name: "pageSize", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
];

add("/subjects/access-requests", "post", "public + consent + rate limit", "이름·이메일 조회에 동일 202 응답; 10분 브라우저 연결 일회용 메일", subjectAccessInput, "implemented", "202");
add("/subjects/sessions", "post", "subject browser cookie + one-use email token", "메일 링크 소비 후 30분 HttpOnly 세션, 비밀 없는 조회 ID 반환", subjectSessionInput, "implemented", "201");
add("/subjects/logout", "post", "subject cookie", "현재 정보주체 세션 종료", undefined, "implemented", "204");
add("/subjects/me", "get", "subject cookie + X-Subject-Session", "세션 ID·만료일; URL ID와 쿠키 세션 일치 검사", undefined, "implemented");
add("/subjects/me/consents", "get", "fixed verified subject scopes + retained submissions", "본인 동의 목록·페이지; 답변·관리자 메모 제외", undefined, "implemented");
add("/subjects/me/events", "get", "fixed verified subject scopes + retained submissions", "동의·CSV 등록·철회 이벤트 페이지", undefined, "implemented");
add("/subjects/me/withdrawals", "post", "subject session + own consent + optimistic version", "철회 확인 요청 생성; 동일 진행 중 요청 재사용", subjectWithdrawalInput, "implemented", "201");
add("/subjects/me/withdrawals/{id}", "get", "matching subject session + own consent", "실제 철회 요청 상태 조회", undefined, "implemented");
add("/subjects/me/withdrawals/{id}/confirm", "post", "matching session + version + own consent", "철회·불변 이벤트·서비스 이메일 발송 차단을 원자 저장; 완료 중복 요청 멱등", undefined, "implemented");
add("/subjects/me/withdrawals/{id}/cancel", "post", "matching subject session + pending request", "철회 요청 취소; 동의 유지", undefined, "implemented");
for (const [path, item] of Object.entries(paths).filter(([path]) => path.startsWith("/subjects/"))) {
  for (const method of ["get", "post"]) if (item[method]) {
    const operation = item[method] as Operation;
    operation.security = path.endsWith("access-requests") ? [] : path.endsWith("sessions") ? [{ subjectBrowser: [] }] : [{ subjectSession: [] }];
    if (path.startsWith("/subjects/me")) operation.parameters = [{ in: "header", name: "X-Subject-Session", required: true, schema: { type: "string", format: "uuid" } }];
  }
}
const subjectSessionSchema = z.object({ id: z.uuid(), expiresAt: z.iso.datetime() }).strict();
const subjectReceiptSchema = z.object({ id: z.uuid(), purpose: z.string(), grantedAt: z.iso.datetime(), retentionDays: z.number().int(), documentHash: z.string(), withdrawnAt: z.iso.datetime().nullable() }).strict();
const subjectConsentSchema = z.object({ id: z.uuid(), version: z.number().int().positive(), company: z.string(), service: z.string(), title: z.string(),
  status: z.enum(["submitted", "corrected", "withdrawn"]), submittedAt: z.iso.datetime(), retentionUntil: z.iso.datetime(), canWithdraw: z.boolean(), receipts: subjectReceiptSchema.array() }).strict();
const subjectEventSchema = z.object({ id: z.uuid(), type: z.enum(["granted", "imported", "withdrawn"]), createdAt: z.iso.datetime(), submissionId: z.uuid(), title: z.string(), company: z.string(), service: z.string(), purpose: z.string() }).strict();
const subjectWithdrawalSchema = z.object({ id: z.uuid(), sessionId: z.uuid(), title: z.string(), company: z.string(), service: z.string(), status: z.enum(["requested", "completed", "cancelled"]), createdAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable() }).strict();
const subjectPagedSchema = (item: z.ZodType) => z.object({ items: item.array(), total: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.number().int().min(1).max(100) }).strict();
for (const [name, schema] of Object.entries({ SubjectAccepted: z.object({ accepted: z.literal(true) }).strict(), SubjectSession: subjectSessionSchema,
  SubjectConsent: subjectConsentSchema, SubjectEvent: subjectEventSchema, SubjectWithdrawal: subjectWithdrawalSchema,
  SubjectConsentPage: subjectPagedSchema(subjectConsentSchema), SubjectEventPage: subjectPagedSchema(subjectEventSchema) })) schemas[name] = z.toJSONSchema(schema);
for (const [path, method, code, name] of [
  ["/subjects/access-requests", "post", "202", "SubjectAccepted"], ["/subjects/sessions", "post", "201", "SubjectSession"], ["/subjects/me", "get", "200", "SubjectSession"],
  ["/subjects/me/consents", "get", "200", "SubjectConsentPage"], ["/subjects/me/events", "get", "200", "SubjectEventPage"],
  ["/subjects/me/withdrawals", "post", "201", "SubjectWithdrawal"], ["/subjects/me/withdrawals/{id}", "get", "200", "SubjectWithdrawal"],
  ["/subjects/me/withdrawals/{id}/confirm", "post", "200", "SubjectWithdrawal"], ["/subjects/me/withdrawals/{id}/cancel", "post", "200", "SubjectWithdrawal"],
]) { const responses = (paths[path][method] as Operation).responses as Record<string, Record<string, unknown>>; responses[code].content = { "application/json": { schema: { $ref: "#/components/schemas/" + name } } }; }
for (const path of ["/subjects/me/consents", "/subjects/me/events"]) {
  const operation = paths[path].get as Operation;
  operation.parameters = [...operation.parameters as unknown[], ...["page", "pageSize"].map(name => ({ in: "query", name, schema: { type: "integer", minimum: 1, maximum: name === "page" ? 100000 : 100, default: name === "page" ? 1 : 20 } }))];
  operation["x-query-validation"] = "Only page/pageSize; duplicate/unknown keys return 422; clamp to last retained page";
}

add("/marketing/preferences", "get", "marketing.read + current service grant", "채널·상태·제외·정규화 완전일치 검색 및 서버 페이지", undefined, "implemented");
add("/marketing/preferences", "post", "marketing.write + submission.read + service grant", "기존 폼/CSV 응답과 별도 동의 근거로 채널 등록; 요청 키 멱등", marketingCreate, "implemented", "201");
add("/marketing/preferences/{id}", "get", "marketing.read + service grant", "연락처·출처·근거·최근 100개 불변 이력, 보유 기한 종료 후 원문 제외", undefined, "implemented");
add("/marketing/preferences/{id}", "patch", "marketing.write + current version", "채널별 발송 제외 변경과 변경 이력", marketingChange, "implemented");
add("/marketing/preferences/{id}", "delete", "marketing.write + current version", "연락처·근거·메일 큐/로컬 사본 삭제, 최소 발송 거부 기록 유지", z.object({ serviceId: z.uuid(), version: z.number().int().positive() }), "implemented");
add("/marketing/preferences/withdrawals", "post", "marketing.write + service grant + versions", "최대 100개 원자 철회, 같은 철회 반복은 멱등", z.object({ serviceId: z.uuid(), items: marketingVersions }), "implemented");
add("/marketing/preferences/export", "get", "marketing.read + service grant", "동일 검색 조건 CSV, 5000건 상한·수식 무해화", undefined, "implemented");
add("/marketing/sources", "get", "marketing.write + submission.read + service grant", "유효한 원본 응답의 텍스트 항목 선택, 20개 페이지", undefined, "implemented");
add("/marketing/summary", "get", "marketing.read + current service grants", "동일 DB 시점의 현재 동의·철회·삭제·수신 차단·발송 가능과 기간 내 변경 이력 집계", undefined, "implemented");
(paths["/marketing/summary"].get as Operation).parameters = [
  { in: "query", name: "serviceId", schema: { type: "string", format: "uuid" }, description: "접근 가능한 단일 활성 서비스" },
  { in: "query", name: "search", schema: { type: "string", maxLength: 100 } },
  { in: "query", name: "from", schema: { type: "string", format: "date-time" }, description: "변경 이벤트 포함 시작 시각" },
  { in: "query", name: "to", schema: { type: "string", format: "date-time" }, description: "변경 이벤트 미포함 종료 시각; 현재 이후면 현재 시각으로 제한" },
];
add("/sms/receipts", "post", "signed sms provider webhook", "서명된 문자 결과만 접수. 같은 영수증은 한 번이고 sent로 표시하지 않음", z.object({ deliveryId: z.uuid(), receiptId: z.string(), outcome: z.enum(["accepted", "failed", "timeout"]) }).strict(), "implemented", "202");
add("/kakao/channels", "get", "message.manage + current service", "현재 서비스의 카카오 채널. 공급자 확인 전 verified가 아님", undefined, "implemented");
add("/kakao/channels", "post", "message.manage + current service", "카카오 채널 등록. 같은 검색 아이디 거부", kakaoChannelInput, "implemented", "201");
add("/kakao/channels/{id}", "patch", "message.manage + current service", "채널 이름·보관. 사용 중 템플릿이 있으면 보관 거부. 자체 인증 불가", kakaoChannelPatch, "implemented");
add("/kakao/channels/{id}/verify", "post", "message.manage + current service", "공급자 없으면 503이며 pending 유지", undefined, "implemented");
add("/kakao/templates", "get", "message.manage + current service", "알림톡 템플릿 목록", undefined, "implemented");
add("/kakao/templates", "post", "message.manage + current service", "알림톡 템플릿 초안", kakaoTemplateInput, "implemented", "201");
add("/kakao/templates/preview", "post", "message.manage", "변수 치환 미리보기. 저장하지 않음", kakaoPreviewInput, "implemented");
add("/kakao/templates/{id}", "patch", "message.manage + current service", "템플릿 수정 시 draft로 되돌려 재심사", kakaoTemplatePatch, "implemented");
add("/kakao/templates/{id}/submit", "post", "message.manage + current service", "심사 요청. approved로 만들지 않음", z.object({ version: z.number().int().positive() }).strict(), "implemented");
add("/kakao/templates/{id}/review", "get", "message.manage + current service", "저장된 심사 상태. providerMatched는 공급자 대조 전 false", undefined, "implemented");
add("/kakao/templates/{id}/send", "post", "message.manage + current service", "미승인 템플릿 409. 승인돼도 발송 공급자 없으면 503", undefined, "implemented");
add("/kakao/reviews", "post", "signed kakao review webhook", "서명된 채널 확인·템플릿 승인/반려. 심사 중이 아니면 반영하지 않음", kakaoReviewInput, "implemented", "202");
add("/analytics/closes", "get", "service.read + current service grants; company-wide: direct owner/admin", "현재 세션·정책·서비스 권한을 재검사하는 월마감 조회. 없으면 close는 null. 조회 감사 기록, 준수 통과 없음", undefined, "implemented");
add("/analytics/closes", "post", "service.read + current service grants; company-wide: direct owner/admin", "한국 시간 월과 범위별 집계·5개 점검 근거·생성 감사를 원자적으로 저장. 법적 준수 미판정. 회사 인증 근거는 회사 전체 마감만 포함. 재요청 현재 권한 재검사와 단일 마감", complianceCloseInput, "implemented");
add("/analytics/closes/{id}/export", "get", "service.read + current service grants; company-wide: direct owner/admin", "현재 세션·정책·서비스 권한 재검사 후 마감 CSV와 다운로드 감사. 5,000행 상한·수식 방어. 판정은 미판정", undefined, "implemented");
add("/analytics/exports", "post", "service.read + current close scope + requester", "불변 월마감의 PDF/CSV 출력 요청. 요청 키 중복 방지, 활성5개, 24시간 만료", complianceExportInput, "implemented", "202");
add("/analytics/exports", "get", "service.read + current close scope + requester", "선택 마감의 본인 출력 작업과 페이지. 암호문/키 제외", undefined, "implemented");
add("/analytics/exports/{id}", "get", "service.read + current close scope + requester", "현재 권한·정책·만료 확인 후 작업 DTO", undefined, "implemented");
add("/analytics/exports/{id}", "delete", "service.read + current close scope + requester", "version 확인 후 암호화 결과 삭제와 감사", complianceExportChange, "implemented", "204");
add("/analytics/exports/{id}/cancel", "post", "service.read + current close scope + requester", "대기/처리 작업 취소. 늦은 worker 게시 방지", complianceExportChange, "implemented");
add("/analytics/exports/{id}/download", "get", "service.read + current close scope + requester", "현재 권한·최종 기한·불변 원천/파일 해시 검사 후 실제 PDF/CSV. 성공 감사", undefined, "implemented");
(paths["/analytics/exports"].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,128}$" } }];
(paths["/analytics/exports"].get as Operation).parameters = Object.entries(z.toJSONSchema(complianceExportList).properties ?? {}).map(([name, schema]) => ({ in: "query", name, required: name === "closeId", schema }));
(paths["/analytics/exports/{id}/download"].get as Operation).responses = { ...errors, "200": { description: "실제 PDF 또는 BOM CSV; attachment/private no-store/nosniff; X-Export-SHA256/X-Source-SHA256", content: { "application/pdf": { schema: { type: "string", format: "binary" } }, "text/csv": { schema: { type: "string" } } } } };
add("/analytics/dashboard", "get", "service.read + current service grants",
  "동일 DB 시점의 활성 서비스·폼·문서·현재 보유 응답·기간 내 접수/파기 집계; 종료 시각 미포함", undefined, "implemented");
(paths["/analytics/dashboard"].get as Operation).parameters = [
  { in: "query", name: "serviceId", schema: { type: "string", format: "uuid" } },
  { in: "query", name: "from", schema: { type: "string", format: "date-time" }, description: "포함 시작 시각" },
  { in: "query", name: "to", schema: { type: "string", format: "date-time" }, description: "미포함 종료 시각; 현재 이후면 현재 시각으로 제한" },
];
schemas.MarketingCreate = z.toJSONSchema(marketingCreate); schemas.MarketingList = z.toJSONSchema(marketingList);
for (const path of ["/marketing/preferences", "/marketing/preferences/export"]) (paths[path].get as Operation).parameters = Object.entries((schemas.MarketingList as { properties: Record<string, unknown> }).properties).map(([name, schema]) => ({ in: "query", name, required: name === "serviceId", schema }));
(paths["/marketing/preferences/export"].get as Operation).responses = { ...errors, "200": { description: "UTF-8 BOM CSV", content: { "text/csv": { schema: { type: "string" } } } } };
for (const path of Object.keys(paths).filter(path => path.startsWith("/marketing/"))) {
  for (const method of ["get", "post", "patch", "delete"]) {
    const operation = paths[path][method] as Operation | undefined;
    if (!operation) continue;
    operation["x-current-access"] = "회사·회원·서비스·현재 grant·계정·MFA·선택 회사·비밀번호·세션 기한을 잠금 후 재검사; 감사/캐시/DTO 처리 뒤 기한 검사";
    operation["x-query-validation"] = "중복/미지원 쿼리 422; 변경/상세 쿼리 없음; 목록 정렬 createdAt/grantedAt, asc/desc; 마지막 페이지 보정";
  }
}
(paths["/marketing/preferences"].get as Operation)["x-current-permissions"] = "목록 canCreate/canExport, 항목 canChangeExclusion/canWithdraw/canErase/canCleanup와 pendingLocalCopies";
(paths["/marketing/preferences"].post as Operation)["x-idempotency-replay"] = "현재 버전 반환; 삭제/원본 기한 종료 410; 재동의 출처 변경 409; 캐시 저장 후 최종 기한 검사";
(paths["/marketing/preferences/{id}"].delete as Operation)["x-copy-cleanup"] = "SQL 삭제 확정 후 파일 정리; 실패 시 localCopyErasedAt=null, cleanup.pending 반환; 반복 DELETE로 재시도, 중복 이력 없음";

for (const [path, method, description] of [
  ["/senders", "get", "현재 권한·최종 세션 기한·엄격한 쿼리·서비스/채널/상태/검색·정렬과 마지막 페이지 보정"],
  ["/senders", "post", "현재 권한의 등록·멱등키; 재실행은 최신 버전, 삭제 후 410; 캐시 저장 뒤 최종 기한"],
  ["/senders/{id}", "get", "현재 권한·인증·작업 권한·사본 정리 대기·증빙·변경 이력; 만료 확인값과 읽기 전용 DNS 비밀 제외"],
  ["/senders/{id}", "patch", "이름·설명·주소 변경·version; 주소 변경 시 재인증"],
  ["/senders/{id}", "delete", "사용중 삭제 제한·주소와 증빙 원문 삭제·최소 이력 유지"],
  ["/senders/{id}/default", "post", "현재 인증된 발신자로 서비스/채널 대표 변경"],
  ["/senders/{id}/disable", "post", "사용 중지·기존 인증/대표 해제"],
  ["/senders/{id}/renew", "post", "새 인증 세대·이전 코드 및 예약 발송 차단"],
  ["/senders/{id}/cleanup", "post", "현재 관리 권한·version·최종 기한 확인 후 확정된 인증 메일·증빙 사본 정리 재시도"],
  ["/senders/{id}/request-email", "post", "10분·5회·일회 이메일 인증번호 요청, 1분 재요청 제한"],
  ["/senders/{id}/confirm-email", "post", "인증번호 소비; 실패 횟수 커밋"],
  ["/senders/{id}/dns", "post", "서비스별 DNS TXT 확인값 발급"],
  ["/senders/{id}/check", "post", "이메일 DNS 또는 SOLAPI 등록번호·ACTIVE·만료 확인"],
  ["/senders/{id}/evidence", "post", "10MB PDF/PNG/JPEG 증빙 업로드 준비·최대 5개"],
  ["/senders/{id}/evidence/{fileId}/attach", "post", "ClamAV 검사를 통과한 본인 업로드 증빙 연결"],
  ["/senders/{id}/evidence/{fileId}", "delete", "현재 발신자 증빙의 실제 삭제·실패 재처리"],
  ["/senders/{id}/evidence/{fileId}/download", "get", "현재 회사/서비스/발신자 권한과 파일 바인딩을 검사한 다운로드"],
] as const) add(path, method, method === "get" && !path.includes("evidence") ? "sender.read" : "sender.manage", description, undefined, "implemented", path === "/senders" && method === "post" ? "201" : path.endsWith("request-email") ? "202" : path.endsWith("/dns") || (path.endsWith("/evidence") && method === "post") ? "201" : "200");
for (const [path, method, schema] of [
  ["/senders", "post", senderCreate], ["/senders/{id}", "patch", senderPatch], ["/senders/{id}", "delete", senderVersion],
  ["/senders/{id}/evidence", "post", senderEvidenceInput], ["/senders/{id}/evidence/{fileId}/attach", "post", senderVersion], ["/senders/{id}/evidence/{fileId}", "delete", senderVersion],
  ["/senders/{id}/confirm-email", "post", senderVersion.extend({ verificationId: z.uuid(), code: z.string().regex(/^\d{6}$/) }).strict()],
  ...["default", "disable", "renew", "request-email", "dns", "check", "cleanup"].map(action => ["/senders/{id}/" + action, "post", senderVersion] as const),
] as const) (paths[path][method] as Operation).requestBody = { required: true, content: { "application/json": { schema: z.toJSONSchema(schema) } } };
for (const [path, description] of [
  ["/campaigns", "서비스·채널·검색·상태·보관·날짜·페이지별 캠페인"],
  ["/campaigns/{id}", "내용·처리 집계·최근 100개 이력"],
  ["/campaigns/sources", "현재 조회 가능한 동의 대상 페이지; marketing.read 추가"],
  ["/campaigns/{id}/recipients", "수신자 페이지; marketing.read 추가"],
  ["/campaigns/{id}/deliveries", "개별 처리 결과 페이지; marketing.read 추가"],
  ["/campaigns/{id}/export", "현재 권한·원문 기한 적용 CSV; 최대 1000행; 수식 무해화"],
] as const) add(path, "get", "message.read", description, undefined, "implemented");
for (const [path, method, schema, description, success] of [
  ["/campaigns", "post", campaignCreate, "멱등 초안 생성; 암호화 내용; 30일 보관", "201"],
  ["/campaigns/{id}", "patch", campaignPatch, "초안 내용·발신자 수정; 낙관적 version", "200"],
  ["/campaigns/{id}", "delete", campaignVersion, "초안만 삭제; 내용·대상 제거; 최소 이력 유지", "200"],
  ["/campaigns/{id}/recipients", "post", campaignTargets, "직접 입력·CSV·명시적 동의 ID로 초안 대상 원자 교체", "200"],
  ["/campaigns/{id}/preview", "post", campaignVersion, "현재 동의·발신자·변수·분량·연결 상태 미리보기", "200"],
  ["/campaigns/{id}/schedule", "post", campaignSchedule, "즉시/예약 멱등 요청; 대상·내용·요청자 고정; SMS 미설정503", "202"],
  ["/campaigns/{id}/reschedule", "post", campaignReschedule, "처리 시작 전 예약 변경; 기한·동의 재확인", "200"],
  ["/campaigns/{id}/cancel", "post", campaignVersion, "미전달 예약 취소; 접수·결과 불확실 보존", "200"],
  ["/campaigns/{id}/archive", "post", campaignVersion, "처리 종료 캠페인 보관/해제", "200"],
  ["/campaigns/{id}/retry", "post", campaignRetry, "최대100개 실패 행 명시적 재요청; 불확실/접수 행 재전송 금지", "202"],
] as const) add(path, method, /schedule|retry/.test(path) ? "message.manage + message.send" : "message.manage", description, schema, "implemented", success);
for (const [path, schema] of [["/campaigns", campaignList], ["/campaigns/sources", campaignSourceList], ...["recipients", "deliveries", "export"].map(action => ["/campaigns/{id}/" + action, deliveryList] as const)] as const) {
  const json = z.toJSONSchema(schema) as { properties: Record<string, unknown>; required?: string[] };
  (paths[path].get as Operation).parameters = Object.entries(json.properties).map(([name, value]) => ({ in: "query", name, required: json.required?.includes(name) ?? false, schema: value }));
}
for (const path of ["/campaigns", "/campaigns/{id}/schedule", "/campaigns/{id}/retry"]) (paths[path].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 16, maxLength: 128 } }];

for (const [path, description] of [
  ["/message-templates", "현재 서비스·채널·상태·이름 검색·서버 페이지; 목록에는 원문 없음"],
  ["/message-templates/{id}", "템플릿 내용과 최근100개 불변 버전"],
  ["/message-templates/{id}/revisions/{version}", "과거 버전 원문; 삭제하면410"],
  ["/campaigns/{id}/files/{fileId}/download", "현재 권한·캠페인 기한·검사·바이트 무결성 확인 후 비공개 파일"],
] as const) add(path, "get", "message.read", description, undefined, "implemented");
for (const [path, method, schema, description, success] of [
  ["/message-templates", "post", messageTemplateCreate, "멱등 생성; 서비스별500개; 서버 HTML 정제", "201"],
  ["/message-templates/{id}", "patch", messageTemplatePatch, "활성 템플릿 수정; version·불변 개정본", "200"],
  ["/message-templates/{id}", "delete", messageTemplateVersion, "현재 및 과거 버전 원문 삭제; 이미 복사한 캠페인은 별도 보관", "200"],
  ["/message-templates/{id}/archive", "post", messageTemplateVersion, "보관 후 편집·적용 차단", "200"],
  ["/message-templates/{id}/restore", "post", messageTemplateVersion, "보관 템플릿 복원; 삭제는 복원 불가", "200"],
  ["/message-content/preview", "post", z.object({ serviceId: z.uuid(), channel: z.enum(["email","sms"]), content: messageContent }).strict(), "HTML 정제·예시 변수 렌더; 외부 리소스·속성 변수 거부", "200"],
  ["/campaigns/{id}/apply-template", "post", messageTemplateApply, "현재 템플릿 버전을 초안에 복사; 서비스·채널·두 버전 검사", "200"],
  ["/campaigns/{id}/files", "post", campaignFileInput, "업로드 예약; 최대5개·각10MB·합계20MB; 검사 필요", "201"],
  ["/campaigns/{id}/files/{fileId}/attach", "post", campaignVersion, "본인이 검사 완료한 파일을 초안에 연결", "200"],
  ["/campaigns/{id}/files/{fileId}", "delete", campaignVersion, "초안 첨부의 접근 차단·실제 삭제; 실패 시 cleanupPending", "200"],
] as const) add(path, method, "message.manage", description, schema, "implemented", success);
{
  const json = z.toJSONSchema(messageTemplateList) as { properties: Record<string, unknown>; required?: string[] };
  (paths["/message-templates"].get as Operation).parameters = Object.entries(json.properties).map(([name, value]) => ({ in: "query", name, required: json.required?.includes(name) ?? false, schema: value }));
}
for (const path of ["/message-templates", "/campaigns/{id}/files"]) (paths[path].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 16, maxLength: 128 } }];
add("/email-feedback", "post", "HMAC signed body; no session", "이메일 결과 릴레이; 5분 서명·작업 범위·event ID 멱등; 외부 공급자 변환은 별도", relayFeedback, "implemented", "202");
(paths["/email-feedback"].post as Operation).security = [];
(paths["/email-feedback"].post as Operation)["x-origin-check"] = "not used; timestamp.rawBody HMAC-SHA256 authentication";
(paths["/email-feedback"].post as Operation).parameters = [{ name: "X-Email-Timestamp", in: "header", required: true, schema: { type: "string", pattern: "^[0-9]{10}$" } }, { name: "X-Email-Signature", in: "header", required: true, schema: { type: "string", pattern: "^v1=[a-f0-9]{64}$" } }];
add("/email-suppressions", "get", "message.read + marketing.read", "현재 서비스 차단 목록; 정확한 주소 검색·사유·페이지·원문 기한", undefined, "implemented");
{
  const json = z.toJSONSchema(suppressionQuery) as { properties: Record<string, unknown>; required?: string[] };
  (paths["/email-suppressions"].get as Operation).parameters = Object.entries(json.properties).map(([name, value]) => ({ in: "query", name, required: json.required?.includes(name) ?? false, schema: value }));
}
for (const method of ["get", "post"]) {
  add("/email-unsubscribe/{token}", method, "job-bound opaque HMAC token", method === "get" ? "수신거부 안내; 상태 변경 없음" : "이메일 수신거부; 반복 확인 멱등; 90일 기한", undefined, "implemented");
  const operation = paths["/email-unsubscribe/{token}"][method] as Operation;
  operation.security = []; operation["x-origin-check"] = "not used; token authentication independent of cookies";
}
(paths["/email-unsubscribe/{token}"].post as Operation).requestBody = { required: true, content: {
  "application/json": { schema: z.toJSONSchema(z.object({ confirm: z.literal(true) }).strict()) },
  "application/x-www-form-urlencoded": { schema: { type: "object", additionalProperties: false, required: ["List-Unsubscribe"], properties: { "List-Unsubscribe": { const: "One-Click" } } } },
  "multipart/form-data": { schema: { type: "object", additionalProperties: false, required: ["List-Unsubscribe"], properties: { "List-Unsubscribe": { const: "One-Click" } } } },
} };
(paths["/email-unsubscribe/{token}"].get as Operation).parameters = [{ name: "confirmPage", in: "query", required: false, schema: { type: "string", const: "1" }, description: "헤더 URL의 GET은 확인 화면으로 302, POST는 이 API에서 직접 처리" }];
add("/integrations", "get", "integration.read + current service", "알림 목록; 검색·대상·등록자·방식·사용여부·페이지", undefined, "implemented");
add("/integrations", "post", "integration.manage + current service", "서비스별 알림/구독 생성; 쓰기 전용 암호화 URL·멱등키·50개 한도", integrationCreate, "implemented", "201");
add("/integrations/options", "get", "integration.read + current service", "현재 서비스의 폼·CSV·등록자·전송 환경", undefined, "implemented");
add("/integrations/{id}", "get", "integration.read + current service", "URL 호스트 마스크와 설정·구독 상세", undefined, "implemented");
add("/integrations/{id}", "patch", "integration.manage + current service", "버전 검사·URL 교체·구독/설정 저장; 기존 대기 취소", integrationPatch, "implemented");
add("/integrations/{id}", "delete", "integration.manage + current service", "URL·이름 삭제 및 대기 취소", notificationVersion.extend({ serviceId: z.uuid() }).strict(), "implemented");
add("/integrations/delete", "post", "integration.manage + current service", "최대100개 버전 확인 후 원자적 선택 삭제", integrationDeleteMany, "implemented");
add("/integrations/{id}/enabled", "post", "integration.manage + current service", "사용/중지 전환 및 기존 대기 취소", integrationToggle, "implemented");
add("/integrations/{id}/test", "post", "integration.manage + current service", "확인된 설정으로 시험 알림 요청; 멱등키·분당10회", notificationVersion, "implemented", "202");
add("/integrations/{id}/deliveries", "get", "integration.read + current service", "실제 전송/불변 시도 이력·상태·페이지; 원문 URL/답변 없음", undefined, "implemented");
add("/integrations/{id}/deliveries/{deliveryId}/retry", "post", "integration.manage + current service", "확실한 실패만 버전·멱등키 재처리; 불확실 전송 거부", notificationVersion, "implemented", "202");
for (const [path, schema] of [["/integrations", integrationQuery], ["/integrations/{id}/deliveries", notificationHistoryQuery]] as const) {
 const spec = z.toJSONSchema(schema) as { properties: Record<string, unknown>; required?: string[] };
 (paths[path].get as Operation).parameters = Object.entries(spec.properties).map(([name, value]) => ({ name, in: "query", required: spec.required?.includes(name) ?? false, schema: value }));
}
// Concrete route handlers that differ from the early /admin/* proposal paths.
add("/plans", "get", "billing.read + current tenant", "현재 주문 가능한 상품·고정 가격 버전", undefined, "implemented");
add("/entitlements", "get", "billing.read + current tenant", "구독 기간과 현재 자산 한도·사용량", undefined, "implemented");
add("/assets", "get", "billing.read + current tenant", "현재 서비스별 폼·정보주체 자산 집계", undefined, "implemented");
add("/subscriptions", "get", "billing.read + current tenant", "회사 구독 상태와 entitlement", undefined, "implemented");
add("/subscriptions", "post", "billing.write + current tenant", "서버 가격표에 따른 유료 구매 대기 접수. 현재 권한·세션·정책 및 판매 기한을 재검사하며 재요청은 현재 구독 상태 반환", purchaseRequest, "implemented", "202");
add("/billing/methods", "get", "billing.read + current tenant", "현재 권한·세션 검사 후 결제수단 목록; 비밀 제외", undefined, "implemented");
(paths["/billing/methods"].get as Operation).parameters = [{ in: "query", name: "includeRevoked", schema: { type: "string", enum: ["true", "false"] } }];
add("/billing/methods", "post", "billing.write + current tenant", "암호화된 PG 토큰 등록; 대표 교체 시 이전 수단 version 증가; 최종 세션 기한 검사", paymentMethodCreate, "implemented", "201");
add("/billing/methods/{id}", "patch", "billing.write + current tenant", "이름·대표수단 수정; 현재 권한과 version 확인; 동시 변경409", paymentMethodUpdate, "implemented");
add("/billing/methods/{id}", "delete", "billing.write + current tenant", "진행 주문 없는 수단 해지; 대표 삭제 시 승격; 최종 세션 기한 검사", paymentMethodRemove, "implemented");
add("/billing/orders", "get", "billing.read + current tenant", "현재 회사 결제 주문 최신100개와 환불 합계", undefined, "implemented");
add("/billing/orders", "post", "billing.write + current tenant", "현재 권한·세션을 검사하여 대기 구독 주문 생성. 서버 가격 적용. 재전송은 최신 상태 반환; 다른 수단의 기존 주문은409", z.object({ subscriptionId: z.uuid(), methodId: z.uuid().optional() }).strict(), "implemented", "201");
(paths["/billing/orders"].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" } }];
add("/billing/orders/{id}", "get", "billing.read", "결제 상태. result=success 쿼리는 무시하고 paid로 바꾸지 않음", undefined, "implemented");
add("/billing/orders/{id}/return", "post", "billing.write", "성공 복귀 주소는 결제를 확정하지 않음", z.object({ result: z.enum(["success", "fail"]) }).strict(), "implemented");
add("/billing/provider-events", "post", "signed payment webhook", "서명된 결제 결과만 반영. 중복은 같은 상태, 종료 후 다른 결과는 409", z.object({ orderId: z.uuid(), eventId: z.string(), outcome: z.enum(["paid", "failed"]) }).strict(), "implemented", "202");
add("/subscriptions/entitlement", "get", "billing.read + current tenant", "회사별 실제 entitlement", undefined, "implemented");
for (const [action, schema] of [["cancel", cancelRequest], ["undo-cancel", cancelRequest], ["schedule-cancel", scheduleTrialCancelRequest]] as const)
  add("/subscriptions/{id}/" + action, "post", "billing.write + current tenant", "무료/유료 구독의 " + action + " 전이. 현재 권한·최종 기한 검사, version 충돌409. 같은 키 재전송은 최신 상태 반환; schedule-cancel 사유도 요청 해시에 포함", schema, "implemented");
for (const path of ["/subscriptions", "/subscriptions/{id}/cancel", "/subscriptions/{id}/schedule-cancel", "/subscriptions/{id}/undo-cancel"])
  (paths[path].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true,
    schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" } }];
add("/access-requests", "get", "active member for mine; member.manage for review", "현재 회사의 본인/검토 요청·요청 가능한 서비스", undefined, "implemented");
add("/access-requests", "post", "active member; experts excluded", "같은 회사 활성 서비스 접근 요청; 동일 대기 요청 재사용", accessRequestInput, "implemented", "201");
add("/access-requests/{id}", "patch", "member.manage + active tenant", "본인 승인 금지·역할 상한·version 확인 후 결정", accessDecisionInput, "implemented");
add("/access-requests/{id}", "delete", "requester + active tenant + If-Match", "본인 대기 요청 취소·이력 보존", undefined, "implemented", "204");
add("/expert-assignments", "get", "own expert or platform-admin", "본인 또는 운영자 배정 목록", undefined, "implemented");
(paths["/expert-assignments"].get as Operation).parameters = [
  { in: "query", name: "scope", schema: { type: "string", enum: ["mine", "admin"], default: "mine" } },
  { in: "query", name: "search", description: "mine도 전체 본인 배정에서 회사명을 검색한다.", schema: { type: "string", maxLength: 100 } },
  ...["page", "pageSize"].map(name => ({ name, in: "query", schema: { type: "integer", minimum: 1, maximum: name === "page" ? 100000 : 100 } })),
];
add("/expert-assignments", "post", "platform-admin", "회사·서비스·전문가 이메일/만료 범위 배정", createExpertInput, "implemented", "201");
add("/expert-assignments/{id}", "get", "own expert or platform-admin", "현재 배정·회수/만료 상태", undefined, "implemented");
add("/expert-assignments/{id}", "patch", "platform-admin", "서비스 범위·기한·version 변경", updateExpertInput, "implemented");
add("/expert-assignments/{id}", "delete", "platform-admin + If-Match", "배정 회수와 서비스 grant 제거", undefined, "implemented", "204");
add("/expert-assignments/options", "get", "platform-admin", "배정 가능한 회사·서비스·전문가", undefined, "implemented");
add("/notices", "get", "authenticated user; platform-admin for admin scope", "게시 공지 목록 또는 운영자 전체 목록", undefined, "implemented");
add("/notices", "post", "platform-admin", "공지 초안/게시 생성", noticeCreate, "implemented", "201");
add("/notices/{id}", "get", "authenticated user for published; platform-admin for preview", "공지 상세와 활성 첨부", undefined, "implemented");
add("/notices/{id}", "patch", "platform-admin", "버전 확인 후 공지 변경", noticePatch, "implemented");
add("/notices/{id}", "delete", "platform-admin + If-Match", "공지 보관·일반 열람 차단", undefined, "implemented", "204");
add("/notices/{id}/attachments/{attachmentId}", "get", "authenticated user for published; platform-admin for preview", "권한·게시 상태 확인 후 첨부 다운로드", undefined, "implemented");
add("/notices/{id}/attachments/{attachmentId}", "put", "platform-admin + If-Match", "크기/해시/형식/ClamAV 확인 후 암호화 첨부 교체", undefined, "implemented");
add("/notices/{id}/attachments/{attachmentId}", "delete", "platform-admin + If-Match", "첨부 접근 차단과 파일 삭제", undefined, "implemented", "204");
(paths["/notices/{id}/attachments/{attachmentId}"].put as Operation).requestBody = { required: true, content: {
  "application/octet-stream": { schema: { type: "string", format: "binary", maxLength: 10485760 } } } };
add("/guides", "get", "active member; platform-admin for admin scope", "게시 가이드 목록 또는 운영자 전체 목록", undefined, "implemented");
add("/guides", "post", "platform-admin", "가이드 초안 생성", guideCreate, "implemented", "201");
add("/guides/{id}", "get", "active member for published; platform-admin for preview", "가이드 상세", undefined, "implemented");
add("/guides/{id}", "patch", "platform-admin", "버전 확인 후 가이드 변경", guidePatch, "implemented");
add("/guides/{id}", "delete", "platform-admin + If-Match", "가이드 보관·파일 접근 차단", undefined, "implemented", "204");
add("/guides/{id}/file", "put", "platform-admin + If-Match", "크기/해시/PDF/ClamAV 확인 후 암호화 파일 교체", undefined, "implemented");
(paths["/guides/{id}/file"].put as Operation).requestBody = { required: true, content: {
  "application/pdf": { schema: { type: "string", format: "binary", maxLength: 10485760 } } } };
add("/guides/{id}/download", "get", "active member for published; platform-admin for preview", "권한·해시 확인 후 PDF 다운로드", undefined, "implemented");
add("/support-tickets", "get", "own company/author for mine; platform-admin for admin scope", "권한별 문의·제안 목록", undefined, "implemented");
add("/support-tickets", "post", "active member in current tenant", "문의·제안 암호화 접수", supportTicketCreate, "implemented", "201");
add("/support-tickets/{id}", "get", "own company/author or platform-admin", "문의·답변 상세와 감사", undefined, "implemented");
add("/support-tickets/{id}", "patch", "author in current tenant + version", "접수 중 본인 문의 수정", supportTicketPatch, "implemented");
add("/support-tickets/{id}", "delete", "author in current tenant or platform-admin + If-Match", "문의 보관·원문 접근 차단", undefined, "implemented", "204");
add("/support-tickets/{id}/reply", "post", "platform-admin", "운영자 답변과 버전 전이", supportTicketReply, "implemented");
for (const action of ["close", "reopen"])
  add("/support-tickets/{id}/" + action, "post", "author in current tenant or platform-admin", "문의 " + action + " 상태 전이", supportTicketVersion, "implemented");
for (const path of ["/access-requests/{id}", "/expert-assignments/{id}", "/notices/{id}", "/guides/{id}", "/support-tickets/{id}",
  "/notices/{id}/attachments/{attachmentId}"]) {
  (paths[path].delete as Operation).parameters = [{ in: "header", name: "If-Match", required: true,
    schema: { type: "string", pattern: "^[1-9][0-9]*$" } }];
}
for (const path of ["/notices/{id}/attachments/{attachmentId}", "/guides/{id}/file"])
  (paths[path].put as Operation).parameters = [
    { in: "header", name: "If-Match", required: true, schema: { type: "integer", minimum: 1 } },
    { in: "header", name: "X-File-Size", required: true, schema: { type: "integer", minimum: 1, maximum: 10485760 } },
    { in: "header", name: "X-File-Sha256", required: true, schema: { type: "string", pattern: "^[0-9a-f]{64}$" } },
    { in: "header", name: "X-File-Name", required: true, schema: { type: "string", minLength: 1, maxLength: 1000 } },
  ];
add("/security/ip-rules", "get", "security.read + direct membership", "현재 회사 IP 규칙·접근 제한·실제 현재 IP·정렬/페이지·변경 권한", undefined, "implemented");
add("/security/ip-rules", "post", "direct owner", "IPv4·IPv6 CIDR 정규화·최대 100개·동일 요청의 현재 결과", ipRuleInput, "implemented", "201");
add("/security/ip-rules/{id}", "get", "security.read + direct membership", "현재 회사의 IP 규칙 상세", undefined, "implemented");
add("/security/ip-rules/{id}", "patch", "direct owner", "현재 version·접속 IP 유지·CIDR 중복 검사 후 변경", ipRulePatch, "implemented");
add("/security/ip-rules/{id}", "delete", "direct owner", "현재 접속을 유지하면서 규칙·요청 원문 삭제", ipRuleDelete, "implemented", "204");
add("/security/ip-rules/settings", "patch", "direct owner + current password", "실제 접속 IP를 허용할 때 제한 활성화; 현재 version과 비밀번호 확인", ipAccessChange, "implemented");
(paths["/security/ip-rules"].get as Operation).parameters = Object.entries(z.toJSONSchema(ipRuleQuery).properties ?? {}).map(([name,schema]) => ({ in: "query", name, schema }));
(paths["/security/ip-rules"].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" } }];
add("/security/mfa-policy", "get", "security.read + direct membership", "현재 회사 인증 강제·구성원 등록·기한이 있는 예외·검색/페이지", undefined, "implemented");
add("/security/mfa-policy", "patch", "enrolled direct owner + current password", "현재 version의 회사 인증 강제를 변경", mfaPolicyChange, "implemented");
add("/security/mfa-policy/exceptions", "post", "enrolled direct owner + current password", "다른 활성 구성원에 사유·최대 24시간 임시 예외; 현재 결과 재실행", mfaExceptionCreate, "implemented", "201");
add("/security/mfa-policy/exceptions/{id}", "get", "security.read + direct membership", "현재 회사의 임시 예외와 만료 상태", undefined, "implemented");
add("/security/mfa-policy/exceptions/{id}", "patch", "enrolled direct owner + current password", "현재 version으로 예외 변경; 최초 등록부터 24시간 상한", mfaExceptionPatch, "implemented");
add("/security/mfa-policy/exceptions/{id}", "delete", "enrolled direct owner + current password", "예외와 생성 캐시 원문 삭제; 다음 요청 접근 차단", mfaExceptionDelete, "implemented", "204");
add("/security/status", "get", "security.read + direct membership", "현재 정책·등록·허용 IP·복구 관리자에서 산출한 보안 확인과 개선 링크", undefined, "implemented");
(paths["/security/mfa-policy"].get as Operation).parameters = Object.entries(z.toJSONSchema(mfaMemberQuery).properties ?? {}).map(([name,schema]) => ({ in: "query", name, schema }));
(paths["/security/mfa-policy/exceptions"].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" } }];
type PolicyRule = { id: string; prefixes: string[] };
add("/exports", "post", "submission.read + current service grant + requester", "검색 조건을 암호화한 비동기 CSV 작업 생성; 같은 키/입력 재전송; 진행 중 5개 상한", createExportInput, "implemented", "201");
add("/exports", "get", "submission.read + current service grant + requester", "해당 폼의 본인 내보내기 안전 DTO·현재 작업 버튼·페이지 보정", undefined, "implemented");
add("/exports/{id}", "get", "submission.read + current service grant + requester", "현재 작업의 상태·진행·만료·오류 코드; 암호문/검색어/요청 키 제외", undefined, "implemented");
add("/exports/{id}", "delete", "submission.read + current service grant + requester", "version 확인 후 결과·검색 조건·해시 제거; 요청 키 tombstone으로 부활 차단", exportChangeInput, "implemented", "204");
add("/exports/{id}/cancel", "post", "submission.read + current service grant + requester", "대기/처리 작업 취소·원문 제거; 오래된 worker 결과 차단", exportChangeInput, "implemented");
add("/exports/{id}/download", "get", "submission.read + current service grant + requester", "현재 원천/권한/보유 기한과 CSV 해시 대조·성공 감사; 100,000건/1,000열/20MB 상한", undefined, "implemented");
(paths["/exports"].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,128}$" } }];
(paths["/exports"].get as Operation).parameters = Object.entries(z.toJSONSchema(exportListQuery).properties ?? {}).map(([name, schema]) => ({ in: "query", name, required: name === "formId", schema }));
(paths["/exports/{id}/download"].get as Operation).responses = { ...errors, "200": { description: "BOM/CRLF CSV; UTF-8; attachment/private no-store/nosniff", content: { "text/csv": { schema: { type: "string" } } } } };
add("/activity-reviews", "get", "current member recipient; sent/company requires security.write + audit.read + service grants", "개인정보 활동 검토 받은/보낸/회사 목록: 제목·상태·기간·서비스·서버 페이지, 본문 제외", undefined, "implemented");
add("/activity-reviews", "post", "security.write + audit.read + current service grants", "회사 개인정보 처리자의 검토 요청·암호화 메시지·감사 원자 생성; 같은 사건 열린 요청 한 건", reviewCreate, "implemented", "201");
add("/activity-reviews/{id}", "get", "current recipient or current service review manager", "검토 상세와 권한 확인 후 복호화 메시지·현재 상태별 버튼", undefined, "implemented");
add("/activity-reviews/{id}/actions", "post", "response: recipient; resolve/cancel: security.write + audit.read + service grants, not recipient", "version을 확인해 답변/처리완료/취소와 불변 메시지·감사를 원자 저장; 같은 키는 접수 ID만 재사용", reviewAction, "implemented");
add("/activity-reviews/{id}/notifications", "post", "current service security.write + audit.read; not recipient", "명시적 검토 알림 접수: version·현재 수신자 검사, 상태별 한 번만 Job 생성; 발송 직전 권한/대상자/상태 재검사", reviewNotify, "implemented", "202");
add("/activity-reviews/{id}/destruction", "post", "security.write + audit.read + current service grants, not recipient", "보유 기한 경과로 승인 대기 중인 종결 검토의 파기/보존 결정: version 확인·메시지 원문만 원자 삭제·검토 이력과 감사는 유지", reviewDestruction, "implemented");
(paths["/activity-reviews"].get as Operation).parameters = Object.entries(z.toJSONSchema(reviewQuery).properties ?? {}).map(([name, schema]) => ({ in: "query", name, schema }));
for (const path of ["/activity-reviews", "/activity-reviews/{id}/actions", "/activity-reviews/{id}/notifications", "/activity-reviews/{id}/destruction"]) {
  (paths[path].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" } }];
  (paths[path].post as Operation).responses = { ...errors, [path.endsWith("notifications") ? "202" : path === "/activity-reviews" ? "201" : "200"]: { description: "저장된 접수 식별자. 최신 상태는 상세 조회.", content: { "application/json": { schema: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" }, messageId: { type: "string", format: "uuid" }, jobId: { type: "string", format: "uuid" } } } } } } };
}
// SSO contracts reflect the concrete handlers, including browser redirects and signed SAML POST.
add("/security/sso", "get", "current direct membership + security.read", "현재 회사 SSO 공급자 목록; secret/certificate 원문 제외", undefined, "implemented");
add("/security/sso", "post", "current direct owner + security.write", "비활성 공급자 등록 및 사전검사; 외부 검사 뒤 현재 권한 재확인", ssoProviderCreate, "implemented", "201");
add("/security/sso/{id}", "patch", "current direct owner + security.write", "version 확인 후 변경; 사용 중 공급자의 수동 비활성화/인증정보 변경은 대체 로그인 검사·SERIALIZABLE 경합 보호. 인증정보 변경은 비활성화·사전검사 초기화. 기존 세션은 유지, 대기 인증은 version 재검사로 차단", ssoProviderPatch, "implemented");
add("/security/sso/{id}", "delete", "current direct owner + security.write + login within 5 minutes", "대체 로그인 검사 후 공급자·연결 계정·영향 사용자 세션/대기 인증을 원자 정리", ssoProviderRemove, "implemented");
add("/security/sso/{id}/preflight", "post", "current direct owner + security.write", "JWKS 또는 인증서 사전검사, 검사 전후 version·권한 확인; 실패하면 비활성화", undefined, "implemented");
add("/auth/sso/{providerId}", "get", "login: public; link: current direct member + login within 5 minutes", "회사 OIDC/SAML 인증 시작; invite는 토큰 POST API를 사용", undefined, "implemented", "302");
(paths["/auth/sso/{providerId}"].get as Operation).parameters = [{ in: "query", name: "mode", schema: { type: "string", enum: ["login", "link"], default: "login" } }];
paths["/auth/sso/{providerId}"].parameters = [{ in: "path", name: "providerId", required: true, schema: { type: "string", format: "uuid" } }];
add("/auth/sso/callback", "get", "one-time unexpired state + PKCE + verified OIDC issuer/audience/nonce/signature", "OIDC 응답 검증 후 대시보드·연결 완료 또는 개인 2FA로 이동", undefined, "implemented", "302");
(paths["/auth/sso/callback"].get as Operation).parameters = [
  { in: "query", name: "state", required: true, schema: { type: "string" } },
  { in: "query", name: "code", schema: { type: "string" }, description: "code 또는 error 중 하나 필요" },
  { in: "query", name: "error", schema: { type: "string" }, description: "취소/거절도 state를 소비하며 공급자 원문은 화면에 노출하지 않음" },
];
add("/auth/sso/saml", "post", "one-time RelayState + signed SAML assertion/response + issuer/audience/recipient/request/time checks", "SAML HTTP-POST ACS 검증 후 대시보드·연결 완료 또는 개인 2FA로 이동", undefined, "implemented", "302");
(paths["/auth/sso/saml"].post as Operation).requestBody = { required: true, content: { "application/x-www-form-urlencoded": { schema: {
  type: "object", required: ["SAMLResponse", "RelayState"], properties: { SAMLResponse: { type: "string", minLength: 1 }, RelayState: { type: "string", minLength: 1 } },
  additionalProperties: true, description: "본문 최대 1,000,000 bytes. SAMLResponse·RelayState는 각 한 번만 허용한다.",
} } } };
(paths["/auth/sso/saml"].post as Operation)["x-origin-check"] = "external signed SAML assertion; Origin exemption only after independent cryptographic validation";
function ssoJsonResponse(path: string, method: string, schema: z.ZodType, status = "200") {
  const operation = paths[path][method] as Operation;
  const responses = operation.responses as Record<string, { description: string; content?: unknown }>;
  responses[status].content = { "application/json": { schema: z.toJSONSchema(schema) } };
}
ssoJsonResponse("/security/sso", "get", z.object({ items: z.array(ssoProviderRecord) }).strict());
ssoJsonResponse("/security/sso", "post", ssoProviderCheckedRecord, "201");
ssoJsonResponse("/security/sso/{id}", "patch", ssoProviderRecord);
ssoJsonResponse("/security/sso/{id}", "delete", z.object({ deleted: z.literal(true), removedAccounts: z.number().int().nonnegative(), endedSessions: z.number().int().nonnegative(), signedOut: z.boolean() }).strict());
ssoJsonResponse("/security/sso/{id}/preflight", "post", ssoProviderCheckedRecord);
ssoJsonResponse("/me/sso-accounts", "get", ownSsoAccounts);
ssoJsonResponse("/me/sso-accounts/{id}", "delete", z.object({ unlinked: z.literal(true), signedOut: z.literal(true) }).strict());
ssoJsonResponse("/invitations/sso/options", "post", z.object({ providers: z.array(z.object({ id: z.uuid(), name: z.string(), protocol: z.string() }).strict()) }).strict());
ssoJsonResponse("/invitations/sso/start", "post", z.object({ redirect: z.string() }).strict());
const ssoExtraErrors = Object.fromEntries([500, 502].map(code => [String(code), { description: code === 500 ? "저장/감사 실패; 원자 롤백" : "IdP 통신 실패",
  content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } }]));
for (const [path, method] of [["/auth/sso/{providerId}", "get"], ["/auth/sso/callback", "get"], ["/auth/sso/saml", "post"],
  ["/invitations/sso/options", "post"], ["/invitations/sso/start", "post"]]) {
  const operation = paths[path][method] as Operation;
  operation.security = [];
  const responses = operation.responses as Record<string, unknown>;
  Object.assign(responses, ssoExtraErrors);
  responses["303"] = { description: "문서 탐색 실패는 고정 오류코드 로그인 화면으로 이동. API 요청은 JSON 오류 상태 유지.",
    headers: { Location: { required: true, schema: { type: "string", pattern: "^/login\\?error=SSO_" } } } };
  if (path.startsWith("/auth/sso/")) responses["302"] = { description: "인증 진행/성공. 개인 2FA가 있으면 아직 로그인 세션 없이 인증 화면으로 이동.",
    headers: { Location: { required: true, schema: { type: "string" } }, "Set-Cookie": { schema: { type: "string" }, description: "콜백: 세션 또는 개인 2FA 쿠키; HttpOnly/SameSite=Lax. HTTPS에서는 Secure." } } };
  operation["x-response-cache"] = "private, no-store; Referrer-Policy: no-referrer";
}

const policies = JSON.parse(await readFile("docs/planning/contracts/domain-policies.json", "utf8")) as { rules: PolicyRule[] };
for (const [path, item] of Object.entries(paths)) {
  const matches = policies.rules.flatMap(policy => policy.prefixes
    .filter(prefix => path === prefix || path.startsWith(prefix + "/"))
    .map(prefix => ({ policy: policy.id, length: prefix.length })));
  const longest = Math.max(...matches.map(match => match.length));
  const selected = matches.filter(match => match.length === longest);
  if (selected.length !== 1) throw new Error("Missing or ambiguous contract policy: " + path);
  for (const method of ["get", "post", "put", "patch", "delete"])
    if (item[method]) (item[method] as Operation)["x-contract-policy"] = selected[0].policy;
}
const specification = {
  openapi: "3.1.0",
  info: { title: "캐치시큐 독립 백엔드 계약", version: "0.1.0", description: "x-implementation=planned는 미구현이다. 전체 필드·상태전이·삭제 정책은 연결된 모델 문서를 함께 적용한다." },
  servers: [{ url: "/api/v1" }],
  security: [{ cookieSession: [] }], paths,
  components: { securitySchemes: { subjectSession: { type: "apiKey", in: "cookie", name: "cs_subject" }, subjectBrowser: { type: "apiKey", in: "cookie", name: "cs_subject_browser" }, cookieSession: { type: "apiKey", in: "cookie", name: "better-auth.session_token" }, viewerSession: { type: "apiKey", in: "cookie", name: "cs_viewer" }, viewerChallenge: { type: "apiKey", in: "cookie", name: "cs_viewer_challenge" } }, schemas },
  "x-model-contract": "../01-data-models.md", "x-route-contract": "../03-route-matrix.csv",
  "x-operation-policy-contract": "operation-policy-matrix.csv",
};
await mkdir("docs/planning/contracts", { recursive: true });
await writeFile("docs/planning/contracts/openapi.json", JSON.stringify(specification, null, 2) + "\n");
console.log("OpenAPI paths:", Object.keys(paths).length);
