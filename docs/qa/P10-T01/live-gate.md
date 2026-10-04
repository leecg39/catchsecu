# P10-T01 상품·구독 라이브 게이트 (2026-10-04)

dev 앱 :3100 + catchsecu_dev 실측. 기존 [부분 구현 증거](../subscriptions/README.md)를 보강한다.

| 수용 조건 | 실측 |
|---|---|
| 제한/무제한 seed | DB: 처리방침 관리·개인정보 수명 관리 월 50,000원(orderable)·연간 `price:null`(orderable:false), 무료체험 0원·한도 10/10/1000·**forms `null` = 무제한**(`assertQuota`에서 null 한도 통과). p03 테넌트가 trial로 12개 폼 보유 — 무제한 실동작 확인 |
| 연간 미확정 가격 주문 | `/api/v1/plans`는 orderable 버전 3건만 노출; DB에서 연간 버전 ID를 꺼내 직접 POST → **409 PLAN_UNAVAILABLE**, 구독 미생성 |
| 서버가격 변조 차단 | POST body에 `priceKrw:1` 주입 → **422 VALIDATION_ERROR**(계약이 가격 필드를 받지 않음 — 서버가 버전 가격으로 고정) |
| 멱등키 없는 주문 | `Idempotency-Key` 생략 → **400 IDEMPOTENCY_REQUIRED** |
| 한도 집행 | assertQuota: 회사별 `pg_advisory_xact_lock` → trialing 활성 구독 → count+pending ≥ limit 시 **409 QUOTA_EXCEEDED**(초대 예약분도 점유로 계산) — UI에서 "현재 구독의 이용 한도" 거부 실측(P03-T02 브라우저 게이트와 동일) |

## 미수용 (선행·외부)

- 연간 실제 가격 미확정(원본 근거 없음 — orderable:false 유지가 올바른 동작).
- 유료 시작·변경·해지 예약과 과거 청구 불변은 PG 승인(P10-T02)·청구 이력(P10-T04) 필요.
- 기간 경계 전수(월말·윤년·시간대) 미실측.
