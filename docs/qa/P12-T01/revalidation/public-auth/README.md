# P12-T01 가입·이메일 확인·복구 요청 감사 — 부분 수용

2026-10-04. 한 Task씩 순차 진행하며 **P12-T01은 in_progress**다. 공식 상태는 완료16·진행41·계획15다. 이 기록은 v29의 공개 인증 경로 보완이다. [v27 조회·선택](../README.md)과 [v28 MFA·세션 종료](../auth-mutations/README.md)는 당시 실행과 소스 해시를 그대로 보존했다.

## 구현과 확인한 범위

- 가입의 계정·자격 증명·암호화 인증 메일 작업과 안전한 감사 이벤트를 한 PostgreSQL 트랜잭션에 둔다. Better Auth 1.7.7의 as-is transaction이 원래 adapter를 전달해 재정의된 create를 우회하던 문제를 수정했다.
- 라이브러리의 메일 콜백이 오류를 삼켜도 요청 scope의 실패 상태를 보존한다. 감사 저장 실패는 가입·인증 플래그·복구 증거·메일 작업을 함께 되돌리고 성공 쿠키/링크 이동을 보내지 않는다.
- 서명된 이메일 확인의 성공 302/303과 error callback을 구별한다. 잠긴 현재 계정, 실제 emailVerified 변경, 감사 저장 뒤 JWT 기한을 검사한다. 실패 후 같은 유효 링크 재시도와 동시 확인 시 실제 변경 이벤트1개를 검증했다.
- 익명 이메일 입력은 계정 소유 증명이 아니다. 재전송·복구 요청·거절된 로그인은 actorId=null이며 원문 이메일/비밀번호/토큰을 기록하지 않는다. 서명된 MFA challenge의 이메일 코드 요청은 검증된 사용자 ID로 기록한다.
- 정지·폐쇄 계정은 새 인증 메일을 큐에 넣지 않고 해당 복구 요청이 만든 증거만 제거한다. 공개 응답은 계정 존재를 구별하지 않는200을 유지한다. 인증 전 로그인403의 의도된 확인 메일과 거절 이벤트도 함께 저장한다.
- MFA challenge와 이메일 코드 큐·확인, 복구코드 소비의 최종 증거 기한을 검사한다. 감사 후 기한이 끝나면 증거/코드/새 세션을 롤백한다. 요청 제한은 롤백 밖에 유지한다. 공개 인증은 무관한/만료된 브라우저 쿠키 때문에 차단되거나 잘못된 actor를 사용하지 않는다.

## 검사 결과

[최종 회귀](tests-final.log)는 **14파일264개 통과**, 신규 공개 인증26개를 포함한다. 전체 저장소 회귀를 뜻하지 않는다. [최종 v29 빌드](build-final.log), [타입](typecheck-final.log), [변경 린트](lint-final.log), [계약](contracts-final.log), [계획](plans-final.log) 종료코드0이다. 계약289경로418operation38정책, implemented377/planned41, 계획181경로72Task다.

수정 전 [19개 기준 시험](baseline.log)은16실패/3통과였다. 첫 결합 시험은52개 중3실패였고 audited adapter가 transaction 안에서도 유지되도록 고쳐 [52개 통과](tests-attempt2.log)를 확인했다. 첫 타입 검사에서는 존재하지 않는 claimOne API를 사용한3오류가 있었으며 실제 consumeOne 계약으로 수정했다. [262개 회귀](tests-regression.log) 뒤 MFA 이메일 코드2개를 추가한 최종264개를 검증했다. pg 동시 client.query 폐기 경고는 로그에 보존했다.

```sh
NODE=/Users/user01/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$NODE --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/auth-public-audit.test.ts tests/server/auth-mutations-audit.test.ts tests/server/audit-auth-atomicity.test.ts tests/server/context-audit.test.ts tests/server/auth-session-gate.test.ts tests/server/password-policy.test.ts tests/server/audit-current-authority.test.ts tests/server/audit-events.test.ts tests/server/account-current-authority.test.ts tests/server/mfa-policy.test.ts tests/server/expert-current-authority.test.ts tests/server/auth-navigation.test.ts tests/server/foundation.test.ts tests/server/ip-access.test.ts
ALLOW_LOCAL_MAIL=1 CATCHSECU_BUILD_DIR=.local/recovery-production-v29 CATCHSECU_TSCONFIG=.local/recovery-production-v29-tsconfig.json $NODE node_modules/next/dist/bin/next build
$NODE node_modules/typescript/bin/tsc --noEmit -p .local/recovery-production-v29-tsconfig.json
python3 scripts/verify-contracts.py
python3 scripts/verify-plan.py
```

## 실제 화면·파일·독립 DB·재시작

