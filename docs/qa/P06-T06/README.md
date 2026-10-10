# P06-T06 본인인증·전자서명

> **완료 판정 정정 (2026-10-04): 미완료.** 0934f4e의 일괄 완료 표시는 수용 조건의 증거를 충족하지 못해 철회했다. 아래 구현·시험 주장은 각 실제 파일/실행 결과와 다시 대조한다. 테스트 파일의 존재는 실행 통과나 브라우저/외부 연동 완료를 뜻하지 않는다. [재검증 계획](../../planning/05-completion-recovery.md).

> **현재 재검증 (2026-10-11):** 내부 `local`+`sandbox` 인증·전자서명 흐름과 영수증 일회 소비, 공개 화면 안내를 다시 통과했다. 로컬 테스트 성공은 외부 공급자 공식 인증으로 표시하거나 저장하지 않는다. 실제 외부 공급자 자격증명·공식 sandbox·production 검증은 계속 `external_pending`이며 P06-T06 전체는 진행 중이다. [최신 증거](../R08-T02/verification-readiness/README.md).

2026-10-04. 서비스별 연동 설정 CRUD와 공통 데이터 모델을 구현했다. **P06-T06은 진행 중**, 공식 완료는 **15/72**, 상태는 완료 15·진행 15·계획 42다. 실제 공급자 어댑터·공개 인증/서명·접수 연결과 외부/UI 검증은 남아 있다. 전체 72개 작업·181개 경로의 목표와 이 작업의 수용 조건을 유지한다.

[검증 manifest](verification.json)에 소스 585개·증거 68개의 해시와 완료하지 않은 조건을 기록했다. [독립 해시 대조](manifest-check.json)로 최종 파일·빌드/시험 입력과 이전 증거를 확인한다.

## 구현 결과

- `GET/POST/PATCH/DELETE /api/v1/services/{id}/verification`으로 서비스별 공급자 식별자·sandbox/production 환경·대기/사용 중지 설정을 관리한다. 현재 form.read/integration.manage·서비스 grant·회사/구성원/전문가·세션·MFA/비밀번호 정책을 transaction 잠금 아래 검사한다.
- 생성은 Idempotency-Key, 수정은 version, 삭제는 현재 If-Match를 요구한다. 같은 생성 요청의 재시도는 설정·이력을 중복 생성하지 않는다. 중지/변경/삭제는 이전 미소비 요청과 생성 키 응답을 무효화하며 삭제 후 재등록은 새 세대다.
- 설정 이력은 불변이며 최근 20개를 반환한다. 저장·감사·생성 키 INSERT 및 잠금 대기가 끝난 뒤 실제 세션 기한이 종료되면 설정·이력·감사·캐시를 함께 롤백한다.
- 폼 편집기의 기존 본인인증/전자서명 항목에서 선택 서비스의 설정 CRUD·현재 권한·대기 사유·이력을 연결했다. 생성 응답을 잃으면 같은 내용과 키로 다시 요청할 수 있다. 변경 충돌 때 최신 설정을 다시 불러온다.
- VerificationIntegration/Revision/Attempt/Event/Receipt 5개 모델을 추가했다. 회사/서비스/폼/게시 버전·설정 세대·문서/요청/브라우저 해시를 연결하며 공급자 이벤트 중복·증거 변경·다른 문서/공급자/게시 버전의 영수증 연결을 DB에서 거부한다. 한 접수에 본인인증/전자서명 영수증을 각각 하나씩 연결할 수 있다.

고객 입력으로 ready·인증 성공·비밀 키·공급자 URL을 설정할 수 없다. 준비 상태의 `ready`/`sandboxVerified`는 false다. 공급자 이름을 저장하거나 운영 환경을 선택해도 verify 폼 게시·접수는 503으로 차단한다. 합성 DB 증거와 HTTP 200 HTML 조회는 실제 외부 인증/서명 성공이나 화면 조작 검증의 증거가 아니다.

## 검증

