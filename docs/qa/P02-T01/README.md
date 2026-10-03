# P02-T01 가입·로그인·로그아웃·세션

2026-10-03. `tests/server/foundation.test.ts` 43개를 테스트 데이터베이스에서 다시 실행해 통과했다.

확인한 동작:

- 틀린 비밀번호와 정지 계정은 세션을 만들지 못한다.
- 회사의 비활성 시간이 지난 세션은 갱신 전에 거부된다.
- 로그아웃은 데이터베이스 세션을 지우고 같은 쿠키를 다시 거부한다.
- 가입 메일의 인증 링크를 거친 뒤에만 로그인된다.
- 변경 요청의 Origin이 다르면 403이다.
- 로그인 시도는 속도 제한에 걸린다.

인증은 Better Auth의 데이터베이스 세션과 HttpOnly 쿠키를 사용한다. 암호 알고리즘을 직접 구현하지 않았다.

실행: `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/foundation.test.ts`
