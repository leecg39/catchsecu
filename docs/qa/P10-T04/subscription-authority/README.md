# P10-T01/T04 — 구독 권한·재요청·변경 기한

2026-10-06. 외부 계정·승인 시험은 대기하고 내부 결제 구독 기능을 보완했다. 공식 상태는 완료 17·진행 42·계획 13을 유지한다.

## 수정한 동작

기존 함수는 요청 초기에 읽은 역할만 확인했다. 따라서 실제 변경 전에 역할·세션·회사 정책이 바뀌어도 작업할 수 있었다. 같은 요청 키를 다시 보내면 권한 재검사 없이 이전 상태가 반환됐고 해지 사유도 요청 해시에 빠져 있었다. 구매 취소의 동시 요청은 낙관 잠금 실패가 일관된 409로 표현되지 않았다. [22개 검사 실패](baseline.log)로 재현했다.

- 상품 목록·구독 목록·이용 한도·자산 조회, 구매 요청·대기 취소·해지 예약·예약 철회를 트랜잭션 안의 현재 권한 검사로 연결했다. 기존 `lockServiceActor`를 재사용해 회사·사용자·소속·세션·현재 선택 회사·IP·MFA·비밀번호 정책을 검사한다.
- 구독 변경과 성공 요청 재전송 모두 현재 결제 권한을 확인한다. 권한·세션 기한은 응답 캐시 저장 후에도 확인한다. 작업 도중 만료되면 업무 자료·감사·요청 키 전체가 롤백된다.
- 성공 요청 재전송은 같은 구독의 최신 상태·version을 읽는다. 취소 후 구매 요청 재전송, 철회 후 예약 재전송, 새 예약 후 예전 철회 재전송이 상태를 다시 바꾸지 않는다.
- 해지 사유도 멱등 해시에 포함한다. 같은 키에 다른 사유는 `409 IDEMPOTENCY_MISMATCH`다.
- 구매 취소에도 구독 행 잠금을 추가했다. 같은 version의 동시 변경은 하나만 성공하고 다른 요청은 `409 VERSION_CONFLICT`로 끝난다.
- 상품 판매 기한, 기존 해지 기한, 새 예약 시각, 구독 종료 기한을 커밋 전 확인한다. 조회 중 만료된 이용권도 active로 반환하지 않는다.
- 구매 요청의 실제 `202` 응답과 네 가지 변경 API의 필수 `Idempotency-Key`를 OpenAPI에 반영했다. 이전 문서의 `201`은 잘못된 선언이었다.

새 DB migration과 UI 코드는 없다. 이전 라운드의 migration96 상태를 사용했다. 기존 화면은 성공 후 목록을 다시 조회한다. 전체 화면 검증과 충돌 후 입력/재조회 UX는 별도 잔여다.

이전 코드에서 사유를 포함한 요청을 저장한 키는 새 해시와 달라 409가 될 수 있다. 해당 경우 최신 구독 상태를 먼저 확인한다. 과거 요청을 자동 재실행하거나 과거 해시를 덮어쓰지 않는다.

## 검증 결과

| 범위 | 결과 | 증거 |
|---|---|---|
| 수정 전 권한·재요청 재현 | 22개 실패 | [baseline.log](baseline.log) |
| 1차 회귀 | 5파일 46개 통과 | [tests.log](tests.log) |
| 기한·재전송 추가 후 최종 PostgreSQL | 7파일 69개 통과 | [tests-final.log](tests-final.log) |
| 전체 TypeScript | 최종 통과 | [typecheck-final.log](typecheck-final.log) |
| 변경 소스·QA 린트 | 오류·경고 0개 | [lint.log](lint.log), [qa-lint-final.log](qa-lint-final.log) |
| Production 빌드 | 최종 성공 | [build-final.log](build-final.log) |
| API 계약 정합성 | 298경로·426작업·42정책 통과 | [contracts-final.log](contracts-final.log) |
| 실제 HTTP | 18개 통과 | [http.json](http.json) |
| 같은 빌드 재시작 후 HTTP | 4개 통과·해시 보존 | [http-restart.json](http-restart.json) |
| 실제 응답과 선언 대조 | 구독 변경 성공 응답/필수 헤더 확인 | [http-contract.json](http-contract.json) |
| 소스·프로세스 식별 | 해시·PID | [source-hashes.json](source-hashes.json), [processes.json](processes.json) |

