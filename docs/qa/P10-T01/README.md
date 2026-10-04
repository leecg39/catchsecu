# P10-T01 상품·가격·할당량·구독 — 미완료

> 2026-10-04: 실제 부분 구현을 근거로 planned에서 in_progress로 정정했다. 전체 완료는 아니다. [근거](../status-revalidation/README.md).

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

상품 버전·체험·대기 구매·할당량 검사. 이번 소스 조사만으로 테스트 실행·브라우저·외부 연동 통과를 주장하지 않는다.

- [src/server/subscriptions.ts](../../../src/server/subscriptions.ts) — plans, subscriptions, entitlement, assetOverview
- [src/server/entitlements.ts](../../../src/server/entitlements.ts) — assertQuota
- [tests/server/subscriptions.test.ts](../../../tests/server/subscriptions.test.ts)

## 남은 구현·수용

유료 구독 활성/변경/주기 청구 전체.

원래 범위: Plan 버전·요금·한도, 월/연 구독·시작/변경/해지 예약과 서버 entitlement 검사를 구현한다.

수용 조건: 서버가격 변조 차단; 제한/무제한 seed; 한도경합·기간경계·변경가격 과거청구 불변

선행: P03-T01, P01-T02. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.
