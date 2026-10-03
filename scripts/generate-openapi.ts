import { integrationCreate, integrationPatch, integrationQuery, integrationToggle, integrationDeleteMany, notificationVersion, notificationHistoryQuery } from "../src/contracts/notifications";
import { marketingCreate, marketingChange, marketingList, marketingVersions } from "../src/contracts/marketing";
import { relayFeedback, suppressionQuery } from "../src/contracts/email-feedback";
import { subjectAccessInput, subjectSessionInput, subjectWithdrawalInput } from "../src/contracts/subjects";
import { shareCreateInput, shareUpdateInput, shareVersionInput, challengeInput, verificationInput } from "../src/contracts/sharing";
import { documentPatch, documentAction, documentPublish, clauseInput, clausePatch, clauseApply, displayInput } from "../src/contracts/documents";
import { importCreate, importPatch, importAction } from "../src/contracts/imports";
import { policyPatch, policyReset, approvalRequestInput, approvalDecisionInput, approvalCancelInput, passwordDeferralInput, passwordChangeInput, passwordResetInput } from "../src/contracts/security";
import { memberInput } from "../src/server/members";
import { formPatch } from "../src/server/forms";
import { actionInput, correctionInput, noteInput } from "../src/server/submission-management";
import { fixedUrlInput } from "../src/server/fixed-urls";
import { templateInput, templatePatch } from "../src/server/templates";
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
import { formInput, documentInput, invitationInput, submissionInput, fileInput, securityInput } from "../src/contracts/domains";
import { memberUploadInput, publicUploadInput } from "../src/contracts/files";
import { destructionAction, destructionSchedule, destructionStatuses, retentionInput } from "../src/contracts/destruction";
import { purposeInput, purposePatch, recipientInput, recipientPatch, catalogAction } from "../src/contracts/processing-catalog";
import regionCodes from "../src/data/region-codes.json";

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
  { name: "Company", path: "/companies", schema: companyInput, scope: "tenant", permission: "company.manage", lifecycle: "closure", status: "partial" },
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
add("/context", "post", "active membership", "회사 또는 서비스 전환", z.object({ companyId: z.uuid().optional(), serviceId: z.uuid().optional() }).strict(), "implemented");
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
add("/me/sessions", "get", "self", "본인 세션 목록: token 제외", undefined, "implemented");
add("/me/sessions/{id}", "delete", "self", "본인 세션 회수", undefined, "implemented", "204");
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
add("/files/{id}/download", "get", "file.read + tenant/service/submission/question binding", "비공개 다운로드·감사; 제출 전 공개 업로드/검사 전/만료/삭제 상태 차단", undefined, "implemented");
for (const path of ["/uploads/init", "/public/forms/{token}/uploads"]) (paths[path].post as Operation).parameters = [
  { in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 16, maxLength: 128 } }];
