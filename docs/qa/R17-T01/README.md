# R17-T01 발신번호·문자 캠페인 — 모델·규칙 대조

2026-10-14. Sender·SenderVerification·SenderEvent·Campaign→CampaignDelivery→SmsReceipt·Job·CreditAccount 대조.

## 모델

- `Sender`: channel(email|sms)·addressCipher/Hash·label·status(pending|verified|disabled|deleted)·environment(local|provider)·isDefault·eligible·generation·version. `SenderVerification`: method(email code|dns txt|evidence)·valueCipher·generation 고정(발신자 세대 변경 시 구 증빙 무효). `SenderEvent` 불변 이력.
- `Campaign`: channel·source(form|direct)·contentCipher(제목+본문 스냅샷)·status(draft|scheduled|processing|sent|partial_failed|cancelled|deleted|archived)·scheduledAt·senderId/version(발신자 변경 시 고정)·archivedAt(30일 보관).
- `CampaignDelivery`: campaign·position 순서·contactCipher·nameCipher·status·reason·sourceSubmissionId·`preference` 연결(동의 근거). `SmsReceipt`: 공급자 이벤트 수신부(서명·중복·순서 검증 대상).
- 크레딧: `CreditAccount`+LedgerEntry — 예약/정산은 `campaign-ledger.ts`가 발송 확정 시에만 차감(재시도 중복 비용 없음).

## 규칙 대조

- 번호 정규화·중복 제거: 수신자 구성 시 contactHash 기준 dedupe, 이름 없는 대상은 {{name}} 발송에서 제외.
- 예약 timezone: `scheduledAt` 저장·job.dueAt 동기화(수용 실측).
- 발신자 변경 버전 고정: 캠페인 생성 시 senderId+version 스냅샷 → 이후 발신자 수정/인증 만료가 예약본을 오염시키지 않음.
- 증빙: SMS 번호는 증빙 파일(최대 크기·MIME·sha256 준비→PUT 바이트→스캔→attach) — 첨부만으로 인증 완료 아님(화면 고지와 일치).
