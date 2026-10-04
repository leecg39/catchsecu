# P11-T01 회사 보안 정책 CRUD와 집행

## 개요

회사 보안 정책(비밀번호 최소길이/변경주기/재사용방지, 2단계 인증 강제, 승인 결재선, 보유기간, 세션 유지시간)을 영속화하고, 즉시 관련 업무 경로에 집행한다.

## 구현 내용

1. **엔드포인트**:
   - `GET /api/v1/security/policy`: 현재 테넌트 보안 정책 조회
   - `PATCH /api/v1/security/policy`: 보안 정책 변경 (현재 비밀번호 재확인 필수)
   - `DELETE /api/v1/security/policy`: 보안 정책 초기화
2. **보안 규칙 및 집행**:
   - 최상위 관리자(`owner`) 전용 접근 제어
   - 비밀번호 확인 실패 시 rate limit 적용
   - 관리자 lockout 방지: 2단계 인증 강제 설정 시 관리자 본인이 2FA 등록되지 않은 경우 409 `MFA_SETUP_REQUIRED`로 차단
   - 승인 정책 변경 시 기존 `pendingApproval` 상태의 폼을 `draft`로 자동 롤백 및 기존 승인 요청 `superseded` 처리
   - `passwordRevision`, `approvalRevision` 버전 관리를 통해 정책 변경 즉시 다음 요청에 전파
   - 정책 변경 이력 `policy.updated` / `policy.reset` 감사 이벤트 생성

## 검증 내역

- 테스트 스위트: `tests/server/policy-approvals.test.ts`
- 주요 검증 항목:
  - 테넌트 격리 및 owner 외 권한 403 거부
  - 비밀번호 오류 5회 연속 시 429 차단
  - 2FA 미설정 owner의 2FA 강제 정책 활성화 차단
  - 승인 정책 활성화 시 미승인 폼의 공개 차단
  - 승인 결정(승인/반려) 및 반려 시 사유 기록
  - 정책 변경 시 대기 중인 승인 요청 원자적 롤백 및 무효화
