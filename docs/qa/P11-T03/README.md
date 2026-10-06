# P11-T03 OAuth/OIDC·SAML·계정연결 — 부분 구현(로컬 검증 완료, 실제 IdP 미검증)

2026-10-06 공급자 중지/교체 후속: 마지막 로그인 수단 보호를 수동 비활성화·인증정보 변경으로 확대하고 회사 간 동시 변경을 보호했다. 기존 세션 유지·대기 인증 차단·사전검사 재활성화 규칙과 UI 안내를 맞췄다. 넓은회귀203통과 후 기대값2건을 보완한 핵심15개·HTTP23개(재시작3 포함)·타입/빌드/린트 오류0(기존경고1)를 확인했다. 최신 브라우저·외부IdP와 migration4건은 남았다. [최신 증거](provider-lifecycle/README.md).

2026-10-06 전문가 재초대 후속: SSO와 이메일 수락이 기존 전문가 배정을 같은 규칙으로 회수하고 회수 감사를 수락 트랜잭션에 남긴다. 기존 이력·타 회사 배정을 보존하고 새 초대 범위로 서비스 권한을 교체한다. 관련174개·최종HTTP11개(재시작3 포함), 타입·린트·빌드가 통과했다. 실제UI·외부IdP·비활성화/키교체 및 기존 migration4건은 남았다. [최신 증거](expert-reinvitation/README.md).

2026-10-06 공급자 참조·계약 후속: Account와 SsoProvider를 DB FK·파생 참조·CHECK로 연결하고, 공급자 삭제의 실제 잠금 오류를409로 처리했다. 관련268개와 생성 응답 계약 보완 후 재검증5개, 실제HTTP17개(재시작3 포함), 타입·린트·최종빌드가 통과했다. 실제SSO API12개·181경로 중 관련12행 계약을 정리했다. Migration95개 빈 설치·기존행 보존을 확인했고 기존 체크섬4건 불일치는 남았다. 실제UI·외부IdP·비활성화/키교체·전문가 재초대 수용은 미완료다. [최신 증거](provider-reference/README.md). 이전 후속 기록은 각 수행 당시 상태다.

2026-10-06 초대 SSO 후속: 토큰 기반 공급자 조회·시작 API와 초대 화면을 연결하고, 시작 당시 초대 해시·버전을 바인딩했다. 재발송/만료/다른 이메일·계정 충돌·역할 상한·동시 수락·2FA·감사 롤백을 검증했다. 관련 186개·실제 HTTP 20개(재시작 5개 포함), 타입·린트·빌드·계약 검사가 통과했다. Migration 94개 빈 설치와 기존 행 보존을 확인했으며 기존 체크섬 불일치 4건은 남아 있다. 실제 브라우저·외부 IdP와 전체 SSO 참조/계약 수용은 미완료다. [최신 증거](invitations/README.md). 아래 후속 기록은 각 수행 당시 상태다.

2026-10-06 공급자 삭제 후속: 연결 계정·영향 사용자 세션/인증·대기 요청을 원자 정리하고 마지막 로그인 수단·최근 로그인·동시 삭제를 보호했다. 관련155개·HTTP15개(재시작3 포함)·타입/빌드·린트 오류0(경고1) 통과. 기존개발DB SSO계정1/고아0 확인. 초대 UI·참조모델/계약·브라우저/외부IdP 전체 수용은 남음. [최신 검증](provider-removal/README.md).
2026-10-06 연결 관리 후속: 본인 회사 SSO 목록·연결·해제 API/UI, 최근 로그인 확인·마지막 수단 보호·일반 unlink 우회 차단·전체 세션/대기 인증 회수·원자 감사를 구현했다. 관련147개+인증70개·HTTP16개(재시작3 포함)·빌드/타입/린트 오류0·계약 통과. 초대 UI·공급자 삭제 시 연결 수명주기·브라우저/외부IdP 수용은 남음. [최신 검증](accounts/README.md).
2026-10-06 오류 화면 후속: SSO 브라우저 실패를 안전한 로그인 안내로 연결하고 회사 SSO 시작 화면·OIDC 취소 state 소비를 구현했다. 관련130개·실제HTTP30개(재시작15 포함)·타입/린트 오류0·빌드 통과. 계정 연결/해제·초대 UI와 실제 브라우저/외부IdP 전체 수용은 남았다. [최신 검증](recovery/README.md).
2026-10-06 SAML 후속: 필수 정보와 서명된 XML의 사용자 확인, 요청 크기/중복 필드, 삭제 소속 자동 재가입을 보완했다. 기존 잘못된 응답12종과 JIT 재가입을 재현했고 최종86개·실제HTTP18개(재시작3 포함)·타입/린트/빌드가 통과했다. [현재 증거](saml-validation/README.md). 실제IdP/UI와 실패 화면 수용은 남았다.

