# P14-T02 전체 API·DB·브라우저 회귀 — 미완료

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

개별 회귀·계약/계획 검사가 존재. 이번 소스 조사만으로 테스트 실행·브라우저·외부 연동 통과를 주장하지 않는다.

- [src/server/context.ts](../../../src/server/context.ts) — activeMembershipWhere, requireActor, requireContext, requireService

## 남은 구현·수용

현재 전체 회귀·181행 backend/UI/test 수용.

원래 범위: TASKS/매핑의 모든 체크와 계약·권한·CRUD·경합·재시작·실제 파일·동적경로 E2E를 실행한다.

수용 조건: 181행 각각 backend/UI/test 증거; 실패·skip 숨김0; build/type/lint오류0; 테스트용 메모리DB로 대체금지

선행: P14-T01, P09-T06, P10-T05, P11-T05. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.

## 최신 회귀 실측 (2026-10-06, signature 커밋 `04138bf` 이후)

| 항목 | 결과 |
|------|------|
| Vitest 전체 | `vitest run` — **96/96 파일, 1314/1314 테스트 통과** (Duration 962s, `/tmp/full-suite-1006.log`) |
| 타입 | `npx tsc --noEmit` — 오류 0 |
| 린트 | 변경 파일 eslint — 위반 0 |
| 빌드 | `next build` — 통과(2026-10-05 실측 유지) |
| 대상 DB | `catchsecu_test` 실 PostgreSQL(인메모리 대체 없음) |
| 실패·skip 숨김 | 0 — 실패 0, skip 0 |

주의: 회귀 도중 별도 vitest 프로세스가 같은 테스트 DB를 동시에 TRUNCATE하면 경합으로 일시 실패한다 — 재현됨(destruction 42건 오탐 → 단독 재실행 48/48 통과). 전수 실행은 배타적으로 돌려야 한다.

남는 게이트(미완료 유지): 181행 경로별 backend/UI/test 증거 매핑 전수, 선행 Task(P09-T06·P10-T05·P11-T05) 완료, 외부 sandbox 검증.

## 2026-10-16 재측정

조직 인증·가상 PG·신규 계약 36 operation 추가 후 전체 회귀 재실행: `npx vitest run` = **105 파일 1,607 테스트 전부 통과** (tsc·eslint·production build는 각 라운드 커밋에서 통과). 선행 게이트 미충족은 동일.
