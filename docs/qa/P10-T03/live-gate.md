# P10-T03 크레딧 원장 라이브 게이트 (2026-10-04)

dev DB(catchsecu_dev)의 실제 트리거/제약을 트랜잭션 안에서 검증 후 ROLLBACK — 잔여 행 0 확인.

| 불변식 | 실측 |
|---|---|
| funding 반영 | 1000원 충전 → 계정 1000/0, 쌍 분개 `external:-1000`·`available:+1000` |
| 잔액 초과 예약 | reserve 9999(잔액 1000) → **CREDIT_INSUFFICIENT** |
| 유효 예약 | reserve 600 → 400 available / 600 held 이동 |
| 예약 초과 정산 | capture 700(예약 600) → **CREDIT_RESERVATION_EXCEEDED** |
| 같은 원천 중복 | 동일 (tenant,kind,sourceKind,sourceId) 재삽입 → **unique violation** |
| 잔액 직접 변경 | UPDATE CreditAccount → **CREDIT_ACCOUNT_DIRECT_CHANGE_DENIED** |
| 거래 불변 | UPDATE LedgerTransaction → **LEDGER_TRANSACTION_IMMUTABLE** |
| 분개 삭제 | DELETE LedgerEntry → **LEDGER_ENTRY_DIRECT_CHANGE_DENIED** |
| 음수/초기 잔액 | available=-5 INSERT → **CREDIT_ACCOUNT_INITIAL_BALANCE_DENIED** |
| 행 shape | funding은 `pg_capture`·서비스/예약 없음 강제, reserve는 serviceId 필수 — shape 위반 시 CHECK 거부 |

추가 근거: `pg_advisory_xact_lock`이 원천 키로 직렬화하고 동일 재시도는 기존 거래 반환·다른 내용 재사용은 `LEDGER_SOURCE_CONFLICT`([ledger.ts](../../../src/server/ledger.ts)).

## 미수용

- funding의 실제 PG 승인 원천(P10-T02)·서비스 사용량 연동·월별 사용량 집계는 외부/후속 게이트.
