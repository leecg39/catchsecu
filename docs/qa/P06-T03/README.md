# P06-T03 첨부파일 실저장·열람

> **완료 판정 정정 (2026-10-04): 미완료.** 0934f4e의 일괄 완료 표시는 수용 조건의 증거를 충족하지 못해 철회했다. 아래 구현·시험 주장은 각 실제 파일/실행 결과와 다시 대조한다. 테스트 파일의 존재는 실행 통과나 브라우저/외부 연동 완료를 뜻하지 않는다. [재검증 계획](../../planning/05-completion-recovery.md).

2026-10-04. 현재 단계는 **진행 중**, 정식 완료는 **15/72**다. 아래는 독립 합성 계정과 실제 PostgreSQL·ClamAV·로컬 암호화 저장소에서 확인한 결과다. 정상 원본 대조·Ego 조작·선행 전체 게이트·운영 저장소까지 통과한 것으로 집계하지 않는다.

[검증 manifest](verification.json)에는 소스·결과 파일 SHA-256과 현재 빌드/서버를 기록한다. [독립 재대조](manifest-check.json)는 실제 파일의 해시·최종 시험/API 집계·작업 상태를 다시 확인한다.

## 보완한 동작

- 기존 Context로 로그인 사용자의 파일을 읽거나 변경할 때 현재 계정·이메일 인증·회사 소속/선택·역할·서비스 권한·세션·보안 정책을 잠금 아래 재검사한다. 로그아웃, 세션/비활동 만료, MFA 요구, 비밀번호 변경 요구를 이전 Context로 우회하지 못한다.
- 로그인 요청과 작업/외부 공유 발급자의 검사 함수를 구분했다. 처리기와 외부 공유는 발급자의 현재 권한을 검사하며 로그인 세션을 요구하지 않는다. 발급자의 이메일 인증 회수도 기존 공유 인증을 차단한다.
- 사용자/세션 변경과 파일 행 잠금을 실제로 기다린 뒤 최신 상태와 실제 기한을 검사한다. 저장소 읽기·쓰기와 감사 저장이 끝난 뒤에도 기한을 확인한다. 만료된 요청은 파일 이름/바이트를 반환하지 않고 해당 트랜잭션의 변경과 성공 감사를 롤백한다.
- 개인·공유 파일 API가 응답·질문 stableKey·파일의 정확한 조합을 확인한다. 중복 또는 알 수 없는 파일 쿼리는 422다. 공유되지 않은 질문의 파일은 404다.
- 제출된 파일은 동의/정정/파기 증거로 관리한다. 제출 전 구성원 파일의 생성·조회·이름 변경·삭제는 가능하며 첨부된 증거의 개별 삭제는 허용하지 않는다.

## 실행 검증

- [gate-before-current.txt](gate-before-current.txt): 수정 전 신규 경계 17개가 실패했다. Session/User 변경을 기다리지 않고 200을 반환했고, 파일 잠금 대기 중 만료와 저장소 읽기 중 만료도 200이었다. 최초 시험의 게시 버전 ID fixture 오류는 제품 수정 전에 고쳐 재현을 다시 수행했다.
- [gate-after.txt](gate-after.txt): 당시 파일·공유·비동기 내보내기 4파일 70개 통과.
- [gate-final.txt](gate-final.txt): 파일 경계 20개와 캠페인/발신자 81개, 3파일 101개 통과. 이후 공유 감사 지연 경계 2개를 추가한 [gate-viewer-final.txt](gate-viewer-final.txt)는 파일 경계 22개·공유 20개, 2파일 42개 통과.
- [lock-barriers.json](lock-barriers.json): 네 경로 모두 실제 대기 1개를 관측했다. 사용자/세션 회수와 파일 대기 중 세션 만료는 401, 응답 보유 기한 만료는 410이다. 가짜 시계로 대기/만료를 대신하지 않았다.
- [full.json](full.json), [full.txt](full.txt): 최종 전체 회귀 **50파일·666개 통과**, 실패/대기 0, 470.03초. [집계](full-summary.json)는 최종 JSON의 개별 파일과 결과를 대조한다.
- [typecheck-current.txt](typecheck-current.txt), [lint-current.txt](lint-current.txt), [database-lint.txt](database-lint.txt), [build-final.txt](build-final.txt): 타입·변경 파일 린트·production 빌드 확인 기록. 빌드 ID와 소스 해시는 [build-sources.json](build-sources.json)에 기록한다.
- [contracts.txt](contracts.txt): 256경로·372작업·32정책, 구현 320/계획 52와 계약 누락 0. [plan.txt](plan.txt): 181경로·34메뉴·72작업, 의존 순환 0. 원본 제한 128개와 sourceRevisited=false를 유지한다.

초기 전체 회귀 [full-before.json](full-before.json)은 663개 중 2개가 실패했다. 31/91일 뒤에도 예전 로그인 Context로 조회하던 캠페인/발신자 fixture다. 만료된 Context가 401인지 추가로 확인하고, 캠페인은 실제 시점에서 이미 파기된 상태를 조회한다. 발신자는 해당 격리 시험에서 지원하는 비밀번호 회전 없음 정책과 실제 신규 가입/로그인으로 만료 필터를 확인하며 원래 정책을 복원한다. DB 제약과 원본 검증을 끄지 않았다.

