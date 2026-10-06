# P10-T04 해지·환불·청구서·마감 — 로컬 구현·검증

2026-10-06 구독 권한 후속: 상품/구독/한도/자산 조회와 구매·취소·예약·철회에 현재 권한·세션·정책 및 최종 기한 검사를 연결했다. 재요청은 최신 구독 상태를 반환하고 해지 사유도 요청 해시에 포함한다. 22개 실패 재현 후 최종 PostgreSQL69개·HTTP22개(재시작4 포함)·전체 타입/린트/빌드·계약 검사를 통과했다. DB migration 추가 없이96개 상태를 유지한다. [검증](subscription-authority/README.md).

2026-10-06 내부 후속: 유료 구독 만료 워커 누락과 DB 해지일 비교 오류를 4개 실패로 재현해 수정했다. PostgreSQL 40개·실제 HTTP 10개(재시작 3개 포함), 전체 타입·최종 린트·빌드가 통과했다. 별도 SSO 테스트 타입 보완 후 39개도 통과했다. Migration 96개 새 설치/개발 DB 구조 2,826개가 일치하고 기존 결제·구독 10개 테이블과 과거 적용 기록을 보존했다. 기존 체크섬 4건은 원문 미확보로 유지한다. P14-T04를 부분 검증 근거에 따라 진행 중으로 갱신해 현재 완료 17·진행 42·계획 13이다. [최신 유료 만료 검증](expiration/README.md).

> 2026-10-06. 환불 누계·서명 이벤트 정산·유료 해지 예약·청구서 PDF·월마감을 로컬에서 구현하고 적대적 검증했다. 실제 PG 환불 승인과 원본 화면 대조는 외부 자격증명이 필요해 미완료로 둔다.

## 구현 범위

### 환불 (`PaymentRefund`, 마이그레이션 `20261006120000_refund_closing`)

- `POST /api/v1/billing/orders/:id/refunds`는 `billing.write`와 Idempotency-Key를 요구한다. paid 주문에만 요청되고 주문 행 잠금 아래 누계를 확인해 `requested+refunded` 합계가 결제액을 넘으면 409 `REFUND_EXCEEDS_PAID`.
- DB 트리거가 환불을 고정한다: `requested`로만 시작, 종료 상태 변경 불가, `refunded` 전이는 `providerRef` 필수, 환불 누계 초과를 INSERT/승인 양쪽에서 거부(`REFUND_EXCEEDS_PAID`), 미결제 주문 환불 거부(`PAYMENT_REFUND_ORDER_INVALID`).
- 서명된 공급자 이벤트 `outcome: "refunded" | "refund_rejected"`가 환불을 정산한다. 이벤트 ID로 멱등 중복을 처리하고, 정산 성공 시 `kind='refund'` 원장 거래(원천키 `payment_refund:{refundId}`)가 가용 잔액을 외부 계정으로 이동한다. 잔액 부족 환불은 `REFUND_EXCEEDS_BALANCE`로 DB가 거부한다.
- 주문 상태는 환불해도 `paid`를 유지한다(부분 환불 지원). `refundedTotal`/`refundable`을 목록 응답에 포함한다.

### 유료 해지 예약

- `POST /subscriptions/:id/schedule-cancel`이 체험(trialing)과 유료(active) 모두를 받는다. `effectiveAt`은 미래·기간 내 시각이어야 하고 `reason`을 이벤트·감사에 남긴다. 유료는 `cancel_scheduled`/`cancel_revoked` 이벤트로 구분한다.
- DB 트리거가 `active→active`의 `cancelAt` 전용 변경만 허용하고, `active→expired`는 `LEAST(cancelAt, periodEnd)` 도래 후에만 허용한다.
- `undo-cancel`은 두 구독 유형의 해지 예약을 철회한다. 읽기 경로(`entitlement`/`subDto`)는 `cancelAt` 도래 시 expired로 표시한다.

### 청구서 PDF

- `GET /api/v1/billing/orders/:id/invoice` — paid 주문만 한글 임베디드 폰트 PDF를 발행한다(공급가액/부가세/환불 누계/실결제 잔액). `x-content-sha256` 헤더로 해시를 반환한다. 미결제 409, 익명 401, 타 회사 404.

### 월마감 (`BillingMonthClose`)

- `POST /api/v1/billing/closing` `{month, currency}` — 지난달만 마감(앱 422 + DB 트리거 `MONTH_CLOSE_NOT_PAST`). 스냅샷 합계(funded/refunded/reservedNet/captured/released)를 JSONB로 고정하고 멱등·유니크하다. 마감 행은 변경·삭제 불가.
- `GET /api/v1/billing/closing?month=&currency=` — 미마감이면 실시간 합계, 마감됐으면 고정 스냅샷 + `postCloseAdjustments`(마감 월에 귀속하지만 마감 이후 기록된 거래 — 원장 불변이라 기록 시각은 감사 이벤트로 판별).

## 적대적 검증 (tests/server/billing-refunds.test.ts — 5/5 통과)

- 환불 누계 초과(요청 13000/추가 8000 → 409), 같은 키 재시도는 같은 환불 행, 다른 본문 재사용은 409, 미로그인 401, 미존재 주문 404, 키 누락 400.
- 환불 이벤트: `refundId` 누락 422, 모르는 환불 404, 카드 필드 422, 무서명 401, `refunded` 정산(잔액 12000→8000, 환불 원장 1건) 후 재적용 duplicate·이중 원장 0, 이미 정산된 환불에 다른 이벤트 409, `refund_rejected`는 원장을 오염시키지 않는다. 종료된 환불의 역전(UPDATE)과 미결제 주문 환불 INSERT는 DB가 거부한다.
- 청구서: 실제 PDF 바이트(%PDF 헤더), 익명 401, 타 회사·미존재 404.
- 마감: 당월 422, 지난달 201 스냅샷, 재마감 200 멱등, 마감 후 해당 월 귀속 거래가 `postCloseAdjustments=1`로 식별됨.
- 유료 해지: 과거 시각 422, 예약 후 `cancelAt`+`cancel_scheduled`(사유 보존), 철회로 null 복귀, 버전 충돌 409.

## 회귀

- subscriptions/payment-orders/payment-methods/ledger/billing-settlement 23건 통과.

## 남은 조건

- 실제 PG sandbox 환불 승인/거절과 부분환불 한도를 외부에서 확인해야 한다(현재는 서명된 로컬 이벤트).
- PG 정산 리포트와 DB 원장의 자동 대사(PG와 DB 대사), 청구서의 원본 화면 대조는 미완료다.
