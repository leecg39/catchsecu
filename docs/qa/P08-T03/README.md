# P08-T03 문자 서비스사 어댑터·receipt — 미완료

> 2026-10-04: 실제 부분 구현을 근거로 planned에서 in_progress로 정정했다. 전체 완료는 아니다. [근거](../status-revalidation/README.md).

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

local SMS/LMS 처리와 서명 영수증 수신. 이번 소스 조사만으로 테스트 실행·브라우저·외부 연동 통과를 주장하지 않는다.

- [src/server/sms-adapter.ts](../../../src/server/sms-adapter.ts) — classifySms, smsReceiptFile, deliverSms, applySmsReceipt
- [tests/server/sms-adapter.test.ts](../../../tests/server/sms-adapter.test.ts)

## 남은 구현·수용

실제 공급자 전송·MMS·요금 정산·sandbox.

원래 범위: SMS/LMS/MMS 지원범위를 계약으로 확정, worker 전송·실패/재시도·결과 webhook·발신자 확인을 연결한다.

수용 조건: sandbox 실제 수신 또는 provider receipt; 인증실패·timeout·중복webhook·부분성공; 허위 sent 금지

선행: P08-T02, P01-T04, P10-T03. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.
