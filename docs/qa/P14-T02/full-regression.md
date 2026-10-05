# P14-T02 전체 회귀 — 진행 중 (2026-10-05)

`node --env-file=.env.test.local vitest run` 전수 실행 결과를 기록한다.

## 실행 요약

| 항목 | 결과 |
|---|---|
| Test Files | 96 (95 passed · 1 failed → 수정 후 1 passed) |
| Tests | 1311 (1310 passed · 1 failed → 수정) |
| Duration | ~1052s |
| tsc --noEmit | 0 errors |
| eslint | 0 errors · 23 warnings(기존 img 경고 중심) |

## 발견·수정한 회귀

`tests/server/platform.test.ts > readiness follows applied migrations and error logs omit messages` — `route()`가 500 응답 시 `error.stack` 전체를 로깅해 에러 메시지(`person@example.com token-secret`)가 로그에 유출. `src/server/http.ts`에서 스택 첫 줄(Error: <message>)을 제외하고 프레임만 기록하도록 수정. 파일 재실행 2/2 통과 (fcc778d).

## 남은 범위

- 181 경로별 backend/UI/test 매핑 전수 대조표는 P14-T05 매핑 보고서에서 추적
- 빌드(`ALLOW_LOCAL_MAIL=1 next build`) 통과 — Next.js 16.3.8 Turbopack, 컴파일 15.9s·타입 30.6s·전 경로 수집 성공
  - 주의: `--env-file` 인자는 워커의 NODE_OPTIONS로 전파돼 거부된다(`ERR_WORKER_INVALID_EXEC_ARGV`). 빌드는 `.env.local` 자체 로딩에 의존한다
  - `MAIL_TRANSPORT=local` 운영 가드가 빌드 타임에도 적용됨을 확인했다 — `ALLOW_LOCAL_MAIL=1`은 로컬 미리보기 전용 해제값
- 실패·skip 숨김 0 조건: 본 실행의 실패 1건은 수정 후 통과로 기록

## verify:* 게이트 (2026-10-05)

| 명령 | 결과 |
|---|---|
| `verify:plan` | passed — 181 경로·34 메뉴·72 Task·의존 사이클 0 |
| `verify:p01-db` | passed — 마이그레이션 85 적용, cross-company FK 23503·중복 이메일 23505 제약, 시드 회사 2·사용자 10 |
| `verify:p01-api` | passed — health 200·unauthenticated 401·notFound 404·badRequest 400·validation 422·forbidden 403·created 201·replay 201·idempotencyMismatch 409·versionConflict 409·deleted 204·rateLimited 429 |
