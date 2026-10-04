# P09-T02 실제 외부 SMTP 접수·수신 게이트 (2026-10-04)

자격증명: Hostinger 메일 `admin@soverin.cloud`(MX: hostinger, DNS는 Cloudflare 권한).
실측 경로: 앱 발신자 인증 파이프라인을 `MAIL_TRANSPORT=smtp` live 환경으로 실행.

## 실측 순서

1. `POST /senders` email 발신자 생성(admin@soverin.cloud) → 201
2. `request-email` → `mail:sender-verification:` job 생성(live 환경 스탬프)
3. `runOneJob` 워커 → nodemailer → `smtp.hostinger.com:465` 실발송 → job `done`(SMTP accept)
4. `imaps://imap.hostinger.com` 실제 수신함에서 메일 확인:
   - Message-ID `<job-id@catchsecu.local>` 일치
   - `dkim=pass`(d=soverin.cloud)·`spf=pass`·`dmarc=pass`
   - 본문: `발신 주소 인증번호: 631883`(base64 디코딩)
5. `confirm-email`에 수신 코드 입력 → 인증 성공(`error:false`), email 증빙 `verified`(environment=live, 90일 validUntil)

## 경계 실증

- local 환경에서 만든 증빙을 live 워커가 소비하려 하면 `VERIFICATION_ENVIRONMENT`로 취소(suppressed) — 환경 바인딩 실증
- 잘못된 비밀번호시 `535 5.7.8 authentication failed` — 실공급자 오류가 계층되어 재시도됨
- 첫 시도의 job은 `retry`→ 비밀번호 교정 후 재시도 `done` — 재시도 생명주기 동작

## 잔여

- DNS 증빙: `soverin.cloud` 권한 NS는 Cloudflare — `_catchsecu-sender` TXT 추가 필요(값은 요청 시 재발급, 24h 유효). 이메일+DNS 모두 verified여야 발신자 status=verified.
- 반송/수신거부 webhook(`EMAIL_FEEDBACK_SECRET` 서명) 실제 공급자 콜백은 미수신 — Hostinger에 webhook 없음.
