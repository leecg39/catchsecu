# P11-T05 보안 모듈 게이트 — 미완료

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

개별 인증/IP/MFA 방어 코드와 시험. 이번 소스 조사만으로 테스트 실행·브라우저·외부 연동 통과를 주장하지 않는다.

- [src/server/auth.ts](../../../src/server/auth.ts)
- [src/server/ip-enforcement.ts](../../../src/server/ip-enforcement.ts) — assertCompanyIp
- [src/server/mfa-enforcement.ts](../../../src/server/mfa-enforcement.ts) — mfaState, assertCompanyMfa
- [tests/server/auth-session-gate.test.ts](../../../tests/server/auth-session-gate.test.ts)
- [tests/server/ip-access.test.ts](../../../tests/server/ip-access.test.ts)
- [tests/server/mfa-policy.test.ts](../../../tests/server/mfa-policy.test.ts)

## 남은 구현·수용

실제 SSO/기관 인증·키 회전·전체 보안 감사.

원래 범위: 정책→로그인→IP→2FA→SSO→계정 회수→감사까지 통합 검사한다.

수용 조건: 실제권한/반복공격·만료·회수·탈퇴 테스트; 비밀 관리/키 회전; critical/high 미해결0

선행: P11-T02, P11-T03, P11-T04. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.

## 통합 체인 검증 추가 (2026-10-07)

`tests/server/security-gate.test.ts` — 격리 test DB에서 정책→로그인→IP→2FA→회수→세션→감사를 **하나의 연속 시나리오**로 집행:

| 단계 | 검증 |
|---|---|
| 정책 권한 | PATCH `/security/policy` 비-owner 403, 잘못된 비밀번호 401, owner+비밀번호 200 |
| IP 경계 | CIDR `10.8.0.0/16` 등록→정책 ON → 허용밖 `192.0.2.99`에서 context 403, 대역 내 200 |
| 2FA 강제 | `requireMfa=true` → 미등록 admin의 `/context`는 `requireMfa:true`(setup 경로 유지), `member.manage` API는 403 `MFA_REQUIRED` |
| 2FA 예외 | `MfaException` 생성 → 200, 실제 시각 만료 후 → 403 (DB 트리거가 과거 만료 직접 갱신·버전 생략을 차단해 우회 불가 확인) |
| 계정 회수 | `status=suspended` → 세션 즉시 파기·모든 요청 401; 재로그인도 `company:null`·`capabilities:[]`·보호 API 403 |
| 세션 만료 | `sessionMinutes=30` + 세션 `updatedAt`을 31분 전으로 → 다음 요청 401 `SESSION_EXPIRED` |
| 감사 | `policy.updated`·`member.*`·`ip.*` 이벤트가 AuditEvent에 기록됨 |
| 부수 발견 | 2FA 활성화 계정 재로그인은 세션 대신 임시 토큰 → 실제 TOTP verify로 완료 확인 |

회귀: security-gate·mfa-policy·ip-access·policy-approvals·auth-session-gate **5파일 79/79 통과**, tsc·eslint 0 오류.

## 남은 수용 조건

- SSO 단계는 P11-T03 로컬 RSA IdP 검증을 참조(이 체인 미포함), GPKI/새올(P11-T04)은 외부 자격증명 대기
- 비밀 관리/키 회전 정책, OWASP critical/high=0 감사, 전체 선행 게이트 미완료로 체크박스 유지