| 검증 | 결과 | 증거 |
|---|---|---|
| 설정·권한·기한·잠금·DB 증거 제약 | 신규 27개, 공통 회귀 포함 70개 통과 | [최종 관련 검사](related-current.json) |
| 전체 회귀 | 54파일 742개 통과·실패/대기 0 | [전체 검사](full-tests.json) |
| 타입·변경 범위 린트 | 통과, 변경 범위 경고 0 | [타입](typecheck.txt), [린트](lint-changes.txt) |
| 전체 린트 | 오류 0·기존 경고 21 | [로그](lint-current.txt) |
| production 빌드 | 통과, 빌드 입력 467개 해시 | [빌드](build.txt), [입력](build-sources.json) |
| 실제 production HTTP | 41건 (34+7), 재시작 후 설정/업무 해시 동일 | [전](http-prepare.json), [후](http-restart.json) |
| 독립 개발 DB 조회 | 설정 1·이력 4·폼 2·일반 접수 1·합성 세션 0 | [DB 대조](database.json) |
| 개발/시험 스키마 | migration 61개 체크섬·새 FK 11/CHECK 5/trigger 5 일치 | [개발](dev-schema.json), [시험](test-schema.json) |
| 계약·전체 계획 | 257 API 경로·376 작업·33 정책, 181 경로·72 Task | [계약](contract-verification.txt), [계획](plan-verification.txt) |

production 서버는 PID 67042→15220→20460, 최종 빌드는 `wAXznvqwGWmeyK2IpgDmP`다. 별도 export-only worker PID 25199만 유지한다. 전역 production 발송/파기 worker는 실행하지 않았다. HTTP 합성 업무 해시는 `c86ffac8c518d1fe4a38c51694adec1a7d2de2b47488c118421cef94c6bc7d1b`이며 이전 P04/P06-T03/T04/T05의 원본 접수/답변/영수증/첨부 해시도 유지됐다. 비밀 합성 계정 checkpoint는 `.local/`의 0600 파일이며 보고서에 포함하지 않는다.

## 마이그레이션·검사 수정 기록

- 자동 schema diff에 포함된 기존 제약·기본값 변경 129개를 적용 전에 제외했다. 기존 migration 59개 파일의 체크섬을 유지하고 새 모델/제약·게시 연결 인덱스 및 영수증 종류별 연결 인덱스만 추가했다.
- 첫 새 migration의 PL/pgSQL CASE 괄호 오류(SQLSTATE 42601)는 transaction 전체가 롤백됐으며 resolve 후 수정본을 적용했다. 미완료/미해결 migration은 없다. [선택·복구 기록](migration-selection.json)
- 첫 검사에는 마지막 회사 소유자를 회수하려는 잘못된 fixture, PostgreSQL SQLSTATE 판정 방식, 필수 폼 입력/게시 요청 키 누락이 있었다. fixture와 판정을 바로잡고 실제 native SQLSTATE·역할 회수·503 차단을 다시 검증했다. 실패 보고서는 성공 게이트에서 제외한다.
- 첫 HTTP QA의 편집기 주소 `/form/create`가 404였다. 실제 `/form/ai/create`로 수정하고 새 독립 합성 회사에서 34건을 다시 통과했다. 실패한 합성 계정의 세션만 종료했고 업무 자료·사용자 관리자를 지우지 않았다. [실패 세션 정리](failed-synthetic-session-cleanup.json)
- 전체 회귀에서 다시 생성된 이전 Task의 잠금 보고서 4개를 이번 폴더에 별도 보존하고 기존 파일을 원래 바이트로 복원했다. P06-T04 37개·P06-T05 57개 기존 증거 해시가 모두 일치한다. [복원 대조](historical-evidence-preservation.json)
- 일반 `git diff --check`는 기존 인증 migration의 EOF LF에 대해 exit 2다. 나머지 파일과 해당 파일의 blank-at-eof 예외 검사만 exit 0이며 DDL/체크섬은 바꾸지 않았다.

## 남은 구현·완료 조건

