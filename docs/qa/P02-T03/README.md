# P02-T03 테넌트·서비스·역할 권한

2026-10-03. `tests/server/tenant-boundary.test.ts` 2개를 테스트 데이터베이스에서 통과했다.

- 회사 B 소유자는 회사 A 서비스를 조회하면 404이고, 서비스 목록은 0건이며 회사 A 식별자가 없다.
- 서비스 권한이 없는 조회자는 403이고, 권한을 부여한 뒤에만 200이다.
- 조회자의 서비스 생성은 403이다.
- 관리자의 소유권 이전은 403이고, 다른 회사의 이전 요청은 404이다.
- 회사 B 구성원을 회사 A 서비스 권한에 연결하는 데이터베이스 쓰기는 거부된다.
- 보호 라우트를 회사 B 세션으로 호출했을 때 회사 A의 회사·서비스·폼·구성원 식별자가 성공 응답에 나오지 않았다.

실행: `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/tenant-boundary.test.ts`
