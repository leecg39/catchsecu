# 계정 탈퇴·본인 활동·기기 관리 후속 검증

2026-10-04. P03-T03 부분 구현이며 전체 Task/목표 완료가 아니다.

## 변경과 회귀

- 탈퇴 조건/기기 목록/기기 회수/본인 활동 목록·CSV에서 현재 계정과 세션을 트랜잭션 안에서 재확인한다. 폐기된 인증 스냅샷으로 조회·삭제·내보내기를 할 수 없다.
- 상호 기기 회수는 사용자 잠금으로 직렬화해 한쪽만 성공한다. 본인 활동의 마지막 빈 페이지를 보정하고 UI 페이지·행 번호에 서버 값을 적용한다.
- 계정 폐쇄는 현재 세션을 잠그고 마지막 기한 검사까지 수행한다. 암호 확인 중 만료되면 폐쇄/권한/자격증명/감사를 함께 롤백한다. 운영자 폐쇄 공통 잠금은 이전 요청의 platformAdmin 값에 의존하지 않는다.
- 수정 전 신규 6개 모두 실패 (`account-authority-before.json/log`), 수정 후 관련 22개 통과 (`account-authority-after.json/log`). 상호 기기 회수/페이지 검사를 더한 **최종 관련 5파일 36개 통과, 실패 0** (`account-related-final.json/log`). 신규는 8개이며 전체 저장소 테스트와 구분한다.
- 최신 production 빌드/내장 타입 검사 통과 (`account-build.log`), 변경 파일 lint 통과 (`account-lint.log`, `account-test-lint-final.log`), diff 검사 통과.
- 추가 시험의 AuditEvent fixture에 필수 detail 누락으로 35개 통과/1개 실패와 타입 오류가 있었다. 시험 데이터를 수정해 재실행했다 (`account-related-fixture-error.json/log`, `account-build-fixture-error.log`). 제품 성공으로 집계하지 않는다.

## 실제 UI·HTTP·DB

Ego 45/p1, production 3106, `.local/recovery-production-v5`를 사용했다. 기존 합성 owner는 탈퇴하지 않았고 별도 합성 계정 한 개만 폐쇄했다.

- owner 화면: 소유 회사 안내와 탈퇴 버튼 disabled (`browser-closure-owner-blocked.txt`).
- 별도 계정의 프로필에서 “Recovery secondary session” 기기를 로그인 해제 → 이전 HTTP 세션 401 (`browser-session-revoked.txt`, `account-revoked-http.json`).
- 본인 활동에 session.revoked 기록 → 동일 검색 필터 → 실제 CSV 파일 1행 다운로드 (`browser-own-activity.txt`, `browser-own-activity-filtered.txt`, `own-activity-filtered.csv`). 다른 session.created 행은 파일에서 제외됨을 확인했다.
- 잘못된 암호로 탈퇴 거부 → 올바른 이메일/암호/확인 체크로 폐쇄 → 로그인 화면 이동 (`browser-closure-password-denied.txt`, `browser-closure-complete.txt/png`). 완료 캡처를 시각 확인했다.
- 탈퇴 전에 추가로 발급한 HTTP 세션은 401, 같은 계정의 새 로그인도 401 (`account-closed-http.json`).
- 독립 DB: user closed, session/credential/activeMembership/grant/2FA/passwordHistory 각각 0, AccountClosure 1. 회사 active 및 기존 합성 구성원 3개의 역할/버전/상태/grant가 이전 스냅샷과 같았다 (`closure-before-restart.json`).
- 서버 PID 92221→97149 재시작 후 폐쇄·권한·감사·회사 상태 해시가 동일했고 이전 세션/로그인 401을 다시 확인했다 (`closure-after-restart.json`, `account-closed-http.json`).

별도 계정은 HTTP 가입 후 이메일 인증을 fixture에서 설정했다. 초기 fixture의 nested grant에 중복 tenantId를 넣어 실패했으며, 생성된 동일 계정을 재사용하고 시험 암호를 다시 설정해 준비를 마쳤다. 신규 가입 이메일 검증·외부 전달 증거가 아니다. 시험 암호와 쿠키는 `.local` 파일에만 저장했다.

## 남은 범위

개인정보 활동 검토 이력은 아직 별도 workflow/모델/API/UI가 없는 빈 표다. SSO만 있는 계정의 탈퇴 재인증, 선행 Task/외부 연동·추가 브라우저 게이트도 미완료다. 기존 프로필 검증은 [README](README.md)와 별도 결과를 유지한다.

## 재현

```sh
qa_node=/Users/user01/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$qa_node" --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/account-current-authority.test.ts tests/server/account-closure.test.ts tests/server/profile-current-authority.test.ts tests/server/audit-events.test.ts tests/server/auth-session-gate.test.ts
ALLOW_LOCAL_MAIL=1 CATCHSECU_BUILD_DIR=.local/recovery-production-v5 CATCHSECU_TSCONFIG=.local/recovery-production-v5-tsconfig.json "$qa_node" node_modules/next/dist/bin/next build
```

실행 중 빌드 디렉터리를 덮어쓰지 않는다. 후속 QA 서버 3106 PID 97149 / exec session 73231을 유지한다. 이전 QA 3105는 종료했고 기존 사용자 서버 3100은 그대로다. Ego 45/p1은 폐쇄 후 로그인 화면(1440px)에 있다. 다음 작업에서 실제 상태를 다시 확인한다. 폐쇄 fixture `.local/recovery-closure.json`은 다시 로그인할 수 없으므로 재사용하지 않는다. 기존 `.local/recovery-members.json`의 owner/member/expert는 유지한다.
