# P10-T02 결제수단·PG 주문·인증 — 미완료

> 2026-10-04: 실제 부분 구현을 근거로 planned에서 in_progress로 정정했다. 전체 완료는 아니다. [근거](../status-revalidation/README.md).

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

주문·서명 이벤트·성공 URL 위조 거부. 이번 소스 조사만으로 테스트 실행·브라우저·외부 연동 통과를 주장하지 않는다.

- [src/server/payments.ts](../../../src/server/payments.ts) — createPaymentOrder, readPaymentOrder, rejectPaymentReturn, applyPaymentEvent
- [tests/server/payment-orders.test.ts](../../../tests/server/payment-orders.test.ts)

## 남은 구현·수용

PG 토큰 결제수단 CRUD·실제 승인 sandbox.

원래 범위: PG token 기반 결제수단 CRUD·대표수단, purchase 생성·provider 승인·서명 검증 webhook을 구현한다.

수용 조건: success URL 위조로 paid 불가; 카드원문 저장0; callback 중복/순서역전; sandbox 승인

선행: P10-T01, P01-T04. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.