2026-10-06 개인2FA 후속: SSO 세션 선발급 결함을 재현/수정했다. TOTP·이메일·복구코드와 회사/provider 바인딩, 세션 감사, 롤백을 연결했다. SSO57개·기존인증70개·실제HTTP18개 및 대기 challenge 재시작·빌드/타입/린트 통과. [MFA 증거](mfa/README.md).

2026-10-06 콜백 후속: 원래 연결 세션·회사/provider 버전·초대·정원·기존 이메일 자동연결 차단을 보완했다. 관련41개·실제HTTP18개(재시작3 포함)·빌드/타입/린트 통과. 기존 migration 체크섬4건 불일치와 SSO 개인2FA 연결은 미해결이다. [콜백 증거](callbacks/README.md).

2026-10-06 현재 설정 관리 보완: [권한·활성화·동시 수정 검증](revalidation/README.md). PostgreSQL27개·실제HTTP21개·독립DB/재시작·타입/린트/빌드 통과. 현재 변경의 브라우저와 외부 IdP는 미검증이며 Task는 진행 중이다.

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
  - login 모드: 기연결 계정 → 바로 세션. 미연결 → `email_verified===true` 필수, 기존 사용자는 SSO_LINK_REQUIRED로 명시적 연결 요구, 신규 사용자는 JIT 생성 + 회사 viewer 멤버십
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
- 초대가입(mode=invite): 시작 시 초대가 pending·미만료·동일 회사인지 검사하고, 콜백에서 초대를 조건부 수락(`status="pending"` 한정 updateMany으로 경합 차단)한 뒤 초대된 role·serviceIds로 멤버십+ServiceGrant를 생성한다. 초대 이메일 ≠ SSO 이메일이면 410, 초대 누락 422, 초대자 권한 상실 409.
- POST 라우트는 Origin 검사를 `"saml-assertion"` 외부 인증으로 우회한다 — IdP가 리다이렉트 POST하므로 Origin이 없고, 대신 SAML 서명+state 바인딩이 자격증명 역할을 한다.

## 검증(실제 로컬 SAML IdP)

`tests/server/sso-saml.test.ts` — openssl로 생성한 RSA-2048 + 자체서명 X.509, `xml-crypto`로 Response에 실제 enveloped XML-DSig 서명.

- CRUD/게이트: protocol=saml 생성 → 인증서 사전검사(subject·만료 표시)→활성화, 인증서 누락 422, OIDC 필드 누락 422, 손상 PEM은 생성되지만 preflightOk=false, 비루프백 http SSO URL 422
- 실제 로그인: AuthnRequest 디코딩(ACS·Destination·ID 확인) → 서명된 SAMLResponse POST → 302 + 세션 쿠키 → `/me` 200, viewer 멤버십·account 연결, RelayState 재전송 401
- 적대적: 무서명 401, 다른 키 서명 401, issuer 불일치 401(직접 강제), audience 불일치 401, 위조 InResponseTo 401, 다른 ACS Recipient 401(직접 강제), 만료 어서션 401, RequestDenied 상태 401(직접 강제), 불명 RelayState 401, 서명 후 XML 변조 401
- 초대가입: 초대 역할(editor)·서비스 그랜트로 수락됨을 DB 행으로 확인, 다른 이메일 초대 탈취 410+초대 pending 유지, 초대 없는 invite 422

## 미완료

- 개인2FA와 세션 감사는 로컬/HTTP로 확인했다. 실패 안내/시작 화면과 HTTP는 후속 구현했다. 최신 실제 브라우저·외부IdP·연결/해제·초대 화면의 전체 수용은 남았다.

- 실제 외부 IdP(Okta/Entra/Google) 통합 검증
- 초대가입 UI(메일 링크 → mode=invite&invitation= 연결의 화면 검증)

## 관리 화면 (2026-10-07 추가)

`/security/sso`·`/security/sso/setting`에 `SsoProviders` 컴포넌트(`src/components/management/SsoProviders.tsx`)를 구현했다. 브라우저 실측(Chrome DevTools, owner@catchsecu.local.test):

- 목록·빈 상태·등록 모달 렌더, OIDC↔SAML 전환 시 필드 교체(token/jwks ↔ idpCert PEM)
- 사전검사 실패 경로: 죽은 IdP 등록 → "등록은 되었으나 사전검사에 실패" 알림 + 목록에 미통과 행, 사용 버튼 비활성(서버 PREFLIGHT_REQUIRED와 일치)
- 사전검사 재실행 버튼 → 갱신된 결과 반영, 삭제 → 확인 다이얼로그 후 행 제거
- `security.write` 없는 역할은 관리 버튼 미노출(capabilities 기반)
- 미검증: 실제 IdP로의 로그인 버튼 왕복, SAML 프로토콜 등록의 UI 완주(서버는 별도 테스트로 검증됨)
