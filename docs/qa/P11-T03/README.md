# P11-T03 OAuth/OIDC·SAML·계정연결 — 부분 구현(로컬 검증 완료, 실제 IdP 미검증)

> 2026-10-06: OIDC authorization code + PKCE + state/nonce + RS256 서명 검증 + 계정 연결을 구현했다. 테스트는 실제 RSA 키를 쓰는 로컬 IdP(HTTP 서버)로 수행했다. SAML과 실제 SaaS IdP(Okta/Entra/Google) 검증, 초대가입 callback UI는 미완료다.

## 구현

- 모델: `SsoProvider`(회사별 issuer/clientId/암호화 secret/endpoint/scopes/enabled/preflight), `SsoState`(state·nonce 해시, PKCE verifier 암호화, 10분 만료, mode login/link/invite)
- DB 제약: endpoint는 `https://` 또는 루프백 HTTP만, URL 내 자격증명(`@`) 금지. 앱도 production에서 loopback http 거부
- CRUD: `GET/POST /api/v1/security/sso`, `PATCH/DELETE /api/v1/security/sso/:id`, `POST .../preflight` — owner 전용, 버전 낙관락, 사전검사(JWKS 실조회) 통과 전 활성화 불가(409 PREFLIGHT_REQUIRED)
- 시작: `GET /api/v1/auth/sso/:id?mode=login|link|invite` → state·nonce·S256 challenge를 담아 IdP authorize로 302. state는 해시만 저장, verifier는 암호화 저장
- 콜백: `GET /api/v1/auth/sso/callback` — state 조건부 삭제(일회성 소비·재전송 차단), code+PKCE 토큰 교환(client_secret Basic), id_token을 JWKS로 RS256 서명·iss·aud·exp·iat·nonce 전수 검증
- 세션: 검증 통과 시 Session 행을 같은 트랜잭션에 생성하고 better-auth 서명 쿠키 발급 → `/dashboard` 302
- 계정 연결: `Account(providerId="sso:<provider>", accountId="iss|sub")`
  - login 모드: 기연결 계정 → 바로 세션. 미연결 → `email_verified===true` 필수, 기존 사용자는 emailVerified인 경우만 자동 연결, 신규 사용자는 JIT 생성 + 회사 viewer 멤버십
  - link 모드: 로그인 세션 + 해당 회사 구성원만 — 타인 계정에 연결 불가
  - 탈취 차단: 미검증 이메일 claim 403, 미인증 계정 연결 403, 비구성원·비활성 계정 403, 비활성/미검증 provider 404
- 감사: `sso.provider_*`, `sso.account_linked`, `sso.login`

## 검증(실제 로컬 IdP)

`tests/server/sso.test.ts` — RSA-2048 키페어·JWKS·authorize→code→token을 제공하는 node:http IdP.

- CRUD/게이트: 생성→preflightOk→활성화→목록(비밀값 미노출), JWKS 죽은 provider 활성화 409, 비루프백 http URL 422
- 실제 로그인: start 302 → IdP authorize 실요청 → callback → 302 + `better-auth.session_token` 쿠키 → `/me` 200 실인증, viewer 멤버십·account 연결 생성
- 적대적: state 재전송 401(일회성), 잘못된 서명키 401, issuer/audience/nonce 불일치 401, 만료 토큰 401, email_verified=false 탈취 403, 토큰 500→401, 불명 state 401

## 미완료

- SAML 어댑터(미구현 — 계약/SDK 필요)
- 실제 외부 IdP(Okta/Entra/Google) 통합 검증
- 초대가입 callback 모드의 초대 연결과 UI
- 회사 관리 화면의 SSO 설정 UI
