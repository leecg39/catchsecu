# R15-T01 광고 동의·수신거부 — 모델·규칙 대조

2026-10-14. MarketingPreference·MarketingEvent·Suppression·Job(marketing 연계)과 원본 `/form/ad-manage` 화면 대조.

## 모델

- `MarketingPreference`: tenant·service·`sourceSubmission`(복합 FK·응답 근거 고정)·name/contactQuestionId·channel(email|sms|kakao)·`contactHash`(검색·중복 통합 기준)·contactCipher(권한자만 복호화)·`evidenceCipher/evidenceHash`(동의 문구·시각 증빙)·sourceKind(form|csv|manual)·grantedAt/withdrawnAt·excluded·status(granted|withdrawn|erased)·version.
  - `(tenantId,serviceId,channel,contactHash)` 유일 → **채널별 중복 수신자 통합 기준**(같은 연락처는 채널당 1건).
- `MarketingEvent`: `(preferenceId,version)` 유일 불변 이벤트(생성/수정/철회/삭제·evidenceHash).
- `Suppression`/`EmailSuppression`: 채널·emailHash 유일 억제 목록(캠페인 발송 직전 재검사 대상).

## 규칙 대조

- 동의 수집: 폼 `marketing{name,email,sms}QuestionId` 설정 → 공개 제출의 `marketingChannels`로 채널별 수신자 생성. 수동 등록은 `attested:true`+근거(reference) 필수.
- 철회: `withdrawn` 상태 + 이벤트, 원자 일괄 철회 멱등(동일 items 재요청 시 이벤트 수 불변 — 수용 실측).
- 삭제: `erased` — contactCipher/evidenceCipher 파기, 연계 발송 Job의 payload·로컬 사본도 같이 지움(`payloadErasedAt`·`localCopyErasedAt`).
- 발송 제외(excluded): 발송 대상 eligibility와 별개 축 — 철회와 다른 운영 차단.
- 목적별 범위: 수집 시 `purpose`를 증빙으로 고정, 재동의는 새 근거(attested+reference) 요구.
