# 이메일 반송·신고·수신거부 검증

2026-10-03 KST. P01-T04, P07-T02, P08-T02/T04, P09-T01/T02의 부분 구현 증거다. 전체 181경로·72 Task의 정식 완료는 **2/72**를 유지한다. [실행 계획](PLAN.md), [실제 계약과 외부 검증 한계](CONTRACT.md).

## 구현한 동작

- HMAC 서명·5분 시간차·16KB 본문 제한을 적용한 릴레이 수신 API를 추가했다. 실제 발송 Job에서 회사·서비스·수신자를 찾고, 중복 이벤트는 같은 결과를 돌려준다. 같은 이벤트 ID로 다른 본문을 보내면 거부한다.
- 전달·일시 반송·영구 반송·신고·수신거부를 불변 이력으로 저장한다. SMTP 접수/로컬 전달 상태와 사후 수신 결과를 별도로 표시하고 CSV에도 구분한다.
- 영구 반송·신고·수신거부는 서비스별 연락처 해시를 차단한다. 일시 반송은 7일 안에 아직 전달되지 않은 서로 다른 3개 작업일 때 차단한다. 뒤늦은 전달이나 재동의가 이미 확정된 차단을 해제하지 않는다.
- 신규 요청·미리보기·예약·worker의 전송 직전 검사에 같은 차단 조건을 연결했다. 원문 삭제 후에도 차단 해시를 유지한다.
- 캠페인 메일 본문과 헤더에 90일 유효한 수신거부 링크를 넣는다. GET은 안내만 표시하고 확인 POST만 상태를 변경한다. 쿠키 없이 동작하며 반복 POST의 추가 부작용은 없다.
- HTTPS와 DKIM 헤더 서명 설정이 함께 켜져 있을 때만 one-click 헤더를 제공한다. 헤더의 API URL은 GET에서 확인 화면으로 이동하고 POST에서 직접 처리한다. 외부 HTTPS·DKIM·메일함 검증은 남아 있다.
- 발송 상세의 수신 결과, `/mail/history?view=suppression`의 검색·사유 필터·페이지, 공개 확인 화면을 연결했다. 접근 권한과 현재 서비스 권한을 매 요청 확인한다.
- 새 작업은 `mail.campaign.v3`를 사용한다. 기존 worker의 정책 생략과 프로토콜 강등을 DB에서 막는다.

## 자동 검사

| 검사 | 결과 | 증거 |
|---|---|---|
| 전체 PostgreSQL 회귀 | **343/343**, 16 files, 166.95초 | [최종 로그](regression-final.log) |
| 첫 변경 범위 | **60/60** | [로그](integration-initial.log) |
| 추가 one-click 회귀 | 1개 통과, 나머지 54개 필터 제외 | [로그](one-click-final.log) |
| 타입 검사 | 통과 | [로그](typecheck-final.log) |
| 전체 린트 | 오류 0, 기존 이미지 경고 19 | [로그](lint-final.log) |
| production build | 통과 | [로그](build-final.log) |
| migration | 개발/시험 DB 모두 38개 적용 | [상태](migration-status.json) |
| OpenAPI | 210 paths | [로그](openapi.log) |
| 계획 대응 | 181경로·34메뉴·72 Task | [로그](plan-verification.log) |

새 검증 15개는 서명·시간·본문·토큰 위조, 중복/경합/충돌, 잘못된 Job·회사·서비스, 미발송/불확실 작업, 역순 수신, 일시 반송 기준, 직접 SQL 우회·불변성, 역할/서비스 권한 회수, 원문 파기 후 차단, one-click의 실제 헤더 URL을 다룬다. [시험 코드](../../../tests/server/campaigns.test.ts).

마지막 점검에서 one-click 헤더 URL의 POST 연결 누락을 발견했다. API 경로를 연결한 뒤 공통 응답 처리와 `Response.redirect`의 변경 불가 헤더가 충돌하는 문제도 수정했다. [실패 로그](one-click-regression.log)와 수정 후 단독·전체 검증을 보존했다.

## Ego 및 실제 로컬 HTTP 검증

Space 30/p1, localhost:3100, 합성 연락처만 사용했다. 원본 운영사이트·외부 공급자에 발송하지 않았다. 비밀번호·세션·수신거부 토큰과 서명 키는 증거에서 제외했다.

