# R17-T02 발신번호·문자 캠페인 — 서버 API·업무 처리

2026-10-14. operation-policy-matrix 91-100·304·325-333 대조.

## API 표면

| op | 기능 | 검증 |
|---|---|---|
| GET/POST `/senders` | 목록(상태·정렬·검색)·멱등 생성(email|sms) | 수용 prepare |
| GET/PATCH/DELETE `/senders/{id}` | 상세(증빙·검증 내역)·낙관 잠금·주소 원문 파기 삭제·사용 중 차단 409 | 수용 |
| POST `/{id}/request-email`·`confirm-email` | 인증번호 메일 잡(dedupeKey)·코드 소비·구 세대 422 | 수용 prepare·finish |
| POST `/{id}/dns`·`check` | DNS TXT 등록→로컬 fixture 조회→verified 전이 | 수용 prepare(실제 DNS 프로토콜) |
| POST `/{id}/evidence`·`evidence/{eid}/attach`·`download`·DELETE | 증빙 준비(sha256·MIME·크기)→PUT 바이트→스캔→첨부→다운로드 바이트 대조 | 수용 |
| POST `/{id}/default`·`disable`·`renew`·`cleanup` | 대표 지정·중지(예약 잡 claim 시 cancelled)·재인증 사이클 | 수용 finish |
| GET/POST/PATCH/DELETE `/campaigns` + sources/recipients/deliveries | 초안→예약→발송→수신자별 결과·취소·삭제 | campaigns.test 66·브라우저 19증거 |
| POST `/sms/receipts` | 공급자 수신 이벤트(서명·중복·순서) | sms-adapter.test + senders.test |

## 업무 규칙

- 발송 직전 재검사: worker claim 시점에 발신자 상태(verified·enabled)·동의(suppression)·잔액을 재검사 — 수용에서 disable 후 dueAt 도래한 예약 잡이 `cancelled`로 확정·파일 미생성.
- `campaign-scheduling.ts`: 예약/재예약/취소가 job.dueAt과 원자 동기화.
- `campaign-worker.ts`: 수신자별 결과(partial_failed) 기록·재시도 시 이미 접수분 재비용 없음.
- `sms-adapter.ts`: 로컬 어댑터는 파일 기록, 실제 공급자는 서명된 receipt만 상태 변경.
