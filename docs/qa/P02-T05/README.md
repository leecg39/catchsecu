# P02-T05 인증·회사 격리 게이트

2026-10-03. 실제 DB 세션·로컬 production 앱으로 확인했다.

- `tests/server/auth-session-gate.test.ts` 7건: HttpOnly/SameSite, 위조·만료 쿠키, 세션 고정 방지, 두 계정 동시 격리, 같은 사용자의 별도 세션 선택, CSRF 출처 차단, GET 로그아웃의 비변경, POST 로그아웃 후 재사용 차단과 다른 기기의 세션 유지.
- 인증 라이브러리는 테스트 환경에서 Origin 검사를 생략하는 기본값이 있었다. `disableOriginCheck: false`, `disableCSRFCheck: false`를 명시해 테스트에서도 실제 보호를 검증했다. 이를 운영 환경의 CSRF 취약점으로 해석하지 않는다.
- `unauthenticated.json`: P03-T03 추가 API까지 보호 API를 포함한 190회 호출. health·readiness 2개만 200이며, 나머지 188개는 미인증 차단.
- `dual-browser.json`: Ego Lite의 합성 회사 A와 별도 Codex in-app browser의 회사 B를 동시에 로그인했다. A가 B 서비스를 API로 읽으면 404. B가 A 서비스 수정 화면을 열면 “서비스를 찾을 수 없습니다.”로 차단됐다. B 로그인 후에도 Ego의 A 회사 선택은 유지됐다.
- `browser-company-a.png`, `browser-company-b.png`, `browser-b-denied-a.png`: 별도 쿠키 저장소를 가진 두 브라우저의 화면 증거. Ego 탭끼리는 쿠키를 공유하므로 두 브라우저 격리 검증에 사용하지 않았다.
- 기존 `foundation.test.ts` 43건의 세션·권한·회사 경계와 전체 회귀 439건 통과. 로그 마스킹은 P01-T05의 실제 검증을 유지했다.

실행: `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/auth-navigation.test.ts tests/server/auth-session-gate.test.ts tests/server/foundation.test.ts`; `node --env-file=.env.test.local --import tsx scripts/verify-protected-api.ts`.

전체 시험 로그·타입·린트 결과는 `../P02-T04/`, 최종 공통 production 빌드는 `../P03-T01/build.txt`에 있다. 외부 SMTP·IdP·GPKI 공급자 검증은 별도 계획 항목에 남아 있다.