1. 사용자 공급자 이름·sandbox 계정/자격증명·허용 callback 주소를 확인하고 실제 요청·조회·취소·서명 검증 어댑터를 구현한다. [공식 문서 참고 검토](PROVIDER-REVIEW.md)는 선정/원본 공급자 확인/실제 성공 증거가 아니다.
2. 공개 challenge에 브라우저 nonce·답변/동의/첨부 HMAC·정확한 서명 문서/PDF hash·게시 버전·설정 세대를 고정한다. raw callback 서명과 현재 실제 공급자 결과를 검증한다.
3. 영수증 일회 소비와 Submission/동의 영수증 저장을 같은 transaction에서 연결한다. 위조/중복 callback·다른 브라우저/환경/수신자·만료·회수·접수 실패 롤백·응답 유실 재시도를 실제 흐름으로 검사한다.
4. 인증 원문/공급자 참조/임시 PDF의 보관·파기, 관리자 안전 DTO와 공개 인증/전자서명 진행·실패·취소 화면을 연결한다.
5. 실제 sandbox 결과 ID·성공/실패/위조·중복 증거와 현재 Ego UI 검사 및 선행 전체 게이트를 통과한다. URL의 success/result 문자열만으로 성공을 만들지 않는다.

Ego TaskSpace 34의 재개 승인은 대기 중이며 browser 호출은 0이다. [ego-browser 스킬](/Users/user01/.agents/skills/ego-browser/SKILL.md:74)의 “stop and ask the user”에 따라 기존 공간을 우회하는 새 TaskSpace·다른 브라우저·Playwright/CUA를 사용하지 않았다. 전체 목표는 active이며 P06-T06과 전체 목표를 완료로 표시하지 않는다.

## 재현 명령

Node 24 경로를 사용한다. Next build/start에는 --env-file을 넣지 않고 `.env.local`을 Next가 읽도록 한다.

```sh
qa_node="/Users/user01/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
"$qa_node" --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/verification-configuration.test.ts tests/server/foundation.test.ts
"$qa_node" --env-file=.env.test.local node_modules/vitest/vitest.mjs run
"$qa_node" node_modules/typescript/bin/tsc --noEmit
ALLOW_LOCAL_MAIL=1 "$qa_node" node_modules/next/dist/bin/next build
ALLOW_LOCAL_MAIL=1 "$qa_node" node_modules/next/dist/bin/next start --port 3100
"$qa_node" --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa-verification-configuration.ts prepare
# 위 서버를 종료하고 같은 최종 build로 다시 start한 뒤 순서대로 실행한다.
"$qa_node" --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa-verification-configuration.ts finish
"$qa_node" --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa-verification-configuration.ts database
"$qa_node" --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa-verification-migrations.ts
"$qa_node" --env-file=.env.test.local node_modules/tsx/dist/cli.mjs scripts/qa-verification-migrations.ts
```

prepare/finish/database를 동시에 실행하지 않는다. PostgreSQL 통합 검사는 localhost/catchsecu_test를 강제하며 그 DB만 초기화한다. HTTP 검사는 localhost/catchsecu_dev에 독립 합성 자료를 만든다. prepare를 새로 실행하면 새 합성 계정/회사를 사용한다. 기존 사용자 관리자 자격증명은 바꾸지 않는다.

## 2026-10-05 — 로컬 sandbox 공급자 실구현

`local` 공급자는 서버 내장 sandbox 어댑터다. 외부 IdP와 같은 challenge→서명 어서션→콜백→영수증→제출 소비 경로를 로컬에서 실제로 구동한다.

### 구현

