# P12-T01 인증 변경·세션 종료 감사 — 부분 수용 검증

2026-10-04. 한 Task씩 순차 진행 중이다. **P12-T01은 in_progress**이며 공식 상태는 완료16·진행41·계획15다. 이 기록은 MFA 설정/확인/해제, 복구코드 소비, 로그아웃·세션 삭제·유휴 만료의 보완 범위다. 이전 [v27 조회·선택 검증](../README.md)과 summary.json은 당시 소스/실행의 스냅샷으로 보존했다.

## 구현과 수용

- 실제 Better Auth 1.7.7의 adapter/hook/요청을 동일한 PostgreSQL 트랜잭션에 묶었다. MFA flag·TwoFactor secret/backup/verified·다른 기기 회수·현재 세션 회전·Verification 소비와 감사가 함께 저장되거나 함께 되돌아간다. detail에는 변경 필드명과 회수 건수만 저장한다.
- 라이브러리의 sign-out은 세션 삭제 오류를 삼키고200을 반환할 수 있다. 별도 실패 상태를 유지해 감사 저장 실패 시 삭제를 롤백하고500을 반환하며 성공 쿠키를 보내지 않는다. 재로그아웃으로 종료 이벤트를 중복 생성하지 않는다.
- 잘못된 인증코드의401은 라이브러리의 실패 횟수를 보존한다. 감사 실패·500·변경 후 실패·최종 세션 기한 만료는 전체 변경을 롤백한다. 요청 제한의 CAS 전체를 인증/비밀번호 트랜잭션 밖에서 실행해 실패 후에도 제한 횟수를 유지한다.
- 계정과 회사 정책을 잠그고 현재 상태를 검증한다. 세션 일괄 회수는 명시적1000행 페이지를 모두 읽으며, 계정 잠금을 기다리는 동안 완료된 로그인까지 잠금 후 다시 조회한다.1004개 종료 이벤트와 실제 DB 잠금 대기를 이용한 동시 로그인/회수 시험을 통과했다.
- 유휴 만료의 세션 삭제와 session.ended도 한 트랜잭션이다. 일반 get-session 만료 기록은 별도 감사 상관 ID를 사용하며 HTTP 요청 ID와 동일하다고 주장하지 않는다. 사용자 전체 MFA 내부 API 호출로 보호된 요청을 우회할 수 없다.

## 실행 결과

[최종 회귀](tests-regression-final.log):11파일163개 통과. 신규 인증 변경20개와 기존 감사/선택/세션/비밀번호/계정/회사 MFA/전문가/인증 내비게이션을 검사했다. 전체 저장소 회귀를 실행했다는 뜻은 아니다. [v28 빌드](build-v28.log), [타입](typecheck-v28.log), [변경 린트](lint-v28.log), [계약](contracts-final.log), [계획](plans-final.log) 종료코드0이다. 계약289경로·418operation·38정책(implemented377/planned41), 계획181경로·72Task다. Next16.3.8을 사용했다.

첫 [인증 시험](tests-attempt1.log)은19개 중 요청 제한1개가 실패했다. 전체 CAS를 scope 밖으로 옮긴 뒤19개 통과, 추가 만료/동시 회수 시험 후22개 통과했다. 첫 [결합 회귀](tests-regression.log)는163개 중 비밀번호 시험의 기존400×10 기대1개가 실패했다. 유지되는 라이브러리 제한은3회 후429이므로400×3/429×7과 별도 사용자 제한 count11을 확인하도록 고쳤다. 최종163개가 통과했다. pg의 동시 client.query 폐기 경고가 있었으며 숨기지 않았다. 계획 검사 첫 명령은 존재하지 않는 파일을 지정해 실패했고, 실제 scripts/verify-plan.py로 바로잡았다. [실패 기록](plans-attempt1.log).

```sh
NODE=/Users/user01/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$NODE --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/auth-mutations-audit.test.ts tests/server/audit-auth-atomicity.test.ts tests/server/context-audit.test.ts tests/server/auth-session-gate.test.ts tests/server/password-policy.test.ts tests/server/audit-current-authority.test.ts tests/server/audit-events.test.ts tests/server/account-current-authority.test.ts tests/server/mfa-policy.test.ts tests/server/expert-current-authority.test.ts tests/server/auth-navigation.test.ts
ALLOW_LOCAL_MAIL=1 CATCHSECU_BUILD_DIR=.local/recovery-production-v28 CATCHSECU_TSCONFIG=.local/recovery-production-v28-tsconfig.json $NODE node_modules/next/dist/bin/next build
$NODE node_modules/typescript/bin/tsc --noEmit -p .local/recovery-production-v28-tsconfig.json
python3 scripts/verify-contracts.py
python3 scripts/verify-plan.py
```

