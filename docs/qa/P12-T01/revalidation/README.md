# P12-T01 감사 조회·인증·선택의 현재 권한 보완

2026-10-04. P12-T01은 **진행 중**이다. 전체 상태는 완료16 / 진행41 / 계획15다. 이 기록은 아래 변경의 수용 증거이며 모든 이벤트 생산 경로의 완료 증거가 아니다. 한 Task씩 진행하며 다음 작업도 P12-T01의 인증 감사 경로다.

## 구현

- 회사 감사 목록과 CSV를 RepeatableRead 안에서 처리한다. 현재 계정·세션·회사·역할·grant·MFA·비밀번호 정책을 다시 검사하고, 서비스명·처리자 마스킹·행 필터·페이지 보정과 감사 쓰기를 같은 트랜잭션에 둔다. 반환 직전 기한을 다시 검사한다.
- 회사/본인 감사 목록에 `audit.viewed`를 기록한다. 조회 결과의 count/rows를 먼저 확정하고 열람 이벤트를 추가하므로 현재 요청의 새 이벤트가 그 요청의 목록에 끼어들지 않는다. 감사 상세에는 범위·종류·건수·필터 존재 여부만 기록한다. 본인 활동의 열람 감사는 tenantId=null이며 다른 회사 이름·서비스 ID·대상 ID를 반환하지 않는다.
- 목록/CSV 4개 경로에서 중복 query를 `requestQuery`로 거부한다. `/context`의 입력은 회사 또는 서비스 하나만 허용하며 OpenAPI와 같은 strict union 계약을 쓴다.
- Better Auth의 Session 생성과 `session.created`를 실제 adapter 트랜잭션으로 묶었다. after hook은 트랜잭션 커밋 뒤 실행될 수 있어 사용하지 않는다. 기존 비밀번호 변경의 scoped transaction은 그대로 재사용한다. 감사 삽입 뒤 실패하면 새 세션과 감사가 롤백되고 로그인 쿠키를 발급하지 않는다.
- 회사·서비스 선택에 `context.company_selected` / `context.service_selected`를 추가했다. 현재 권한과 최종 기한을 검사하고 선택 변경과 요청 ID가 연결된 감사를 함께 저장한다. 동일 세션의 선택은 advisory lock으로 직렬화한다. 접속 이력 필터는 `context.` 이벤트도 포함한다.

## 시험과 실행 결과

최종 관련 **9파일130개**가 통과했다. [실행 로그](tests-auth-context-final.log). 감사 현재 권한28개, 기존 감사5개, 계정 현재 권한8개, 로그인 원자성3개, 선택18개와 세션·비밀번호·MFA·전문가 회귀를 포함한다. 세션/회사/역할/grant/이메일/MFA/정책 기한 변경, 감사 삽입 뒤 실패와 기한 종료, 동시 선택, 마스킹, CSV 상한과 중복 입력을 검사했다. 전체 저장소 시험을 다시 실행했다는 주장은 아니다.

새 감사 조회 시험의 [초기 실패](baseline.log)에는 제품 결손26건과 잘못된 sessionMinutes fixture2건이 함께 있다. fixture는 DB 최소값5분/6분 경과로 고쳤다. [최초 결합](tests-attempt1.log)의 기존 total=8 가정은 열람 감사 추가에 맞춰 독립 count로 바꿨다. [최종 조회41개](tests-final.log)가 통과했다. 로그인 [기존 구현 시험](auth-baseline.log)은 fault helper를 사용하지 않아 실패 응답 기대1건을 충족하지 못했다. 실제 삽입 뒤 롤백은 새 구현의 시험으로 증명했다.

[최종 v27 빌드](build-auth-context.log), [타입](typecheck-auth-context.log), [변경 린트](lint-auth-context.log)는 종료코드0이다. 빌드 초기 실행2건은 Node worker의 --env-file 제한과 로컬 메일 opt-in 누락으로 실패했다. 최종 명령은 아래와 같다. 생성/검증 계약은289경로·418operation·38정책, implemented377/planned41이며 Task 상태16개와 일치했다. [계약 검사](contracts-final.log).

```sh
NODE=/Users/user01/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$NODE --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/audit-auth-atomicity.test.ts tests/server/context-audit.test.ts tests/server/auth-session-gate.test.ts tests/server/password-policy.test.ts tests/server/audit-current-authority.test.ts tests/server/audit-events.test.ts tests/server/account-current-authority.test.ts tests/server/mfa-policy.test.ts tests/server/expert-current-authority.test.ts
ALLOW_LOCAL_MAIL=1 CATCHSECU_BUILD_DIR=.local/recovery-production-v27 CATCHSECU_TSCONFIG=.local/recovery-production-v27-tsconfig.json $NODE node_modules/next/dist/bin/next build
$NODE node_modules/typescript/bin/tsc --noEmit -p .local/recovery-production-v27-tsconfig.json
python3 scripts/verify-contracts.py
```

## 실제 화면·CSV·독립 DB·새 프로세스

