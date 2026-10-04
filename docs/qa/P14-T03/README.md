# P14-T03 외부 서비스·staging 운영 검증

## 개요

외부 연동 공급자(SMTP 메일, Solapi 문자, 카카오 알림톡, PG 결제, 본인인증)의 Sandbox 및 Staging 환경 연동 규격, 웹훅 수신, Worker 중단 및 재시작 복구를 검증한다.

## 구현 내용

1. **외부 공급자 연동 규격**:
   - 이메일: Nodemailer SMTP 트랜스포트 및 로컬 테스트 메일함
   - 문자: Solapi/CoolSMS API 규격 및 SMS/LMS/MMS 분기
   - 알림톡: 카카오 비즈니스 템플릿 심사 및 승인 웹훅
   - 결제: PG 결제 주문, 서명된 승인 웹훅 및 멱등 처리
2. **장애 복구 (Fault Tolerance)**:
   - Worker 프로세스 비정상 종료 시 DB 행 잠금(Lease) 만료 후 다른 Worker 자동 승계
   - 지수 백오프(Exponential Backoff)를 통한 일시적 네트워크 단절 복구

## 검증 내역

- 테스트 스위트: `tests/server/campaigns.test.ts`, `tests/server/payment-orders.test.ts`, `tests/server/kakao-templates.test.ts`
- 주요 검증 항목:
  - 공급자 서명 검증을 통한 위조 웹훅 차단
  - Worker 중단 후 재기동 시 미완료 작업 무결성 복구 확인
