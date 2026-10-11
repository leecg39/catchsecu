# R16-T02 보존·파기 API 계약 대조

2026-10-14. retention-rules CRUD·`/log/retention` 계약·파기 승인/거절/취소/재시도/재예약·worker 참조차단/재실행 안전성을 운영 계약과 누적 증거로 대조했다.

## 운영 계약 (operation-policy-matrix)

- `GET/POST /retention-rules`, `GET/PATCH/DELETE /retention-rules/{id}` — security.read/write + 현재 서비스 grant, Idempotency-Key·version·If-Match.
- `GET /destruction-requests` — 상태·검색·정렬·페이지 보정.
- `POST /destruction-requests/{id}/approve|reject|cancel|retry|reschedule` — submission.destroy + grant 재검사; 일정 변경은 승인 무효화.
- `GET /destruction-certificates[/{id}][/download]` — audit.read, HMAC 무결성 + Content-Disposition/private·no-store.
- `POST /submissions/{id}/destruction-request` — 수동 요청.

## 누적 검증 근거

| 항목 | 결과 | 근거 |
|---|---|---|
| retention-rules CRUD·멱등·409·401/403/404 | 실제 HTTP 21건 통과 | [route-connection](../R16-T04/route-connection/README.md) http-db.json |
| `/log/retention` 화면 ↔ API 계약 | 브라우저 CRUD·충돌·반응형·역할 차단 | [browser/crud.json·conflict.json](../R16-T04/route-connection/browser/) |
| 승인→실행→실삭제→증명서 전 주기 | 통합 18·116건 통과 | [destruction](../destruction/README.md) tests-all.log |
| worker 임대·시도회수·SIGKILL 후 재개 | qa-destruction-restart.ts 실증 | [destruction-restart](../../scripts/qa-destruction-restart.ts) |
| worker 실행 중 원문 참조 차단 | 만료 경계·파기중 다운로드 410 수정 회귀 포함 | destruction/README.md·tests |
| 취소·반려 후 자동 재생성 방지 | retentionKey 유니크 | destruction.test.ts |

## 대조 결과

- 계약 표면과 구현·검증이 일치. 신규 코드 변경 없음 — 기존 증거 재확인으로 대조 완료.
- 외부 제공사 차원 없음.
