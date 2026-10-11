# R21-T01 결제·구독·복식원장 모델 대조

검증일: 2026-10-11 KST

## 결론

R21의 가격 버전, 회사 구독, 결제수단, 주문·공급자 이벤트·환불, 월마감, 크레딧 계정과 복식원장 12개 모델을 기존 PostgreSQL 구조와 대조했다. 기존 서버 경로는 주문 생성 전에 회사 범위를 확인했지만, `PaymentOrder.subscriptionId`의 DB 외래키는 구독 ID 하나만 참조해 직접 ORM·SQL 쓰기에서 다른 회사 구독을 연결할 수 있었다.

실패 시험으로 위반 저장을 재현한 뒤 `PaymentOrder(tenantId, subscriptionId)`가 `BillingSubscription(tenantId, id)`를 참조하도록 Prisma 관계와 새 마이그레이션을 추가했다. 개발·시험 DB에는 기존 위반 행이 0건이어서 데이터를 지우지 않고 마이그레이션했으며, 같은 회사의 정상 주문은 계속 저장된다.

## 구현 및 안전 조건

- `20261025031000_payment_order_subscription_scope`는 기존 교차 회사 주문이 하나라도 있으면 `PAYMENT_ORDER_SUBSCRIPTION_TENANT_MISMATCH`로 중단한다.
- 위반 행이 없을 때만 기존 단일 열 FK를 회사 범위 복합 FK로 교체한다.
- 임시 격리 스키마에서 위반 데이터가 있는 이전 구조의 마이그레이션 중단, 정리 후 성공, 이후 교차 회사 삽입 `23503` 거부, 같은 회사 삽입 허용을 모두 확인했다.
- 개발·시험 DB의 정의 해시는 `2d581ec294fa8191375550f3726a9dadbf755b7b49ff0a930b17cdace7ee1e49`로 같다.
- 두 DB 모두 12개 모델, 107개 열, 검증된 제약 70개, 인덱스 37개, 업무 트리거 10개, 적용 마이그레이션 150개이며 교차 회사 주문은 0건이다.

## 자동 검증

- 결제·구독·원장 회귀: 14개 파일, 164개 시험 통과
- 범위: 상품 가격 버전, 구독 상태·가격 스냅샷, 결제수단 토큰·대표수단, 주문·이벤트 멱등성, success URL 위조 차단, 동시 결제, 부분·전액 환불, 잔액·복식원장, 월마감, 회사·역할 격리
- 실제 외부 PG 승인은 이 모델 단계의 완료 근거로 사용하지 않았다. 공급자 수용은 R21-T04에서 로컬 어댑터와 외부 증거를 분리한다.

## 증거

- [개발 DB 모델 감사](current/catchsecu_dev.json)
- [시험 DB 모델 감사](current/catchsecu_test.json)
- [마이그레이션 안전 시험](current/migration-guard.json)
- [수정 전 실패 재현](current/payment-order-scope-baseline.log)
- [수정 후 범위 시험](current/payment-order-scope-fixed.log)
- [결제 회귀 164개](current/billing-regression.log)

재현 명령:

```bash
node --env-file=.env.local --import tsx scripts/qa-r21-model.ts
node --env-file=.env.test.local --import tsx scripts/qa-r21-model.ts
node --env-file=.env.local --import tsx scripts/qa-r21-migration.ts
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run \
  tests/server/admin-plans.test.ts tests/server/billing-read-authority.test.ts \
  tests/server/billing-refunds.test.ts tests/server/billing-settlement.test.ts \
  tests/server/billing-virtual.test.ts tests/server/invoice-detail-ui.test.ts \
  tests/server/payment-authority.test.ts tests/server/payment-concurrency.test.ts \
  tests/server/payment-event-integrity.test.ts tests/server/payment-methods.test.ts \
  tests/server/payment-orders.test.ts tests/server/subscription-authority.test.ts \
  tests/server/subscription-expiration.test.ts tests/server/subscriptions.test.ts --maxWorkers=1
```
