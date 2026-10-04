# P11-T03 OAuth/OIDC·SAML·계정연결

## 개요

기업용 SSO(Single Sign-On)를 위한 OAuth 2.0 / OpenID Connect (OIDC) 및 SAML 2.0 인증 연동, state/nonce/PKCE 검증, 계정 연결 및 테넌트 격리를 구현한다.

## 구현 내용

1. **SSO Provider 설정**:
   - 회사별 독립적인 IdP(Identity Provider) 클라이언트 ID, 시크릿, Discovery 엔드포인트 저장 (암호화)
   - 표준 OIDC 흐름: Authorization Code with PKCE (S256)
2. **보안 검증**:
   - `state` 및 `nonce` 불일치 시 401 차단
   - JWT 서명(JWKS) 및 Audience/Issuer 정밀 검증
   - 미승인 도메인 및 위조 콜백 거부
   - 기존 내부 계정과의 안전한 매핑 및 충돌 방어

## 검증 내역

- 테스트 스위트: `tests/server/auth-session-gate.test.ts`, `tests/server/auth-navigation.test.ts`
- 주요 검증 항목:
  - 위조된 state/nonce 공격 방어
  - 회사별 IdP 설정 격리 및 타 회사 사용자 로그인 차단
  - SSO 인증 후 발급된 세션의 정상 동작 확인
