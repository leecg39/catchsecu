# 발신번호·이메일 주소 CRUD 검증

2026-10-03 KST. P08-T01과 발송·파일 기반의 부분 구현 증거다. 전체 72 Task의 정식 완료는 2개이며, 외부 공급자와 선행 게이트는 남아 있다.

## 구현

- `/mail/number`, `/sms/number`를 PostgreSQL 목록·상세·등록·수정·대표 설정·중지·재인증·삭제와 연결했다. 검색, 상태 필터, 페이지 이동, 버전 충돌, 역할·회사·서비스 권한을 적용한다.
- migration 29~31: 암호화 Sender, 인증 세대·시도·기한을 가진 SenderVerification, 버전마다 필요한 불변 SenderEvent, 증빙 FileObject와 Job의 회사·서비스 바인딩.
- 이메일은 실제 주소로 보낸 10분·5회·일회 코드와 DNS TXT 확인이 모두 필요하다. 인증한 환경을 저장하고, 로컬 검증을 외부 SMTP 자격으로 사용할 수 없다. 외부 발송에는 SMTP 연결과 발신 도메인 허용 목록도 필요하다.
- 문자 번호는 해당 회사에 연결된 SOLAPI 계정에서 정확한 번호·ACTIVE·유효 기한을 조회한다. 증빙 첨부만으로 인증하지 않는다. 공급자 미설정 시 503과 안내를 반환한다.
- 증빙은 최대 5개, 각 10MB의 PDF/PNG/JPEG다. 실제 ClamAV 검사, 암호화 저장, 권한 있는 바인딩 다운로드, 파일 삭제와 실패 재처리를 연결했다.
- 예약 등록과 실제 전달 직전에 발신자 버전·상태·기한을 다시 검사한다. 사용 중 삭제는 409다. 중지·재인증 이후 이전 버전 작업은 취소된다.
- 발신자 지정 메일과 인증 메일에는 `mail.sender.v1` 작업 유형을 사용한다. 이전 처리기가 일반 메일로 보내거나 DB에서 이전 유형으로 변경할 수 없게 했다.

## 최종 자동 검증

| 검사 | 결과 | 증거 |
|---|---|---|
| PostgreSQL 전체 회귀 | **282/282**, 14 files | [전체 로그](tests-all-protocol.log) |
| 발신자 통합 | **26/26** | [발신자 로그](tests-protocol.log) |
| 타입 검사 | 통과 | [로그](typecheck-final-qa.log) |
| 린트 | 오류 0, 기존 이미지 경고 19 | [로그](lint-protocol.log) |
| 로컬 production build | 통과 | [로그](build-protocol.log) |
| migration | 개발·시험 DB 31개 적용 | [개발](migration-protocol-dev.log), [시험](migration-protocol-test.log) |
| OpenAPI | 188 paths 생성 | [로그](openapi-final.log) |
| 경로·계획 대응 | 181경로·34메뉴·72 Task, 누락·순환 없음 | [로그](plan-verification.log) |

통합 테스트는 회사/서비스 격리, 권한 회수, 중복·멱등키·버전, 코드 실패·소비·만료, 실제 UDP DNS, 대표 유일성, 환경 변경, 공급자 응답 오류, 파일 바이트·검사·삭제, DB 직접 제약 위반, 실제 From, 중지 후 예약 차단, 만료 필터 및 작업 유형 변경 금지를 다룬다. 시간 이동 시험은 발신자 판정 서비스에 적용해 로그인 세션 만료와 구분했다.

## Ego 실제 조작

Space 30/p1, `localhost:3100`, 합성 회사·서비스·주소·번호만 사용했다.

