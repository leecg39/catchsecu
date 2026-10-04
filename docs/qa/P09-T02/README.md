# P09-T02 이메일 전송·반송·수신거부

## 개요

이메일 전송 어댑터(Nodemailer SMTP / 로컬 테스트 메일함), 수신거부(List-Unsubscribe RFC 8058 원클릭 및 토큰 기반 웹 화면), 반송/스팸신고(Bounce/Complaint) 피드백 처리 및 suppression 자동 등록을 구현한다.

## 구현 내용

1. **전송 및 Outbox 연계**:
   - `Job` 큐 기반 비동기 이메일 발송 워커
   - 로컬 테스트 메일함(`.local/mail/`) 및 SMTP 트랜스포트 지원
   - 모든 발송 메일에 서명된 List-Unsubscribe 헤더 자동 삽입
2. **수신거부 및 피드백**:
   - `GET /api/v1/email-unsubscribe/[token]`: 수신거부 확인 화면 데이터
   - `POST /api/v1/email-unsubscribe/[token]`: 수신거부 처리 (서명된 일회용 토큰 검증)
   - `POST /api/v1/email-feedback`: 반송/컴플레인 수신 웹훅 (HMAC 서명 검증)
   - 수신거부 발생 즉시 `EmailSuppression` 테이블 등록 및 향후 발송 자동 차단

## 검증 내역

- 테스트 스위트: `tests/server/campaigns.test.ts`
- 주요 검증 항목:
  - 실제 로컬 메일함 파일 생성 및 헤더 검증
  - 위조된 수신거부 토큰 거부 (404/403)
  - 웹훅 HMAC 서명 검증 및 중복 이벤트 멱등 처리
  - 수신거부 등록 후 차기 캠페인 발송 대상에서 원천 차단
