# P14-T03 외부 서비스·staging 운영 검증 — 미완료

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

local 및 미연결 방어 기반만 확인. 이번 소스 조사만으로 테스트 실행·브라우저·외부 연동 통과를 주장하지 않는다.

- [src/server/jobs.ts](../../../src/server/jobs.ts) — enqueueMail, enqueueServiceMail, enqueueMarketingMail, claimJob
- [src/server/sms-adapter.ts](../../../src/server/sms-adapter.ts) — classifySms, smsReceiptFile, deliverSms, applySmsReceipt
- [src/server/payments.ts](../../../src/server/payments.ts) — createPaymentOrder, readPaymentOrder, rejectPaymentReturn, applyPaymentEvent

## 남은 구현·수용

공급자별 실제 sandbox/staging 결과ID·장애복구.

원래 범위: 공급자 sandbox와 staging에서 실제 수신·결제·환불·SSO·서명/본인인증·웹훅·worker 중단복구를 확인한다.

수용 조건: 서비스별 증거 ID/시각/상태; 미설정은 blocked 표시; 실패대사/알람/재시도 절차

선행: P14-T02. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.
