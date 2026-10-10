# R00-T03 작업·역할·상태 계약 통합

## 완료 범위

- 활성 107개 Task와 기존 72개 Task를 `legacy-task-map.json`으로 전부 연결했다. 기존 상태는 이력으로 보존하며 현재 완료 상태로 자동 승격하지 않는다.
- 원본 선언 186개(구체 184·fallback 2)와 독립 제품 부가 경로 21개를 활성 포인터에서 분리했다.
- 모든 활성 Task에 `verification_status.database/api/ui/external`을 추가했다. `not_assessed`, `not_applicable`, `partial_verified`, `verified`, `external_pending`을 구분하고 한 표면의 결과를 다른 표면으로 전이하지 않는다.
- tenant 역할 9개와 capability 32개를 `src/server/permissions.ts`와 동일한 기계 판독 계약으로 고정했다. 역할과 별도로 현재 Membership, ServiceGrant, license/entitlement, 전문가 만료를 검사한다.
- 구형 모델명 `Delivery`, `MonthlyClose`, `Purchase`를 현재 Prisma 모델의 문맥별 매핑으로 교체했다. 실제 데이터 모델 문서에는 `CampaignDelivery`, `SmsReceipt`, `NotificationDelivery`, `BillingMonthClose`, `ComplianceClose`, `PaymentOrder`, `PaymentEvent`, `PaymentRefund`를 사용한다.
- OpenAPI 329개 path·466개 operation과 정책표 466행을 통합 검증기로 대조한다.

## 증거

- [통합 검사 결과](integration-check.json)
- [활성 계획 포인터](../../planning/active-plan.json)
- [기존 72개 작업 연결표](../../planning/09-rea-fullstack/legacy-task-map.json)
- [표면별 상태 계약](../../planning/09-rea-fullstack/status-contract.json)
- [역할 계약](../../planning/contracts/roles.json)
- [구형 모델명 매핑](../../planning/contracts/model-name-map.json)

## 재현

~~~bash
npm run verify:plan-integration
npm run verify:plan
npm run verify:route-baseline
npm run typecheck
npx eslint scripts/verify-plan-integration.ts
~~~

이 Task는 계획·계약 통합 범위다. 각 메뉴의 DB/API/UI/외부 공급자 완료 여부는 개별 Task의 분리 상태와 실제 증거로 계속 관리한다.
