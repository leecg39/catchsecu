# R07 E2 — SSO 외부 통신 검증

2026-10-10. OIDC의 JWKS 조회와 토큰 교환에 DNS 응답 검사·주소 고정·TLS 검증·응답 제한을 적용했다. 사설 HTTPS 주소가 이전 사전검사를 통과하는 결함을 재현한 뒤 수정했다. 전체 R07이나 외부 인증 제공사의 수용 완료를 뜻하지 않는다.

## 변경과 범위

- `src/server/sso-transport.ts`: URL 자격증명·fragment·비정상 형식을 거절한다. 모든 DNS 응답을 검사한 후 공개 주소 하나에 연결을 고정하며, 연결 중 DNS를 다시 조회하지 않는다. 혼합된 공개/사설 응답도 거절한다.
- `src/server/public-network.ts`: 기존 알림 전송의 공개 IP 판정을 공통 함수로 분리했다. 알림 전송의 주소 허용 범위는 그대로다.
- HTTPS는 원래 hostname/SNI와 기본 인증서 검증을 사용한다. `rejectUnauthorized: true`, TLS 1.2 이상을 유지한다. 연결별 `agent: false`와 고정 lookup으로 다른 주소나 이전 소켓의 재사용을 막는다. [Node HTTPS](https://nodejs.org/api/https.html), [Node TLS](https://nodejs.org/api/tls.html).
- redirect를 따라가지 않는다. DNS는 최대 3초, 전체 요청은 기본 8초·최대 10초다. 헤더 16KiB, 요청 본문 64KiB, 응답 본문 1MiB 상한과 중단·불완전 응답·JSON 형식 검사를 적용했다. 실패 메시지는 공급자 본문이나 인증 정보를 포함하지 않는다.
- 로컬 주소 예외는 `NODE_ENV != production`이고 `ALLOW_LOCAL_SSO=1`이며 URL hostname이 정확히 localhost/127.0.0.1/::1일 때만 허용한다. DNS 별칭이나 다른 사설 주소는 허용하지 않는다. production에서는 이 플래그가 있어도 사설 주소를 거절한다.
- 기존 DB 구조는 변경하지 않았다. migration109는 앞선 브라우저 결합 단계의 변경이다.

## 실제 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 변경 전 결함 재현 | 사설 HTTPS JWKS 사전검사 거절 기대가 실패. fetch 대역을 사용했으며 실제 metadata 주소로 연결하지 않음 | [before.log](before.log) |
| 서버 회귀 | 12파일 409개 통과, 실패·대기 0 | [regression-first.json](regression-first.json) |
| 실제 TLS 연결 | 정상 CA/hostname GET·POST 성공, 미신뢰 CA·SAN 불일치·만료 인증서·production localhost 거절: 6개 통과 | [tls.json](tls.json) |
| production HTTP | 가입/로그인·공급자 생성·활성화 거절·재검사·목록 9개 통과. 통제된 로컬 TLS 대상에 TCP 연결 0건 | [http.json](http.json) |
| Ego2/p1 | 두 공급자의 미통과 사유와 사용 안 함 표시, 페이지 자체 가로 넘침 없음 | [관측](browser.json), [화면](browser.png) |
| 서버 재시작 | HTTP 목록 200, Ego 재로딩/목록 API 200, 공급자 버전/상태와 관계 행 해시 일치 | [restart.json](restart.json), [브라우저](browser-restart.json), [verify.json](verify.json) |
| 타입·린트·빌드 | 통과 | [타입](typecheck-final.log), [린트](lint.log), [타입 수정 후 린트](lint-type-fixes.log), [빌드](build.log) |

409개는 이전 결과와 합산하지 않는 이번 회귀 수다. `numTotalTestSuites=15`는 중첩 describe를 포함하며 실제 파일 수는 `testResults.length=12`다. 전송 52개, SSO 131개, 알림 25개 및 조직 인증·로그인 정책·계정 근거·SAML·세션 근거·브라우저 결합 검사가 포함된다. 주소 고정/SNI 옵션은 대역 시험으로, CA·hostname·만료 거절은 별도의 실제 TLS 소켓으로 확인했다.

TLS 시험은 새 사설 시험 CA와 SAN/serverAuth 인증서를 생성했다. 자식 클라이언트에만 `NODE_EXTRA_CA_CERTS`를 설정했으며 시스템 인증서 저장소를 변경하거나 TLS 검증을 끄지 않았다. TLS 서버까지 HTTP가 도달한 것은 정상 GET/POST 두 건뿐이다. 실제 OIDC/SAML 브라우저 로그인 왕복을 대신하는 시험은 아니다.

production HTTP 시험의 소유자 인증 상태·회사는 명시적 DB fixture다. 공급자 동작은 실제 앱 HTTP로 수행했다. Ego 로그인 이후 기준을 동결했으며 재시작 뒤 다시 기준을 만들지 않았다. 공급자 2, state 0, 감사 8, 세션 2; SHA256 `3965f075132d5677169c18f895aa3b746b51888ca6e51d2a3ed26b2b92d6d020`. 세션 토큰과 last-updated 필드는 비교 대상에서 제외한다. 비밀번호·쿠키·개인키는 `.local`에만 보관한다.

## 실패 기록과 검증 한계

- 전송 시험 첫 실행의 1개 실패는 `test.each`에 빈 배열을 직접 넣어 인수가 undefined가 된 시험 데이터 형식 문제였다. 각 DNS 응답을 객체로 감싼 뒤 최종 회귀에서 통과했다. [첫 실행](transport-first.json)을 보존했다.
- 타입 검사에서 Node 타입의 `autoSelectFamily` 선언, 선택적 Set-Cookie, 시험 header union을 수정했다. 최종 검사는 앱과 변경 시험·QA 스크립트를 포함하는 `tsconfig.rea-sso-outbound-tests.json`을 사용했다. 앱 전용 tsconfig 통과를 스크립트 전체 통과로 확대하지 않는다.
- [이전 E1 기준](previous-browser-binding-verify.json)과 [이전 브라우저 기준](previous-browser-followup-verify.json)도 읽기 전용으로 재검증했고 기존 해시가 유지됐다.
- 현재 화면의 긴 로그인 URL 줄바꿈과 표 내부 가로 스크롤은 관측됐으며 전체 공급자 화면의 폭/키보드/페이지 수용은 E4/E5에서 계속한다. 현재 캡처는 그 전체 수용 결과가 아니다.
- E3 실제 HTTPS OIDC/SAML 브라우저 왕복, E1 cross-site POST 쿠키, E4 공급자 화면의 회사 문맥/입력 보호, E5 전체 인증 경로와 나머지 메뉴가 남아 있다. 외부 Google/Microsoft/기관 인증은 이번 시험으로 검증되지 않았다.

## 재현 진입점

`tests/server/sso-transport.test.ts`, `tests/server/sso.test.ts`의 E2 사례와 `scripts/qa-sso-transport-tls.ts`를 사용한다. 실제 HTTP fixture는 `scripts/qa-rea-sso-outbound.ts`로 만들었다. 동결된 fixture에는 `verify`/`restart`만 허용하며 `http`나 `freeze`를 반복하지 않는다. 시험의 삭제성 DB 초기화는 `.env.test.local`의 격리 DB에서만 수행한다.
