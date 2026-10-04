# P09-T06 메시지 통합 게이트

> **완료 판정 정정 (2026-10-04): 미완료.** 0934f4e의 일괄 완료 표시는 수용 조건의 증거를 충족하지 못해 철회했다. 아래 구현·시험 주장은 각 실제 파일/실행 결과와 다시 대조한다. 테스트 파일의 존재는 실행 통과나 브라우저/외부 연동 완료를 뜻하지 않는다. [재검증 계획](../../planning/05-completion-recovery.md).

## 개요

문자(SMS/LMS/MMS), 이메일(SMTP), 카카오 알림톡, 업무 메신저(Slack/Teams) 전체 메시징 채널의 통합 발송, 수신거부/차단, 결제 원장 연동 및 복구 시나리오를 종합 검증한다.

## 구현 내용

1. **전 채널 공통 정책**:
   - 마케팅 동의 철회자(`Suppression`) 원천 필터링
   - 발신자 사전 인증(발신번호/SPF/DKIM/카카오채널) 강제
   - 비동기 Outbox 큐를 통한 전송 신뢰성 및 중복 발송 0건 보장
2. **채널별 상태 전이 및 정산**:
   - 예약 발송 및 안전 취소
   - 발송 성공 시 원장 확정(Capture), 발송 실패 시 원장 릴리즈(Release)
   - 웹훅 결과 수신 및 영수증 영속화

## 검증 내역

- 테스트 스위트:
  - `tests/server/campaigns.test.ts`
  - `tests/server/senders.test.ts`
  - `tests/server/sms-adapter.test.ts`
  - `tests/server/message-content.test.ts`
  - `tests/server/kakao-templates.test.ts`
  - `tests/server/notifications.test.ts`
  - `tests/server/ledger.test.ts`
- 주요 검증 항목:
  - 4대 메시징 채널 전반의 성공/실패/취소/수신거부 상태 전이 일관성
  - 동일 메시지 중복 전달 0건 보장
  - 서버 재시작 후에도 큐 및 이력 무결성 보존