- `POST /api/v1/public/forms/{token}/verification` — challenge 발급. `FormVersion.verify`·연동 `enabled`·`local`+`sandbox`를 확인하고 nonce 해시·문서 해시를 바인딩한 attempt(pending, 10분 TTL)를 생성한다.
- `POST /api/v1/public/verify/local` — 내장 공급자. nonce를 재검증하고 HMAC-SHA256으로 어서션에 서명한다.
- `POST /api/v1/public/forms/{token}/verification-callback` — 어서션 서명·nonce·만료를 검증한다. 위조도 불변 `VerificationEvent`(rejected)로 남기고 attempt는 pending으로 유지한다. 정상이면 attempt→verified, 이벤트·영수증(proofHash=event.bodyHash)을 같은 트랜잭션에 기록한다.
- 제출은 `verification:{attemptId,receipt}`를 요구한다. 제출 tx 안에서 영수증의 테넌트/서비스/게시/폼버전 귀속·만료·문서 해시를 검증하고 `submissionId` NULL→값 조건부 갱신으로 한 번만 소비한다(동시 경합은 한 건만 성공). 소비 시 attempt→consumed.
- 연동 설정은 `enabled` 상태를 추가했다. `enabled`는 앱 계층에서 `local`+`sandbox` 조합만 허용한다(외부 공급자·production → 422 PROVIDER_ADAPTER_REQUIRED). `pending`/`disabled`는 challenge·게시를 503으로 차단한다.
- 워커는 만료 pending attempt를 `expired`로 전이한다. verified/consumed 시도의 provider 원문은 증거이므로 CHECK가 잠그고, 파기 워커가 영수증 삭제(DELETE 트리거가 이벤트·시도 연쇄 삭제)로 함께 제거해 파기 증명서에 건수를 남긴다.
- 공개 폼 UI는 `verify` 폼에서 본인인증 섹션을 렌더하고 인증 전까지 제출 버튼을 비활성화한다(중첩 form 제거 — HTML 파서가 중첩 form을 버려 인증 버튼이 외부 폼을 제출하던 결함 수정).

### DB 상태 기계 정합 (`20261008000000_verification_enabled`)

- `VerificationIntegration`/Revision status CHECK에 `enabled` 추가.
- `verification_attempt_guard`의 "사용 가능한 설정" 조건을 `pending`→`enabled`로 정정. attempt INSERT·verified/consumed 전이는 enabled 설정에서만 가능하다.
- `VerificationReceipt_evidence_check`의 `environment='production'` 전용 조건을 sandbox 포함으로 완화(local 공급자 영수증은 sandbox). attempt↔revision↔receipt 정합성은 `verification_receipt_guard`가 유지한다.
- `migrate deploy`로 빈 DB에 전량 적용 확인(재현성), 4개 로컬 DB의 `_prisma_migrations` 체크섬을 동기화했다.

### 적대적 검증 (`tests/server/verification-flow.test.ts`, 6/6)

challenge 발급→공급자 서명→콜백→영수증 소비→제출 201 전체 경로. 위조 subject 콜백 403+rejected 이벤트 보존+attempt pending 유지, 탈취 nonce 403, 동일 어서션 재생 409, 영수증 토큰 위조 403, 타 테넌트/게시 귀속 불일치 404, 재사용 409(attempt consumed), 만료 410+워커 expired 전이, 미사용 연동 503, 외부 공급자·production enabled 422, verify=false 폼의 challenge 422·영수증 첨부 422. 문서 바인딩 해시 변경 시 재인증 요구 409.
회귀: `verification-configuration` 27/27(합성 픽스처를 enabled 승격으로 갱신), `destruction` 48/48(파기 시 영수증·이벤트·시도 연쇄 삭제 유지), `public-submission-*`·`form-publication-state`·`publication-access-gate` 39/39.

### 브라우저 실측 (`scripts/qa-verify-browser.ts`)

dev 서버에서 verify 폼 게시→공개 URL 접근→challenge 자동 발급→이름/생년월일 입력→`local` 어서션→콜백→"본인인증을 완료했습니다" 표시→제출 버튼 활성화→제출 완료·접수 번호 발급까지 확인했다.

### 미완료 조건 (체크박스 유지)

- 실제 외부 공급자 어댑터(PASS/이니시스 등)와 공식 sandbox 검증 — 외부 인증이 필요해 이번 범위에서 제외.
- ~~전자서명 `signature` kind~~ — **2026-10-05 구현·실측.** `signatureProvider`가 설정된 서비스는 kind=signature challenge→서명 어서션→콜백→영수증(kind=signature 기록)→제출 소비가 동작한다. 공개 폼 응답의 `verification.kinds`가 설정된 공급자를 노출하고 공개 화면은 두 방법을 버튼으로 선택하게 한다. 미설정 kind의 challenge는 503, 외부 서명 공급자는 여전히 게시·enabled 불가. 브라우저 실측 `scripts/qa-signature-flow.ts` 5/5([signature-browser.json](signature-browser.json), [서명 단계](states/signature-step.png), [제출 완료](states/signature-submitted.png)).
- production 환경 공급자 — `enabled`를 sandbox+local로 제한해 production 어댑터 부재를 드러낸다.