## 실제 HTTP·재시작·독립 DB

[http-prepare.json](http-prepare.json) 62건과 [http-finish.json](http-finish.json) 9건, 최신 빌드에서 **71건 통과**했다. 이메일 인증 링크·로그인·회사 등록·폼 게시·ClamAV 첨부 2개·접수 1건·개인/공유 목록/메타/원본 바이트·ID 조합 변조·쿼리 변조를 실제 HTTP로 확인했다. 미제출 구성원 파일의 이름 변경·이전 버전 409·실제 객체 삭제·첨부 삭제 거부·공유 회수·실제 시간 만료·로그아웃을 검증했다.

실제 서버 PID **82909→84609** 재시작 후 개인/공유 다운로드 SHA-256, 폼·응답·암호화 답변·영수증·파일의 업무 해시는 같았다. 앞선 단계의 기존 원본 응답도 변경되지 않았다. file-view 네 주소의 HTML 응답은 200이지만, 이 확인을 브라우저 조작으로 집계하지 않는다.

[database-current.json](database-current.json)은 별도 SQL/저장소 조회로 접수 1건·영수증 1건·첨부 2개·삭제 파일 1개·사용자 세션 0을 확인한다. 첨부는 실제 바이트/크기/SHA가 DB와 같고 CSF1 암호화 객체에 평문이 없다. 객체 0600·폴더 0700이며 삭제한 객체는 없다. 제출 파일의 업로드 권한은 null이다. 비밀 checkpoint는 비공개 .local의 0600 파일에만 둔다.

이전 빌드의 [earlier/](earlier/) 기록은 별도로 보존한다. 최초 재시작 검증은 정상 로그아웃 204를 200으로 예상한 QA 오류로 멈췄다. 실제 회수된 쿠키의 거부를 확인하고 새 공유 인증·재시작으로 복구했다. 최종 빌드에서는 전체 합성 흐름과 재시작을 새 계정으로 다시 실행했으며 그 이전 기록은 위 71건에 포함하지 않는다.

## 모델·migration

데이터 모델과 DDL은 동일하다. 59개 migration의 적용/소스 SHA-256을 대조해 인증 ID migration 한 파일의 마지막 빈 줄 차이를 발견했다. 로컬 개발·시험 DB 모두 원본에 빈 줄 하나가 더 있었던 동일 SHA를 보관했다. SQL 문장을 바꾸지 않고 마지막 LF 1바이트를 복원해 59개 모두 적용 SHA와 일치시켰다. 이력 테이블을 수정하거나 SQL을 다시 실행하지 않았다. [발견 기록](database-checksum-before.json)과 [개발 DB 대조](database-current.json), [시험 DB 59개 읽기 전용 대조](test-database-migrations.json)를 보존한다. [diff-standard.txt](diff-standard.txt)의 EOF 빈 줄 경고는 적용 이력을 보존하기 위한 명시적 예외다. 다른 파일은 [diff-rest.txt](diff-rest.txt), 해당 migration의 나머지 공백은 [diff-migration.txt](diff-migration.txt)에서 오류 0이다.

## 남은 완료 게이트

- P06-T01의 선행/전체 수용조건, 정상 원본의 업로드·열람·모바일 동작 대조.
- 명시적 Ego TaskSpace 34 재개 승인 후 파일 선택·다운로드·인증 이동과 저장소 초기화/권한 오류의 UI 조작.
- 실제 운영 S3/외부 저장소, 보존·파기 운영 조건. 로컬 성공과 기존 S3 어댑터/서명 시험으로 외부 환경 성공을 대신하지 않는다.

Ego skill의 중단 규칙 때문에 이 단계에서 브라우저를 호출하거나 새 창/다른 브라우저로 우회하지 않았다. 사용자 관리자 계정과 기존 회사 자료를 바꾸지 않았다. 전역 발송/파기 worker를 실행하지 않았으며 내보내기 전용 worker만 유지했다. 목표는 active다.

## file-view 네 경로 라이브 보강 (2026-10-04 추가)

`scripts/qa-file-view-routes.ts` — P06 체크포인트 합성 회사의 실제 응답·파일 fixture로 측정:

| 경로/API | 결과 |
|---|---|
| `/file-view/{sub}`·`/shared`·`/{sub}/{q}/{file}`·`…/shared` | 전부 200(셸) |
| `GET /api/v1/files?submissionId=`(소유자) | 200 · 첨부 2건 |
| `GET /api/v1/files/{id}?submissionId&questionId`(소유자) | 200 |
| `GET /api/v1/files/{id}/download`(소유자) | 200 text/plain 실바이트 |
| 익명 `/api/v1/files` | 401 UNAUTHENTICATED |
| 익명 `/api/v1/viewer/files*` | 401 VIEWER_AUTH_REQUIRED(공유 열람 세션 별도) |
| 타 회사 owner가 타사 submission 조회 | 404 NOT_FOUND(격리) |

외부 S3 업로드·본인인증 게이트는 기존과 동일하게 로컬 범위 한정.