## 실제 Ego 화면·파일·독립 DB·재시작

기존 Ego Lite TaskSpace45/p1만 사용했다. 별도 합성 사용자2b3ebce5-0f02-4e03-ba5a-f0a74a5b0c4c/회사968f98e9-3f15-4e71-bf06-a6ec592fefc7다. 가입·일반 로그인·회사 생성은 실제 API다. 이메일 인증은 명시적 DB fixture이며 외부 이메일 인증 성공을 뜻하지 않는다. 전체 worker는 실행하지 않았다. [설정](setup.json).

실제 로그인→MFA 등록→TOTP 확인→로그아웃→MFA 로그인→복구코드 입력→해제→로그아웃의8개 UI POST가 모두200이었다. [UI 요청](browser.json). 등록 뒤 factor verified=true·사용자 flag=true·현재 세션1개·보조 기기 삭제를 독립 SQL로 확인했다. [등록 상태](enrolled-state.json), [프로필 화면](enrolled-profile.png), [해제 화면](disabled-mfa.png). MFA 로그인은 라이브러리가 임시 세션을 생성/종료한 뒤 challenge를 발급하며, 해당 session.created/session.ended를 같은 요청 ID로 확인했다. 전용 challenge 이벤트의 전체 매핑은 다음 범위에 남아 있다.

접속 이력의 회사 기록18행과 실제 내려받은 CSV18행의 ID가 일치한다. GET 열람 감사1개와 CSV 출력 감사1개(rowCount18)를 독립 DB로 대조했다. [HTTP DTO](access-http.json), [CSV](access.csv), [감사 대조](access-audit.json), [ID 검사](evidence-check.json). [1440px](access-desktop.png)/[390px](access-mobile.png)에서 표 내부 스크롤을 확인했고 documentWidth=innerWidth=390이다. [치수](mobile.json). 비밀번호·TOTP키·복구코드·쿠키는 .local의0600 파일에만 보관했고 화면 증거는 키/코드가 없는 페이지에서 촬영했다.

최종 사용자 MFA=false·factor0·session0과 요청에 연결된 감사21건의 상태 해시는 `b0228be6746cd9fa2aa3e9238831690af4281f907df9f9bfb3d56837155c86dd`다.3128의 자체 QA 프로세스82181→84928 재시작 뒤 [독립 DB](database-restarted.json)가 [이전 DB](database.json)와 같다. 로그아웃 상태에서 context401/revoke-sessions401/get-session200(null)의3건을 확인했으며 성공 감사는0이다. [새 프로세스 HTTP](restart-http.json).

기존 v27 선택·감사 해시bb213455…ed4와 접근/서비스 해시6ec87161…056도 유지됐다. [이전 데이터 보존](legacy-preserved.json). 월마감 fixture와 원래 owner의 MFA를 변경하지 않았다. 사용자3100에는 신호를 보내지 않았고 자체3127을 정리했다. 커밋/푸시하지 않았다.

## 같은 Task의 남은 범위

[AST 생산 위치 목록](event-producers.json)은238파일/198호출/64파일이며 root-client 감사 쓰기2곳(공지 첨부/가이드 다운로드)이 남아 있다. 호출 존재는 모든 이벤트의 원자성·누락 없음의 증거가 아니다.

1. 가입·이메일 확인·복구 요청/인증 challenge·거절된 로그인 등 나머지 인증 이벤트를 실제 endpoint별로 매핑한다.
2. 남은 변경·민감 열람·발송·권한·파기 생산 경로의 감사 누락/원자성과 공지 첨부·가이드 다운로드를 검증한다.
3. 로그10개 화면의 종류별 실제 기록·필터·역할·빈 결과·실패 복구 수용을 완료한다.

일반 사용자 원장 U/D 차단과 월마감 PDF/CSV의 기존 수용은 유지한다. 이 부분 검증을 P12-T01 전체 완료로 확대하지 않는다. 전체 목표는 active다.
