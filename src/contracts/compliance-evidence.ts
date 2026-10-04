import { z } from "zod";

const count = z.number().int().nonnegative().safe();
export const complianceEvidenceBody = z.object({
  version: z.literal(1), checkedAt: z.iso.datetime(), serviceIds: z.array(z.uuid()),
  facts: z.object({
    services: count, purposeServices: count, activePurposes: count,
    policyServices: count, livePolicyPublications: count,
    unpurgedSubmissions: count, overdueSubmissions: count, heldSubmissions: count,
    companyMfa: z.object({ required: z.boolean().nullable(), members: count, enrolled: count }).nullable(),
  }),
});
export const complianceEvidenceSchema = complianceEvidenceBody.extend({ hash: z.string().regex(/^[a-f0-9]{64}$/) });
export type ComplianceEvidence = z.infer<typeof complianceEvidenceSchema>;
export const evidenceStatusLabels = { observed: "조건 확인", attention: "검토 필요", not_assessed: "미점검", not_applicable: "대상 없음" };
export type EvidenceCheck = { id: string; category: string; title: string; status: keyof typeof evidenceStatusLabels; detail: string; source: string };

// Version 1 describes stored technical facts, never a legal compliance verdict.
export function complianceEvidenceChecks(evidence: ComplianceEvidence): EvidenceCheck[] {
  const f = evidence.facts;
  const coverage = (value: number) => !f.services ? "not_applicable" : value === f.services ? "observed" : "attention";
  return [
    { id: "purpose-coverage", category: "수집", title: "처리 목적 등록", status: coverage(f.purposeServices),
      detail: `선택 서비스 ${f.services}개 중 활성 처리 목적이 등록된 서비스 ${f.purposeServices}개, 활성 목적 ${f.activePurposes}개. 목적·법적 근거의 적정성은 별도 검토가 필요합니다.`, source: "ProcessingPurpose · status=active" },
    { id: "policy-publication", category: "이용", title: "처리방침 게시 기록", status: coverage(f.policyServices),
      detail: `선택 서비스 ${f.services}개 중 유효한 내부 처리방침 게시가 있는 서비스 ${f.policyServices}개, 게시 ${f.livePolicyPublications}개. 외부 게시와 본문 적정성은 확인하지 않습니다.`, source: "DocumentPublication · 활성·미회수·미만료, 비보관 privacy_policy" },
    { id: "retention-overdue", category: "파기", title: "보유 기한 경과 응답", status: !f.unpurgedSubmissions ? "not_applicable" : f.overdueSubmissions ? "attention" : "observed",
      detail: `파기 미완료 응답 ${f.unpurgedSubmissions}건 중 보존 조치가 없고 기한이 지난 응답 ${f.overdueSubmissions}건, 보존 조치 ${f.heldSubmissions}건. 파기 중인 응답도 미완료에 포함하며 보존 사유·외부 사본은 별도 검토합니다.`, source: "Submission · status≠destroyed, retentionUntil≤점검 시각, legalHold=false" },
    { id: "member-mfa", category: "관리적 보호조치", title: "구성원 인증 등록", status: !f.companyMfa ? "not_assessed" : !f.companyMfa.members ? "not_applicable" : f.companyMfa.members === f.companyMfa.enrolled ? "observed" : "attention",
      detail: f.companyMfa ? `활성·이메일 확인된 직접 소속 구성원 ${f.companyMfa.members}명 중 검증된 2단계 인증 등록 ${f.companyMfa.enrolled}명. 임시 예외는 등록으로 계산하지 않습니다.` : "서비스별 마감에서는 회사 전체 구성원 정보를 점검하지 않습니다.", source: "Membership·User·TwoFactor · 활성 직접 소속, enabled 및 verified" },
    { id: "company-mfa", category: "기술적 보호조치", title: "회사 인증 강제 설정", status: f.companyMfa?.required == null ? "not_assessed" : f.companyMfa.required ? "observed" : "attention",
      detail: !f.companyMfa ? "서비스별 마감에서는 회사 전체 인증 정책을 점검하지 않습니다." : f.companyMfa.required === null ? "저장된 회사 보안 정책이 없습니다." : `회사 2단계 인증 강제가 ${f.companyMfa.required ? "켜져" : "꺼져"} 있습니다. 설정 유무만 확인하며 보안 전체의 적정성을 판정하지 않습니다.`, source: "SecurityPolicy · requireMfa" },
  ];
}
