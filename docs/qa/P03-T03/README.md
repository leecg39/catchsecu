# P03-T03 프로필·계정 폐쇄·본인 활동 — 진행 중

2026-10-03. 서버·데이터 모델·화면을 구현했다. 선행 P03-T02와 본 항목의 브라우저 조작 게이트가 남아 공식 완료에 포함하지 않는다.

## 구현한 기능

- 프로필의 이름·부서·직책·연락처·언어를 version으로 저장한다. Migration 54에 직책 필드와 100자 DB 제약을 추가했다. 실제 회사명도 프로필에서 표시한다. 이메일·계정 상태·운영자 권한 변경은 거부한다. 프로필에서 암호·2단계 인증·로그인 기기·본인 활동·탈퇴 화면으로 이동한다.
- `/me/audit-events`와 `/me/audit-events/export`는 회사 소속 없이 본인 이벤트의 시각·처리내용·처리대상만 반환한다. 다른 처리자·회사/서비스 식별자·원문 detail은 제외한다. 서버 검색·기간·페이지, 종료 시각 미포함, 동일 필터 CSV·5,000건 상한·수식 방어를 적용했다.
- `/me/closure` GET은 본인 계정의 소유권 인계·운영자 인계·암호 인증 조건을 조회한다. POST는 현재 암호·정확한 로그인 이메일·version·살아 있는 세션을 검증한다. 소유 회사가 남았거나 마지막 플랫폼 운영자이면 폐쇄를 거부한다.
- 계정 폐쇄는 하나의 PostgreSQL transaction에서 모든 회사의 구성원·서비스 권한·전문가 배정·관련 초대·세션·credential/OAuth 정보·2단계 인증 자료·암호 이력·재설정 증거를 회수하고 계정을 `closed`로 바꾼다. 회사 업무 자료·감사·배정 이력은 남긴다. 회사 자료 삭제를 계정 탈퇴의 완료로 표시하지 않는다.
- Migration 53의 `AccountClosure`에 폐쇄 시각과 암호화한 선택 사유를 저장한다. 완료 기록 변경/삭제, 폐쇄 계정 재활성화, 폐쇄 계정의 활성 구성원/세션 생성은 DB에서 거부한다. 회사 소유권 인계는 기존 마지막 owner 보호와 회사 잠금으로 검사하고 암호 변경/재설정은 같은 계정 잠금으로 직렬화한다.
- 폐쇄 후 세션·로그인·암호 재설정·이메일 인증 링크와 같은 이메일의 재가입을 통한 복구를 거부한다. 운영자 두 명이 동시에 폐쇄해도 한 명의 활성 운영자를 유지한다.

## 검증 근거

- `server-tests.txt`: 실제 분리된 PostgreSQL에서 신규 시험 8개 통과. 프로필 저장·새 세션 유지·허용 필드, 본인 활동 격리·기간·페이지·CSV, 기기 회수, owner 인계, 암호/이메일/version/세션 검증, 계정 폐쇄·링크 차단·DB 불변성, 전문가 회수, 운영자 동시 폐쇄를 확인했다.
- `full-test.txt`, `full-test.json`: 최신 전체 PostgreSQL 회귀 33개 파일·478개 시험 통과.
- `unauthenticated.txt`, `../P02-T05/unauthenticated.json`: API 190회 호출에서 health·readiness 2개만 공개이고 188개는 미인증 차단됐다.
- `http-prepare.json`: production HTTP 7개 확인 항목 통과. 프로필·편집·탈퇴·본인 활동 화면의 HTTP 200과 프로필 서버 저장을 확인했다.
- `restart.json`, `http-finish.json`: production 서버를 PID 74952에서 75975로 재시작했다. 다시 로그인한 HTTP 17개 확인 항목에서 프로필 유지·소유권 인계·암호 재확인·본인 활동/CSV·로컬 worker의 재설정 메일·폐쇄·세션/로그인/재설정 링크 차단을 확인했다. 별도 DB 연결에서 계정 closed, 세션/credential/활성 구성원/grant 각각 0개, 폐쇄 기록 1개, 새 owner 1명과 활성 회사·서비스 자료 유지를 대조했다.
- `migrations.txt`: Migration 53의 빈 설치·52→53 업그레이드·실패 복구 검증. `profile-job-title-migrations.txt`, `../P01-T01/db-rehearsal.json`: 최신 shadow DB의 빈 설치 54개, 53→54 업그레이드, 실패 migration 롤백·복구·seed·복합 FK 검증 통과.
- `profile-job-title-tests.txt`: 기존 8개 시험에 직책 저장·새 세션 조회·API/DB 101자 거부·빈 값으로 삭제를 추가해 통과했다. `profile-job-title-typecheck.txt`: 타입 검사 통과.
- `../P04-T01/http-prepare.json`, `../P04-T01/http-finish.json`, `../P04-T01/restart.json`: 직책을 production HTTP로 저장하고 PID 4811→5420 재시작 후 새 로그인·조회·독립 DB에서 유지됨을 확인했다. 이 시점의 전체 회귀는 34개 파일·488개였다. 질문 규칙 구현 후 최신 전체 회귀는 `../P04-T01/questions-full-test.txt`의 35개 파일·498개 시험 통과다.
- `typecheck.txt`, `lint.txt`, `http-lint.txt`, `build.txt`: 타입·변경 파일 ESLint 오류 0·production 빌드 통과.

HTTP 시험은 이전 P03-T02에서 만든 합성 계정의 소유권을 합성 구성원에게 이전한 후 합성 소유자 계정을 폐쇄했다. 사용자 관리자 계정과 브라우저 세션은 변경하지 않았다. 암호·쿠키·메일 링크는 출력하지 않고 `.local/`은 Git에서 제외했다. 외부 SMTP와 회사 자료의 물리 파기는 이 증거에 포함하지 않는다.

실제 화면의 입력·오류·뒤로가기·모바일 검증은 Ego 제어 재개 응답을 기다린다. HTTP 200과 API/DB 시험을 브라우저 조작 증거로 집계하지 않는다. 개인정보 활동 검토 이력은 일반 본인 활동과 별도 계약이 필요하다. 원본은 빈 표와 잘못된 접근 안내만 관찰해 수신·검토·발송 계약을 확정하지 않았다. 인증 수단이 비밀번호 없는 SSO뿐인 계정의 재인증·폐쇄는 P11-T04의 실제 IdP 연결 후 검증할 범위다.

재현은 새 합성 계정이 필요하다. `qa-member-management.ts` → `qa-member-archived-service.ts` → `qa-account-closure.ts prepare` → production 서버 재시작 → `qa-account-closure.ts finish` 순서로 실행한다. 모든 스크립트는 로컬 개발 DB만 허용하며 메일 worker는 다른 사용자의 대기 작업이 있으면 중단한다.
