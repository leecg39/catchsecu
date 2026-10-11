# R25-T02 전 도메인 교차 흐름 — 로컬 검증

`scripts/qa-r25-cross-flow.ts`가 조직→폼→승인·게시→공개 응답→동의→외부 공유/열람자→예약 발송→과금→철회·파기→감사/통계를 **하나의 실제 DB 흐름**으로 검증한다.
결과: **7/7 PASS** — [acceptance/cross-flow.json](acceptance/cross-flow.json)

## 실행

```bash
SMS_TRANSPORT=local QA_ORIGIN=http://localhost:3121 node --env-file=.env.local --import tsx scripts/qa-r25-cross-flow.ts
```

출력:

```text
PASS form-publish / submission-consent / share-viewer / campaign-send / billing / withdraw-destroy / audit-stats
R25-T02 cross-flow: 7 steps passed
```

## 단계별 실데이터

| 단계 | 내용 | 실제 ID |
|---|---|---|
| form-publish | 폼 생성(name+email subject 문항) → 승인 → 게시 토큰 발급 | formId `754c8f90-…` |
| submission-consent | 공개 POST(`origin`+`idempotency-key`) → 제출 + SMS 마케팅 동의 생성 | submissionId `0e7104c0-…`, preferenceId `b574f5b0-…` |
| share-viewer | 공유 승인 생성(201) → 열람자 챌린지(202) → 로컬 메일 코드 검증(200) → 공유 조회(200) | — |
| campaign-send | `source:"form"` 캠페인 → recipients POST(동의 preferenceId) → 예약 → 워커 발송 | campaignId `9f6d5e35-…`, **local_delivered** |
| billing | 결제 주문 생성 → paid 상태 + 원장 2건 | orderId `8975502f-…` |
| withdraw-destroy | 제출 철회 → 파기 요청→승인→워커 → `destroyed` + 파기 증명서 | — |
| audit-stats | 흐름 동안 신규 감사 이벤트 100건, form/submission/share/campaign/billing 도메인 모두 존재 | — |

## 한계·구분

- `campaign-send` 결과는 `SMS_TRANSPORT=local`의 **`local_delivered`** — 실제 SMS 프로바이더 발송 증거가 아니다(외부 검증은 R25-T03).
- 열람자 인증 코드는 로컬 메일 디렉터리(`deliveries/`)에서 추출. 실제 메일 발신 증거 아님.
- 권한·경합 회귀의 A/B 테넌트·역할 변경 다리는 각 도메인(R11~R24) 수용에서 개별 검증됨.
