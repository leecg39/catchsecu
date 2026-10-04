# P08-T01 발신자 규칙 라이브 게이트 (2026-10-04)

dev 앱 :3100 + catchsecu_dev 실측. [기존 발신자 증거](../senders/README.md)의 규칙 경계 보강.

| 규칙 | 실측/근거 |
|---|---|
| 삭제 버전 검사 | `DELETE /senders/{id}` version+99 → **409 VERSION_CONFLICT**(낙관적 잠금이 삭제에도 적용) |
| 사용 중 삭제 | 예약/처리 중 job 참조 시 **409 SENDER_IN_USE**("예약 발송을 먼저 취소") — 완료된 캠페인 참조는 soft-delete(`status:deleted`, 캠페인 행 보존 — dev DB의 삭제 발신자가 캠페인 1건 참조 상태로 실존) |
| 재삭제 | 이미 deleted 발신자 재삭제 → 200 멱등 무해 |
| 미인증 발신 불가·만료 재확인 | P09-T01 게이트 실측(pending 409 SENDER_UNAVAILABLE·DNS_NOT_FOUND·verify:false) |

## 미수용

- 실제 DNS TXT·이메일 인증코드 수신·증빙 파일 심사는 로컬 환경 한계 — 외부 게이트.

## 실제 외부 이메일 인증 (2026-10-04 추가)

`MAIL_TRANSPORT=smtp`+Hostinger SMTP로 발신자 이메일 인증의 실제 외부 왕복을 실증했다:

- 발신자 생성 → request-email → 워커 실발송 → **IMAP 수신함에서 인증번호 631883 수신**(DKIM/SPF/DMARC pass) → confirm-email 코드 일치 → email 증빙 `verified`(live, 90일)
- local/live 환경 바인딩: local 증빙을 live 워커가 거부(`VERIFICATION_ENVIRONMENT`)
- 미해결: DNS 증빙 대기 — soverin.cloud NS가 Cloudflare라 Hostinger 존 편집이 공인 DNS에 반영되지 않음. Cloudflare TXT 추가 후 `check` 호출로 발신자 verified 완성 가능.

## 실제 Solapi 발신번호 검증 (2026-10-04 추가)

`.env.local`의 실제 SOLAPI_API_KEY/SECRET으로 `api.solapi.com/senderid/v1/numbers` HMAC 호출:

- 등록 번호 `01029062908`: `check` → 공급자 ACTIVE 확인 → **sender verified**(environment=live, providerRef 기록)
- 미등록 번호 `01000001234`: `check` → 공급자에 ACTIVE 아님 → `verified:false` · 발신자 pending 유지(적대적 경로)
- `SOLAPI_TENANT_ID`는 회사 UUID와 바인딩 — 다른 회사는 `SMS_PROVIDER_REQUIRED` 503

## 미수용

- **SMS 실제 전송은 미구현**: `SMS_TRANSPORT`는 `unconfigured|local`만 지원 — 캠페인 문자 발송은 여전히 로컬 영수증. 실제 Solapi 메시지 전송·receipt webhook은 구현이 필요한 범위.