for (const path of ["/uploads/{id}", "/uploads/{id}/content", "/uploads/{id}/complete"]) paths[path].parameters = [
  ...(paths[path].parameters ?? []), { in: "header", name: "X-Upload-Token", required: false, description: "공개 업로드에 필수. 제출 완료 시 회수되며 다운로드 권한으로 사용할 수 없다.", schema: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" } }];
(paths["/uploads/{id}/content"].put as Operation).requestBody = { required: true, content: Object.fromEntries(
  ["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"].map(mime => [mime, { schema: { type: "string", format: "binary", maxLength: 10485760 } }])) };
for (const path of ["/files/{id}", "/files/{id}/download"]) (paths[path].get as Operation).parameters = ["submissionId", "questionId"].map(name =>
  ({ in: "query", name, required: false, description: "응답 첨부파일은 두 값 모두 필수. questionId는 질문 stableKey이다.", schema: { type: "string", format: "uuid" } }));
(paths["/files"].get as Operation).parameters = [{ in: "query", name: "submissionId", required: true, schema: { type: "string", format: "uuid" } }];
for (const path of ["/uploads/{id}", "/files/{id}"]) (paths[path].delete as Operation).parameters = [
  { in: "header", name: "If-Match", required: true, schema: { type: "integer", minimum: 1 } }];
(paths["/files/{id}/download"].get as Operation).responses = { ...errors, "200": {
  description: "권한 확인 후 내려받는 원본 바이트; Content-Disposition: attachment 및 private,no-store",
  content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } } };
add("/security/policy", "get", "security.read", "실제로 집행되는 정책");
add("/security/policy", "patch", "security.write", "정책 변경·감사 기록", securityInput.partial().extend({ version: z.number().int().positive() }));
add("/public/forms/{token}", "get", "active publication grant", "게시 당시 질문과 동의문 표시");
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
  ["identity-providers", "security.write", "disable; last method protection"], ["admin/plans", "platform-admin", "archive; sold price immutable"],
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
  "identity-providers": {
    create: z.object({ type: z.enum(["oidc", "saml"]), issuer: z.url().max(2000), clientId: z.string().trim().min(1).max(200),
      secretRef: z.string().trim().min(1).max(200), enabled: z.boolean() }).strict(),
    patch: z.object({ version: z.number().int().positive(), issuer: z.url().max(2000).optional(),
      clientId: z.string().trim().min(1).max(200).optional(), secretRef: z.string().trim().min(1).max(200).optional(),
      enabled: z.boolean().optional() }).strict(),
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
for (const path of ["/forms", "/forms/{id}"]) add(path, "get", "form.read + service grant", "캐치폼 안전 DTO 또는 서버 목록", undefined, "implemented");
add("/forms", "post", "form.write + service grant", "질문·선택지·초안 생성", formInput, "implemented", "201");
add("/forms/{id}", "patch", "form.write + service grant", "초안 변경; 게시본 불변", formPatch, "implemented");
add("/forms/{id}", "delete", "form.write + service grant", "공개 종료와 보관", undefined, "implemented", "204");
add("/forms/{id}/publish", "post", "form.publish + service grant", "검증된 초안 게시; 승인·본인인증·첨부 연동 미충족 시 차단", version.extend({ expiresAt: z.iso.datetime().optional() }), "implemented", "201");
add("/forms/{id}/copy", "post", "form.write + service grant", "전체 폼 복사", z.object({ title: z.string().trim().min(1).max(200).optional() }).strict(), "implemented", "201");
for (const action of ["pause", "resume"]) add("/forms/{id}/" + action, "post", "form.publish + service grant", "공개 " + action, version, "implemented");
add("/forms/{id}/favorite", "put", "form.read + service grant", "본인 즐겨찾기 등록", undefined, "implemented");
add("/forms/{id}/favorite", "delete", "form.read + service grant", "본인 즐겨찾기 해제", undefined, "implemented", "204");
add("/forms/{id}/submissions", "get", "submission.read + service grant", "암호화 응답을 권한 범위에서 조회·감사; 보유 기한 종료 또는 파기 시작 뒤 원문 제외", undefined, "implemented");
add("/public/forms/{token}", "get", "active publication", "유효한 게시본 조회", undefined, "implemented");
add("/public/forms/{token}/submissions", "post", "active publication + rate limit", "한도·필수항목·동의 검증 후 원자 저장", submissionInput, "implemented", "201");
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
add("/destruction-requests", "get", "submission.destroy + service grant", "파기 요청·승인·예약·실패·완료 이력; 회사와 서비스 범위 목록", undefined, "implemented");
for (const action of ["approve", "reject", "cancel", "retry", "reschedule"]) add("/destruction-requests/{id}/" + action, "post",
  "submission.destroy + current service grant" + (["approve", "reject"].includes(action) ? " + active owner/admin" : ""),
  ({ approve: "보존 조치를 확인하고 파기 예약 승인; 실행 시 승인 권한 재검사", reject: "실행 전 파기 요청 반려",
    cancel: "실행 전 파기 예약 취소; 만료된 원문 열람은 계속 차단", retry: "실패한 파기 재시도 허용; 시작된 원문 접근은 계속 차단",
    reschedule: "보유 기한 이내의 일정 변경과 기존 승인 무효화" } as Record<string, string>)[action],
  action === "reschedule" ? destructionSchedule : destructionAction, "implemented");
add("/destruction-certificates", "get", "audit.read + service grant", "원문 삭제가 완료된 파기 증명서 목록", undefined, "implemented");
add("/destruction-certificates/{id}", "get", "audit.read + current service grant", "현재 DB·비공개 파일 파기 수량과 HMAC 무결성; 백업·WAL·외부 사본 제외", undefined, "implemented");
add("/destruction-certificates/{id}/download", "get", "audit.read + current service grant", "파기 증명서 JSON 다운로드·열람 감사", undefined, "implemented");
for (const path of ["/destruction-requests", "/destruction-certificates"]) (paths[path].get as Operation).parameters = [
  ...["serviceId", "submissionId"].map(name => ({ in: "query", name, schema: { type: "string", format: "uuid" } })),
  { in: "query", name: "page", schema: { type: "integer", minimum: 1, default: 1 } },
  { in: "query", name: "pageSize", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
  ...(path === "/destruction-requests" ? [{ in: "query", name: "status", schema: { type: "string", enum: destructionStatuses } }] : []),
];
(paths["/destruction-certificates/{id}/download"].get as Operation).responses = { ...errors, "200": {
  description: "Content-Disposition: attachment; private,no-store; integrityVerified=true인 증명서",
  content: { "application/json": { schema: { type: "object" } } } } };
add("/fixed-urls", "get", "form.read + service grant", "고정 URL 목록", undefined, "implemented");
add("/fixed-urls", "post", "form.publish + service grant", "게시된 폼에 고정 URL 연결", fixedUrlInput, "implemented", "201");
add("/fixed-urls/{id}", "get", "form.read + service grant", "고정 URL 조회", undefined, "implemented");
add("/fixed-urls/{id}", "patch", "form.publish + service grant", "연결 대상·이름 변경", fixedUrlInput.omit({ slug: true }).partial().extend({ version: z.number().int().positive() }), "implemented");
add("/fixed-urls/{id}", "delete", "form.publish + service grant", "고정 URL 회수", undefined, "implemented", "204");
add("/public/urls/{slug}", "get", "active fixed URL", "유효한 공개 폼 연결", undefined, "implemented");

add("/members", "get", "member.manage", "회사 구성원 검색·상태·페이지 목록", undefined, "implemented");
add("/members/{id}", "get", "member.manage", "회사 구성원 상세", undefined, "implemented");
add("/members/{id}", "patch", "member.manage + role ceiling", "역할·서비스 권한·정지 상태 변경", memberInput, "implemented");
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
for (const path of ["/form-templates", "/form-templates/{id}"]) delete paths[path];
add("/templates", "get", "form.read + service grant", "공용·허용 서비스 템플릿 검색·페이지 목록", undefined, "implemented");
add("/templates", "post", "form.write + service grant", "완전한 질문·동의·설정 템플릿 생성", templateInput, "implemented", "201");
add("/templates/{id}", "get", "form.read + service grant", "템플릿 전체 내용 조회", undefined, "implemented");
add("/templates/{id}", "patch", "form.write + service grant; public read-only", "템플릿 편집", templatePatch, "implemented");
add("/templates/{id}", "delete", "form.write + service grant; public read-only", "템플릿 물리 삭제; 기존 복제 폼 유지", undefined, "implemented", "204");
add("/templates/{id}/use", "post", "form.write + target service grant", "전체 내용 복제와 새 질문 ID 생성", version.extend({ serviceId: z.uuid(), title: z.string().trim().min(1).max(200).optional() }), "implemented", "201");

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

add("/imports", "get", "import.read + current service grant", "회사·서비스별 업로드 목록·검색·페이지", undefined, "implemented");
add("/imports", "post", "import.write + current service grant + Idempotency-Key", "CSV 작업·용량 예약·24시간 원본 업로드 생성", importCreate, "implemented", "201");
add("/imports/options", "get", "import.read + current service grant", "동일 서비스의 사용 중인 수집 목적·원자료 제공자", undefined, "implemented");
add("/imports/{id}", "get", "import.read + current service grant", "가져오기 진행·설정·계수; 만료 원문 제외", undefined, "implemented");
add("/imports/{id}", "patch", "import.write + current service grant + version", "수집 근거·컬럼 설정 수정; 기존 검증 무효화", importPatch, "implemented");
add("/imports/{id}", "delete", "import.write + current service grant + If-Match", "임시 자료 삭제 및 취소/보관; 반영된 응답 유지", undefined, "implemented");
for (const [action, summary] of [["inspect", "안전 검사한 CSV의 헤더·행 수 확인"], ["validate", "행별 타입·동의·기한·중복 검증; 응답 생성 0"],
  ["commit", "검증 당시 근거 확인 후 비동기 반영 요청"], ["retry", "권한 재확인 후 중단 작업 재시도"]])
  add("/imports/{id}/" + action, "post", "import.write + current service grant + version", summary, importAction, "implemented", ["commit", "retry"].includes(action) ? "202" : "200");
add("/imports/{id}/rows", "get", "import.read + current service grant; unexpired staging", "행 미리보기·페이지·오류 필터; 파기/만료 응답 원문 차단", undefined, "implemented");
add("/imports/{id}/errors.csv", "get", "import.read + current service grant; unexpired staging", "실패행 CSV·수식 시작 문자 방어·다운로드 감사", undefined, "implemented");
for (const path of ["/imports", "/imports/options"]) (paths[path].get as Operation).parameters = [
  { in: "query", name: "serviceId", required: true, schema: { type: "string", format: "uuid" } }];
(paths["/imports"].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 16, maxLength: 128 } }];
(paths["/imports/{id}"].delete as Operation).parameters = [{ in: "header", name: "If-Match", required: true, schema: { type: "integer", minimum: 1 } }];
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
add("/documents/{id}/versions", "get", "document.read + current service grant", "불변 게시 버전·비교용 본문·SHA-256·링크 목록; 공유 주소는 쓰기 권한에만 제공", undefined, "implemented");
add("/documents/{id}/publish", "post", "document.write + current service grant", "본문·수집 자료 스냅샷과 공개 링크 생성; 과거 버전 유지", documentPublish, "implemented", "201");
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
schemas.DocumentInput = z.toJSONSchema(documentInput); schemas.ClauseInput = z.toJSONSchema(clauseInput); schemas.ServiceConsentDisplayInput = z.toJSONSchema(displayInput);

add("/forms/document-options", "get", "form.read + document.read + current service grant", "같은 서비스에서 공개 중인 동의서 게시 버전 검색·페이지 목록", undefined, "implemented");
(paths["/forms/document-options"].get as Operation).parameters = [
  { in: "query", name: "serviceId", required: true, schema: { type: "string", format: "uuid" } },
  { in: "query", name: "search", schema: { type: "string" } },
  ...["page", "pageSize"].map(name => ({ in: "query", name, schema: { type: "integer", minimum: 1 } })),
];
add("/submissions/{id}/receipts/{receiptId}/pdf", "get", "submission.read + current service grant + unexpired or held submission", "제출 당시 암호화해 보관한 동의 영수증 PDF; 파기 후 접근 차단", undefined, "implemented");
(paths["/submissions/{id}/receipts/{receiptId}/pdf"].get as Operation).responses = { ...errors, "200": { description: "저장한 PDF 바이트. no-store, X-PDF-SHA256, X-Document-SHA256", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } } };

