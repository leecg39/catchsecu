# P01-T05 CI·비밀설정·로그

2026-10-03. 환경 변수 누락, 로그 마스킹, readiness, CI 실패 차단을 확인했다.

- 필수 환경 변수가 없으면 프로세스 시작이 실패하고, 오류에는 필드 이름만 있다. 심어 둔 비밀 값은 출력되지 않았다.
- 처리되지 않은 500 오류 로그에는 요청 ID와 `INTERNAL_ERROR`만 있고, 예외 메시지에 넣은 이메일과 token 문자열은 없다.
- `/api/v1/ready`는 적용된 migration이 있을 때 200 `{ status: "ready" }`를 반환한다.
- `.github/workflows/ci.yml`은 의존성 설치, migration, 타입 검사, lint, 데이터베이스 테스트를 실행한다. 이 단계에는 `continue-on-error`가 없다.
- ClamAV가 필요한 `files`·`notices`·`guides` 테스트는 GitHub runner에 검사 소켓이 없어 blocked이며 통과로 집계하지 않는다.

로컬 확인: `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/platform.test.ts` — 2 passed.
