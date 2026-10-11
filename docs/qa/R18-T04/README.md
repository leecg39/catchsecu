# R18-T04 — 발신메일·이메일 발송·수신거부: DB·브라우저·재시작 수용검증

## 수용 절차

1. `scripts/qa-r18-acceptance.ts run` — 5/5 PASS (R18-T02 증거 참조). fixture에 senderId·campaignId·suppressionId·jobId 기록.
2. 서버 재시작(프로덕션 빌드, `APP_PORT=3121`).
3. `scripts/qa-r18-acceptance.ts restart` — PASS: 발신자 `verified`, 캠페인 `completed`, 억제 `unsubscribed`, 로컬 메일 파일 잔존 → 재시작 지속성 확인.
4. 브라우저 수용(R18-T03): 발신 주소·발송(폼/직접)·내역·차단 목록·캠페인 상세·주소없음 게이트 전부 실제 데이터로 렌더.

## 검증된 보장

- 동의 근거 없는 수신자는 발송 불가(`CONSENT_REQUIRED` → 제외/422), 명시적 이메일 동의 제출만 발송 대상.
- 수신거부→억제 목록→후속 발송 제외, 전원 제외 시 예약 거부.
- 수신 결과는 서명된 릴레이만 수용(위조 401·중복 멱등).
- 배달·억제·메일 원문·감사 이력이 재시작 후 유지.

## 외부 공급자 증거 상태 — external_pending

로컬 메일 전송(`MAIL_TRANSPORT=local`)은 실제 SMTP 수신이 아니다. 실제 DNS 공개 조회·외부 SMTP 접수·수신함 도달·공급자 수신거부/반송 콜백 증거는 미확보이며, 이 작업은 `external_pending`을 유지한다. UI는 "로컬 전달"·"공급자 접수"·"외부 공급자 확인 전" 라벨로 이를 정직하게 구분한다.
