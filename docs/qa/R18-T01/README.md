# R18-T01 — 발신메일·이메일 발송·수신거부: 모델·규칙 대조

## 대상 모델 (prisma/schema.prisma)

| 모델 | 핵심 필드·규칙 |
|---|---|
| `Sender` | tenant/service 범위, 상태(pending→verified→expired/disabled/deleted), `expiresAt`, 대표 발신자, `version` 낙관적 잠금 |
| `SenderVerification` | method `email`(확인 코드) / `dns`(TXT), `valueCipher` 암호화, 시도·만료 제한 |
| `Campaign` | channel `email|sms|kakao`, source `direct|form`, 상태기계 draft→scheduled→dispatching→completed|partial_failed|failed|cancelled|deleted|expired, `mailProtocol`(`mail.campaign.v3`), 최대 수신자 1,000 |
| `CampaignDelivery` | 캠페인당 수신자 행, `contactCipher` 암호화, `preferenceId`/`sourceSubmissionId` 동의 근거 바인딩, `erasedAt`(파기), attempt≤5, 상태 queued→local_delivered/…/excluded/cancelled |
| `EmailSuppression` | (tenant,service,contactHash) 유니크, reason `unsubscribed|hard_bounce|complaint|soft_bounce×3/7d`, 원문 삭제 후 연락처 비표시 |
| `EmailFeedbackEvent` | 공급자/수신거부 이벤트 원장, 중복 이벤트 멱등 |
| `Job`(`mail.campaign.v3`) | delivery 단위 잡, `dedupeKey=campaign:{deliveryId}:{attempt}` 재시도 분리, lease·attempt |

## 규칙 대조 결과

- 수신자 자격: 삭제·파기·유효하지 않은 연락처·동의 근거 없음(`CONSENT_REQUIRED`)·동의 변경·억제 목록은 `evaluateRecipient`가 사유와 함께 제외한다 (`src/server/campaign-common.ts:75`).
- 예약: 자격자 0이면 422 `NO_ELIGIBLE_RECIPIENTS`, 일부 제외는 `excludeInvalid` 동의 필요(409 `RECIPIENT_REVIEW_REQUIRED`) (`src/server/campaign-scheduling.ts:53`).
- 수신거부 토큰은 잡에 바인딩된 서명 토큰(`unsubscribeToken`), 공개 GET/POST(confirm:true) 경로 (`src/server/email-policy.ts`, `src/app/api/v1/email-unsubscribe/[token]/route.ts`).
- 외부 수신 결과는 서명된 릴레이(`email-feedback`)만 수용 — 시각+HMAC 검증, 위조 401, 중복 멱등 (`src/server/email-feedback.ts`).
- 발신자 인증은 이메일 코드 + DNS TXT 이중 확인, 재인증·주소 변경 시 기존 인증 해제.

결론: 모델·규칙이 계획 범위를 충족. DB 대조 수용 PASS.
