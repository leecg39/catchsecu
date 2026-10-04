# P10-T05 결제 UI와 전체 게이트 — 미완료

> 2026-10-04: 실제 부분 구현을 근거로 planned에서 in_progress로 정정했다. 전체 완료는 아니다. [근거](../status-revalidation/README.md).

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

일부 라이선스·체험 이력·잔액 화면. 이번 소스 조사만으로 테스트 실행·브라우저·외부 연동 통과를 주장하지 않는다.

- [src/server/billing-history.ts](../../../src/server/billing-history.ts) — billingHistory
- [src/server/ledger.ts](../../../src/server/ledger.ts) — postTrustedLedgerTransfer, ledgerOverview
- [tests/server/subscriptions.test.ts](../../../tests/server/subscriptions.test.ts)
- [tests/server/ledger.test.ts](../../../tests/server/ledger.test.ts)

## 남은 구현·수용

결제17경로·주문부터 환불/대사까지 E2E.

원래 범위: 상품/방법/결제결과/청구서/환불/사용량 17개 경로를 서버 상태에 연결한다.

수용 조건: 주문→승인→한도증가→사용→환불→대사 E2E; 실패URL·다른purchaseId 노출 차단; 외부 미검증 완료금지

선행: P10-T04. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.