add("/share-grants", "get", "share.manage + submission.read + current service grant", "formId의 외부 공유 목록; 이메일 전체 일치 검색·상태 필터·페이지", undefined, "implemented");
add("/share-grants", "post", "share.manage + submission.read (+ file.read for file fields)", "지정 게시 버전과 필드에 외부 열람자 초대; 멱등키·암호화 이메일·메일 작업", shareCreateInput, "implemented", "201");
add("/share-grants/options", "get", "share.manage + submission.read + current service grant", "폼의 게시 버전·질문 선택 목록", undefined, "implemented");
add("/share-grants/{id}", "get", "share.manage + submission.read + current service grant", "외부 공유 안전 DTO", undefined, "implemented");
add("/share-grants/{id}", "patch", "share.manage + submission.read + current service grant", "이메일·필드·기한 변경, 초대 코드 교체·세션 무효화·새 메일", shareUpdateInput, "implemented");
add("/share-grants/{id}", "delete", "share.manage + submission.read + If-Match", "공유 회수; 현재 세션·인증코드·파일 접근 차단", undefined, "implemented");
add("/share-grants/{id}/resend", "post", "share.manage + submission.read", "초대 재발송·이전 코드와 세션 무효화", shareVersionInput, "implemented");
add("/share-grants/{id}/events", "get", "share.manage + submission.read", "개인정보 값·코드 없는 열람 로그 페이지", undefined, "implemented");
(paths["/share-grants"].post as Operation).parameters = [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 16, maxLength: 128 } }];
(paths["/share-grants/{id}"].delete as Operation).parameters = [{ in: "header", name: "If-Match", required: true, schema: { type: "integer", minimum: 1 } }];
for (const path of ["/share-grants", "/share-grants/options"]) (paths[path].get as Operation).parameters = [{ in: "query", name: "formId", required: true, schema: { type: "string", format: "uuid" } }];
add("/viewer/challenges", "post", "invitation code + form code + email + consent; rate limit", "이메일 인증 요청; 유효/무효 조합에 동일 응답, 브라우저 바인딩 쿠키 설정", challengeInput, "implemented", "202");
add("/viewer/challenges/{challengeId}/verify", "post", "HttpOnly browser challenge cookie", "6자리 일회용 코드 검증; 5회 제한·10분 만료·30분 열람 세션", verificationInput, "implemented");
add("/viewer/session", "get", "active viewer + fresh grant/scope/creator permission", "외부 열람 세션·기한·허용 필드", undefined, "implemented");
add("/viewer/logout", "post", "viewer cookie", "열람 세션 회수·쿠키 만료", undefined, "implemented", "204");
add("/viewer/submissions", "get", "active viewer + fresh grant/scope/creator permission", "허용 게시 버전·필드의 현재 응답; 철회·파기·만료는 제외", undefined, "implemented");
add("/viewer/submissions/{id}", "get", "active viewer + fresh grant + bound version", "허용 필드만 포함한 응답; 메모·정정 이력·영수증 제외", undefined, "implemented");
add("/viewer/files", "get", "active viewer + selected file question + current answer", "공유 응답의 현재 첨부파일 목록", undefined, "implemented");
add("/viewer/files/{id}", "get", "active viewer + exact submission/question/file binding", "허용된 현재 첨부파일 메타", undefined, "implemented");
add("/viewer/files/{id}/download", "get", "active viewer + exact submission/question/file binding", "공유·응답·파일 잠금 아래 비공개 파일 원본 다운로드", undefined, "implemented");
for (const [path, item] of Object.entries(paths).filter(([path]) => path.startsWith("/viewer/"))) {
  for (const method of ["get", "post"]) if (item[method]) (item[method] as Operation).security = path === "/viewer/challenges" ? [] :
    path.includes("/verify") ? [{ viewerChallenge: [] }] : [{ viewerSession: [] }];
}
for (const path of ["/viewer/files", "/viewer/files/{id}", "/viewer/files/{id}/download"]) (paths[path].get as Operation).parameters =
  (path === "/viewer/files" ? ["submissionId"] : ["submissionId", "questionId"]).map(name => ({ in: "query", name, required: true, schema: { type: "string", format: "uuid" } }));
