# P08-T02/T03 — Solapi 라이브 SMS 캠페인 E2E (2026-10-05)

## 실측 체인 (전부 실제 동작)

1. `POST /forms` — 마케팅 sms 동의 폼 생성 → `approvals` 요청(reference 필수 정책) → `decision approved` → `publish` 201
2. `POST /public/forms/{token}/submissions` — `01029062908` + `marketingChannels:["sms"]` → MarketingPreference `granted` (b96ddd3a)
3. `POST /campaigns` — channel sms, source form, verified 발신자 → 201
4. `POST /campaigns/{id}/recipients` mode selection → 200, `POST .../schedule` → 202, Job enqueue
5. `SMS_TRANSPORT=solapi` 워커 `runOneJob` → **실제 Solapi 발송**

## 결과

- campaign `completed` / delivery `accepted` / job `done`
- `SmsReceipt`: `receiptId=solapi:G4V20261005033243…:M4V20261005033244…`, status `provider_accepted` — 증거 `live-solapi-campaign.json`

## 발견·수정된 차단 (적대적 결과)

- DB 트리거 `check_sender_job`이 `channel='email'`만 허용해 SMS 캠페인 job을 `23514 unverified sender job`으로 거부 → 마이그레이션 `20261006091000_sms_sender_jobs`: 캠페인 바인딩이 `channel='sms'` 캠페인에 연결된 verified·유효 sms 발신자를 허용(email 경로 불변, tenant·serviceId·expiry 검사 유지)
- `SMS_TRANSPORT=unconfigured` 서버는 예약을 `503 SMS_PROVIDER_REQUIRED`로 올바르게 거부 (공급자 미설정 차단 확인)

## 회귀

`campaigns + sms-adapter + senders` 111/111 통과 · tsc 0 · eslint 0
