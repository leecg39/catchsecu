# R18-T02 — 발신메일·이메일 발송·수신거부: 서버 API·업무 처리

## 라이브 수용 (`scripts/qa-r18-acceptance.ts run`, 5/5 PASS)

실행 환경: 프로덕션 서버(3121), `MAIL_TRANSPORT=local` + `ALLOW_LOCAL_MAIL=1`, 발신자 DNS는 로컬 DNS 픽스처(`SENDER_DNS_SERVER=127.0.0.1:49226`)가 실제 질의로 응답.

1. **sender-verified** — 발신자 등록 → 이메일 코드 확인(로컬 메일 아웃박스에서 실제 메일 파싱) → DNS TXT `check` → `verified`. 픽스처는 `senderVerification`(method dns) 레코드에서 토큰을 읽어 실제 DNS 프로토콜로 응답.
2. **campaign-delivered** — 마케팅 매핑 폼 게시(승인 체인) → 명시적 `marketingChannels:["email"]` 동의 제출 2건 → selection 수신자 캠페인 → 즉시 발송 → 워커 드레인 → 2건 `local_delivered`. 로컬 메일 파일의 본문 SHA-256, `List-Unsubscribe` 헤더, 본문 수신거부 URL 존재 확인.
3. **unsubscribed** — 잡 바인딩 토큰 → 공개 GET(정보) → POST `{confirm:true}` → `EmailSuppression(reason=unsubscribed)` 생성 + 배달 피드백 기록.
4. **suppression-blocks-resend** — 수신거부 수신자+동의 유지 수신자 혼합 재캠페인 → 억제 건 `excluded`, 정상 건 `local_delivered`. (전원 제외 캠페인은 422 `NO_ELIGIBLE_RECIPIENTS`로 예약 자체가 거부됨도 확인.)
5. **relay-feedback** — 타임스탬프+HMAC 서명 릴레이 반송 수용(feedback 기록), 위조 서명 401, 동일 이벤트 재전송 멱등.

## API 표면

- `/api/v1/senders` request-email·confirm-email·dns·check·대표·비활성·삭제
- `/api/v1/campaigns` CRUD·recipients(모드 direct|selection|csv)·schedule·reschedule·cancel·retry·deliveries·export
- `/api/v1/email-unsubscribe/[token]` 공개 확인
- `/api/v1/email-feedback` 서명 릴레이
- `/api/v1/email-suppressions` 목록

한계(정직 표시): 로컬 전송은 실제 SMTP 수신이 아니며 `local_delivered` 상태와 UI의 "로컬 전달" 라벨로 구분한다. 외부 SMTP 수신 증거는 R18-T04 external_pending.
