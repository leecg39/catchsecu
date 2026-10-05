# P08-T04 발송 목록·예약·상세·재처리 화면

> 2026-10-04: 실제 부분 구현을 근거로 planned에서 in_progress로 정정했다. 전체 완료는 아니다. [근거](../status-revalidation/README.md).

> **완료 판정 정정 (2026-10-04): 미완료.** 0934f4e의 일괄 완료 표시는 수용 조건의 증거를 충족하지 못해 철회했다. 아래 구현·시험 주장은 각 실제 파일/실행 결과와 다시 대조한다. 테스트 파일의 존재는 실행 통과나 브라우저/외부 연동 완료를 뜻하지 않는다. [재검증 계획](../../planning/05-completion-recovery.md).

## 개요

문자/이메일 발송 결과 목록, 예약 현황, 상세 내역, 수신자별 성공/실패 조회, 실패 건 선별 재처리 및 결과 CSV 다운로드를 구현한다.

## 구현 내용

1. **발송 이력 및 상태 관리**:
   - `GET /api/v1/campaigns/[id]/deliveries`: 수신자별 발송 결과 목록 (커서/오프셋 기반 페이징)
   - 기간(한국 시간 기준), 상태(성공, 실패, 예약, 대기), 발신자 필터링
   - 실패 건에 대한 선택 재처리 및 재발송 Outbox 생성
   - 동일 delivery에 대한 중복 발송 차단 (멱등성 보장)
2. **다운로드 및 감사**:
   - 발송 결과 CSV 다운로드 (수식 인젝션 방어 적용)
   - 다운로드 감사 이벤트 생성

## 검증 내역

- 테스트 스위트: `tests/server/campaigns.test.ts`
- 주요 검증 항목:
  - 캠페인 상세 및 수신자 결과 페이징
  - 동일 수신자 중복 발송 0건 보장
  - 예약 취소 후 재개 불가 및 상태 전이 불변성
  - 실패 수신자 재처리 시 새 작업 고유 식별자 생성

## 예약취소+정산 E2E 추가 실측 (2026-10-12, tests/server/billing-settlement.test.ts 4/4)

- 신규 "예약된 문자 캠페인 취소는 미발송분을 취소하고 발송분만 정산한다": 동의 수신자 2명의 SMS 캠페인을 실제 예약 → 첫 잡만 워커로 완료(`local_delivered`, reserve+capture 50) → `/cancel` API 호출 → 미발송 1건 `cancelled`+잡 `cancelled`, 발송분만 `reserve→capture` 유지(원장 `funding,reserve,capture` 3행), 잔액 `available=50 held=0` — 취소된 잡 재실행해도 발송 0·원장 불변.
- 비용한도(잔액 부족): 기존 "잔액 부족은 INSUFFICIENT_CREDIT 실패로 기록되고 원장을 오염시키지 않는다" — `available < unitCost` 시 INSERT 전 `failed/INSUFFICIENT_CREDIT`, 원장에 funding만 남고 held=0.
- 남은 미수용: 실 PG 충전 기반 한도·외부 비용 검증은 외부 게이트.
