# P09-T01 이메일 작성·템플릿·발신 도메인 — 부분 통과(적대적 라이브 보강)

2026-10-04 KST. 기존 부분 증거([campaigns](../campaigns/README.md)·[email-content](../email-content/README.md)) 위에
수용 조건의 **거부 경로를 dev 앱(:3100) HTTP로 라이브 재검증**했다.

## 라이브 적대적 검증 결과

| 시나리오 | 요청 | 실제 응답 |
|---|---|---|
| 공공 도메인 발신자 | `news@gmail.com` 발신자 생성 | 422 `SENDER_PUBLIC_DOMAIN` |
| 로컬 도메인 발신자 | `news@mail.localhost` 생성 | 422 `SENDER_DOMAIN` |
| 미확정 변수 | 제목 `{{evil}}`·본문 `{{password}}` | 422 `VALIDATION_ERROR` — "{{name}}, {{contact}}만 사용할 수 있습니다" |
| HTML 속성 변수 | `<a href="https://x.test/{{name}}">` | 422 `HTML_VARIABLE_CONTEXT` |
| 미인증 발신자 발송 | pending 발신자로 즉시 schedule | 409 `SENDER_UNAVAILABLE` |
| DNS 미응답 도메인 | `.test` 발신자 dns 발급→check | `verified:false`·`status:pending`·`resultCode:DNS_NOT_FOUND` — 거짓 인증 불가 |
| 권한 없는 생성 | viewer로 발신자·캠페인 생성 | 403 `FORBIDDEN` (sender.manage·message.manage 각각) |
| 무인증 | 쿠키 없이 발신자 생성 | 401 `ORIGIN_REJECTED` |

검증 산출물(캠페인 `8c6c0152`·발신자 `8542dde8`)은 API로 삭제했고 `cleanupPending:false`를 확인했다.

## 기존 증거가 커버하는 수용 조건

- sanitize: 서버 HTML 정제 + sandbox iframe 미리보기 ([email-content](../email-content/README.md), 21개 시험·실제 ClamAV)
- draft CRUD: 초안 생성·수정·삭제·검색·보관, DB 대조 ([campaigns](../campaigns/README.md))
- 업로드 권한: 첨부의 회사·서비스·초안 상태·기한 확인 + ClamAV 검사 + 부모 경유 다운로드만 허용
- 발신 도메인 인증 흐름: 이메일 코드 + DNS TXT 이중 확인, 로컬 UDP DNS fixture로 실증 ([sender-authentication.json](../campaigns/sender-authentication.json))
- 발송 시점 재검사: schedule·worker에서 발신자 버전·만료·환경 재확인 (`src/server/campaign-scheduling.ts`, `src/server/campaign-worker.ts`)

## 한계(완료 보류 사유)

- 실제 소유 도메인의 공용 DNS TXT 등록·확인은 외부 작업(B-게이트)이라 미실증.
- 실제 외부 SMTP 접수·DKIM은 미검증 — `MAIL_TRANSPORT=local`만 실측.
- `.test` 도메인의 외부 발송 차단은 `SENDER_DNS_SERVER` 미설정 dev 환경에서 실제 DNS 부재로 확인 — 외부 환경 재인증 경계(`VERIFICATION_ENVIRONMENT`)는 단위 테스트 수준.

수용 조건 대비: sanitize·미확정변수 차단 ✅(라이브), 업로드 권한 ✅(기존+시험), 도메인 미확인 차단 ✅(로컬 라이브, 공용 DNS는 외부 게이트), draft CRUD ✅(기존 증거).
