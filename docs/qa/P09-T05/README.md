# P09-T05 Slack·Teams 알림 CRUD

## 개요

외부 업무 메신저(Slack, Microsoft Teams) 인컴 웹훅(Incoming Webhook) 연동, 이벤트 필터링, SSRF 방어, 테스트 발송 및 비동기 발송 이력을 구현한다.

## 구현 내용

1. **웹훅 엔드포인트**:
   - `GET /api/v1/notifications`: 웹훅 채널 목록
   - `POST /api/v1/notifications`: 새 웹훅 등록
   - `PATCH /api/v1/notifications/[id]`: 웹훅 설정 수정 및 활성/비활성 토글
   - `POST /api/v1/notifications/[id]/test`: 테스트 알림 발송
2. **보안 및 무결성 (SSRF 방어)**:
   - 등록 웹훅 URL에 대해 사설 IP(Private IP CIDR), 로컬호스트(`127.0.0.1`), 메타데이터 엔드포인트(`169.254.169.254`) 사전 차단
   - HTTP 리디렉션 추적 차단
   - 비활성화(`disabled`) 채널에 대한 이벤트 전송 0건 보장
   - Outbox를 통한 비동기 발송 및 실패 시 지수 백오프 재시도

## 검증 내역

- 테스트 스위트: `tests/server/notifications.test.ts`
- 주요 검증 항목:
  - 내부 IP 및 SSRF 위험 URL 등록 거부 (422)
  - 비활성화 채널 알림 누락 0건 확인
  - 폼 접수 등 이벤트 발생 시 정상 Outbox 큐잉 확인
  - 웹훅 테스트 발송 성공/실패 응답 코드 검증
