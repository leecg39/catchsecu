# P11-T03 OAuth/OIDC·SAML·계정연결 — 부분 구현(로컬 검증 완료, 실제 IdP 미검증)

> 2026-10-06: OIDC authorization code + PKCE + state/nonce + RS256 서명 검증 + 계정 연결을 구현했다. 테스트는 실제 RSA 키를 쓰는 로컬 IdP(HTTP 서버)로 수행했다.
> 2026-10-07: SAML 2.0 SP-initiated Web SSO(POST 바인딩)를 `@node-saml/node-saml@5.1.0`으로 구현했다. 테스트는 openssl로 생성한 실제 X.509 인증서와 `xml-crypto` 서명의 로컬 IdP로 수행했다. 실제 SaaS IdP(Okta/Entra/Google) 검증, 초대가입 callback UI는 미완료다.

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

## SAML (2026-10-07 추가)

- `SsoProvider.protocol`(`oidc`|`saml`) + `idpCert`(IdP 서명 인증서 PEM, 공개키라 평문 저장). `tokenUrl`/`jwksUrl`은 OIDC 전용으로 nullable 완화. DB CHECK가 protocol 값과 SAML 필수 인증서·endpoint 보안을 강제한다.
- 시작: `GET /api/v1/auth/sso/:id` — SAML provider면 node-saml이 AuthnRequest(deflate+base64)를 생성해 IdP SSO URL로 302. `SsoState.nonceHash`에 AuthnRequest ID 해시, `stateHash`에 RelayState 해시를 저장한다.
- 콜백: `POST /api/v1/auth/sso/saml` — RelayState로 상태 조회 후 `validatePostResponseAsync`로 XML-DSig 서명(idpCert)·Conditions 시각·Audience·InResponseTo(캐시 프로바이더가 state의 요청ID 해시와 대조)를 검증한다. 서명은 응답 또는 어서션 중 하나 이상 필수.
- node-saml이 검증하지 않는 항목을 직접 강제한다 — 로그인 응답의 `profile.issuer === provider.issuer`(idpIssuer는 logout 경로만 검증됨), 어서션 존재 시 생략되는 `StatusCode=Success`, `SubjectConfirmationData@Recipient === ACS URL`.
- RelayState 조건부 삭제로 일회성 소비·재전송 차단은 OIDC와 동일하며, 프로비저닝/연결/세션 발급은 `completeSso` 공용 경로를 공유한다.
- POST 라우트는 Origin 검사를 `"saml-assertion"` 외부 인증으로 우회한다 — IdP가 리다이렉트 POST하므로 Origin이 없고, 대신 SAML 서명+state 바인딩이 자격증명 역할을 한다.

## 검증(실제 로컬 SAML IdP)

`tests/server/sso-saml.test.ts` — openssl로 생성한 RSA-2048 + 자체서명 X.509, `xml-crypto`로 Response에 실제 enveloped XML-DSig 서명.

- CRUD/게이트: protocol=saml 생성 → 인증서 사전검사(subject·만료 표시)→활성화, 인증서 누락 422, OIDC 필드 누락 422, 손상 PEM은 생성되지만 preflightOk=false, 비루프백 http SSO URL 422
- 실제 로그인: AuthnRequest 디코딩(ACS·Destination·ID 확인) → 서명된 SAMLResponse POST → 302 + 세션 쿠키 → `/me` 200, viewer 멤버십·account 연결, RelayState 재전송 401
- 적대적: 무서명 401, 다른 키 서명 401, issuer 불일치 401(직접 강제), audience 불일치 401, 위조 InResponseTo 401, 다른 ACS Recipient 401(직접 강제), 만료 어서션 401, RequestDenied 상태 401(직접 강제), 불명 RelayState 401, 서명 후 XML 변조 401

## 미완료

- 실제 외부 IdP(Okta/Entra/Google) 통합 검증
- 초대가입 callback 모드의 초대 연결과 UI
- 회사 관리 화면의 SSO 설정 UI(`/security/sso`는 현재 Gate 상태 — API는 완비)
