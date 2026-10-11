# R10-T04 최종 수용 — 재위탁 고지 발송·worker·재시작·재로그인

2026-10-11. R10 도메인의 마지막 수용 델타를 실제 DB/API/worker/브라우저로 검증했다.

## 범위

기존 4개 하위 흐름(display/overseas/structured/trustee-items)이 문서·표시 동의·구조화 처리방침·수탁 항목의 CRUD/게시/PDF/재시작을 커버했다. 이 증거는 남은 축을 닫는다: 재위탁 수신자·고지 발송의 outbox mail 경로, worker 처리, 서버 재시작 지문, 재로그인 세션 확인.

## 실제 실행

1. `scripts/qa-r10-acceptance.ts prepare` — access-fixture owner로 실제 로그인(200) → service context → `POST /services/{id}/subprocessors` 201 → `POST /services/{id}/subprocessor-notices` 201. 고지·`mail:subprocessor-notice:` job·`subprocessor.notice_queued` 감사가 한 트랜잭션으로 생성됨을 독립 DB 조회로 확인. [prepare.json](prepare.json)
2. `worker --drain` — job `74ae5bb1` status queued→done, attempts 1, completedAt 기록.
3. `after-worker` — 재로그인 후 고지 목록 조회: 상태 `processed`, completedAt 일치. [after-worker.json](after-worker.json)
4. 회귀 — 도메인 17파일/171개 vitest 통과 (`/tmp/r10-regression.log`).
5. `before` — documents 1·versions 2·subprocessors 1·notices 1·jobs 1·audits 7 SHA-256 `f4f62052e35d80d5d47d47d292de073c5df77c52dbf57311de2897d46dbf0081`. [database-before.json](database-before.json)
6. production `server.ts` SIGTERM→재기동(3121), `/api/v1/health` ok → `restart` 지문 동일. [database-restart.json](database-restart.json)
7. 브라우저 재로그인 — owner 재로그인 후 문서 목록에 처리방침 v5·draftRevision3·게시2본 유지, `/set/service/consigment/mail` 발송 이력에 "전송 처리 완료"와 로컬 미리보기 한계 안내 표시.

## 한계·구분

- 수신함 실도착은 로컬 메일 어댑터가 생성하는 미리보기 파일로 확인하지 않는다 — 화면 문구도 "메일 작업이 끝난 상태이며 수신함 도착을 확인한 결과는 아니다"로 안내한다.
- 실제 SMTP 수신 증거는 확보되지 않았으므로 R10-T04의 외부 검증은 `external_pending`으로 유지한다. 로컬 수용은 통과했다.
