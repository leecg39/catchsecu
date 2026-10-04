# P11-T03 OAuth/OIDC·SAML·계정연결 — 미완료

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

일반 이메일 인증 기반; 외부 인증은 미연결 안내. 이번 소스 조사만으로 테스트 실행·브라우저·외부 연동 통과를 주장하지 않는다.

- [src/server/auth.ts](../../../src/server/auth.ts)
- [tests/server/auth-session-gate.test.ts](../../../tests/server/auth-session-gate.test.ts)

## 남은 구현·수용

회사 IdP CRUD·OIDC/SAML·계정연결·실제 SSO.

원래 범위: 회사 provider 설정 CRUD·사전검사, 로그인/연동/초대가입 callback을 표준 라이브러리로 구현한다.

수용 조건: state/nonce/PKCE/audience/issuer/서명·재전송·연결탈취 검사; 테스트 IdP 실제 SSO

선행: P02-T05, P11-T02. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.
