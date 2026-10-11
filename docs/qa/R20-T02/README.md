# R20-T02 알림 받기·웹훅 — 서버 API·업무 처리

2026-10-14. 계약·구현·검증 3면 대조.

## API 표면 (operation-policy-matrix 106-110, 361-366)

| op | 기능 | 검증 |
|---|---|---|
| GET/POST `/integrations` | 페이지 목록(검색·이벤트·대상·등록자·provider·사용여부 필터)·멱등 생성(서비스별 50개 상한·대상 유효성) | tests + 수용 2단계 |
| GET/PATCH/DELETE `/integrations/{id}` | 읽기·낙관적 잠금 수정·삭제(tombstone·endpointCipher 제거) | 수용 8·9단계 |
| GET `/integrations/options` | 폼·CSV작업·등록자 옵션 + transport 노출 | 수용 브라우저 |
| POST `/integrations/delete` | 다건 원자 삭제(한 건 stale이면 전체 거부) | tests |
| POST `/integrations/{id}/enabled` | 즉시 토글 → 임대·큐잉 취소 | 수용 7단계 |
| POST `/integrations/{id}/test` | 202 큐잉 → worker 처리 | 수용 3단계 |
| GET `/integrations/{id}/deliveries` | 전송 내역 + 불변 시도 이력 | tests |
| POST `.../deliveries/{deliveryId}/retry` | 안전한 실패 재처리(상한·24h·설정 세대 일치) | tests |

## 업무 트랜잭션

- 이벤트는 응답 제출/CSV 완료 **같은 트랜잭션**에서 생성 → 커밋과 outbox 원자성.
- 배달은 event+integration 유일로 정확히 1회. 설정 세대 변경 시 구세대 전송 취소.
- 실패 분류: retryable(5xx·rate limit)/failed/uncertain(응답 쓰기 후 단절 — 자동재시도 없음·수동만).

## 검증 근거

- `tests/server/notifications.test.ts` 25건(멱등·잠금·SSRF·타이밍·중복 워커·보존).
- `docs/qa/R20-T04/acceptance/http-run.json` 라이브 9케이스.
