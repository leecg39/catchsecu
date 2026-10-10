/** Stable local fixtures shared by the active route catalog. These values are test data, not production secrets. */
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
  fileView: "45000000-0000-4000-8000-000000000002",
  importFile: "45000000-0000-4000-8000-000000000003",
  importJob: "45100000-0000-4000-8000-000000000001",
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
  kakaoChannel: "4c000000-0000-4000-8000-000000000001",
  purchase: "4e000000-0000-4000-8000-000000000001",
  billingPlanVersion: "4f000000-0000-4000-8000-000000000001",
  subscription: "4f000000-0000-4000-8000-000000000002",
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
  fileViewUpload: token("FixFileViewUploadA"),
  subjectAccess: token("FixSubjectAccessA"),
  subjectBrowser: token("FixSubjectBrowserA"),
  documentConsent: token("FixDocConsentA"),
  documentPolicy: token("FixDocPolicyA"),
  documentOverseas: token("FixDocOverseasA"),
} as const;
export const externalScenarios = [
  { id: "EXT-01", grade: "adapter" as const, name: "로컬 메일함 전달", evidence: "MAIL_TRANSPORT=local 일 때 .local 메일 파일", releasePass: false },
  { id: "EXT-02", grade: "adapter" as const, name: "ClamAV 파일 검사", evidence: "CLAMAV_SOCKET이 연결될 때만 adapter. 없으면 blocked", releasePass: false },
  { id: "EXT-03", grade: "adapter" as const, name: "로컬 Slack/Teams 알림 파일", evidence: "NOTIFICATION_TRANSPORT=local", releasePass: false },
  { id: "EXT-04", grade: "staging" as const, name: "외부 SMTP 수신·반송", evidence: "공급자 receipt 없음", releasePass: false,
    testTargetPolicy: "전용 allowlist 시험 수신함과 공급자 시험 계정만 사용" },
  { id: "EXT-05", grade: "staging" as const, name: "문자·카카오 발송", evidence: "공급자 시험 계정·실제 발송 receipt 미확보", releasePass: false,
    testTargetPolicy: "전용 allowlist 시험 전화번호·카카오 채널과 공급자 시험 계정만 사용" },
  { id: "EXT-06", grade: "staging" as const, name: "PG 승인·환불", evidence: "PaymentOrder/Refund 구현; 실제 PG sandbox 수용 미확인", releasePass: false,
    testTargetPolicy: "PG sandbox 상점·시험 결제수단만 사용하고 실제 과금 금지" },
  { id: "EXT-07", grade: "staging" as const, name: "본인인증 callback", evidence: "검증 영수증 없음. URL의 result 값으로 성공 처리 금지", releasePass: false,
    testTargetPolicy: "본인인증 sandbox 전용 시험 사용자와 callback allowlist만 사용" },
  { id: "EXT-08", grade: "staging" as const, name: "SSO·새올", evidence: "테스트 IdP와 기관 계약 없음", releasePass: false,
    testTargetPolicy: "전용 시험 IdP tenant·기관 계정과 callback allowlist만 사용" },
] as const;
export const ciGates = {
  internal: { command: "npm run verify:fixtures", requiredOnEveryChange: true, skipIsPass: false, mockIsPass: false },
  adapter: { command: "npm test", requiredOnEveryChange: true, skipIsPass: false, missingToolIs: "blocked" },
  staging: { command: "npm run test:providers", requiredForRelease: true, requiredOnEveryChange: false, missingCredentialIs: "blocked", blockedIsPass: false },
} as const;