1. 화면에서 이메일을 작성·즉시 발송했다. 실제 메일 파일의 본문·헤더·작업 바인딩을 확인했다. [메일 대조](actual-mail.json).
2. 로컬 HTTP에 서명한 전달 결과·중복·위조 요청을 보냈다. 각각 202/202/401이며 화면에 전달 확인이 표시됐다. [HTTP](relay-http.json), [화면](01-relay-delivered.png).
3. worker를 멈추고 두 번째 이메일을 대기시켰다. [DB](queued-before-unsubscribe.json), [화면](02-queued-before-unsubscribe.png).
4. 실제 메일 링크를 열었을 때 상태 변화가 없음을 확인하고, 390px 화면에서 수신거부를 확인했다. 이벤트·차단·감사가 각각 한 번 생겼다. [GET 대조](get-no-mutation.json), [변경 대조](unsubscribe-effect.json), [화면](04-unsubscribed-mobile.png), [너비 측정](mobile-unsubscribe.json).
5. worker를 다시 켜자 대기 발송이 `EMAIL_SUPPRESSED`로 취소됐다. 두 번째 메일 파일은 생성되지 않았다. [DB/파일](queued-blocked.json), [화면](05-queued-cancelled.png).
6. 영구 반송을 같은 합성 릴레이로 접수했다. 정확한 이메일·사유 필터와 모바일 표를 확인했다. [HTTP](hard-bounce-http.json), [화면](07-filtered-mobile-suppression.png), [390px 측정](mobile-suppression.json).
7. 새 초안에서 같은 수신자로 미리보기했다. 발송 가능 0명·제외 1명이며 발송 버튼이 비활성화됐다. [결과](blocked-preview.json), [화면](08-blocked-preview.png).
8. 발송 결과 CSV를 화면에서 내려받아 원래 전달 상태와 영구 반송 결과가 함께 기록됐는지 확인했다. [CSV](downloads/feedback-recipients.csv), [대조](export-check.json), [상세 화면](09-final-feedback.png).
9. 앱과 worker를 최종 빌드로 재시작했다. 두 차단 사유·대기 취소·메일 파일 부재가 유지됐다. [DB/파일](restart-persistence.json), [런타임](runtime.json), [화면](10-restart-suppression.png).
10. 헤더에서 사용한 것과 같은 one-click API URL에 실제 HTTP GET/POST를 보냈다. GET 302, POST 200·리디렉션 없음·쿠키 없음·추가 부작용 없음을 확인했다. [결과](one-click-http.json). 이 검사는 로컬 HTTP이며 외부 DKIM 수신 검증과 구분한다.

## 남은 범위

- 실제 이메일 공급자별 이벤트 변환·서명 검증 어댑터, 외부 SMTP 수신·HTTPS·DKIM·one-click 메일함 시험.
- 차단 이의 처리/해제 정책, 운영 보존·백업 복원 후 재파기. 현재 차단은 불변이며 관리 화면에 해제 버튼을 제공하지 않는다.
- 기존 저수준 `enqueueMarketingMail`은 차단 검사를 적용하지만 자동 footer는 현재 캠페인 발송 경로에 적용된다.
- 문자·요금·결제, Slack/Teams 등 남은 메뉴와 전체 선행 수용 게이트.

## 재현

```sh
npm run db:migrate
node --env-file=.env.test.local node_modules/prisma/build/index.js migrate deploy
npm test -- tests/server/campaigns.test.ts tests/server/message-content.test.ts
npm test
npm run typecheck
npm run lint
ALLOW_LOCAL_MAIL=1 npm run build
npm run verify:plan
node --env-file=.env.local --import tsx scripts/qa-email-feedback.ts restart
```

[QA 스크립트](../../../scripts/qa-email-feedback.ts)는 로컬 DB와 고정 합성 자료만 허용한다. `before`, `queued`, `subscribed` 증거는 해당 순서의 중간 상태이며 최종 상태에서 재실행하면 이전 조건과 맞지 않는다. `relay`·`hard-bounce`·`one-click` 모드는 로컬 HTTP 쓰기를 수행한다.