최종 69개에는 신규 권한 검사 29개와 기존 만료·구독·환불·결제 주문·정산·시스템 감사 검사가 포함된다. 첫 46개와 최종 69개는 겹치므로 합산하지 않는다. PostgreSQL `catchsecu_test`에서 순차 실행했다. 기존 pg query deprecation 경고는 남아 있다. 계약 검사는 선언 정합성 검사이며 426개 API 전체를 실행했다는 의미는 아니다.

첫 타입/빌드는 QA 스크립트의 요청 키 타입이 UUID 문자열 형식으로 너무 좁게 추론돼 실패했다. 매개변수를 `string`으로 명시한 후 전체 타입과 빌드가 통과했다. [처음 타입](typecheck.log), [처음 빌드](build.log). 계약 생성 첫 실행의 환경 변수 누락과 이전 매핑 불일치는 환경 파일 지정 및 매핑 재생성 후 해소했다. [처음 계약 실행](contracts.log). 실패 기록을 삭제하지 않았다.

## 실제 HTTP·재시작 범위

별도 production 앱3168과 시험 DB를 사용했다. 새 사용자·회사·결제 담당자 소속 및 합성 paid 구독을 준비했다. 회사/권한/paid 자료의 준비는 DB fixture이며 실제 PG 승인 시험이 아니다.

- 상품 조회 → 구매202 → 취소 → 구매 재전송에서 cancelled/version2 확인.
- 해지 예약 → 사유가 다른 재요청409 → 철회 → 예전 예약 재전송에서 cancelAt=null/version4 확인.
- 새 예약 → 예전 철회 재전송에서 새 예약 유지 → 같은 version 동시 철회200/409 확인.
- 결제 담당자 권한 회수 후 조회·성공 요청 재전송403 확인. 시험 소속만 원래 역할로 복원.
- 구독2개·이력6개·업무 감사6개의 해시를 저장하고 앱 PID36026→36381로 재시작. 재로그인·재전송·조회 후 같은 해시 확인.

최종 로그아웃 후 시험 사용자 세션0이다. 전용 QA3168은 종료했고 사용자 앱3100·상주 워커·기존 회사 자료는 변경하지 않았다. 실행 파일은 `scripts/qa-subscription-authority.ts`, 완료 marker는 `.local/qa-subscription-authority.json`이다. marker에는 시험 자격증명이 있으므로 원문을 출력하지 않는다. 최초 실행을 반복하지 않는다.

## 재현

Node24를 사용하며 같은 DB를 쓰는 다른 테스트/QA와 병렬 실행하지 않는다.

```sh
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/subscription-authority.test.ts tests/server/subscription-expiration.test.ts tests/server/subscriptions.test.ts tests/server/billing-refunds.test.ts tests/server/payment-orders.test.ts tests/server/billing-settlement.test.ts tests/server/system-producer-audit.test.ts
node node_modules/typescript/bin/tsc --noEmit
node --env-file=.env.local --import tsx scripts/generate-openapi.ts
python3 scripts/verify-contracts.py
```

## 남은 작업

결제수단·주문·환불의 현재 권한/동시 변경을 별도로 점검하고, 결제 화면의 충돌 복구와 전체 브라우저 수용을 확인한다. 실제 PG 승인·환불·대사는 사용자 요청에 따라 외부 대기로 남긴다. 기존 migration 체크섬4건도 미해결이다. P10 전체를 완료 처리하지 않는다.
