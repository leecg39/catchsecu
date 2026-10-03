# P01-T04 Outbox·Worker·예약·재시도

2026-10-03. 작업 큐의 동시 claim, 중단 후 재시작, 재시도 이력, 실패 한도, 취소를 catchsecu_shadow에서 확인했다.

`JobAttempt`는 시도 번호와 결과 코드만 저장한다. 수신자나 본문은 기록하지 않는다. 만료된 lease를 다른 worker가 집으면 이전 시도는 `expired`가 된다. 로컬 메일 파일은 같은 작업 ID로 한 번만 연결된다.

[outbox.json](outbox.json): 동시 claim 1건, 재시작 이력 `expired` → `delivered`, 복호화 실패는 `dead` / `DELIVERY_FAILED`, 취소된 작업은 다시 집지 않음.

실행: `npm run verify:outbox`.
