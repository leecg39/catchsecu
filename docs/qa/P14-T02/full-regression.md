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
- 빌드(`next build`) 전수 통과 증거는 아직 미기록
- 실패·skip 숨김 0 조건: 본 실행의 실패 1건은 수정 후 통과로 기록
