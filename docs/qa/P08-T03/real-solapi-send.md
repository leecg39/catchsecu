# P08-T03 — Solapi 실발송 게이트 (live)

## 환경

- `SMS_TRANSPORT` enum 확장: `unconfigured | local | solapi` (`src/server/env.ts`)
- `SOLAPI_API_KEY`/`SOLAPI_API_SECRET`/`SOLAPI_TENANT_ID` (`.env.local`, 비밀값 미커밋)
- 발신번호 `01029062908`: Solapi `senderid/v1/numbers` ACTIVE 확인 → Sender `verified`(live) — `bba012a` 게이트

## 구현

- `src/server/sms-adapter.ts` — `deliverSms({transport:"solapi"})`: HMAC-SHA256 서명(`date+salt`) → `POST https://api.solapi.com/messages/v4/send` `{message:{to,from,text,type:SMS|LMS}}`. 45자 기준 SMS/LMS 분류, 15s 타임아웃, `redirect:"error"`, Zod 응답 검증. 반환 `receiptId: "solapi:<groupId>:<messageId>"`.
- 오류 매핑: 네트워크/타임아웃/비JSON → `SMS_PROVIDER_UNAVAILABLE`(503, 재시도), `errorCode`·비2xx·`statusCode!="2000"` → `SMS_PROVIDER_REJECTED`(422, 즉시 실패), `groupId` 부재 → `SMS_PROVIDER_RESPONSE`(503).
- `campaign-scheduling.ts` — `SMS_TRANSPORT=solapi`이면 `solapiConfigured(tenantId)` 검증 후 `sms-solapi` 페이로드 발행.
- `campaign-worker.ts` — `sms-solapi` 전송 시 `deliverSms` 호출 후 `SmsReceipt(status:"provider_accepted", receiptId)` 행 기록, delivery `accepted`. 재개/복구 경로는 SmsReceipt 존재로 판정 — 로컬 영수증 파일 규칙과 분리, 크래시 후 재실행은 중복 발송 없이 수신 여부로만 판정하지 않음(영수증 없으면 재발송 → 공급자 측 중복 가능성은 pending 건에 한정).

## 실측 (2026-10-05 03:19 KST)

| 검증 | 결과 |
|---|---|
| `deliverSms` 실제 호출(to=from=01029062908) | `provider_accepted`, `receiptId=solapi:G4V…:M4V…` |
| 원시 응답 | HTTP 200 `{groupId:"G4V2026…", statusCode:"2000", statusMessage:"정상 접수(이통사로 접수 예정)"}` |
| 미등록 발신번호 | `verified:false` pending 유지 (공급자 거부 반영) |

## 적대적 경로 (mock fetch 테스트 — `tests/server/sms-adapter.test.ts`)

- 키 미설정 → `SMS_PROVIDER_REQUIRED` 503
- 요청 검증: `Authorization: HMAC-SHA256 apiKey=…, date=…, salt=…, signature=HMAC(date+salt)` 서명 재계산 일치
- 성공 응답 → `receiptId` 매핑, 45자 초과 → `LMS`
- `statusCode:"4000"` → `SMS_PROVIDER_REJECTED` 422
- HTTP 500 + 비JSON 본문 → `SMS_PROVIDER_UNAVAILABLE` 503
- webhook `applySmsReceipt`: 서명 불일치 401, 중복 receiptId 멱등, 다른 receiptId 409 — 회귀 통과

## 검증 커맨드

```
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/sms-adapter.test.ts tests/server/campaigns.test.ts
npx tsc --noEmit
npx tsx --env-file=.env.local scripts/qa-solapi-send.ts
```
