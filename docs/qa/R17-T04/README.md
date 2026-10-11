# R17-T04 발신번호·문자 캠페인 — DB·브라우저·재시작 수용

2026-10-14. `scripts/qa-sender-lifecycle.ts`(QA_ORIGIN=http://localhost:3121·QA_OUT·QA_CHECKPOINT 추가, P08 증거 보존) + `scripts/qa-sender-dns.ts` 로컬 DNS 프로토콜 fixture(QA_DNS_CHECKPOINT로 합성 회사 .test만 서빙) 3단계 재실행.

## prepare — 40 케이스 ([http-prepare.json](lifecycle/http-prepare.json))

- 독립 회사·계정(자체 메일 인증) → 이메일 발신자 등록(멱등·수정 낙관 잠금·쿼리 위조 422·`__proto__` 파라미터 거부).
- request-email → 인증번호 메일 잡(dedupeKey)·실제 코드 추출 → dns 등록 → **로컬 DNS fixture가 `_catchsecu-sender.*.test` TXT를 실제 DNS 프로토콜로 응답** → check → confirm-email → `verified`·`environment=local`·eligible → 인증 메일 잡의 로컬 사본 자동 파기.
- default 지정·구버전 409·SMS 발신자 check(공급자 미연결 → 503·pending 유지 — 가짜 승인 없음).
- 번호 증빙: sha256·MIME·크기 준비 → PUT 실제 PNG 바이트 → 스캔 완료 → attach → 다운로드 **바이트 완전 일치**.
- 수신 동의 폼 게시·명시적 동의 → 검증된 발신자 From의 로컬 마케팅 메일 실제 발송(from={name,address} 일치)·예약 잡 큐잉·**사용 중 발신자 삭제 409 차단**.

## finish — 18 케이스, 서버 재기동 후 ([http-finish.json](lifecycle/http-finish.json))

- 재시작 후 verified·default·eligible 유지·증빙 다운로드 바이트 재일치(restartPersistence).
- disable → 상태 disabled+default 해제, 기한 도래한 예약 잡이 claim 시 **cancelled 확정·로컬 파일 미생성**(발송 직전 재검사 실증).
- renew → pending 복귀·구 세대 인증번호 재사용 422.
- 삭제 → 주소 원문 null·cleanupPending false·반복 삭제 이력 중복 없음·생성 멱등키 재사용 410.
- 증빙 원문 삭제 → 발신번호 삭제 → 삭제 증빙 다운로드 410·합성 세션 0·원본 지문 동일.

## database — 독립 대조 ([dev-database.json](lifecycle/dev-database.json))

- 스냅샷 지문 finish↔database 동일·originalsUnchanged·syntheticSessions 0·globalWorkerRun false·providerVerified false.

## 누적 보완

- tests: campaigns.test 66(수신자 dedupe·변수·예약/취소·receipt 순서·부분 실패·아카이브)·senders.test 40·sms-adapter.test(서명·재시도 중복비용 없음).
- docs/qa/campaigns 19장·docs/qa/senders 세트·actual-local-delivery.json(실제 로컬 발송 From 대조).

## 외부 제공사 상태

- 로컬 메일·로컬 SMS 어댑터·로컬 DNS fixture로 검증. 실제 SMS 수신·실제 DNS·실제 공급자 receipt 증거 없음 → **external_pending**(Solapi 라이브 fixture는 별도 라운드의 수동 증거로 존재하나 이번 수용에서는 외부 제공사로 계산하지 않음).