Ego Lite TaskSpace45/p1에서 실제 가입 폼→재전송→서명된 이메일 링크→잘못된 비밀번호 거절→로그인→복구 요청→발급된 링크→비밀번호 변경→이전 비밀번호 거절→새 비밀번호 로그인→로그아웃을 조작했다. [9개 POST](browser.json)는200×7/401×2다. 처음401의 단계명이 login으로 기록된 관찰 코드 문제는 원문 status/requestId를 유지해 설명했고 이후 요청 시작 시 단계명을 저장하도록 수정했다. 가입 약관 미선택·로그아웃 확인 버튼 미클릭으로 대기한 것은 HTTP 실패로 계산하지 않는다.

사용자69a9befd-6491-4a64-857b-f0acb3d1c51d의 가입·확인은 실제 요청이다. **emailVerified를 DB fixture로 변경하지 않았다.** 암호화된 개발 메일 큐에서 해당 요청의 링크만 읽어 같은 브라우저로 사용했다. [가입 큐](link-signup.json), [재전송 큐](link-resend.json), [복구 큐](link-reset-request.json), [실제 이메일 플래그·요청 감사](confirmed.json). 외부 이메일 수신은 검증하지 않았고 전체 worker를 실행하지 않았다. 실제 링크 이동은 [확인](email-navigation.json)/[복구](reset-navigation.json)의 redirectCount1과 최종 경로만 기록한다. 브라우저에서 초기 HTTP302를 직접 캡처했다고 주장하지 않는다.

[가입 요청 화면](signup-requested.png), [확인 후 프로필](verified-profile.png), [복구 요청](reset-requested.png), [비밀번호 변경](password-changed.png)을 확인했다. 비밀 입력·서명 토큰·쿠키는 공개 증거에 포함하지 않았다.

본인 활동에서 auth.로 검색한5행, [HTTP DTO](activity-auth-http.json), [실제 CSV](activity-auth.csv)의 ID가 일치한다. 대상 ID는 null로 마스킹된다. GET 열람 감사1개와 다운로드 감사1개(rowCount5)를 [독립 대조](evidence-check.json)했다. 익명 재전송/복구/거절 이벤트는 본인 소유 활동으로 포함하지 않는다. 회사 없는 사용자의 회사 API403도 [별도 기록](company-required-http.json)했고 정상 본인 API는 /api/v1/me/audit-events다.

[1440px 화면](activity-auth-desktop.png)과 [390px 화면](activity-auth-mobile.png)을 확인했다. 표는 내부 가로 스크롤이며 documentWidth=innerWidth=390이다. [치수](activity-auth-layout.json).

최종 emailVerified=true·status=active·session0·복구증거0과 감사20건의 상태 해시는 `e36ad241251415c6cf037b90e103aa3accc1ea980b449819ba47c58d045713da`다. 자체3129 프로세스93825→4512 재시작 뒤 [DB 상태](database-restarted.json)가 [이전 상태](database.json)와 같다. [새 프로세스 HTTP](restart-http.json)의 context401/revoke-sessions401/get-session200(null), 해당 거절 요청 성공 감사0도 확인했다.

password.created/changed는 기존 DB 트리거의 원자 이벤트이며 HTTP 요청과 다른 UUID를 사용한다. 요청과 같은 ID로 기록됐다고 주장하지 않는다. v27의 두 해시와 v28의21이벤트/MFAfalse/factor0/session0 해시도 보존됐다. [v27](v27-preserved.json), [v28](v28-preserved.json). 이전 소스 스냅샷을 현재 소스로 덮어쓰지 않았다. 자체 이전3128 서버는 정리했고 사용자3100에 신호를 보내지 않았다. 커밋/푸시하지 않았다.

## 같은 Task에서 남은 조건

[현재 생산 위치 목록](event-producers.json)은238파일208호출64파일과 root-client 감사2곳이다. auth 메일 helper 호출을 포함한 AST 목록이며 호출 수는 수용 통과 수가 아니다. SQL 트리거는 별도로 대조했다.

1. 비밀번호 변경 트리거가 이전 세션을 직접 삭제하지만 각 session.ended를 만들지 않는 실제 경로를 보완해야 한다. 비밀번호 감사의 요청 상관 ID도 현재 독립 UUID다.
2. 공지 첨부·가이드 다운로드의 현재 권한/최종 기한·감사 원자성과 나머지 변경·민감 열람·발송·권한·파기 생산 경로를 매핑해야 한다.
3. 인증 메일은 큐 저장까지 검증했다. 처리기·외부 공급자 전달과 다른 활성 인증 endpoint의 생산 범위는 남아 있다.
4. 로그10개 화면의 종류별 실제 기록·필터·역할·빈 결과·오류 복구 전체 수용은 남아 있다. 이번 범위는 본인 활동 화면이다.

일반 사용자 원장 UPDATE/DELETE 거부와 P12-T03 완료 수용은 기존 기록을 유지한다. 이 부분 수용을 P12-T01 전체 완료로 확대하지 않으며 goal은 active다.
