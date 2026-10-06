# P10-T04 — 유료 구독 만료·예약 해지 종결

2026-10-06. 외부 계정·승인이 필요한 시험은 대기하고 내부 구현과 PostgreSQL 검증을 진행했다. Task 전체는 진행 중이다.

## 발견한 문제와 수정

기존 워커는 무료 체험만 만료시켜 유료 구독의 저장 상태가 계속 active로 남았다. 조회 화면과 이용 권한은 날짜를 보고 만료로 판단해 DB 상태·이력과 달랐다. 또한 DB 트리거의 비교 연산자가 반대로 작성돼 해지일을 보존한 정상 만료를 거부하고, 만료하면서 해지일을 바꾸는 요청은 허용했다. 새 검사 5개 중 4개가 실패하며 재현했다.

- `expireSubscriptions`가 무료 체험과 유료 구독을 함께 처리한다. 만료 여부와 트리거 모두 PostgreSQL의 UTC 트랜잭션 시각을 사용한다.
- 기한 순으로 최대 100개 행을 잠그고 `SKIP LOCKED`로 다른 워커와 나눈다. 상태·버전·구독 이력·감사 기록은 한 트랜잭션으로 저장한다.
- 무료 체험은 기존 `trial_expired`, 유료는 `expired` 이력과 `billing.expired` 감사를 남긴다. 해지 예약과 자연 만료의 사유를 구분한다.
- 새 migration `20261014140000_paid_subscription_expiration`이 정상 만료의 해지일 보존을 강제하고 기한 조회용 부분 인덱스를 추가한다. 과거 migration 원문·적용 체크섬은 변경하지 않았다.
- `scripts/worker.ts`의 정기 처리에 연결했다. 화면·API 계약은 기존 기한 표시 동작을 유지한다.

## 검증

| 범위 | 결과 | 증거 |
|---|---|---|
| 수정 전 재현 | 4개 실패·1개 통과 | [baseline.log](baseline.log) |
| PostgreSQL 구독·환불·정산·주문·감사 회귀 | 6파일 40개 통과 | [tests.log](tests.log) |
| 전체 TypeScript | 최종 통과 | [typecheck-final.log](typecheck-final.log) |
| 변경 파일·QA 스크립트 린트 | 최종 오류·경고 0개 | [lint-final.log](lint-final.log), [qa-script-lint.log](qa-script-lint.log) |
| Production 빌드 | 최종 성공 | [build-final.log](build-final.log) |
| 실제 로컬 HTTP | 7개 통과 | [http.json](http.json) |
| 같은 빌드 재시작 후 HTTP | 3개 통과 | [http-restart.json](http-restart.json) |
| 개발 DB 업데이트 | 96개 적용·기존 10개 테이블 해시 보존 | [이전](migration-before.json), [이후](migration-after.json) |
| 새 설치/기존 DB 구조 대조 | 2,826개 항목 일치 | [구조 검증](../../P14-T04/migration-drift/README.md) |
| 소스·프로세스 식별 | 해시 및 재시작 PID | [source-hashes.json](source-hashes.json), [processes.json](processes.json) |

신규 PostgreSQL 검사는 자연 만료·예약 해지·조기 만료 거부·해지일 변경 거부·동시 워커 1회 처리·감사 실패 원자 롤백·철회한 예약 유지·결제 주문 보존을 포함한다. 기존 무료 체험 감사 롤백도 함께 통과했다. 테스트 DB에서만 순차 실행했고 기존 pg query deprecation 경고는 남아 있다.

전체 타입 검사에서 기존 SSO 복구 테스트의 헤더 배열 추론 오류 1개가 발견됐다. 배열에 `Record<string, string>[]`를 명시해 수정하고 해당 39개를 별도 통과했다. 이는 위 PostgreSQL 40개와 별도인 요청/오류 처리 검사다. [처음 타입 오류](typecheck.log), [재검사](sso-type-fix-tests.log). 기존 구독 테스트의 미사용 import도 제거했다.

첫 빌드는 로컬 메일 사용 허용 환경 변수 누락으로 실패했다. 로컬 QA 설정 `ALLOW_LOCAL_MAIL=1`, `ALLOW_LOCAL_KAKAO=1`을 지정한 최종 빌드는 성공했다. 처음 실패 로그 [build.log](build.log)는 보존한다.

## 실제 실행 범위

별도 production 앱 3167을 `catchsecu_test`에 연결했다. 합성 사용자와 두 개의 과거 결제 구독을 DB의 정상 pending→active 전이로 준비했다. 실제 PG 승인 시험은 아니다.

실제 HTTP 로그인·구독 조회·예약 해지 후, 새 Node 프로세스에서 워커 함수를 실행했다. 자연 만료 1개와 예약 해지 1개가 각각 종결됐다. 예약 기한 도래 후 워커 실행 전에도 이용 권한이 차단되는 것을 확인했다. 구독 2개·이력 7개·주문 2개·만료 감사 2개가 저장됐다.

동일 빌드 앱 PID 29246→29592 재시작 후 재로그인·조회가 성공했고 위 자료의 합산 해시가 동일했다. 새 워커 프로세스 재실행 결과는 0개로 중복 이력이 없었다. 로그아웃 후 시험 사용자 세션 0개이며 이번 전용 QA 앱은 종료했다. 사용자 앱 3100과 상주 워커는 재시작하지 않았다. 상주 워커에 새 자동 만료 처리를 반영하려면 이후 배포 시 워커를 재시작해야 한다.

완료 marker `.local/qa-paid-expiration.json`에는 시험 자격증명이 있어 출력하지 않는다. 최초 실행을 반복하지 않는다. HTTP 검증은 `scripts/qa-paid-expiration.ts`와 `--verify-restart`로 분리했다. 테스트 자료는 catchsecu_test에만 남아 있으며 다른 DB로 이전하지 않았다.

## 재현 명령

Node 24를 사용한다. DB 테스트와 위 HTTP 검증은 동일 시험 DB를 사용하므로 병렬 실행하지 않는다.

```sh
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/subscription-expiration.test.ts tests/server/subscriptions.test.ts tests/server/billing-refunds.test.ts tests/server/billing-settlement.test.ts tests/server/payment-orders.test.ts tests/server/system-producer-audit.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

## 남은 범위

실제 PG 환불·대사, 전체 결제 UI 수용, 구독 변경의 현재 권한·경합·재요청 경계는 별도 점검한다. 기존 migration 체크섬 4건의 원문 불명 문제도 해소되지 않았다. 이번 검증을 전체 결제/운영 완료로 확대하지 않는다.
