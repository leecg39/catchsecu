/** Stable local fixtures for the 181-route catalog. These values are test data, not production secrets. */
export const companies = {
  a: "10000000-0000-4000-8000-000000000001",
  b: "10000000-0000-4000-8000-000000000002",
} as const;
export const services = {
  a: "20000000-0000-4000-8000-000000000001",
  aRestricted: "20000000-0000-4000-8000-000000000002",
  b: "20000000-0000-4000-8000-000000000003",
} as const;
export const users = {
  ownerA: "30000000-0000-4000-8000-000000000001",
  adminA: "30000000-0000-4000-8000-000000000002",
  editorA: "30000000-0000-4000-8000-000000000003",
  viewerA: "30000000-0000-4000-8000-000000000004",
  privacyA: "30000000-0000-4000-8000-000000000005",
  senderA: "30000000-0000-4000-8000-000000000006",
  billingA: "30000000-0000-4000-8000-000000000007",
  securityA: "30000000-0000-4000-8000-000000000008",
  auditorA: "30000000-0000-4000-8000-000000000009",
  ownerB: "30000000-0000-4000-8000-000000000010",
} as const;
export const records = {
  form: "40000000-0000-4000-8000-000000000001",
  formVersion: "41000000-0000-4000-8000-000000000001",
  questionName: "42000000-0000-4000-8000-000000000001",
  questionEmail: "42000000-0000-4000-8000-000000000002",
  questionFile: "42000000-0000-4000-8000-000000000003",
  publication: "43000000-0000-4000-8000-000000000001",
  approval: "43200000-0000-4000-8000-000000000001",
  fixedUrl: "43100000-0000-4000-8000-000000000001",
  submission: "44000000-0000-4000-8000-000000000001",
  answerName: "44100000-0000-4000-8000-000000000001",
  answerEmail: "44100000-0000-4000-8000-000000000002",
  file: "45000000-0000-4000-8000-000000000001",
  subject: "46000000-0000-4000-8000-000000000001",
  subjectAccess: "46100000-0000-4000-8000-000000000001",
  receipt: "46200000-0000-4000-8000-000000000001",
  consentDocument: "47000000-0000-4000-8000-000000000001",
  policyDocument: "47000000-0000-4000-8000-000000000002",
  overseasDocument: "47000000-0000-4000-8000-000000000003",
  consentVersion: "47100000-0000-4000-8000-000000000001",
  policyVersion: "47100000-0000-4000-8000-000000000002",
  overseasVersion: "47100000-0000-4000-8000-000000000003",
  consentPublication: "47200000-0000-4000-8000-000000000001",
  policyPublication: "47200000-0000-4000-8000-000000000002",
  overseasPublication: "47200000-0000-4000-8000-000000000003",
  supportTicket: "48000000-0000-4000-8000-000000000001",
  messageTemplate: "49000000-0000-4000-8000-000000000001",
  kakaoTemplate: "4d000000-0000-4000-8000-000000000001",
  purchase: "4e000000-0000-4000-8000-000000000001",
  invoice: "4f000000-0000-4000-8000-000000000001",
} as const;
export const actors = [
  { role: "owner", email: "owner@catchsecu.local.test", userId: users.ownerA, tenantId: companies.a, populated: true },
  { role: "admin", email: "admin@catchsecu.local.test", userId: users.adminA, tenantId: companies.a, populated: true },
  { role: "editor", email: "editor@catchsecu.local.test", userId: users.editorA, tenantId: companies.a, populated: true },
  { role: "viewer", email: "viewer@catchsecu.local.test", userId: users.viewerA, tenantId: companies.a, populated: true },
  { role: "privacy", email: "privacy@catchsecu.local.test", userId: users.privacyA, tenantId: companies.a, populated: true },
  { role: "sender", email: "sender@catchsecu.local.test", userId: users.senderA, tenantId: companies.a, populated: true },
  { role: "billing", email: "billing@catchsecu.local.test", userId: users.billingA, tenantId: companies.a, populated: true },
  { role: "security", email: "security@catchsecu.local.test", userId: users.securityA, tenantId: companies.a, populated: true },
  { role: "auditor", email: "auditor@catchsecu.local.test", userId: users.auditorA, tenantId: companies.a, populated: true },
  { role: "owner", email: "owner-b@catchsecu.local.test", userId: users.ownerB, tenantId: companies.b, populated: false },
] as const;
export const subjectContact = { name: "픽스처 정보주체", email: "subject-a@catchsecu.local.test" } as const;
export const fixedSlug = "fixture-form-a";
export const noticeId = "59";
function token(prefix: string) {
  const value = prefix.padEnd(43, "0");
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("fixture token 형식 오류: " + prefix);
  return value;
}
export const tokens = {
  publicForm: token("FixPubFormA"),
  fileUpload: token("FixFileUploadA"),
  subjectAccess: token("FixSubjectAccessA"),
  subjectBrowser: token("FixSubjectBrowserA"),
  documentConsent: token("FixDocConsentA"),
  documentPolicy: token("FixDocPolicyA"),
  documentOverseas: token("FixDocOverseasA"),
} as const;
/** Routes whose business object has no table yet. Page shells may open; the ID is not a database row. */
export const unmodeledRoutes = new Set(["R014", "R069", "R070", "R108", "R109", "R110", "R111", "R113", "R114", "R115", "R116", "R156"]);
/**
 * R162–R164 keep the source path letters. Those letters are not aliases of consent, policy, or overseas documents.
 * The three tokens below only prove that a 43-character public document token can open the route.
 */
