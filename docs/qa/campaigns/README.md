# 캠페인·수신자·예약 발송 검증

2026-10-03 KST. P08-T02/P08-T04와 P09-T01/T02의 부분 구현 증거다. 전체 181경로·72 Task 작업은 계속 진행 중이다. 선행 게이트와 외부 연동의 수용 조건이 남아 정식 완료 집계는 **2/72**를 유지한다.

## 구현한 화면과 서버

- **6개 화면**: /mail/direct, /mail/catchform, /mail/history, /sms/direct, /sms/catchform, /sms/history.
- PostgreSQL의 Campaign·CampaignDelivery·CampaignEvent와 32~33번 migration을 추가했다. 회사·서비스·발신자·동의·작업을 복합 FK로 연결하고, 버전별 불변 이벤트와 상태 전이를 DB에서도 검사한다.
- 초안 생성·목록·상세·내용/발신자 수정·삭제, 검색·상태·보관·생성 기간 필터와 서버 페이지를 구현했다. 삭제한 초안은 원문과 대상 행을 지우고 최소 이력을 남긴다.
- 직접 입력, UTF-8 CSV 한 열, 명시적 동의 ID 선택으로 최대 1,000명을 원자적으로 교체한다. 정규화·중복 제거·형식 오류·동의·철회·기한·변수 검사를 적용한다. 연락처 입력만으로 동의를 만들지 않는다.
- 텍스트 및 {{name}}/{{contact}} 미리보기, 제외 사유와 명시적 제외 동의, 비용 확인 상태, 즉시/예약 요청·예약 변경·취소·보관·실패 행 선택 재처리·CSV를 연결했다.
- 요청 시 내용·발신자 버전·동의 버전·출처·실제 요청자를 고정한다. 새 작업 유형은 **mail.campaign.v1**이며 수신자/시도별 멱등 키를 쓴다. 작업 payload에는 식별자·시도·전송 환경만 저장한다.
- worker는 현재 요청자 권한·서비스·동의·출처·발신자를 재확인한다. 로컬 파일 전달과 SMTP 접수를 구분한다. sending을 먼저 커밋하므로 중간 종료/SMTP 응답 불확실성을 자동 재발송으로 처리하지 않는다.
- 로컬 파일은 작업 ID로 한 번만 게시한다. 두 worker 경쟁, 임대 만료, 마지막 시도 종료, 실패 재요청과 이전 작업 정리 간 충돌을 시험했다.
- 동의/응답 파기와 기한 정리는 초안의 사본까지 포함한다. 암호화 연락처·작업 내용·실제 로컬 메일 파일을 제거하고, 파기 증명서에 campaignRecipients 수를 포함한다. 캠페인 내용과 직접 입력 사본은 생성 후 최대 30일 보관한다.

## 최종 자동 검증

| 검사 | 결과 | 증거 |
|---|---|---|
| 전체 PostgreSQL 회귀 | **307/307**, 15 files, 152.02초 | [로그](regression.log) |
| 캠페인 통합 | **25개**가 전체 회귀에 포함됨 | [테스트](../../../tests/server/campaigns.test.ts), [앞선 24개 단독 실행](integration-final.log) |
| 타입 검사 | 통과 | [로그](typecheck-final.log) |
| 전체 린트 | 오류 0, 기존 이미지 경고 19 | [로그](lint-final.log), [최신 보조 코드](lint-latest.log) |
| 로컬 production build | 통과 | [로그](build-final.log) |
| migration | 개발/시험 DB 33개 적용 | [상태](migration-status.json) |
| OpenAPI | 198 paths | [로그](openapi.log) |
| 계획 대응 | 181경로·34메뉴·72 Task, 누락·순환 없음 | [로그](plan-verification.log) |

통합 시험은 CRUD·멱등키·버전·권한/회사/서비스 격리, CSV·암호화·명시적 선택·1000행 페이지와 예약, 두 worker, 실제 로컬 From/변수 렌더링, 취소/권한 회수/동의 변경/발신 중지, 원문 삭제/기한/증명서, 파일 실패 재처리, 중단 상태 복구, SMTP 불확실성, 직접 SQL 우회 거부를 다룬다.

## Ego 실제 조작과 DB 대조

동일한 Space 30/p1, localhost:3100, 합성 회사·서비스·연락처만 사용했다.