(paths["/viewer/files/{id}/download"].get as Operation).responses = { ...errors, "200": { description: "첨부파일 원본. attachment, private/no-store, nosniff, sandbox CSP", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } } };

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

for (const [path, method, description] of [
  ["/senders", "get", "서비스·채널·상태·이름/정확한 주소 검색·서버 페이지"],
  ["/senders", "post", "발신자 등록·멱등키, 인증 대기"],
  ["/senders/{id}", "get", "발신자·현재 인증·증빙·최근 100개 변경 이력"],
  ["/senders/{id}", "patch", "이름·설명·주소 변경·version; 주소 변경 시 재인증"],
  ["/senders/{id}", "delete", "사용중 삭제 제한·주소와 증빙 원문 삭제·최소 이력 유지"],
  ["/senders/{id}/default", "post", "현재 인증된 발신자로 서비스/채널 대표 변경"],
  ["/senders/{id}/disable", "post", "사용 중지·기존 인증/대표 해제"],
  ["/senders/{id}/renew", "post", "새 인증 세대·이전 코드 및 예약 발송 차단"],
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
  ...["default", "disable", "renew", "request-email", "dns", "check"].map(action => ["/senders/{id}/" + action, "post", senderVersion] as const),
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
add("/subscriptions", "post", "billing.write + current tenant", "서버 가격표에 따른 유료 구매 대기 요청; PG 승인 아님", purchaseRequest, "implemented", "201");
add("/subscriptions/entitlement", "get", "billing.read + current tenant", "회사별 실제 entitlement", undefined, "implemented");
for (const [action, schema] of [["cancel", cancelRequest], ["undo-cancel", cancelRequest], ["schedule-cancel", scheduleTrialCancelRequest]] as const)
  add("/subscriptions/{id}/" + action, "post", "billing.write + current tenant", "체험/대기 구독의 " + action + " 상태 전이; 유료 PG 취소 아님", schema, "implemented");
add("/access-requests", "get", "active member for mine; member.manage for review", "현재 회사의 본인/검토 요청·요청 가능한 서비스", undefined, "implemented");
add("/access-requests", "post", "active member; experts excluded", "같은 회사 활성 서비스 접근 요청; 동일 대기 요청 재사용", accessRequestInput, "implemented", "201");
add("/access-requests/{id}", "patch", "member.manage + active tenant", "본인 승인 금지·역할 상한·version 확인 후 결정", accessDecisionInput, "implemented");
add("/access-requests/{id}", "delete", "requester + active tenant + If-Match", "본인 대기 요청 취소·이력 보존", undefined, "implemented", "204");
add("/expert-assignments", "get", "own expert or platform-admin", "본인 또는 운영자 배정 목록", undefined, "implemented");
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
type PolicyRule = { id: string; prefixes: string[] };
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