1. 이메일 등록·설명 수정 → 로컬 `.test` DNS 프로토콜 확인 → 실제 로컬 메일의 인증번호 입력 → 대표 설정. [인증 화면](01-email-verified.png), [DB 및 인증 메일 삭제 대조](verified-sender.json).
2. 확인된 이름·주소가 로컬 메일의 From에 반영됨. [전달 증거](branded-mail-delivered.json).
3. 한 시간 뒤 예약한 작업의 존재로 [삭제 차단](02-queued-delete-blocked.png). 화면에서 [사용 중지](03-email-disabled.png)한 DB 상태를 확인한 뒤 시험 작업의 시각을 앞으로 옮김. **cancelled/SUPPRESSED, 메일 파일 없음**. [순서 증거](queue-before-release.json), [차단 결과](queued-mail-blocked.json).
4. [재인증 초기화](04-renewal-reset.png), [이메일 삭제](05-email-deleted.png).
5. 문자 번호 등록 → [미설정 공급자 안내](06-sms-provider-required.png) → [증빙 검사·첨부](07-evidence-attached.png). 인증 대기 상태 유지.
6. 화면의 다운로드 링크로 받은 PNG 68바이트와 SHA-256이 원본과 일치. [다운로드 대조](evidence-download.json).
7. 증빙이 있는 번호 변경 [거부](11-number-change-blocked.png), [파일 삭제·설명 수정](12-evidence-deleted-edited.png), 재첨부.
8. 앱과 처리기를 종료·재시작한 뒤 [목록·수정 내용 보존](13-restart-persisted.png). DB에서도 첨부 상태를 재확인했다. 시험 DNS 서버는 종료했고 최종 앱에는 DNS override가 없다.
9. [문자 발신자 삭제](14-sms-deleted.png), [삭제 필터](15-deleted-filter.png). 두 증빙의 실제 암호화 파일이 사라지고 이전 다운로드는 [410](deleted-download.json).
10. 390×844: 페이지 너비 390, 관리창 client/scroll 너비 모두 342, 모든 입력이 창 안에 있음. [측정](browser-mobile.json), [관리창](09-mobile-detail-top.png), [목록](10-mobile-list.png). 넓은 표는 표 내부에서 가로 스크롤한다.

[최종 독립 검증](final-verification.json): 두 발신자 삭제, 주소/인증 원문 제거, 증빙 2개 실제 삭제, 버전별 연속 이벤트, 감사 로그 연락처 미포함, 지정 발신 메일 완료와 중지 후 취소를 확인했다. 이미 전달된 메일의 발송 기록은 발신자 설정 삭제와 별개이며 수신 근거의 보관·파기 정책을 따른다.

## 실제 검증에서 발견하고 수정한 문제

[초기 실행](initial-run/)에서는 발신 중지 후 합성 메일이 전달됐다. 같은 프로젝트에서 이전 CSV 검증 때 시작한 PID 75885가 남아 있었고, 발신자 기능 이전 코드로 일반 메일을 처리했다. 시작 시각·작업 폴더·로그·발송 결과를 [실패 증거](initial-run/initial-worker-failure.json)와 [프로세스 증거](initial-run/runtime-evidence.json)에 보존했다.

이전 처리기를 종료한 것에 더해 작업 유형 분리와 DB의 유형 변경 금지를 추가했다. migration 31은 진행 중인 해당 구형 작업을 새 유형으로 옮긴다. 최신 처리기만 실행한 뒤 전체 시험을 다시 했으며, 위 최종 결과는 수정 후 기록이다. 배포 시에는 **모든 기존 worker를 중지 → migration → 앱·worker를 같은 버전으로 재시작**해야 한다. 구형 worker가 새 유형을 집으면 전송 전에 거부하지만 재시도로 지연될 수 있다.

초기 테스트의 입력 fixture, 인증 시계 이동, 로컬 빌드 플래그 누락 및 OpenAPI 환경 변수 누락도 로그에 보존했다. 최종 통과 로그를 위 표에 명시했다.

## 검증 환경과 남은 범위

- 이메일 코드·로컬 메일 파일·PostgreSQL·UDP DNS·ClamAV·암호화 저장·Ego 화면은 실제 실행했다. DNS는 합성 `.test` 도메인에 한정한 로컬 시험 서버다. 외부 도메인 소유 확인이나 외부 이메일 수신 성공을 뜻하지 않는다.
- SOLAPI 요청 서명·응답 판정은 격리된 HTTP fixture로 시험했다. 실제 자격증명이 없어 외부 계정 조회·번호 심사 접수·SMS 발송 receipt는 검증하지 못했다. SMTP 도메인 승인과 외부 수신도 후속 검증이다.
- 캠페인 초안·대상 선택·예약 관리 화면, SMS/MMS·공급자 receipt·결제 비용은 P08-T02/T03 및 후속 Task에서 구현한다.
- 원본 등록 심사와 유료 상태는 관찰하지 못했다. [계획](PLAN.md)의 독립 계약이며 원본 내부 동작과 동일하다고 주장하지 않는다.

## 재현

```sh
# 최신 코드·migration과 단일 시험 worker 사용
npm run db:migrate
node --env-file=.env.test.local node_modules/prisma/build/index.js migrate deploy
npm test -- tests/server/senders.test.ts
npm test
npm run typecheck
npm run lint
ALLOW_LOCAL_MAIL=1 npm run build
```

`scripts/qa-sender-dns.ts`, `scripts/qa-senders.ts`는 `catchsecu_dev`, localhost, local mail과 고정 합성 범위만 허용한다. QA 보조 스크립트는 인증번호를 출력하지 않으며 입력 후 임시 파일을 제거한다. 운영 데이터에 실행하지 않는다.
