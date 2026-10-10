# 실제 HTTPS SSO 시험: HTTP·Ego·재시작 통과

2026-10-10 체크포인트. 개발 DB의 새 합성 사용자·회사·공급자만 사용하는 별도 HTTPS 애플리케이션과 IdP다. 실제 외부 Google/Microsoft/기관 인증 수용으로 집계하지 않는다.

## 검증 결과

- [HTTP 결과](http.json): 실제 애플리케이션 요청 48개 통과. OIDC authorize/동의/authorization code/PKCE/token/JWKS와 SAML 서명 POST를 실제 TLS 소켓으로 왕복했다. 계정 연결·기존 계정 로그인·재사용 거절·브라우저 결합 쿠키 누락 거절/정상 결합 성공을 포함한다.
- OIDC nonce/issuer/audience/expiry/signature, SAML Recipient/issuer/audience/expiry/signature 오류를 거절했다. 실패 요청으로 추가 세션이 생성되지 않는 것을 DB에서 검사했다.
- 계정 연결 2개, 인증 근거 6개(모두 OTHER), 세션 7개, 감사 19개. 소유자 이메일 확인/회사 생성은 명시적인 DB 준비 단계이며 사용자 UI 검증으로 집계하지 않는다.
- [IdP 이벤트](idp-events.json)는 추가 실제 IdP 요청의 성공 여부만 기록한다. 인증 코드·비밀번호·시크릿·키·세션 토큰은 보고서에 기록하지 않는다.
- [인증서](certificate.json): 새 시험 CA, SAN localhost/127.0.0.1 및 serverAuth 서버 인증서. 초기 HTTP 시험은 Node 시험 프로세스의 NODE_EXTRA_CA_CERTS에 신뢰를 한정했다. 후속 브라우저 시험에만 사용자 승인으로 임시 사용자 키체인 신뢰를 적용했고 아래와 같이 제거했다. CA/호스트명 검증은 계속 유지했다.
- 신뢰되지 않은 CA·SAN 불일치·만료의 실제 TLS 거절 시험은 앞선 [E2 전송 시험](../../R07-T02/outbound/README.md)에 별도 기록되어 있다.

## Ego 실제 HTTPS 왕복과 DB 증거

사용자 승인 후 SSL 용도로만 시험 CA를 사용자 키체인에 등록했다. [OIDC 로그인](browser-oidc-login.json), [OIDC 기존 계정 연결 재확인](browser-oidc-link.json), [SAML 기존 계정 연결 재확인](browser-saml-link.json), [SAML 로그인](browser-saml-login.json)을 실제 IdP 동의 버튼으로 완료했다. 기존 계정 연결 2개를 중복 생성하지 않았다. 최초 연결 자체는 앞선 실제 HTTPS HTTP 시험에서 수행했다.

[교차 사이트 POST/쿠키 관측](browser-saml-start.json)에서 IdP `https://127.0.0.1:3444`의 form이 애플리케이션 `https://localhost:3443/api/v1/auth/sso/saml`로 POST하는 것을 확인했다. 브라우저 결합 쿠키는 Secure/HttpOnly/SameSite=None, 로그인 쿠키는 Lax다. 콜백이나 쿠키를 수동 주입하지 않고 브라우저 폼을 제출했다. [최종 브라우저 세션의 실제 DB 인증 근거](browser-db.json)는 해당 SAML 공급자/회사/사용자와 일치하고 OTHER로 기록됐다. [IdP 화면](saml-idp.png), [로그인 후 화면](saml-authenticated.png).

[동결](freeze.json) 이후 HTTPS 애플리케이션을 새 프로세스로 재시작했다. [HTTP 재조회와 관계행 해시](restart.json) 및 [Ego 새로고침](browser-restart.json)을 통과했다. 공급자2·계정3(SSO2+이메일1)·세션11·근거10·state5·감사33의 해시는 `e53cfe4a5bf6f874c9bd8c0ab72dd159e1c0fbfc999b46090d9cc635114d9121`이다. 이후 fixture 변경/최초 http/freeze 재실행을 금지한다.

## 시험 CA와 남은 범위

