# R20-T04 알림 받기 — DB·브라우저·재시작 수용

2026-10-14. `scripts/qa-r20-acceptance.ts`(QA_ORIGIN=http://localhost:3121, production) — 9케이스 + 서버 재기동 후 영속 확인.

## run — 9 케이스 ([http-run.json](acceptance/http-run.json))

1. **form-published**: 폼 생성→승인→결정→게시·공개 토큰 발급.
2. **integration-created**: slack+로컬 transport·`endpointHost`만 응답·URL 비밀값 마스킹.
3. **test-delivered**: 테스트 202→worker→`local_delivered`·시도 1회 불변 기록·페이로드에 endpoint 비밀값 없음.
4. **form-event-delivered**: 실제 공개 응답 제출 → `submission.created` 이벤트 → **정확히 1개 배달**(event+integration 유일)→succeeded·페이로드에 응답 내용 부재.
5. **service-isolation**: 타 서비스 함정 구독(DB 시드, 같은 이벤트 kind·전체 대상)에 두 번째 제출도 **누출 0** — emission이 `serviceId`로 필터됨을 실증.
6. **ssrf-refused**: `127.0.0.1:8080`·`localhost`·`169.254.169.254`(메타데이터) endpoint 전부 400 계열 거부.
7. **disable-cancels-queued**: enabled POST 즉시 큐잉 배달 `cancelled`(worker 개입 없이 토글이 직접 취소)·로컬 파일 미생성.
8. **optimistic-lock**: stale version PATCH → 409.
9. **deleted**: tombstone + `endpointCipher` 제거(비밀값 즉시 파기).

## restart — 서버 재기동 후 ([restart.json](acceptance/restart.json))

- tombstone·succeeded 배달·로컬 알림 파일·이벤트 모두 영속.

## 누적 보완

- `tests/server/notifications.test.ts` 25건: 멱등 키·낙관 잠금·중복 워커 단일 효과·uncertain 불자동재시도·24h 데드라인·DNS/IP핀/TLS·50개 상한·다건 원자 삭제.
- `docs/qa/notifications/` 브라우저 13증거.

## 외부 제공사 상태

- Slack/Teams **실제 수신 미검증 → external_pending**. 로컬 transport(`NOTIFICATION_TRANSPORT=local`)는 파일 기록으로 검증됐고 webhook transport는 DNS·TLS·IP핀·응답 분류까지 테스트됐으나 실제 공급자 수신 증거는 없음.
