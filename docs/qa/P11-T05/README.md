# P11-T05 보안 모듈 게이트

## 개요

회사 보안 정책 수립 → 로그인 → IP 접근 제어 → 2단계 인증(TOTP) → SSO 계정 연동 → 권한 회수 및 탈퇴 → 감사 로그 기록에 이르는 보안 전 과정을 통합 검증한다.

## 구현 내용

1. **다층 보안 게이트**:
   - `scripts/server.ts`의 HMAC IP 증명 + CIDR 검사
   - `better-auth` 기반 비밀번호 정책 및 세션 관리
   - TOTP 2FA 강제 및 긴급 복구코드 소진
   - 비밀번호 변경 시 기존 모든 활성 세션 즉시 만료
   - 탈퇴 계정 및 정지 계정의 재접속 원천 차단
2. **비밀 정보 보호**:
   - `DATA_ENCRYPTION_KEY`를 통한 민감 데이터 암호화
   - API 응답 및 로그에서 토큰, 시크릿, PII 마스킹

## 검증 내역

- 테스트 스위트:
  - `tests/server/ip-access.test.ts`
  - `tests/server/mfa-policy.test.ts`
  - `tests/server/password-policy.test.ts`
  - `tests/server/policy-approvals.test.ts`
  - `tests/server/auth-session-gate.test.ts`
- 주요 검증 항목:
  - 비허용 IP 접속 즉시 차단
  - 2FA 미설정 사용자의 보호 리소스 접근 차단
  - 무차별 대입(Brute force) 공격에 대한 rate limiting 동작
  - Critical/High 보안 취약점 0건 검증
