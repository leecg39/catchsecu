# 이메일 HTML·템플릿·첨부 검증

2026-10-03 KST. P01-T03/T04, P08-T02/T04, P09-T01/T02의 부분 구현 증거다. 전체 181경로·72 Task와 외부 연동 검증은 계속 진행 중이다. 정식 완료 집계는 **2/72**를 유지한다.

## 구현 범위

- 서비스·이메일/문자 채널별 메시지 템플릿 생성·조회·검색·페이지·수정·보관·복원·삭제, 불변 개정본 조회를 연결했다. 삭제하면 현재와 과거 개정본의 이름·본문을 지운다.
- 템플릿을 적용하면 지정 버전의 내용을 캠페인에 복사한다. 템플릿의 이후 변경·삭제는 복사된 내용에 영향을 주지 않는다. 수동 편집하면 템플릿 연결을 해제한다.
- 서버의 HTML 정제, 필수 텍스트 대체 본문, 제목/본문의 변수 검증, HTML 글자 변수의 이스케이프를 구현했다. 스크립트·이미지·CSS·이벤트·위험 URL과 HTML 속성 안의 변수를 제거하거나 거부한다. 허용 목록과 근거는 [결정 기록](DECISIONS.md)에 있다.
- HTML 미리보기는 sandbox iframe·CSP·inert 본문을 사용한다. 정제 결과와 실제 발송 내용을 일치시킨다.
- 캠페인 첨부는 최대 5개·각 10MB·합계 20MB다. 업로더·회사·서비스·초안 상태·기한을 확인하고 실제 ClamAV 검사 후 암호화 저장한다. 부모 캠페인을 통한 다운로드만 허용한다.
- 요청 시 첨부 ID·해시·크기·MIME을 고정한다. 예약 변경·재요청·전송 직전에 실제 파일을 다시 검사한다. Nodemailer에는 검증한 바이트만 전달하고 파일 경로·URL 접근을 차단한다.
- `mail.campaign.v2`와 DB 프로토콜 가드를 추가했다. 구형 worker가 HTML/첨부를 생략한 채 새 캠페인을 보내지 못하게 한다. 새 worker는 기존 v1 작업도 처리한다.
- 첨부 제거·초안 삭제·기한 만료 시 실제 원문을 삭제한다. 저장소 삭제 실패는 `deleting` 상태에서 재처리한다. 응답/동의 파기 시 수신자별 로컬 메일 파일 전체와 그 안의 HTML·첨부 사본을 지운다. 여러 수신자가 공유하는 원본 첨부는 캠페인의 30일 기한을 따른다.

## 자동 검증

| 검사 | 결과 | 증거 |
|---|---|---|
| 전체 PostgreSQL 회귀 | **328/328**, 16 files, 165.22초 | [로그](regression.log) |
| 변경 범위 | 캠페인/이메일 40 + HTML 6 = **46/46** | [로그](integration-final.log), [캠페인 시험](../../../tests/server/campaigns.test.ts), [HTML 시험](../../../tests/server/message-content.test.ts) |
| 타입 검사 | 통과 | [로그](typecheck-latest.log) |
| 전체 린트 | 오류 0, 기존 이미지 경고 19 | [로그](lint-latest.log) |
| production build | 통과 | [로그](build-final.log) |
| migration | 개발/시험 DB 모두 37개 적용 | [상태](migration-status.json) |
| OpenAPI | 207 paths | [로그](openapi.log) |
| 계획 대응 | 181경로·34메뉴·72 Task | [로그](plan-verification.log) |

이번에 21개 검증을 추가했다. 템플릿 CRUD·이력·멱등/버전·역할/서비스/회사 격리, HTML/URL/변수 공격과 헤더 개행, 예약 내용 고정, 실제 첨부 바이트와 다운로드, 미검사/손상 파일 차단, 5개/20MB 경합, 실제 EICAR 탐지, 검사 서비스 장애, 삭제 실패 후 재처리와 실제 시간 경과 후 만료 삭제, 직접 SQL 우회 거부를 다룬다.

초기 실패 로그도 보존했다. 테스트의 존재하지 않는 helper 이름, 동의 삭제 경로, fake clock 복원 순서를 수정한 후 [최종 단독 실행](integration-final.log)과 전체 회귀를 통과했다. 상세 경과는 [초기 실행](integration-initial.log), [첨부 실행](integration-files.log), [실제 기한 확인](expiry-investigation.log)에 있다. 외부 SMTP 시험에서는 DNS와 Nodemailer 응답만 모의했고 실제 외부 서버에는 연결하지 않았다.