[신뢰 설정 기록](trust.json): 사용자가 macOS 인증을 완료한 뒤 신뢰 제거와 정확한 SHA256 인증서 삭제가 exit0으로 끝났다. 사용자 로그인 키체인에서 해당 인증서 부재를 확인했고, 동일 서버 인증서의 시스템 검증은 설치 중 exit0에서 제거 후 exit1/CSSMERR_TP_NOT_TRUSTED로 바뀌었다. 임시 신뢰와 인증서 정리를 완료했다. 인증서 경고 우회나 TLS 검증 해제는 하지 않았다. 최초 미신뢰 실패는 [이전 관측](browser-before-trust.json)과 [원문](browser-certificate-blocked.txt)에 보존했다.

원본18개 인증·2개 정책 화면 전수 수용과 실제 외부 Google/Microsoft/기관 제공사 수용은 별도 잔여다. 이 결과는 합성 로컬 IdP의 실제 TLS/브라우저 동작 검증이다.

## 시행 오류 구분

최초 `/login` 접근은 dev 컴파일이 15초 관측 제한을 넘었지만 후속 동일 탭에서 정상 화면을 확인했다. OIDC 성공 후 회사 선택 버튼 대기는 회사가 하나여서 텍스트 헤더인 상황을 잘못 예상한 관측 오류였다. 새 로그인을 실행하지 않고 동일 세션/페이지에서 성공과 일치 사용자를 확인했다. 첫 재시작 시 기존 dev 프로세스가 종료 제한시간을 소모해 새 서버의 dev lock이 거절됐다. 기존 종료(exit1)와 거절 프로세스(exit1)를 확인한 뒤 새 프로세스를 시작했고 HTTP/Ego/DB 동결 해시를 검증했다. 이 오류를 성공으로 집계하지 않는다.

## 재현 자원

- 환경: `scripts/qa-sso-https-environment.ts` (init/app/idp), 시험: `scripts/qa-rea-sso-https.ts` (http/browser/freeze/verify/restart).
- `init`와 `http` 최초 실행은 완료됐다. 기존 fixture를 재생성하지 않는다. 개인 데이터는 ignored `.local/rea-fullstack/sso/https`에 저장하며 개인 키/자격증명 파일은 0600이다.
- 타입 검사 [최종 로그](typecheck-final.log) 및 [린트](lint-first.log) 통과. 최초 타입 오류는 [초기 로그](typecheck-first.log)에 보존했고 수정했다.
- HTTP48 결과 후 E4에서 생성 계약에 필수 tenantId가 추가됐다. 시험 스크립트는 이를 반영했으나 이미 성공한 최초 생성/인증 시험을 재실행하지 않았다. 이 차이를 현재 소스 전체의 신규 HTTP48 통과로 확대하지 않는다.

후속 브라우저 세션/DB 대조 QA 코드의 [타입](typecheck-browser.log)·[린트](lint-browser.log)도 통과했다.

## 브라우저 재시작의 추가 읽기 감사

최초 재시작 HTTP 직후에는 원래 전체 해시가 일치했다. 이후 대시보드 UI가 `analytics.dashboard_viewed`와 `marketing.summary_viewed` 감사2건을 추가했다. [엄격 전체 해시 검사 실패](failed-verify.json)를 보존했다. [추가 행의 ID·각 행 해시](browser-audit-delta.json)를 독립 조회로 확정했고, 이 두 행만 제외하면 회사/공급자/계정/세션/근거/state/기존감사 전체가 원본 동결 해시와 정확히 일치했다. DB나 기존 동결 해시를 재설정하지 않았다.

[최종 검증](verify.json)은 해당 두 행의 내용까지 고정하여 검증한다. 현재 전체 해시는 `a8b8479c85fc23c93be7028c36448d6b4cae61a6c8274236adb6541670b74754`, 감사 수는35이며 기준 해시 `e53cfe4a…`와 명시적으로 구분한다. 새로운 감사나 인증 데이터 변경을 자동 허용하지 않는다. [후속 타입](typecheck-final-audit.log)·[린트](lint-final-audit.log)도 통과했다. HTTPS 시험 앱과 IdP 프로세스는 검증 후 정상 종료했다.
