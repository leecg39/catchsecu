# R15-T04 광고 동의·수신거부 — DB·브라우저·재시작 수용

2026-10-14. `scripts/qa-marketing-lifecycle.ts`(QA_ORIGIN=http://localhost:3121·QA_OUT·QA_CHECKPOINT 추가, P07 증거 보존) 3단계 재실행.

## prepare — 26 케이스 ([http-prepare.json](lifecycle/http-prepare.json))

- 독립 회사·서비스·합성 계정(자체 메일 인증 링크 소비) → 채널별 동의 폼(이름/이메일/전화 + marketing questionId 매핑)→게시→명시적 `marketingChannels:[email,sms]` 제출 → 수신자 2건 자동 생성.
- 목록 페이지 보정·권한·정렬, 중복/불법 쿼리 422, 수식문자(`＝1+1`) 방어 CSV + `private,no-store`.
- 로컬 마케팅 메일 잡: 즉시 발송 runOneJob→done+로컬 파일 일치, 예약 잡(1h 후) 큐잉.
- 제외 PATCH 낙관 잠금(구버전 409)·원본 응답 선택·수동 동의 등록(attested+근거)→멱등 재생(버전 유지)→**2채널 원자 일괄 철회**→재요청 멱등(이벤트 수 불변)→summary·suppression 조회.
- 기존 109사/172인 원본 지문 보존.

## finish — 9 케이스, 서버 재기동 후 ([http-finish.json](lifecycle/http-finish.json))

- 재시작 후 스냅샷 지문 동일(restartPersistence).
- 철회된 수신자 `withdrawn`·비적격 → DELETE erased: 연락처·증빙 암호문 파기, **연계 발송 잡 2건(완료+예약)의 payload/local 사본까지 동시 파기** — 예약 발송 억제를 claim 단계가 아니라 삭제 시점에도 실증.
- 삭제 후 동의 원문 null·생성 멱등키 재사용 410·합성 세션 0·원본 지문 동일.

## database — 독립 대조 ([dev-database.json](lifecycle/dev-database.json))

- 최종: sms withdrawn(이벤트2)·email erased×2(contactErased·이벤트4/3)·스냅샷 해시 dc5d0563… ·globalWorkerRun=false·providerVerified=false.

## 누적 보완

- `tests/server/marketing.test.ts` 32건: 중복 통합 유일성·철회/재동의·억제 재검사·회사 경계·잡 연계 파기.
- 브라우저 증거 docs/qa/marketing/ 13장 + 이번 `/form/ad-manage` 라이브 스냅샷.

## 외부 제공사 상태

- 로컬 메일함·로컬 잡으로만 검증. 실제 광고 발송(SMS/이메일/알림톡) 수신 증거 없음 → **external_pending**.