1. 합성 발신 주소를 화면에서 새로 등록했다. 로컬 UDP DNS와 실제 로컬 인증메일 코드로 검증했다. [인증 증거](sender-authentication.json). 코드 원문은 기록에 남기지 않았다.
2. 이메일 초안 생성 → 내용 수정 → CSV 입력. 중복 1개 제거, 유효 1명/형식 오류 1명/동의 없음 1명을 [미리보기](01-preview.png)에서 확인했다.
3. 명시적으로 제외에 동의하고 즉시 요청했다. [화면 결과](02-delivery-results.png), 실제 메일 파일의 수신자·From·변수·수정 내용 및 [DB 대조](actual-local-delivery.json)를 확인했다. 1명 전달/2명 제외이므로 캠페인은 일부 미발송으로 집계한다.
4. 결과 링크를 실제 클릭하여 [CSV 파일](downloads/campaign-recipients.csv)을 받았다. 3행·UTF-8 BOM·서버 처리 상태를 [대조](csv-download.json)했다.
5. 별도 캠페인을 06:00에 예약하고 07:00로 변경했다. [변경 화면](03-rescheduled.png)과 [예약 DB](reserved.json)를 먼저 기록한 뒤 취소했다. [취소 화면](04-cancelled.png), [작업 cancelled·메일 파일 없음](cancelled.json).
6. 이메일 [수집 자료 선택](05-form-selection.png)에서 명시적 대상 1명을 적용했다. 문자 직접 입력과 [목록](08-sms-history.png), [폼 작성](09-sms-form-create.png), [철회된 문자 대상 제외](13-sms-form-withdrawn.png)를 실행했다. [문자 공급자 미설정](07-sms-provider-required.png)은 가격 미확인·발송 비활성 상태다. [범위 대조](sources-and-sms.json).
7. 화면에서 [별도 초안](draft-before-delete.json)을 삭제했다. [원문·대상 제거](draft-deleted.json)와 [삭제 필터](17-deleted-filter.png)를 확인했다. [제목 검색](11-history-search.png), [보관 필터](12-archived-history.png)도 실제 서버 결과를 표시한다.
8. 일반 worker를 잠시 중지하고 합성 캠페인 한 건만 실제 파일 쓰기 실패 경로로 실행했다. [실패 화면](14-storage-failed.png), [독립 실패 증거](storage-failure.json). 정상 worker를 재시작한 뒤 실패 행을 선택해 재처리했다. [복구 화면](15-retried-success.png), [이전 dead/새 done·실제 메일 파일](retried-delivery.json).
9. 앱과 worker를 종료·재시작한 뒤 [화면 목록](16-restart-history.png), 7개 캠페인의 상태·내용·이력 연속성과 개인정보 없는 감사를 [대조](restart-persistence.json)했다. 최종 프로세스에는 DNS override가 없다. [실행 정보](runtime.json).
10. 390×844의 [목록](18-mobile-history.png)과 [작성 화면](19-mobile-form-final.png)을 확인했다. 문서 너비 390, 화면 밖 입력 0개다. 넓은 표는 표 안에서 가로 스크롤한다. [측정](mobile-final.json).

처리 완료 상태는 화면의 **최신 상태 불러오기**로 확인했다. 날짜 입력은 Ego의 단순 fill이 React 변경 이벤트를 발생시키지 않아 DOM의 입력/변경 이벤트를 함께 사용했다. 예약 요청·변경·취소는 모두 화면 버튼으로 실행했다.

## 발견한 문제와 수정

- 비동기 발신자 옵션 로딩 후 선택값이 비어 보였다. DB에는 발신자가 있었지만 내용 저장 시 해제될 수 있었다. 선택값과 현재 선택 항목을 유지하도록 수정하고 실제 저장·전달을 재검증했다. [증거](sender-selection-fix.json).
- 이전 실패 Job이 새 시도의 queued 행을 덮어쓸 수 있었다. 정리 대상 조회와 잠금 후 재검사에서 현재 attempt의 정확한 키를 확인한다. 오래된 작업을 LIMIT 전에 제외하여 복구 대상이 밀리는 것도 막았다.
- 처리기가 sending 상태에서 중단되면 외부 접수 여부가 불확실할 수 있다. 취소·파기·만료에서도 이를 미발송으로 단정하지 않고 unknown을 보존한다.
- 모바일 제목과 설명을 위아래로 배치했다. [수정 전](06-mobile-form.png), [수정 후](19-mobile-form-final.png).
- 초기 타입 오류, migration의 CASE 구문, SMTP 시험용 .test 도메인 거부를 수정했다. .test를 외부 발신자로 허용하는 완화는 하지 않았다. SMTP 계약 시험은 합성 DNS/SMTP 응답을 주입해 외부 연결 없이 실행한다.

## 남은 작업

- 실제 외부 SMTP 접수/수신, 반송·complaint·수신거부 webhook, 운영 보존/백업 정책.
- SMS/LMS/MMS 공급자 전송·receipt, 실제 요금/잔액/한도와 결제 원장. 현재 문자 초안·대상·미리보기는 동작하며 발송 요청은 503으로 거부한다.
- HTML sanitizer·첨부·메시지 템플릿은 후속 [이메일 내용 검증](../email-content/README.md)에서 로컬 구현을 확인했다. 발신자별 내역 필터 등 전체 Task의 추가 조건은 남아 있다.
- 원본 유료 작성 화면은 관찰하지 못했다. 여기의 캠페인 작성/상태 계약은 [독립 구현 계획](PLAN.md)에 근거한다.

로컬 메일 파일·DB·브라우저·UDP DNS는 실제 실행했다. SMTP 오류/불확실성은 공급자 응답 모의 시험이며, 중간 종료는 DB의 임대/sending 상태를 재현한 복구 시험이다. 외부 전달이나 실제 프로세스 강제 종료의 완전한 운영 증거로 사용하지 않는다.

## 재현

```sh
npm run db:migrate
node --env-file=.env.test.local node_modules/prisma/build/index.js migrate deploy
npm test -- tests/server/campaigns.test.ts
npm test
npm run typecheck
npm run lint
ALLOW_LOCAL_MAIL=1 npm run build
```

[QA 보조 스크립트](../../../scripts/qa-campaigns.ts)는 localhost·catchsecu_dev·로컬 메일 및 고정 합성 범위를 검사한다. fail-delivery는 일반 worker를 멈추고, 해당 합성 작업만 실행 가능한 상태인지 확인한 뒤 사용한다.