## Ego에서 실행한 흐름

Space 30/p1, localhost:3100, 고정된 합성 회사·서비스·연락처를 사용했다. 비밀번호·인증 코드·세션은 증거에 기록하지 않았다.

1. 템플릿을 생성·수정·보관·복원했다. [HTML 정제 미리보기](01-html-preview.png), [개정본](02-template-revision.png), [보관 필터](03-template-archived.png), [DB의 4개 불변 개정본 대조](template-crud.json).
2. 새 이메일 초안에 템플릿 v4를 적용하고 152바이트 파일을 업로드했다. 실제 ClamAV 검사·첨부 연결 후 수신자를 적용했다. [화면](04-campaign-html-attachment.png).
3. 화면의 다운로드 링크로 [첨부파일](downloads/email-content-attachment.txt)을 받았다. 화면에서 즉시 발송하고 worker의 실제 로컬 메일 파일을 확인했다. HTML·텍스트·수신자·From·base64 첨부·암호화 원본·다운로드 바이트가 모두 일치했다. [처리 결과](05-actual-delivery.png), [독립 DB/파일 대조](actual-html-attachment.json).
4. 템플릿을 삭제했다. 현재/과거 내용은 모두 지워지고 이미 복사한 캠페인 본문은 남았다. [화면](07-template-deleted.png), [원문 제거 대조](template-erasure.json).
5. 별도 초안에서 첨부 제거 후 다시 업로드하고 초안을 삭제했다. 두 파일의 DB 상태와 실제 바이트 삭제를 확인했다. [첨부 제거](08-file-removed.png), [삭제 후 목록](09-draft-deleted.png), [DB/파일 제거](attachment-erasure.json).
6. 390px의 [템플릿](06-mobile-template.png)·[발송 상세](10-mobile-campaign.png)를 확인했다. 문서 너비 390, 화면 밖 입력·버튼 0개다. 넓은 표는 표 안에서 가로 스크롤한다. [템플릿 측정](mobile-template.json), [상세·iframe·외부 리소스 측정](mobile-campaign.json). iframe의 sandbox는 빈 값, tabIndex는 -1, CSP 기본 허용 대상은 없고 본문은 inert다. 외부 리소스 요청은 0건이었다.
7. 앱과 worker를 종료한 뒤 최종 빌드로 재시작했다. 캠페인 완료 상태·템플릿 삭제·첨부 해시가 유지됐다. [재시작 대조](restart-persistence.json), [실행 정보](runtime.json), [재시작 화면](11-restart-campaign.png).

## 남은 범위

- 실제 외부 SMTP 전달/수신, 운영 보존·백업 복원 후 재파기. 반송·complaint·수신거부의 독립 릴레이/로컬 흐름은 [후속 검증](../email-feedback/README.md)에 구현했다.
- SMS/LMS/MMS 공급자·receipt·실제 요금/잔액/한도, 결제 원장.
- S3 저장 어댑터, 발신자별 캠페인 필터 등 전체 Task의 추가 조건과 전 경로 수용 게이트.
- 원본 유료 작성기는 미관찰 상태다. 이 범위는 [12단계 독립 구현 계획](PLAN.md)에 따라 구현했다. 로컬 DB·메일함·ClamAV·파일·브라우저는 실제 실행했고, 외부 SMTP 응답은 모의 시험으로 구분한다.

## 재현

```sh
npm run db:migrate
node --env-file=.env.test.local node_modules/prisma/build/index.js migrate deploy
npm test -- tests/server/campaigns.test.ts tests/server/message-content.test.ts
npm test
npm run typecheck
npm run lint
ALLOW_LOCAL_MAIL=1 npm run build
```

[QA 보조 스크립트](../../../scripts/qa-email-content.ts)는 localhost·catchsecu_dev·로컬 메일·고정 합성 범위를 검사하며 DB는 읽기만 한다. `template` 단계는 템플릿이 v4/active일 때 실행했고, 이후 삭제 단계의 증거와 구분한다. 재시작 검증은 `node --env-file=.env.local --import tsx scripts/qa-email-content.ts restart`로 재현한다.