export const unresolvedDocumentRoutes = {
  R162: tokens.documentConsent,
  R163: tokens.documentPolicy,
  R164: tokens.documentOverseas,
} as const;
const params: Record<string, string> = {
  customerId: records.submission,
  questionId: records.questionFile,
  fileId: records.file,
  outerToken: tokens.publicForm,
  serviceId: services.a,
  formId: records.form,
  templateId: records.kakaoTemplate,
  admNotiId: noticeId,
  purchaseId: records.purchase,
  purchasedId: records.purchase,
  type: "license",
  errorCode: "PG_DENIED",
  id: records.invoice,
  category: "items",
  agree: "required",
  isDomestic: "domestic",
  result: "pending",
  org: "fixture-org",
  infoOwnerToken: tokens.subjectAccess,
  token: tokens.documentConsent,
};
export function concretePath(routeId: string, template: string) {
  const value = template.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    if (routeId === "R009" && name === "outerToken") return fixedSlug;
    if (name === "token" && routeId in unresolvedDocumentRoutes) return unresolvedDocumentRoutes[routeId as keyof typeof unresolvedDocumentRoutes];
    const resolved = params[name];
    if (!resolved) throw new Error(routeId + " 경로 매개변수 " + name + " 에 대한 fixture가 없습니다.");
    return resolved;
  });
  if (value.includes(":")) throw new Error(routeId + " 경로에 치환되지 않은 매개변수가 있습니다.");
  return value;
}
export type VerificationGrade = "internal" | "adapter" | "staging";
export function routeGrade(routeId: string): VerificationGrade {
  return unmodeledRoutes.has(routeId) ? "staging" : "internal";
}
/** Tasks that own no page row. A task missing from both the route matrix and this map is an orphan. */
export const nonRouteTasks: Record<string, "foundation" | "enforcement" | "embedded" | "gate" | "release"> = {
  "P00-T01": "foundation", "P00-T02": "foundation", "P00-T03": "foundation", "P00-T04": "foundation",
  "P01-T01": "foundation", "P01-T02": "foundation", "P01-T03": "foundation", "P01-T04": "foundation", "P01-T05": "foundation",
  "P02-T03": "enforcement", "P02-T05": "gate", "P03-T05": "gate", "P04-T05": "gate",
  "P05-T04": "embedded", "P06-T07": "gate", "P07-T03": "embedded", "P07-T04": "gate",
  "P08-T03": "embedded", "P09-T02": "embedded", "P09-T06": "gate", "P10-T05": "gate",
  "P11-T05": "gate", "P12-T03": "embedded", "P12-T04": "gate", "P13-T03": "gate", "P13-T04": "gate",
  "P14-T01": "release", "P14-T02": "release", "P14-T03": "release", "P14-T04": "release", "P14-T05": "release",
};
export const externalScenarios = [
  { id: "EXT-01", grade: "adapter" as const, name: "로컬 메일함 전달", evidence: "MAIL_TRANSPORT=local 일 때 .local 메일 파일", releasePass: false },
  { id: "EXT-02", grade: "adapter" as const, name: "ClamAV 파일 검사", evidence: "CLAMAV_SOCKET이 연결될 때만 adapter. 없으면 blocked", releasePass: false },
  { id: "EXT-03", grade: "adapter" as const, name: "로컬 Slack/Teams 알림 파일", evidence: "NOTIFICATION_TRANSPORT=local", releasePass: false },
  { id: "EXT-04", grade: "staging" as const, name: "외부 SMTP 수신·반송", evidence: "공급자 receipt 없음", releasePass: false },
  { id: "EXT-05", grade: "staging" as const, name: "문자·카카오 발송", evidence: "모델 또는 공급자 계정 없음", releasePass: false },
  { id: "EXT-06", grade: "staging" as const, name: "PG 승인·환불", evidence: "구매·청구 모델과 sandbox 없음", releasePass: false },
  { id: "EXT-07", grade: "staging" as const, name: "본인인증 callback", evidence: "검증 영수증 없음. URL의 result 값으로 성공 처리 금지", releasePass: false },
  { id: "EXT-08", grade: "staging" as const, name: "SSO·새올", evidence: "테스트 IdP와 기관 계약 없음", releasePass: false },
] as const;
export const ciGates = {
  internal: { command: "npm run verify:fixtures", requiredOnEveryChange: true, skipIsPass: false, mockIsPass: false },
  adapter: { command: "npm test", requiredOnEveryChange: true, skipIsPass: false, missingToolIs: "blocked" },
  staging: { command: "npm run test:providers", requiredForRelease: true, requiredOnEveryChange: false, missingCredentialIs: "blocked", blockedIsPass: false },
} as const;
