# R07 E1 — 로그인 시작 브라우저 결합

2026-10-10. 로그인·초대·계정 연결의 state와 기관 이메일 등록 티켓을 시작 브라우저의 HttpOnly 쿠키에 결합했다. 로컬 검증 체크포인트이며 전체 R07·전체 107개 작업 완료가 아니다.

## 구현

- migration109의 SsoState.browserHash에는 32바이트 난수의 SHA-256만 저장한다. OIDC 성공/취소, SAML POST, 기관 PIN state 전환 및 이메일 challenge/오답/완료에서 소비 전에 대조한다. 외부 state의 null 해시는 거절한다. 직접 PIN 인증의 내부 즉시 소비 state만 null을 허용한다.
- HTTPS는 __Host- 접두사·Path=/·Secure·HttpOnly·SameSite=None, 명시적 ALLOW_LOCAL_SSO=1의 HTTP 루프백은 별도 이름·Lax를 사용한다. URL은 BETTER_AUTH_URL 기준이며 요청 Host/전달 헤더로 완화하지 않는다. HTTP SAML은 시작과 유효 state 소비를 거절한다.
- 최초 동시 두 탭의 응답이 단일 쿠키를 덮어쓰던 문제를 실패로 재현했다. 해시 앞 128비트를 쿠키 이름에 넣어 독립 최초 시작을 보존하고, 검증 때 전체 256비트 해시를 비교한다. 이후 시작은 기존 유효 결합 하나를 재사용하며 쿠키를 추가로 누적하지 않는다. state/PKCE/nonce는 요청별이다.
- 시작 응답의 비밀 쿠키는 Set-Cookie로만 전송한다. 조직 로그인 JSON은 status/ticket/expiresAt/protocol로 한정한다. 브라우저 불일치·HTTPS 필요 오류는 한국어 안내와 로그인 재시작 경로를 제공한다.

## 자동 검증

| 검증 | 결과 | 근거 |
|---|---|---|
| 이전 결합 누락 재현 | 로그인·연결 취소 2개 실패 | [before.log](../../R07-T02/browser-binding/before.log) |
| 최초 두 탭 경합 재현 | 1개 실패·15개 선택 제외 | [first-tab-race-before.log](../../R07-T02/browser-binding/first-tab-race-before.log) |
| 최종 PostgreSQL·서명·쿠키 회귀 | 7파일 269개 통과, 실패/미실행 0 | [회귀 JSON](../../R07-T02/browser-binding/regression-race-fixed.json) |
| 타입·린트·production 빌드 | 통과 | [빌드](../../R07-T02/browser-binding/build-race-fixed.log), [타입](../../R07-T02/browser-binding/typecheck-final.log), [앱/시험 린트](../../R07-T02/browser-binding/lint-final.log), [QA 린트](../../R07-T02/browser-binding/lint-qa.log) |
| dev/test 스키마 | migration109, 예상 밖 차이 0 | [dev](../../R07-T02/browser-binding/schema/catchsecu_dev-contract.json), [test](../../R07-T02/browser-binding/schema/catchsecu_test-contract.json) |

기존 직접 route 테스트에 실제 브라우저처럼 쿠키를 왕복하는 작은 jar를 연결했다. 적대 요청 시험은 raw handler로 jar를 우회한다. 첫 회귀의 초대 alias 19개 실패는 jar 적용 누락이었고 원문을 보존했다. 보완 뒤 267개가 통과했으며, 동시 탭 재현 및 PKCE 왕복 2개를 추가한 최종 결과가 269개다. 테스트 수를 합산하지 않는다. SAML 테스트의 HTTPS 환경 문자열은 실제 TLS 브라우저 왕복 증거가 아니다.

## 실제 HTTP·Ego·재시작

- [HTTP 22개](http.json): 실제 소유자 가입/로그인, 가상 디렉터리 생성/활성화, PIN state 전환, 쿠키 누락·변조·중복 거절, 실제 로컬 메일 OTP, 쿠키 없는 올바른 OTP 거절 및 시도 횟수 보존, 정상 등록·재사용 거절, OIDC 취소 전 state 보존, 문서 오류 복귀, HTTP SAML 거절.
- 소유자 이메일 확인/회사 및 취소 전용 OIDC/SAML은 명시적 DB fixture다. 실제 외부 IdP에는 접속하지 않았다. 최초 SAML fixture에서 인증서를 누락해 DB 제약이 거절했고, 유효한 새 시험 인증서를 생성한 뒤 남은 단계만 이어갔다. [실패 기록](failed-http.json)을 보존했으며 이전 소비 흐름을 재실행하지 않았다.
- Ego 공간2/p1에서 새 구성원의 PIN→이메일 발급→새로고침 복구→실제 로컬 메일 OTP 입력→등록 성공→본인 조회200을 확인했다. 등록 후 초안은 삭제됐다. [성공](browser-success.json), [쿠키 속성](browser-cookie.json), [복구 화면](email-restored.png), [등록 결과](registration-success.png).
- HttpOnly 쿠키는 브라우저에 저장됐고 document.cookie에서는 읽히지 않았다. HTTP 로컬 예외만 실측했으며 HTTPS SameSite=None cross-site POST는 미검증이다.
- 불일치 안내 URL을 직접 열고 재시작 링크를 실제 클릭했다. [복구](browser-recovery.json), [화면](browser-mismatch-recovery.png). 이 UI 관측과 실제 HTTP의 잘못된 브라우저 취소 시험은 별개다. Ego의 일반 alert 선택자는 Next의 두 번째 alert 때문에 모호했으며 현재 snapshot으로 대상 p를 확인했다.
- 같은 production 빌드의 PID45506→46784 재시작 후 HTTP 및 Ego 본인 조회200, 데이터 해시 일치. [HTTP 재시작](restart.json), [Ego 재시작](browser-restart.json), [최종 DB](verify.json).

동결 해시: cc4e04b861bd152c1dcc842dedd5bad270bc4e97f012af2d7089b5a1b091c434. 등록 구성원2, 대기 state/challenge0, Account3(소유자 credential 포함), Session3, SSO 근거2, 감사19, 완료 메일2. RepeatableRead의 관계 행을 검증하며 session token/updatedAt은 제외한다. 동결은 검증 기준이며 DB 쓰기 잠금이 아니다. fixture 비밀값은 .local의 권한0600 파일에만 보관한다.

기존 browser-followup 기준 b891f5e8…의 SsoState 한 행에는 migration109로 browserHash:null이 추가됐다. 기존 기준을 재작성하지 않고 해당 값이 null임을 확인한 뒤 **schema108 직렬화로만 비교**했다. 기존 이메일 등록 2c89f4bb… 및 정책 저장 45fee7c4…도 일치했다. [기존 기준 검증](../browser-followup/verify.json).

## 남은 범위

E1의 실제 HTTPS/SAML cross-site 브라우저, E2 DNS/IP 고정 전송, E3 실제 HTTPS 로컬 IdP와 인증서 거절, E4 공급자 화면 tenant/미저장 보호, E5 전체 인증 경로·MFA·원본 대조는 남아 있다. Google/Microsoft/기관·SMTP 등의 외부 제공사 수용은 이 결과에 포함하지 않는다. 브라우저 쿠키 차단/삭제 뒤에는 안전하게 재시작하며 검증 생략 fallback은 없다.

독립 읽기 리뷰는 최초 탭 경합 수정 후 추가 확정 결함을 찾지 못했다. 리뷰어가 테스트나 브라우저를 실행한 것으로 집계하지 않는다. [리뷰](review.json).
