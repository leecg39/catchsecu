# P03-T04 재위탁 발송 이력 재검증

2026-10-04. 부분 구현 및 검증이다. Task 상태는 `in_progress`이며 전체 완료가 아니다.

## 발견·수정

기존 API는 수신자 주소록의 현재 이메일과 갱신되지 않는 notice.status를 읽었다. 주소 수정 후 과거 발송 주소가 바뀌고, 실제 메일 작업 완료 후에도 queued가 표시됐다. 신규 회귀 검사 2개에서 두 문제를 재현했다(`history-before.log`).

이력은 같은 회사·정확한 안내 ID에 연결된 Job의 상태와 암호화된 발송 당시 주소를 사용한다. 작업이 없거나 원문이 삭제되면 확인 불가로 표시하며 현재 주소로 대체하지 않는다. 처리 중·재시도·실패·취소를 구분한다. done은 ‘전송 처리 완료’이고 수신함 도착 증거가 아니다. 로컬 미리보기와 실제 수신을 구분하는 안내를 표시했다. 본문·암호문은 응답에 포함하지 않는다.

화면의 첫 50건 클라이언트 페이지 제한을 서버 페이지 조회로 바꿨다. 전체 건수·요청/처리 일시·새로고침·빈 목록·오류와 수신자 목록 비동기 오류 재조회도 연결했다.

## 자동 검증

Node 24.19.0, 격리 PostgreSQL catchsecu_test. `tests/server/subprocessor-notices.test.ts`, `documents.test.ts`, `form-documents.test.ts` 3파일 41개 통과(`history-final.log`). 재위탁 5개에는 기존 권한/중복/보관 검사와 실제 로컬 worker 완료, 주소 변경 후 이력 보존, 상태별 표시, 원문 삭제/작업 누락, 52건 페이지 보정, 회사/서비스/작업 연결 격리가 포함된다. retry/dead/cancelled/leased는 상태 fixture 검사이며 공급자 실패를 실재현한 증거가 아니다.

초기 수정 검증의 1개 실패는 실행 가능한 작업을 원문 삭제 상태로 만드는 시험 fixture가 DB 제약에 걸린 것이다(`history-related.log`). 추가 시험의 회사 연결 변경 fixture도 불변 제약으로 실패했다(`history-binding-fixture-error.log`). 적법한 별도 작업 참조 fixture로 바꿔 재실행했다. 최초 빌드의 시험 tuple 타입 오류도 수정했다(`build-test-type-error.log`). 실패 기록은 보존했다.

최종 isolated production build와 TypeScript 통과(`build.log`), 변경 4파일 린트 통과(`lint-final.log`). 전체 저장소 회귀는 이번 범위에 포함하지 않았다. Prisma schema/migration 변경 없음.

## 실제 화면·DB

Ego 기존 공간45/p1, production port3107, .local/recovery-production-v6. 합성 회사 6d8eed27/서비스 A에서 UI 수신자 등록→안내 요청→대기 이력을 확인했다. 명시한 회사/작업 한 건만 로컬 worker로 처리했다(`local-mail.json`). 외부 SMTP 발송은 하지 않았다.

수신자 주소를 별도 HTTP PATCH로 변경 후 UI 새로고침에서 원래 주소와 ‘전송 처리 완료’, 완료 시각을 확인했다. 수신자 수정 UI 검증으로 세지 않는다. 추가 51행은 페이지 시험용 DB fixture이며 발송을 요청하지 않았다. 화면에서 전체52건과 50행 기준 두 번째 페이지의 51/52행, 서비스 B의 빈 목록, A 복귀 후 첫 페이지를 확인했다. 1440px/390px 스크린샷을 시각 검사했고 문서 가로폭은 390px였다. 표는 내부 가로 스크롤이다.

서버8936 종료→11553 재시작 뒤 52개 이력/수신자 version2/Job done의 DB 해시가 일치했고 화면 재조회도 유지됐다. 해시·판정은 summary.json 및 db-seed-pages.json/db-state.json에 있다. 이전 자체 검증 서버3106도 종료했으며 기존 사용자3100은 유지했다.

## 남은 조건

수신자 수정·보관·복원 화면과 100건 이후 수신자 선택, 최신 동의 표시 탭별 복원/잘못된 URL/타서비스 문서 UI, 현재 권한/기한/재요청 경계, 선행 P05-T02와 실제 SMTP P09-T02 및 전체 공통 게이트가 남아 있다. 이 부분 검증을 전체 Task 완료로 처리하지 않는다.

후속: 수신자 관리 UI/100건 이후 선택·주소 버전 검사를 추가 구현하고 검증했다. 최신 범위와 남은 조건은 [수신자 관리 검증](recipient-README.md)을 따른다. 위 기록은 최초 발송 이력 검증 당시의 범위다.
