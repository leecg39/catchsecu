# R20-T01 알림 받기·웹훅 — 모델·규칙 대조

2026-10-14. 원본 `/integration/message` 캡처(`docs/research/services/integration__message*.json`)와 구현을 대조한다.

## 모델 (migration 39~)

- `NotificationIntegration`: tenant·service·creator·provider(slack|teams)·`endpointCipher`+`endpointHost`(비밀값 분리 저장·응답 마스킹)·enabled·`generation`(설정 세대)·version·deletedAt. `(tenantId,serviceId,id)` 유일.
- `NotificationSubscription`: `(integrationId,kind)` 유일, `targetId=null`=서비스 전체 / 특정 폼·CSV 작업.
- `NotificationEvent`: `eventKey` 유일(출처:버전), kind·sourceId·sourceVersion·targetId·imported/failedRows.
- `NotificationDelivery`: event+integration 유일·생성 시 generation·transport 고정. `NotificationAttempt` 불변 시도 이력.

## 이벤트 발생지 일대일 대응

| 이벤트 | 발생지 |
|---|---|
| `submission.created` | `emitNotificationEvent` — 공개 응답 제출 트랜잭션 내(`notifications.ts:151`), target=폼 |
| `import.completed` | 동일 함수 — ImportJob 완료/부분완료 시(target=job, imported/failed 건수) |
| `test` | `testIntegration` 수동 트리거 |

**원본 대조 노트**: 원본 캡처는 목록 화면(빈 상태)만 확보됐고 추가 모달의 이벤트 목록은 캡처되지 않았다(과업서의 "9이벤트"는 기획 추정). 구현은 실제 서버 발생지가 존재하는 2종 + 테스트만 노출해 발생지 없는 사망 구독을 만들지 않는다. 화면 문구("캐치폼·개인정보 업로드 관련 알림")는 원본과 일치.

## 규칙

- 전송 페이로드: 이벤트 종류·시각·건수·참조만. **응답 내용·연락처 미포함**(수용 4단계 실증).
- 비활성/URL 변경/삭제 → `generation` 증가와 함께 임대·큐잉 전송 즉시 취소. 24h 이벤트 데드라인·재시도 상한.
- SSRF: HTTPS만·자격정보/IP 리터럴/리다이렉트 위장 거부·DNS 혼합 응답 차단·IP 핀+TLS 호스트 검증(`notification-transport.ts`, 테스트 25건).
