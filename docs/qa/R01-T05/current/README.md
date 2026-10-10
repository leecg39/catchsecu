# R01-T05 자동 검증·관측·통합환경

2026-10-11 완료. 기준 소스는 `b66199f` 이후 R01-T05 작업 트리이며 Node 24.18.0, 실제 로컬 PostgreSQL의 `catchsecu_dev`·`catchsecu_test`, ClamAV 1.5.4, production build에서 검증했다. 운영·원본 DB와 공식 외부 발송·결제는 사용하지 않았다.

## 현재 결과

- dev/test DB 모두 migration 소스 148개와 적용 148개의 checksum이 일치하며 미적용·실패 migration이 없다. 사전 점검은 localhost와 `catchsecu_dev|test|shadow` 이름만 허용하고 준비 실패 시 종료 코드 1을 반환한다.
- production 서버가 구조화된 `ready` 로그를 낸 뒤 `/api/v1/health`와 `/api/v1/ready`는 200, 보호된 `/api/v1/forms`는 request ID가 본문과 헤더에 일치하는 401, `/login`은 200으로 응답했다.
- main worker와 export worker를 `catchsecu_test`에서 `--once`로 실행했다. 두 프로세스 모두 시작 로그를 남기고 종료 코드 0으로 끝났다.
- API 오류 로그는 요청 ID와 안전한 오류 코드만 기록하며 주입한 이메일·token 문자열을 기록하지 않는다. 필수 환경 누락 오류도 환경 변수 이름만 노출한다.
- GitHub CI는 의존성 설치, Prisma 생성·migration, typecheck, lint, DB 시험을 순서대로 실행하며 실패 무시 설정이 없다. ClamAV가 없는 runner에서 검사기 의존 3개 파일은 일반 DB 시험에서 제외하고 `blocked`, `countsAsPass: false`로만 보고한다.
- 운영 모드의 로컬 mail·Kakao·payment 어댑터는 각 전용 플래그 값이 정확히 `1`일 때만 허용된다. 한 공급자의 플래그가 다른 공급자 차단을 해제하지 않는다.
- 증거 계약은 Task ID 아래에 commit/작업트리 지문, 시각, 환경, 명령, fixture ID, HTTP status/body/request ID, 독립 DB 전후, 브라우저 캡처, 외부 receipt를 기록하고 비밀·token을 마스킹하도록 고정돼 있다. 이 교차 서버 Task 자체의 브라우저 화면과 외부 공급자 수용은 비해당이다.

## 실행 결과

| 검증 | 결과 | 증거 |
|---|---:|---|
| dev/test PostgreSQL·ClamAV·migration 사전 점검 | 양쪽 통과 | `../preflight/catchsecu_dev.json`, `../preflight/catchsecu_test.json` |
| readiness·비밀 마스킹 | 2/2 | `platform.json` |
| 운영 로컬 공급자 차단 | 31/31 | `env-production.json` |
| CI 실패·scanner blocked 집계 계약 | 3/3 | `ci-evidence-gate.json` |
| production HTTP readiness·401 request ID | 4/4 | `runtime-http.json` |
| main/export worker 실제 기동 | 2/2 | `worker-readiness.json` |
| TypeScript·ESLint·production build | 모두 통과 | `quality-gates.json` |

자동 시험 3개 파일의 36개 시험이 통과했다. HTTP 4건과 worker 2개 프로세스, dev/test DB preflight, typecheck·lint·build 결과를 별도 JSON으로 보존했다.

## 재현 명령

```bash
/Users/user01/.local/bin/node24 --env-file=.env.local --import tsx scripts/qa-preflight.ts
/Users/user01/.local/bin/node24 --env-file=.env.test.local --import tsx scripts/qa-preflight.ts
/Users/user01/.local/bin/node24 --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/platform.test.ts tests/server/env-production.test.ts tests/server/r01-ci-evidence-gate.test.ts
ALLOW_LOCAL_MAIL=1 ALLOW_LOCAL_KAKAO=1 ALLOW_LOCAL_PAYMENT=1 /Users/user01/.local/bin/node24 --env-file=.env.test.local --import tsx scripts/worker.ts --once
ALLOW_LOCAL_MAIL=1 ALLOW_LOCAL_KAKAO=1 ALLOW_LOCAL_PAYMENT=1 /Users/user01/.local/bin/node24 --env-file=.env.test.local --import tsx scripts/export-worker.ts --once
/Users/user01/.local/bin/node24 node_modules/typescript/bin/tsc --noEmit
ALLOW_LOCAL_MAIL=1 ALLOW_LOCAL_KAKAO=1 ALLOW_LOCAL_PAYMENT=1 /Users/user01/.local/bin/node24 node_modules/next/dist/bin/next build
```

worker 정리는 `catchsecu_test` 안의 만료 fixture에만 적용했다. 실행 전 DB 호스트·이름 가드를 통과한 환경만 사용했으며 운영·원본 DB, 실제 수신자, 공식 OAuth, PG 결제를 호출하지 않았다. `externalAcceptance: false`는 출시나 외부 공급자 성공을 뜻하지 않는다는 점을 각 preflight 보고서에 유지했다.