Ego Lite TaskSpace45/p1만 재사용했다. 별도 합성 회사 `f9cbf932-42cc-467a-960c-66faeb2c8596`, 서비스A `35beff5d-72e0-44e7-b100-2c475a4e6ba2`, B `dc1de9cb-1166-4c8c-b477-d40fc91e403c`를 사용했다. 실제 API로 A를11번 변경해 version12의 로그11건을 만들었다. 담당자의 이메일 인증·역할·A grant는 명시적 DB fixture이며 외부 이메일 인증 결과가 아니다. [설정 기록](setup.json). 비밀번호·쿠키는 .local의0600 파일에만 보관하며 증거에 포함하지 않는다. 전체 worker는 실행하지 않았다.

- owner 화면에서 A 필터→전체11건→2페이지1행→CSV 실제 다운로드를 확인했다. 담당자 화면의 처리자명은 비공개, 대상 ID는 숨김이며 B와 처리자 검색 선택지가 없다. 두 실제 CSV의 이벤트 ID11개는 같고 마스킹 열만 다르다. [owner 화면](owner-service.png), [담당자 화면](privacy-service.png), [CSV/요청 대조](evidence-check.json).
- v26의 HTTP 대표10건에서 정상 조회/CSV/본인 활동과 B404·처리자 검색403·중복422를 확인했다. 정상 요청5개에 각각1개의 열람/출력 감사가 있고 거절5개에는 없다. [요청](browser-results.json), [독립 DB](database.json). 해당10건은 v27 인증/선택 변경 전의 결과다.
- v27에서 담당자 서비스A 선택과 owner 회사 선택→서비스B 선택을 실제 모달 버튼으로 수행했다. fetch의 상태·요청 ID·선택 ID만 sessionStorage에 수집했으며 응답/사용자 정보는 수집하지 않았다. UI 쓰기3건의 선택 상태와 감사, 새 로그인2개의 `session.created`, 추가 열람2개의 기록을 독립 DB에서 대조했다. [최신 UI/API](new-process.json), [접속 이력 화면](context-access-v27.png), [독립 DB7이벤트](database-auth-context.json). 담당자 세션은 역할 전환 때 명시적으로 로그아웃해 삭제됐고 그 감사 기록은 유지됐다.
- 1440px 화면과390px 모바일을 확인했다. 모바일 document.scrollWidth=innerWidth=390이며 표 내부 스크롤을 사용한다. [모바일](privacy-mobile.png), [치수](mobile.json).
- QA 프로세스65306/v26→71152/v27→73040/v27로 전환했다. owner의 선택 회사/서비스가 두 번째 재시작 뒤 유지됐으며 재로그인한 담당자 CSV 바이트는 이전 파일과 같다. [새 프로세스5개 검사](restart-final.json), [해당 요청 감사 대조](restart-audit.json), [재시작 DB](database-auth-context-restarted.json). 선택·감사 상태 해시 `bb213455da8cc637b5579523d6fda258c0f30cacb9798ebf067f2663e3124ed4`와 이전 접근 증거 해시 `6ec87161cf0956992ccc6d0c0152dc7a1e6027334002cba27991301c4ab33056`가 유지됐다. 해시는 명시적으로 선택한 ID·선택 상태·감사·서비스 필드를 대상으로 한다.

DB 재현은 `$NODE --env-file=.env.local --import tsx .local/audit-ui.ts read` 및 `.local/audit-final-read.ts`다. prepare는 이미 실행했으므로 재실행하지 않는다. 원래 회사/서비스의 업무 값을 바꾸지 않았고 사용자3100 프로세스에는 신호를 보내지 않았다. 자체 QA3126은 정리했고3127만 사용 중이다.

회사 선택 후 대시보드를 보던 중 서버에 Prisma 오류500 기록1개가 있었다. 해당 요청 경로와 원인은 확정하지 못했다. 이후 명시적 `/analytics/dashboard` 재조회는200이었다. 대시보드 전체 게이트 통과로 확대하지 않았다.

## 남은 동일 Task 작업

[호출 위치 목록](event-producers.json)은236파일/194호출/63파일이다. 호출이 있다는 사실은 모든 변경·민감 열람·발송·권한·인증·파기의 이벤트 누락 없음이나 원자성을 증명하지 않는다.

1. `auth.ts`의 MFA 변경 전 세션 회수와 감사는 아직 별도 root-client 호출이다. MFA 변경과 함께 원자 처리하고 실패 시험을 추가한다.
2. Better Auth의 로그아웃/세션 삭제와 나머지 인증 변경을 매핑하고, 성공 이벤트 누락 및 업무/감사 원자성을 보완한다.
3. 나머지 생산 경로의 변경/민감 열람 coverage와 로그10개 화면의 종류별 실제 데이터·필터·권한·빈 결과·실패 복구를 끝낸다.

기존 audit_immutable 트리거의 U/D 차단은 유지된다. 별도 월마감 PDF/CSV는 P12-T03의 완료 증거이며 P12-T01 자체의 새 PDF 요구로 추가하지 않는다. 운영 보존·복구와 전 경로/성능 게이트는 해당 원래 Task에서 계속 추적한다. 전체 목표는 active다.
