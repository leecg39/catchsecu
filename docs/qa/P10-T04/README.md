# P10-T04 해지·환불·청구서·마감 — 미완료

> 2026-10-04: 실제 부분 구현을 근거로 planned에서 in_progress로 정정했다. 전체 완료는 아니다. [근거](../status-revalidation/README.md).

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

체험 종료 예약/철회만 부분 구현. 이번 소스 조사만으로 테스트 실행·브라우저·외부 연동 통과를 주장하지 않는다.

- [src/server/subscriptions.ts](../../../src/server/subscriptions.ts) — plans, subscriptions, entitlement, assetOverview
- [tests/server/subscriptions.test.ts](../../../tests/server/subscriptions.test.ts)

## 남은 구현·수용

유료 해지·부분/전체환불·청구서PDF·PG대사.

원래 범위: 부분/전체환불·해지 effective date·취소사유·청구서 PDF·월마감·조정을 구현한다.

수용 조건: 환불누계 초과 거부; PG와 DB 대사; refund retry 중복0; 마감후 정정 이벤트

선행: P10-T03, P01-T03. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.
