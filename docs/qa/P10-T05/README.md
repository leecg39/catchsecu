# P10-T05 결제 UI와 전체 게이트 — 미완료

> 2026-10-04: 실제 부분 구현을 근거로 planned에서 in_progress로 정정했다. 전체 완료는 아니다. [근거](../status-revalidation/README.md).
> 2026-10-06 갱신: 결제수단·주문·환불·청구서·결과 페이지를 서버 상태에 연결했다. 실제 PG 연동(주문 승인 콜백을 발생시키는 provider)이 없으므로 완료가 아니다.

## 이번에 연결한 경로 → 서버 상태

| UI 경로 | 연결 |
|---|---|
| `/pay/membership/detail` | `GET /plans`(버전·가격·주문 가능 여부), `GET /subscriptions`, `POST /subscriptions` |
| `/pay/license-service` | `GET /subscriptions`(trialing/active/pending·cancelAt 표시), `POST /subscriptions/:id/cancel·schedule-cancel·undo-cancel`(active 해지 사유 포함), `GET /ledger`(available/held), `GET /billing/methods`(목록·등록·대표지정·해지), `GET /billing/orders`(주문 목록·planName·refundedTotal), `POST /billing/orders`(pending 구독 → 주문 생성), `POST /billing/orders/:id/refunds`, `GET /billing/orders/:id/refunds`, `GET /billing/orders/:id/invoice`(청구서 PDF 링크) |
| `/pay/history` · `/pay/usage/history` | `GET /billing-history` — 무료 체험 + 결제 주문 + 환불 행을 발생시각 역순·페이지네이션으로 반환. 월 필터는 KST 달력 기준 |
| `/pay/service-asset` | `GET /assets` — entitlement·서비스별 사용량 |
| `/pay/result/success` | `GET /billing/orders/:id?result=…` — URL의 result 값은 `returnResultIgnored`로만 에코되고 상태 판정에 사용되지 않음. 테넌트 불일치는 404 |
| `/pay/result/fail` | 정적 실패 안내(서버 상태 변경 없음) |
| `/pay/method` · `/pay/billing-policy` | `/pay/license-service` 리다이렉트 |

## 검증(로컬)

- `tests/server/payment-orders.test.ts` 3/3 — 위조 `?result=success`가 주문을 paid로 만들지 않음, return URL 거부(409), 서명 없는 이벤트 401, 승인→구독 active+충전 같은 트랜잭션, 이벤트 재생 멱등, 늦은 failed 409, 연간 주기 기간 계산, **주문 목록 회사 격리**(타사 주문 미노출, 타사 `purchaseId` 조회 404), **결제 이력에 payment/refund 행 포함·타사 행 없음**, 미인증 401
- `tsc --noEmit`·`eslint` 0 오류

## 미완료로 남은 것

- 실제 PG 체크아웃/승인(공급자 계정 없음) — pending 주문의 "주문 생성"은 주문 레코드만 만들고 승인은 서명된 콜백에만 의존
- 주문→승인→한도증가→사용→환불→대사의 **실제 PG E2E**
- 원본 Catchsecu 화면과의 시각 대조
- 17개 경로의 외부 provider 구간(결제수단 토큰 발급은 PG 시트 연동 필요 — 현재 수동 토큰 입력)

## 이전 조사(2026-10-04)

일부 라이선스·체험 이력·잔액 화면만 확인. 전수 통과 주장을 인정하지 않음 — [57개 재분류](../status-revalidation/README.md).
