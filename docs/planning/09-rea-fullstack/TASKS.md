# 상세 TASKS — 캐치시큐 전 페이지 풀스택 완성 계획

R01-T01 실행환경·DB 정합성 완료: 적용 당시 Git blob에서 migration3개의 파일 끝 빈 줄을 복구해 Node24 dev/test 148/148 checksum 차이0을 확인했다. schema 예상 밖 차이0·SQL전용FK1개, shadow 빈 설치·147→148 upgrade·실패 rollback/recovery·seed·FK/unique 거부가 통과했다. 현재 공식 상태는 완료5·진행48·계획54다. [검증](../../qa/R01-T01/current/README.md).

F3 입력 패턴 체크포인트: 원본 확인 ID 1·2·3·4·7·8의 nullable 모델·DB 조합 제약, 폼 CRUD/복제/템플릿/게시/정정과 편집/공개 화면을 구현했다. 임의 정규식은 strict 계약에서 거부하며 고정 길이 검증만 실행한다. 집중6·관련27·frozen fixture20/20, migration140 빈 설치·기존 질문415개 보존, Ego 잘못된 값 거부/정상 제출·production 재시작 hash, 82페이지 build를 통과했다. [검증](../../qa/R08-T02/question-patterns/README.md). R08-T02와 공식 완료0/진행53/계획54는 유지한다.

F3 문항 이미지: 단일 questionImageKey·JPEG/PNG 1 MiB·migration124·현재/과거 버전 참조·복제/템플릿/승인/열람 구현. 관련23파일323시험·실제 HTTP 경계12·수명주기71요청·Ego 편집/공개/제출/교체/정정/3폭/선택 공유 확인. 폼3·자산11·참조14·실제blob3과 이전19세트의 재시작 해시 보존. 본문 rich HTML 이미지·NLP/자동동의·다중페이지·전수 수용은 잔여. [검증](../../qa/R08-T02/question-metadata/content-images/README.md). 공식 완료0/진행53/계획54 유지.
본문 rich 체크포인트: BI-02a~07 typed문서/HTML/FormContent·14MiB/24MiPixels·페이지/분기·콘텐츠 자산 pin·4슬롯 편집/권한·증거 v2/PDF를 migration125~139로 구현했다. BI-07 실제 4슬롯 CRUD·게시·2페이지 제출·개정 이력·복제/템플릿, 390/768/1440·RTL·키보드, 장애22·production82페이지·재시작 hash와 frozen fixture20/20을 통과했다. [검증](../../qa/R08-T02/body-images/full-acceptance/README.md). R08-T02 전체 수용은 계속 진행하며 공식 완료0/진행53/계획54를 유지한다.

F3 수동 개인정보 분류: nullable JSON/migration120·엄격4필드/5분류·UTF-16 이름50·독립20개 상한·행렬/RESIDENT 필수·생략 보존/제거·복제/템플릿/승인·공개 JSON 비노출 구현. 최종11파일103시험, 실제 Ego CRUD·취소·언어·공개 제출/개정/구 응답 정정·원본PDF 다운로드 통과. 폼1/버전2/응답1/정정1/감사21·production 재시작 및 기존16fixture 보존. NLP/자동동의/FILE/기타/다중페이지·시각/전체수용은 잔여. [검증](../../qa/R08-T02/question-metadata/personal-information/README.md). 공식 상태 완료0/진행53/계획54 유지.

F3 참고 자료 LINK: nullable JSON/migration119·원본5필드/순서/3개 상한·UTF-16 URL512/이름100·생략 보존/명시 삭제·복제/템플릿/승인 연결. 최종9파일81시험, 실제 Ego CRUD·취소·순서·새 탭·공개 제출/개정/구 응답 정정·원본PDF 다운로드 통과. 폼1/버전2/응답1/정정1/감사22·production 재시작 및 기존15fixture 보존. FILE/개인정보 분류/기타/다중페이지·시각/전체수용은 잔여. [검증](../../qa/R08-T02/question-metadata/reference-link/README.md). 공식 상태 완료0/진행53/계획54 유지.

F3 질문 추가 설명: DB/API·편집·공개·정정·템플릿 연결, 고유102시험, Ego 실동작/PDF바이트/production 재시작·기존14fixture 보존 확인. 나머지 메타데이터·전수 수용은 진행 중. [결과](../../qa/R08-T02/question-metadata/explanation/README.md). 공식 상태 완료0/진행53/계획54 유지.

F3/F5 국제 연락처·언어·PDF: 원본16언어·181국가/179코드·nullable 게시 언어/migration117 구현. 고유13파일192시험 후 PDF/번역 최종8파일126시험 통과(중복 합산 안 함). 원본 문구1952개 중 연결 범위 명시. Arabic 발행 실패를 v2 PDF로 수정하고 실제 Ego 발행/RTL/제출/암호화 저장 확인. 폼2/응답2/정정1/감사25·production 재시작 hash 일치, 기존13fixture 보존. PDF.js 복합 Arabic 추출·전체 시각/번역·인증 서명·메타데이터/여러 페이지·전체수용은 잔여. [검증](../../qa/R08-T02/international-contact/README.md).

F3 직접 그리기: 질문16유형·PNG 파일 수명주기·메타데이터 계약·권한 마스킹·migration116 구현. 고유11파일201시험·HTTP10·Ego 제출/재입력/취소/정정/이력 다운로드/CSV·터치와390/768/1440px 획 보존 통과. 실제 목록 질문 순서 결함 수정. 재시작 폼1/응답1/정정1/파일2/감사30건과 기존12세트 보존. 최초 resize 전 캡처의 바이트 불일치는 한계로 기록하고 정정 적용 Blob/저장/다운로드 해시 일치 확인. 전체 화면 시각 검증·국제전화/언어·서명/메타데이터/다중페이지 및 전체수용 잔여. [검증](../../qa/R08-T02/drawing-questions/README.md).

F3 길이 제한: 새UI 단문100·장문1000, 버전별 nullable 제한·구1000/20000·승인지문·공백 포함 정보주체 정정 호환 구현. 관련89·최종38개(중복), HTTP12·Ego·113migration/기존8테이블 보존·재시작 폼1/응답1/감사7건 확인. 특수유형/패턴/메타데이터/페이지 및 전체 수용은 계속 진행. [검증](../../qa/R08-T02/text-limits/README.md).

계획일: 2026-10-09. 실행 시작: 2026-10-10. **사용자 승인 후 구현·검증 중.** 기존 코드·진행 이력을 보존하며 새 증거를 추가한다.

목표: 최신 역공학 186개 경로 선언과 모든 메뉴의 데이터 모델·영속 DB·권한·API·화면을 연결하고, 각 데이터의 생성/조회/수정/삭제 또는 업무상 상태전이를 실제 DB와 브라우저에서 검증한다. 원본 백엔드 복원 결과가 아니라 현재 독립 구현의 완성 계획이다.

- 작업 107개, Phase 26개. 도메인별 모델 → 서버 → 화면 → 수용검증을 따로 완료한다.
- 순서는 ID 숫자가 아니라 `dependencies`를 따른다. R21 결제 기반이 발송과 게시보다 먼저다.
- 기존 72 Task의 완료 이력을 삭제하지 않는다. 신규 작업은 재검증/보완 분량이며 기존 구현률 0%를 뜻하지 않는다.
- `api-ui-spec.md`: 도메인별 정확한 현재 API operation과 신규 보완 요구. `data-models.md`: 현재128모델 필드/관계/제약 및 변경 계획.
- `route-matrix.csv/json`: 186행 각각 모델·CRUD·UI·권한·fixture·E2E·실행작업.
- `acceptance.md`: DB/브라우저/재시작/외부 검증과 완료 기준.
.

## R00 기준선·계약

### [x] R00-T01 186 경로·메뉴·모달 근거 기준선 확정

현 계획의 source evidence와 10월2일 181경로를 대조하고, 3개 새 구체경로+2개 wildcard를 구분한다. 메뉴 밖 생성/편집/인증/공개/결과와 부가 운영경로를 별도 register에 넣는다.

- 선행: 없음
- 대상: `src/data/route-manifest.json`; `src/data/menu.json`; `scripts/verify-plan.py`; `docs/planning/03-route-matrix.csv`
- 기존 작업 연결: P00-T01
- 증거: `catchsecu-clone/docs/qa/R00-T01/`
- 완료 조건:
  - 186 source entries 고유·누락0; 기존181 모두포함; wildcard2를 업무화면 수에 합산하지 않음
  - 메뉴 action→route/API/모달 trace와 미확인상태 목록; 리디렉션·403을 정상 CRUD 성공으로 집계하지 않음
- 완료 증거: [경로·메뉴·동작 기준선](../../qa/R00-T01/README.md), `action-trace.json`, `route-contract-check.json`, `menu-runtime/inventory.json`

### [x] R00-T02 현재 구현·계약·증거 유효성 감사

128 Prisma 모델·308 계약path·440 operation·154 handler파일·116 test파일 기준을 다시 수집하고 호출 가능한 API와 미연결 UI를 분류한다. 문서 및 테스트 파일 존재만으로 구현 완료 판정하지 않는다.

- 선행: R00-T01
- 대상: `prisma/schema.prisma`; `src/app/api/v1`; `src/server`; `src/components`; `tests`; `docs/qa`
- 기존 작업 연결: P00-T03, P14-T01
- 증거: `catchsecu-clone/docs/qa/R00-T02/`
- 완료 조건:
  - operation별 handler/서버함수/DTO/정책/실행증거 연결
  - 현재 수정중 payment 관련 코드·문서 변경을 보존하고 근거 commit/time 기록; 과거181 검증의 한계 표시
- 완료 증거: [현재 소스 최종 감사](../../qa/R00-T02/README.md), [API operation 대조](../../qa/R00-T02/api-audit/README.md), [런타임 route 추적](../../qa/R00-T02/runtime-route-trace/README.md), [지원 Node 전체 회귀](../../qa/R00-T02/full-tests-current.json). 466 operation·158 handler의 진입점/메서드/정책/작업소유자 누락0, 직접 handler 시험466/466, 성공 응답466/466, catch-all285/285를 확인했다. 지원 Node24 단일 실행 196파일·261suite·2,877시험이 전부 통과했다.

### [x] R00-T03 TASKS·역할·기능범위·새 경로 계약 통합

별도 계획107 task를 기존72 task와 연결하고 새 baseline으로 적용한다. unknown 원본 기능은 독립제품 설계로 라벨한다. 역할 owner/admin/editor/viewer/privacy/sender/billing/security/auditor와 license·service를 함께 명세한다.

- 선행: R00-T02
- 대상: `TASKS.md`; `docs/planning/tasks.json`; `.Codex/goals`; `docs/planning/contracts`
- 기존 작업 연결: P00-T03
- 증거: `catchsecu-clone/docs/qa/R00-T03/`
- 완료 조건:
  - root TASKS/tasks.json/goals를 사용자 기존수정과 병합; 181 hardcode 제거·186+부가경로 구분
  - API/DB/UI/외부검증 상태 분리; 존재하지 않는 구형 Delivery/MonthlyClose 등 모델명 정정
- 완료 증거: [통합 보고서](../../qa/R00-T03/README.md), [기계 검사](../../qa/R00-T03/integration-check.json), [기존 작업 연결표](legacy-task-map.json), [표면별 상태 계약](status-contract.json), [역할 계약](../contracts/roles.json), [모델명 매핑](../contracts/model-name-map.json). 활성107↔기존72 전부 연결, 원본186+부가21 분리, DB/API/UI/외부 상태 분리, 역할9·capability32·Prisma143모델·OpenAPI466정책을 검사했다.

### [x] R00-T04 fixture·페이지별 행동표·QA 재현계약 확정

회사A/B, 역할9종, 전문가/외부열람자/정보주체, license/토큰/상태/파일·외부실패 fixture를 선언하고 RR별 실제 URL을 생성한다.

- 선행: R00-T03
- 대상: `scripts/seed-route-fixtures.ts`; `scripts/verify-route-fixtures.ts`; `docs/qa`; `tests`
- 기존 작업 연결: P00-T04
- 증거: `catchsecu-clone/docs/qa/R00-T04/`
- 완료 조건:
  - 각 RR 경로의 구체fixture와 정상/권한거부/실패 최소 시나리오 존재
  - 동적경로 demo 치환 금지; callback은 사전state; wildcard는 알수없는URL fixture; 외부비용 발생 시험은 전용시험수신자/계정
- 완료 증거: [fixture 계약 보고서](../../qa/R00-T04/active-fixtures/README.md), [검증 결과](../../qa/R00-T04/active-fixtures/result.json), [전체 경로 카탈로그](../../qa/R00-T04/active-fixtures/route-catalog.json), [실제 DB 시드 결과](../../qa/R00-T04/active-fixtures/seed-result.json), [단위시험](../../qa/R00-T04/active-fixtures/tests-current.json). 원본186+부가21 경로와 시나리오621개를 구체화했으며 실행 상태는 별도 `not_run`으로 유지한다.


## R01 공통 서버 기반

### [x] R01-T01 실행환경·DB 변경 이력·스키마 정합성

현재 채택된 Node/Next/Prisma/PostgreSQL 환경을 확인하고 설치문서를 기준으로 변경한다. 마이그레이션 누적과 과거 checksum 불일치를 백업/증거로 대조하며 기존SQL 덮어쓰기를 금지한다.

- 선행: R00-T04
- 대상: `package.json`; `prisma/schema.prisma`; `prisma/migrations`; `scripts/seed.ts`
- 기존 작업 연결: P00-T02, P01-T01
- 증거: `catchsecu-clone/docs/qa/R01-T01/`
- 완료 조건:
  - 빈 DB migrate+seed와 기존시험DB upgrade 모두 통과; FK/unique/index 점검
  - 현재 migration 파일 전수와 실행DB 이력은 별도 검증; checksum 차이 해소 근거 보존
- 완료 증거: [현재 보고서](../../qa/R01-T01/current/README.md), [shadow 148개 재현](../../qa/R01-T01/current/db-rehearsal.json), [dev 스키마 계약](../../qa/R01-T01/schema-alignment/catchsecu_dev-contract.json), [test 스키마 계약](../../qa/R01-T01/schema-alignment/catchsecu_test-contract.json), [checksum 복구 근거](../../qa/R01-T01/current/checksum-recovery.json). Node24 dev/test 148/148 checksum 일치, 빈 설치·147→148 업그레이드·실패 rollback/recovery·seed·FK/unique 거부를 확인했다.

### [ ] R01-T02 API·권한·경합·멱등 공통 경계

HttpError/DTO·requestId·pagination·최대크기·401/403/404/409/410/422/429 정책, optimistic version과 create/action idempotency 범위를 통일한다.

- 선행: R01-T01
- 대상: `src/server/http.ts`; `src/server/context.ts`; `src/server/permissions.ts`; `src/server/idempotency.ts`; `src/contracts`
- 기존 작업 연결: P01-T02, P02-T03
- 증거: `catchsecu-clone/docs/qa/R01-T02/`
- 완료 조건:
  - tenantId는 세션context에서 결정; body/URL 참조 tenant FK까지검증
  - 경쟁PATCH409·동일키재시도1회·다른payload동일키409; create/update/delete 모두읽기와독립권한검증

### [~] R01-T03 파일·비공개 저장소·다운로드 공통 경계

DB metadata/비공개 binary/검사status·용량·확장자·파일형식검증, 로컬/S3 adapter 및 한글PDF 생성 기반을 재검증한다.

- 선행: R01-T02
- 대상: `src/server/file-storage.ts`; `src/server/files.ts`; `src/server/file-access.ts`; `src/server/file-scanner.ts`; `src/server/s3-storage.ts`
- 기존 작업 연결: P01-T03
- 증거: `catchsecu-clone/docs/qa/R01-T03/`
- 완료 조건:
  - 파일완료전열람불가·악성파일격리·다른tenant파일bind거부
  - 다운로드 시 최신권한/보유기한 확인; 분리저장 실패정리 및 파일hash실제대조

### [ ] R01-T04 Outbox·worker·플랫폼 인증메일·감사 기반

Job/JobAttempt claim·lease·재시도·실패/재실행, DB쓰기와 event원자성, 인증용 로컬메일/SMTP transport를 제공한다. 캠페인메일과 순환의존을 만들지 않는다.

- 선행: R01-T02
- 대상: `src/server/jobs.ts`; `src/server/audit.ts`; `scripts/worker.ts`; `scripts/export-worker.ts`; `src/server/auth.ts`
- 기존 작업 연결: P01-T04, P01-T05
- 증거: `catchsecu-clone/docs/qa/R01-T04/`
- 완료 조건:
  - worker강제종료→재시작시 이벤트유실/이중발송 방지; 시도이력 보존
  - 비즈니스 실패 rollback이면 감사/외부job 성공기록도 없음; 인증메일은 마케팅동의 기능에 의존하지 않음

### [~] R01-T05 자동 검증·관측·통합환경

전용dev/test/shadow DB 가드, request/job 상관ID·secret마스킹, type/lint/build/DB통합/브라우저 증거 디렉터리를 정비한다.

- 선행: R01-T03, R01-T04
- 대상: `scripts`; `tests`; `docs/qa`; `src/server/env.ts`
- 기존 작업 연결: P01-T05
- 증거: `catchsecu-clone/docs/qa/R01-T05/`
- 완료 조건:
  - 실패한검사를 성공처럼집계하지않는검증명령; 서버기동/workerready확인
  - 기존fixture정리 범위명확; 운영·원본DB/발송/결제 사용안함; screenshot/HTTP/DB 증거상호추적


## R02 계정 인증·세션·복구

### [~] R02-T01 계정 인증·세션·복구 — 모델·규칙 대조 및 보완

현재 Better Auth 테이블을 재사용한다. 이메일 중복·만료·한 번만 쓰는 인증, 암호 이력, 복구코드 소비, 세션 폐기를 DB 제약과 트랜잭션으로 대조한다.

- 선행: R01-T05
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/auth.ts`; `src/server/auth-adapter.ts`; `src/server/auth-mutations.ts`; `src/server/credential-lock.ts`; `src/server/password-policy.ts`; `src/server/password-deferral.ts`
- 기존 작업 연결: P02-T01, P02-T02, P02-T04, P02-T05
- 증거: `catchsecu-clone/docs/qa/R02-T01/`
- 완료 조건:
  - C 가입·인증 challenge; R 세션/암호정책; U 암호·2FA; D 세션 폐기·2FA 해제. 계정 삭제는 R05.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [~] R02-T02 계정 인증·세션·복구 — 서버 API·업무 처리

이메일 가입→인증→로그인→로그아웃, 재설정, OTP/TOTP·복구코드 계약을 실제 handler와 대조한다. 재전송 rate limit, 계정 존재 노출 방지, returnTo 검증 및 정책 변경 후 기존 세션 집행을 확인한다.

- 선행: R02-T01
- 대상: `src/server/auth.ts`; `src/server/auth-adapter.ts`; `src/server/auth-mutations.ts`; `src/server/credential-lock.ts`; `src/server/password-policy.ts`; `src/server/password-deferral.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P02-T01, P02-T02, P02-T04, P02-T05
- 증거: `catchsecu-clone/docs/qa/R02-T02/`
- 완료 조건:
  - A 계정 가입 후 로컬 시험메일 링크를 한 번 사용, 재사용 거부; 틀린 암호·만료 OTP·복구코드 재사용 거부; 다른 브라우저 세션 폐기; 재시작 뒤 인증 유지/폐기 일치.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [~] R02-T03 계정 인증·세션·복구 — 전체 화면·모달 연결

로그인/가입/이메일·OTP/복구/암호변경/2단계/만료 경로 각각 서버 상태에 연결한다. 전송 중·잘못된 코드·만료·재전송 대기·로그아웃 완료를 표시한다.

- 선행: R02-T02
- 대상: `src/components/auth/AuthPages.tsx`; `src/components/auth/LiveAuth.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P02-T01, P02-T02, P02-T04, P02-T05
- 증거: `catchsecu-clone/docs/qa/R02-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [~] R02-T04 계정 인증·세션·복구 — DB·브라우저·재시작 수용검증

A 계정 가입 후 로컬 시험메일 링크를 한 번 사용, 재사용 거부; 틀린 암호·만료 OTP·복구코드 재사용 거부; 다른 브라우저 세션 폐기; 재시작 뒤 인증 유지/폐기 일치.

- 선행: R02-T03
- 대상: `tests`; `scripts`; `docs/qa/R02-T04`
- 기존 작업 연결: P02-T01, P02-T02, P02-T04, P02-T05
- 증거: `catchsecu-clone/docs/qa/R02-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R03 회사·서비스·초기 설정

### [~] R03-T01 회사·서비스·초기 설정 — 모델·규칙 대조 및 보완

Company→Service tenant FK, 회사 내 서비스명 unique, Membership/ServiceGrant 관계, 사업자 파일 소유권과 version을 검사한다. 회사 종료와 구성원 탈퇴를 구분한다.

- 선행: R02-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/company-management.ts`; `src/server/service-management.ts`; `src/server/context-selection.ts`; `src/server/service-access.ts`; `src/server/access-requests.ts`
- 기존 작업 연결: P03-T01
- 증거: `catchsecu-clone/docs/qa/R03-T01/`
- 완료 조건:
  - C 회사/서비스/접근요청; R 목록·상세·현재 컨텍스트; U 기본정보/이름/요청결정; D 서비스 보관·회사 종료요청. 참조 데이터 즉시 cascade 삭제 금지.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [~] R03-T02 회사·서비스·초기 설정 — 서버 API·업무 처리

회사·서비스 CRUD, 사업자 파일, 컨텍스트 전환 및 서비스 접근 요청 API에 tenant·활성 상태·version·권한 재검사를 적용한다. 서비스 폐기 시 게시·예약·공유 접근과의 일관성을 확인한다.

- 선행: R03-T01
- 대상: `src/server/company-management.ts`; `src/server/service-management.ts`; `src/server/context-selection.ts`; `src/server/service-access.ts`; `src/server/access-requests.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P03-T01
- 증거: `catchsecu-clone/docs/qa/R03-T02/`
- 완료 조건:
  - 회사 A 생성→서비스2개→수정→보관→재로그인; B 회사 serviceId를 본문/URL에 주입해 거부; 같은 이름 동시생성 하나409; 사용 중 서비스 삭제 의존성 안내.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [~] R03-T03 회사·서비스·초기 설정 — 전체 화면·모달 연결

회사 조회/편집, 서비스 목록·추가 모달·편집/보관, 회사 최초 등록, 서비스 없음→접근요청 흐름. 전환 시 목록·권한·선택값 캐시를 함께 갱신한다.

- 선행: R03-T02
- 대상: `src/components/management/live.tsx`; `src/components/ServiceAccessPage.tsx`; `src/components/ApplicationContext.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P03-T01
- 증거: `catchsecu-clone/docs/qa/R03-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [~] R03-T04 회사·서비스·초기 설정 — DB·브라우저·재시작 수용검증

회사 A 생성→서비스2개→수정→보관→재로그인; B 회사 serviceId를 본문/URL에 주입해 거부; 같은 이름 동시생성 하나409; 사용 중 서비스 삭제 의존성 안내.

- 선행: R03-T03
- 대상: `tests`; `scripts`; `docs/qa/R03-T04`
- 기존 작업 연결: P03-T01
- 증거: `catchsecu-clone/docs/qa/R03-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R04 구성원·초대·권한·전문가

### [~] R04-T01 구성원·초대·권한·전문가 — 모델·규칙 대조 및 보완

회사별 멤버십·서비스 권한의 복합 FK 및 중복 초대 방지, 초대 만료/수락 1회, 전문가 배정 범위·기간·version을 확인한다. 마지막 owner 제거를 차단한다.

- 선행: R03-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/members.ts`; `src/server/permissions.ts`; `src/server/service-access.ts`; `src/server/expert-assignments.ts`
- 기존 작업 연결: P02-T03, P03-T02, P03-T05
- 증거: `catchsecu-clone/docs/qa/R04-T01/`
- 완료 조건:
  - C 초대/서비스 권한/전문가 배정; R 목록·초대미리보기; U 역할·담당범위·소유권 이전; D 초대취소/권한회수/배정해제.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [~] R04-T02 구성원·초대·권한·전문가 — 서버 API·업무 처리

초대·재전송·수락·취소, 멤버 변경/삭제/owner 이전, 서비스 접근요청 결정과 전문가 배정 API를 역할 허용표에 대조한다. 회수 후 세션과 진행 중 작업에서 권한을 다시 검사한다.

- 선행: R04-T01
- 대상: `src/server/members.ts`; `src/server/permissions.ts`; `src/server/service-access.ts`; `src/server/expert-assignments.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P02-T03, P03-T02, P03-T05
- 증거: `catchsecu-clone/docs/qa/R04-T02/`
- 완료 조건:
  - A 초대 수락→서비스1만 조회→권한회수 즉시거부; B ID 교체 실패; owner2명이 동시탈퇴/이전해도 최소1명 보장; 초대 중복·만료·전문가 기간 만료/재배정409.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [~] R04-T03 구성원·초대·권한·전문가 — 전체 화면·모달 연결

구성원 목록/검색/초대/편집/삭제와 /set/authority 서비스별 범위 편집, 전문가 회사 선택을 연결한다. 관리자용 배정 페이지는 별도 부가 경로로 관리한다.

- 선행: R04-T02
- 대상: `src/components/management/members.tsx`; `src/components/auth/InvitationAccept.tsx`; `src/components/ExpertSelectPage.tsx`; `src/components/ExpertAssignmentsAdmin.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P02-T03, P03-T02, P03-T05
- 증거: `catchsecu-clone/docs/qa/R04-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [~] R04-T04 구성원·초대·권한·전문가 — DB·브라우저·재시작 수용검증

A 초대 수락→서비스1만 조회→권한회수 즉시거부; B ID 교체 실패; owner2명이 동시탈퇴/이전해도 최소1명 보장; 초대 중복·만료·전문가 기간 만료/재배정409.

- 선행: R04-T03
- 대상: `tests`; `scripts`; `docs/qa/R04-T04`
- 기존 작업 연결: P02-T03, P03-T02, P03-T05
- 증거: `catchsecu-clone/docs/qa/R04-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R05 MY·프로필·활동 검토·탈퇴

### [~] R05-T01 MY·프로필·활동 검토·탈퇴 — 모델·규칙 대조 및 보완

자기 사용자 범위와 회사별 활동 검토 scope를 분리한다. 탈퇴요청 사유 암호화·보존, 마지막 owner 제약, 검토 메시지/답변의 수정 정책과 감사 근거를 정리한다.

- 선행: R04-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/account-closure.ts`; `src/server/account-actor.ts`; `src/server/activity-reviews.ts`; `src/server/activity-review-mail.ts`; `src/server/auth-mutations.ts`; `src/server/sso-accounts.ts`
- 기존 작업 연결: P03-T03, P06-T02
- 증거: `catchsecu-clone/docs/qa/R05-T01/`
- 완료 조건:
  - C 활동 검토요청·탈퇴요청; R 프로필/내 활동/검토; U 이름·연락처·검토 응답; D 세션·연결 계정 해제, 탈퇴는 상태 전이.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [~] R05-T02 MY·프로필·활동 검토·탈퇴 — 서버 API·업무 처리

프로필 PATCH·세션 DELETE·연결 계정 해제·closure 및 활동검토 actions/notifications/destruction의 상태 전이를 검사한다. 권한회수/탈퇴 경합 중 다른 회사 자료 조회를 막는다.

- 선행: R05-T01
- 대상: `src/server/account-closure.ts`; `src/server/account-actor.ts`; `src/server/activity-reviews.ts`; `src/server/activity-review-mail.ts`; `src/server/auth-mutations.ts`; `src/server/sso-accounts.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P03-T03, P06-T02
- 증거: `catchsecu-clone/docs/qa/R05-T02/`
- 완료 조건:
  - 자기 프로필 수정 재로그인 확인; B 사용자 프로필 노출없음; 최종 로그인 수단 해제 차단; 탈퇴 후 세션 폐기와 보존대상 분리; 검토 만료·중복처리·알림실패 재시도.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [~] R05-T03 MY·프로필·활동 검토·탈퇴 — 전체 화면·모달 연결

/my-page 별칭→프로필, 편집/탈퇴 확인, 내 활동로그, 개인정보 활동검토 목록·상세·사유응답·처리결과·재시도를 구현 또는 보완한다.

- 선행: R05-T02
- 대상: `src/components/management/live.tsx`; `src/components/management/AccountClosure.tsx`; `src/components/management/ActivityReviews.tsx`; `src/components/auth/SsoAccounts.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P03-T03, P06-T02
- 증거: `catchsecu-clone/docs/qa/R05-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [~] R05-T04 MY·프로필·활동 검토·탈퇴 — DB·브라우저·재시작 수용검증

자기 프로필 수정 재로그인 확인; B 사용자 프로필 노출없음; 최종 로그인 수단 해제 차단; 탈퇴 후 세션 폐기와 보존대상 분리; 검토 만료·중복처리·알림실패 재시도.

- 선행: R05-T03
- 대상: `tests`; `scripts`; `docs/qa/R05-T04`
- 기존 작업 연결: P03-T03, P06-T02
- 증거: `catchsecu-clone/docs/qa/R05-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R06 회사 보안정책·IP·MFA

### [~] R06-T01 회사 보안정책·IP·MFA — 모델·규칙 대조 및 보완

회사 단일 정책, IP/CIDR 정규화·중복, IPv4/IPv6, MFA 예외 만료와 version을 점검한다. 보안 수치의 원본 미확인 기본값을 확정 사실로 기록하지 않는다.

- 선행: R04-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/security-policy.ts`; `src/server/ip-access.ts`; `src/server/ip-enforcement.ts`; `src/server/client-ip.ts`; `src/server/mfa-policy.ts`; `src/server/mfa-enforcement.ts`; `src/server/password-policy.ts`
- 기존 작업 연결: P11-T01, P11-T02, P11-T05
- 증거: `catchsecu-clone/docs/qa/R06-T01/`
- 완료 조건:
  - C IP 규칙/MFA 예외; R 정책·보안현황; U 정책·예외기간·활성; D 규칙·예외 삭제/정책 초기화.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [~] R06-T02 회사 보안정책·IP·MFA — 서버 API·업무 처리

저장된 정책이 로그인·매 API·파일/내보내기·worker에 실제 집행되게 한다. 프록시 IP 신뢰 경계, 잘못된 정책으로 관리자 전원 잠금 방지와 예외 갱신 경합을 시험한다.

- 선행: R06-T01
- 대상: `src/server/security-policy.ts`; `src/server/ip-access.ts`; `src/server/ip-enforcement.ts`; `src/server/client-ip.ts`; `src/server/mfa-policy.ts`; `src/server/mfa-enforcement.ts`; `src/server/password-policy.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P11-T01, P11-T02, P11-T05
- 증거: `catchsecu-clone/docs/qa/R06-T02/`
- 완료 조건:
  - IP 차단 후 기존 로그인에서도 API403; 잘못된 CIDR422(INVALID_CIDR); 신뢰하지 않는 X-Forwarded-For 우회실패; MFA 예외만료 즉시 재인증; 정책초기화 이후 DB와 화면 일치.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [~] R06-T03 회사 보안정책·IP·MFA — 전체 화면·모달 연결

회사 정책 조회/설정, 보안 대시보드, IP 목록·편집·삭제, 2FA 강제·예외 사용자/기간을 API로 연결한다. Enterprise 미가입과 권한 부족을 구분한다.

- 선행: R06-T02
- 대상: `src/components/management/policy.tsx`; `src/components/management/SecurityOverview.tsx`; `src/components/management/IpAccess.tsx`; `src/components/management/MfaPolicy.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P11-T01, P11-T02, P11-T05
- 증거: `catchsecu-clone/docs/qa/R06-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [~] R06-T04 회사 보안정책·IP·MFA — DB·브라우저·재시작 수용검증

IP 차단 후 기존 로그인에서도 API403; 잘못된 CIDR422(INVALID_CIDR); 신뢰하지 않는 X-Forwarded-For 우회실패; MFA 예외만료 즉시 재인증; 정책초기화 이후 DB와 화면 일치.

- 선행: R06-T03
- 대상: `tests`; `scripts`; `docs/qa/R06-T04`
- 기존 작업 연결: P11-T01, P11-T02, P11-T05
- 증거: `catchsecu-clone/docs/qa/R06-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R07 SSO·OAuth·기관 인증

### [~] R07-T01 SSO·OAuth·기관 인증 — 모델·규칙 대조 및 보완

기관별 issuer·client·인증서와 암호화 secret, state/nonce·만료·소비 제약을 대조한다. VirtualOrgMember는 가상시험용임을 유지하며 실제 기관 신원 모델과 혼동하지 않는다.

- 선행: R06-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/sso.ts`; `src/server/sso-provider-lifecycle.ts`; `src/server/sso-route.ts`; `src/server/saml-validation.ts`; `src/server/sso-accounts.ts`; `src/server/org-auth.ts`; `src/server/sso-mfa.ts`
- 기존 작업 연결: P11-T03, P11-T04, P02-T04
- 증거: `catchsecu-clone/docs/qa/R07-T01/`
- 완료 조건:
  - C SSO 공급자/인증 state/계정연결; R 설정·preflight; U 설정·활성; D 공급자 비활성/계정연결 해제. callback은 검증 후 1회 처리.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [~] R07-T02 SSO·OAuth·기관 인증 — 서버 API·업무 처리

OIDC/SAML 검증·계정연결 및 신규 /login/gpki/callback·/login/saeol/callback 경로를 정식 어댑터 계약에 연결한다. GPKI/새올/그룹웨어 규격은 제공사 확인 후 확정하며 callback URL만으로 성공시키지 않는다.

- 선행: R07-T01
- 대상: `src/server/sso.ts`; `src/server/sso-provider-lifecycle.ts`; `src/server/sso-route.ts`; `src/server/saml-validation.ts`; `src/server/sso-accounts.ts`; `src/server/org-auth.ts`; `src/server/sso-mfa.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P11-T03, P11-T04, P02-T04
- 증거: `catchsecu-clone/docs/qa/R07-T02/`
- 완료 조건:
  - 잘못된 issuer/audience/state·만료/재사용 assertion 거부; 별도 시험 IdP로 로그인·연결·해제; 기관2곳 tenant 분리; 가상기관 테스트와 실제기관 수신 증거를 분리.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [~] R07-T03 SSO·OAuth·기관 인증 — 전체 화면·모달 연결

SSO 목록·등록·수정·삭제·연결시험, OAuth/SAML 시작/성공/실패/초대가입, GPKI 이메일등록/기관 실패/새올 callback 화면을 서버 결과와 연결한다.

- 선행: R07-T02
- 대상: `src/components/management/SsoProviders.tsx`; `src/components/auth/AuthPages.tsx`; `src/components/auth/SsoRecovery.tsx`; `src/components/auth/SsoAccounts.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P11-T03, P11-T04, P02-T04
- 증거: `catchsecu-clone/docs/qa/R07-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [~] R07-T04 SSO·OAuth·기관 인증 — DB·브라우저·재시작 수용검증

잘못된 issuer/audience/state·만료/재사용 assertion 거부; 별도 시험 IdP로 로그인·연결·해제; 기관2곳 tenant 분리; 가상기관 테스트와 실제기관 수신 증거를 분리.

- 선행: R07-T03
- 대상: `tests`; `scripts`; `docs/qa/R07-T04`
- 기존 작업 연결: P11-T03, P11-T04, P02-T04
- 증거: `catchsecu-clone/docs/qa/R07-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R08 캐치폼·질문·템플릿·단계 편집

### [~] R08-T01 캐치폼·질문·템플릿·단계 편집 — 모델·규칙 대조 및 보완

Form와 버전/질문/보기 관계, 게시본 불변·draft revision, 질문 순서·필수·조건·옵션 ID 안정성을 확인한다. 원본 번들 question·policy 세부항목과 현재 계약의 누락 필드 표를 만든다.

- 선행: R04-T04, R06-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/forms.ts`; `src/server/templates.ts`; `src/server/form-access.ts`; `src/server/form-documents.ts`; `src/server/answer-validation.ts`
- 기존 작업 연결: P04-T01, P04-T02, P04-T04
- 증거: `catchsecu-clone/docs/qa/R08-T01/`
- 완료 조건:
  - C 폼/초안/질문/보기/템플릿/복제; R 목록·상세·초안; U 순서·문구·유형·단계 설정; D 미사용 초안·질문·템플릿 보관.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [~] R08-T02 캐치폼·질문·템플릿·단계 편집 — 서버 API·업무 처리

폼·템플릿 CRUD/use/copy/revise/draft/favorite 계약과 편집 저장 payload를 대조한다. 질문 유형별 필수/길이/선택/첨부 검증과 충돌409를 서버에서 집행한다.

- 선행: R08-T01
- 대상: `src/server/forms.ts`; `src/server/templates.ts`; `src/server/form-access.ts`; `src/server/form-documents.ts`; `src/server/answer-validation.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P04-T01, P04-T02, P04-T04
- 증거: `catchsecu-clone/docs/qa/R08-T02/`
- 완료 조건:
  - 질문3종+제공자+동의서로 초안 작성→모든 단계 새로고침→다른 브라우저 재개; 2탭409; A 문서를 B 폼에 연결 차단; 게시본 수정 시 원래 응답의 질문·문구 불변.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.
- 진행 체크포인트: F5 시작·종료 시각의 버전/게시본 계약과 DB 제약, 시작 전425·시작 후 제출·종료 후410을 구현했다. migration142·기존196버전/154게시본 보존, 전용5·회귀158시험, Ego Lite·production 재시작을 확인했다. [증거](../../qa/R08-T02/collection-window/README.md). 중복 참여·대상 목록·인증 방법 전체와 R08 수용조건은 남아 있다.

### [~] R08-T03 캐치폼·질문·템플릿·단계 편집 — 전체 화면·모달 연결

템플릿→신규 폼, create/basic-frame/v3/recipient/agreement/set/setting 각 단계로 직접진입·저장·재개; 전체 단계 경로/query의 formId 유지. 목록 검색/필터/복제/삭제와 미저장 이동 경고.

- 선행: R08-T02
- 대상: `src/components/forms/FormEditor.tsx`; `src/components/forms/FormLists.tsx`; `src/components/forms/TemplateGallery.tsx`; `src/components/forms/Workflow.tsx`; `src/components/forms/QuestionInput.tsx`; `src/components/forms/QuestionSettings.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P04-T01, P04-T02, P04-T04
- 증거: `catchsecu-clone/docs/qa/R08-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [~] R08-T04 캐치폼·질문·템플릿·단계 편집 — DB·브라우저·재시작 수용검증

질문3종+제공자+동의서로 초안 작성→모든 단계 새로고침→다른 브라우저 재개; 2탭409; A 문서를 B 폼에 연결 차단; 게시본 수정 시 원래 응답의 질문·문구 불변.

- 선행: R08-T03
- 대상: `tests`; `scripts`; `docs/qa/R08-T04`
- 기존 작업 연결: P04-T01, P04-T02, P04-T04
- 증거: `catchsecu-clone/docs/qa/R08-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R09 폼 승인·게시·고정 URL

### [ ] R09-T01 폼 승인·게시·고정 URL — 모델·규칙 대조 및 보완

승인대상 버전 해시·게시 포인터·토큰 hash·고정slug unique와 만료를 확인한다. 승인 뒤 내용 변경 시 승인 유효성 및 참조 버전 고정을 명시한다.

- 선행: R08-T04, R10-T04, R21-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/approvals.ts`; `src/server/public-publication.ts`; `src/server/fixed-urls.ts`; `src/server/forms.ts`; `src/server/form-cache.ts`
- 기존 작업 연결: P04-T03, P04-T05
- 증거: `catchsecu-clone/docs/qa/R09-T01/`
- 완료 조건:
  - C 승인요청/게시/고정URL; R 승인상세·게시상태; U 승인결정·URL 대상·재개; D 승인취소·URL 폐기·게시중단.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [ ] R09-T02 폼 승인·게시·고정 URL — 서버 API·업무 처리

요청/승인/거절/취소와 publish/pause/resume/고정URL CRUD를 트랜잭션으로 연결한다. 자기승인 허용 여부를 계약으로 확정하고 만료 라이선스에서 write gate를 검증한다.

- 선행: R09-T01
- 대상: `src/server/approvals.ts`; `src/server/public-publication.ts`; `src/server/fixed-urls.ts`; `src/server/forms.ts`; `src/server/form-cache.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P04-T03, P04-T05
- 증거: `catchsecu-clone/docs/qa/R09-T02/`
- 완료 조건:
  - 초안→승인→게시→외부접속→중단410→재개; 승인본 바꿔치기 거부; 고정URL 대상 교체와 이전 링크 정책; 같은slug 경쟁409; 링크 복사만으로 게시되지 않음.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [~] R09-T03 폼 승인·게시·고정 URL — 전체 화면·모달 연결

공유 단계에서 게시전 검증·승인상태·URL 복사·중단·재개, 고정URL 추가/이름변경/대상교체/삭제, 승인로그 상세/결정/사유 입력을 연결한다.

- 선행: R09-T02
- 대상: `src/components/forms/Approvals.tsx`; `src/components/forms/Workflow.tsx`; `src/components/forms/FixedUrls.tsx`; `src/components/forms/DraftStatus.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P04-T03, P04-T05
- 증거: `catchsecu-clone/docs/qa/R09-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [ ] R09-T04 폼 승인·게시·고정 URL — DB·브라우저·재시작 수용검증

초안→승인→게시→외부접속→중단410→재개; 승인본 바꿔치기 거부; 고정URL 대상 교체와 이전 링크 정책; 같은slug 경쟁409; 링크 복사만으로 게시되지 않음.

- 선행: R09-T03
- 대상: `tests`; `scripts`; `docs/qa/R09-T04`
- 기존 작업 연결: P04-T03, P04-T05
- 증거: `catchsecu-clone/docs/qa/R09-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R10 처리 목적·동의서·처리방침·서비스 공개문서

### [~] R10-T01 처리 목적·동의서·처리방침·서비스 공개문서 — 모델·규칙 대조 및 보완

목적↔항목↔제공자와 DocumentVersion 스냅샷 관계를 대조한다. 국외이전·아동·CCTV·자동화 결정·권리담당자 등 역공학 상태에 있는 필드를 실제 schema/DTO 지원 여부별로 확정한다.

- 선행: R03-T04, R06-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/processing-catalog.ts`; `src/server/documents.ts`; `src/server/document-pdf.ts`; `src/server/public-service-documents.ts`; `src/server/subprocessors.ts`; `src/server/form-documents.ts`
- 기존 작업 연결: P05-T01, P05-T02, P05-T03, P05-T04, P03-T04
- 증거: `catchsecu-clone/docs/qa/R10-T01/`
- 완료 조건:
  - C 목적/제공·수탁자/문서/문구; R 목록·버전·공개/PDF; U 초안·표시문구·재위탁; D 보관·복구·게시폐기. 증거 참조 버전은 불변.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [~] R10-T02 처리 목적·동의서·처리방침·서비스 공개문서 — 서버 API·업무 처리

목적/제공자/문구/문서 CRUD·restore/history/publish/unpublish/revoke/PDF와 서비스 동의표시·재위탁고지의 상태 전이를 연결한다. HTML 정제·PDF 폰트·공개 토큰 권한을 확인한다.

- 선행: R10-T01
- 대상: `src/server/processing-catalog.ts`; `src/server/documents.ts`; `src/server/document-pdf.ts`; `src/server/public-service-documents.ts`; `src/server/subprocessors.ts`; `src/server/form-documents.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P05-T01, P05-T02, P05-T03, P05-T04, P03-T04
- 증거: `catchsecu-clone/docs/qa/R10-T02/`
- 완료 조건:
  - 목적+제공자 CRUD→문서생성/개정→공개토큰/PDF 내용일치; 소프트삭제/복구; 게시문서와 이전동의영수증 불변; 국내/국외/수신자/agree 변형 DB fixture로 각각검증.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [~] R10-T03 처리 목적·동의서·처리방침·서비스 공개문서 — 전체 화면·모달 연결

이용목적 wizard, 동의서 생성/목록/편집/문구, 처리방침 목록·미리보기·버전·게시, 서비스 표시동의/수탁자 고지 화면. 모든 /services/... 공개 변형은 경로 파라미터에 맞는 문서 분기.

- 선행: R10-T02
- 대상: `src/components/forms/ProcessingCatalog.tsx`; `src/components/forms/Documents.tsx`; `src/components/forms/ConsentDocuments.tsx`; `src/components/forms/PublicServiceDocuments.tsx`; `src/components/management/ConsentDisplay.tsx`; `src/components/management/SubprocessorMail.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P05-T01, P05-T02, P05-T03, P05-T04, P03-T04
- 증거: `catchsecu-clone/docs/qa/R10-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [~] R10-T04 처리 목적·동의서·처리방침·서비스 공개문서 — DB·브라우저·재시작 수용검증

목적+제공자 CRUD→문서생성/개정→공개토큰/PDF 내용일치; 소프트삭제/복구; 게시문서와 이전동의영수증 불변; 국내/국외/수신자/agree 변형 DB fixture로 각각검증.

- 선행: R10-T03
- 대상: `tests`; `scripts`; `docs/qa/R10-T04`
- 기존 작업 연결: P05-T01, P05-T02, P05-T03, P05-T04, P03-T04
- 증거: `catchsecu-clone/docs/qa/R10-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R11 공개 폼·응답·첨부·정정

### [ ] R11-T01 공개 폼·응답·첨부·정정 — 모델·규칙 대조 및 보완

Submission→FormVersion→Answer/ConsentReceipt와 파일 바인딩, 원본문항·동의문구·timestamp 보존을 검증한다. 정정 payload 암호화, 파일 검사 상태, export source 참조 및 purge 후 불가역 비노출을 설계한다.

- 선행: R09-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/submissions.ts`; `src/server/submission-management.ts`; `src/server/submission-access.ts`; `src/server/consent-receipts.ts`; `src/server/files.ts`; `src/server/file-access.ts`; `src/server/file-download.ts`; `src/server/submission-export.ts`
- 기존 작업 연결: P06-T01, P06-T02, P06-T03, P06-T07
- 증거: `catchsecu-clone/docs/qa/R11-T01/`
- 완료 조건:
  - C 제출/동의영수증/첨부/메모; R 응답·파일·내보내기; U 정정/메모/보유기간; D 메모·미참조첨부, 개인정보 삭제는 파기요청.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [ ] R11-T02 공개 폼·응답·첨부·정정 — 서버 API·업무 처리

외부 토큰 조회/제출과 응답 list/read/PATCH/withdraw/hold/retention/note/export API를 점검한다. 응답+영수증+outbox 원자성, 공개 제출 중복과 최대응답 경합, 파일 owner 검증을 수행한다.

- 선행: R11-T01
- 대상: `src/server/submissions.ts`; `src/server/submission-management.ts`; `src/server/submission-access.ts`; `src/server/consent-receipts.ts`; `src/server/files.ts`; `src/server/file-access.ts`; `src/server/file-download.ts`; `src/server/submission-export.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P06-T01, P06-T02, P06-T03, P06-T07
- 증거: `catchsecu-clone/docs/qa/R11-T02/`
- 완료 조건:
  - 게시된폼 외부제출→관리자응답조회→정정→영수증/PDF→첨부hash비교→재시작; 2회제출 멱등; 필수동의누락400; 만료게시/타회사파일/공유범위밖파일 거부; 내보내기 재권한검사.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [~] R11-T03 공개 폼·응답·첨부·정정 — 전체 화면·모달 연결

project/projects/test-projects/url/customer-use-case/jap_intro 별칭의 차이를 명세한다. 응답목록·상세·정정·철회·첨부 실제다운로드·로그; file-view 일반/공유 및 파일 지정/목록 네 변형을 각각 연결한다.

- 선행: R11-T02
- 대상: `src/components/forms/PublicForm.tsx`; `src/components/forms/SubmissionDetail.tsx`; `src/components/forms/FileView.tsx`; `src/components/forms/ExportJobs.tsx`; `src/components/forms/FormLists.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P06-T01, P06-T02, P06-T03, P06-T07
- 증거: `catchsecu-clone/docs/qa/R11-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [~] R11-T04 공개 폼·응답·첨부·정정 — DB·브라우저·재시작 수용검증

게시된폼 외부제출→관리자응답조회→정정→영수증/PDF→첨부hash비교→재시작; 2회제출 멱등; 필수동의누락400; 만료게시/타회사파일/공유범위밖파일 거부; 내보내기 재권한검사.

- 선행: R11-T03
- 대상: `tests`; `scripts`; `docs/qa/R11-T04`
- 기존 작업 연결: P06-T01, P06-T02, P06-T03, P06-T07
- 증거: `catchsecu-clone/docs/qa/R11-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R12 외부 공유·열람자 인증

### [ ] R12-T01 외부 공유·열람자 인증 — 모델·규칙 대조 및 보완

공유권한은 회사·서비스·폼버전·허용필드·대상범위·만료를 가진다. 코드/인증 challenge hash·시도제한·세션 generation으로 권한 수정/회수 뒤 기존세션을 무효화한다.

- 선행: R11-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/sharing.ts`; `src/server/viewer.ts`; `src/server/share-query.ts`; `src/server/share-cache.ts`; `src/server/sender-access.ts`
- 기존 작업 연결: P06-T04
- 증거: `catchsecu-clone/docs/qa/R12-T01/`
- 완료 조건:
  - C 공유권한/열람 challenge; R 공유목록·허용 응답; U 허용필드·기간·대상; D 권한회수/열람세션 폐기.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [ ] R12-T02 외부 공유·열람자 인증 — 서버 API·업무 처리

공유 CRUD/resend/events와 challenge→verify→session→submissions/files/logout API에서 매번 허용필드/범위를 적용한다. 사용자가 전달한 filter로 범위를 넓힐 수 없게 한다.

- 선행: R12-T01
- 대상: `src/server/sharing.ts`; `src/server/viewer.ts`; `src/server/share-query.ts`; `src/server/share-cache.ts`; `src/server/sender-access.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P06-T04
- 증거: `catchsecu-clone/docs/qa/R12-T02/`
- 완료 조건:
  - 공유범위2필드/응답1개 지정→별도브라우저코드인증→그 범위만조회; 필드회수·만료·완전회수 즉시적용; 다른공유의 id 주입·재사용OTP·토큰로그노출 차단.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [ ] R12-T03 외부 공유·열람자 인증 — 전체 화면·모달 연결

공유생성/편집/회수/초대재전송, /shared-privacy/verify·email-verify·view 각 단계와 만료/권한없음. 이메일·공유코드 입력값과 필수동의 확인을 구분한다.

- 선행: R12-T02
- 대상: `src/components/forms/ShareGrants.tsx`; `src/components/forms/SharedPrivacy.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P06-T04
- 증거: `catchsecu-clone/docs/qa/R12-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [ ] R12-T04 외부 공유·열람자 인증 — DB·브라우저·재시작 수용검증

공유범위2필드/응답1개 지정→별도브라우저코드인증→그 범위만조회; 필드회수·만료·완전회수 즉시적용; 다른공유의 id 주입·재사용OTP·토큰로그노출 차단.

- 선행: R12-T03
- 대상: `tests`; `scripts`; `docs/qa/R12-T04`
- 기존 작업 연결: P06-T04
- 증거: `catchsecu-clone/docs/qa/R12-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R13 정보주체·동의이력·본인인증

### [ ] R13-T01 정보주체·동의이력·본인인증 — 모델·규칙 대조 및 보완

동명이인/동일이메일 다른서비스 분리 기준을 확정하고 SubjectAccessScope를 서버에서 좁힌다. 본인인증 결과와 폼버전/사용 목적을 불변 결합하고 secret은 암호화한다.

- 선행: R11-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/subjects.ts`; `src/server/subject-identity.ts`; `src/server/subject-scope.ts`; `src/server/verification.ts`; `src/server/verification-flow.ts`
- 기존 작업 연결: P06-T05, P06-T06
- 증거: `catchsecu-clone/docs/qa/R13-T01/`
- 완료 조건:
  - C 본인조회 challenge/철회요청/인증설정; R 자기동의·처리이력; U 인증설정·철회확정/취소; D 인증설정 비활성·세션종료.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [ ] R13-T02 정보주체·동의이력·본인인증 — 서버 API·업무 처리

access-requests→sessions→consents/events/withdrawals(confirm/cancel), 서비스별 verification CRUD와 검증된 provider callback을 연결한다. 검증 미설정이면 성공 영수증을 만들지 않는다.

- 선행: R13-T01
- 대상: `src/server/subjects.ts`; `src/server/subject-identity.ts`; `src/server/subject-scope.ts`; `src/server/verification.ts`; `src/server/verification-flow.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P06-T05, P06-T06
- 증거: `catchsecu-clone/docs/qa/R13-T02/`
- 완료 조건:
  - 주체A 링크로 B동의 접근거부; 같은이메일 회사간격리; 철회확정→마케팅억제 반영; 취소·반복확정 멱등; 인증만료/중복callback/대상폼교체 거부; 실제기관시험 별도.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [ ] R13-T03 정보주체·동의이력·본인인증 — 전체 화면·모달 연결

find/find-complete, 동의이력·행위이력 토큰, formComplete/form-interrupt 및 /identification/:result에 서버 확인결과를 표시한다. 토큰/URL 문구를 신원증명으로 신뢰하지 않는다.

- 선행: R13-T02
- 대상: `src/components/forms/SubjectPortal.tsx`; `src/components/forms/VerificationSettings.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P06-T05, P06-T06
- 증거: `catchsecu-clone/docs/qa/R13-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [ ] R13-T04 정보주체·동의이력·본인인증 — DB·브라우저·재시작 수용검증

주체A 링크로 B동의 접근거부; 같은이메일 회사간격리; 철회확정→마케팅억제 반영; 취소·반복확정 멱등; 인증만료/중복callback/대상폼교체 거부; 실제기관시험 별도.

- 선행: R13-T03
- 대상: `tests`; `scripts`; `docs/qa/R13-T04`
- 기존 작업 연결: P06-T05, P06-T06
- 증거: `catchsecu-clone/docs/qa/R13-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R14 개인정보 업로드·이관

### [ ] R14-T01 개인정보 업로드·이관 — 모델·규칙 대조 및 보완

파일→헤더매핑→행검증→동의/출처증빙→Submission 변환 관계와 (tenant,job,rowNo)unique를 검사한다. 오류행·부분성공 정책과 원본파일 보존/삭제 시점을 명시한다.

- 선행: R11-T04, R10-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/imports.ts`; `src/server/import-csv.ts`; `src/server/import-worker.ts`; `src/server/legacy-migration.ts`
- 기존 작업 연결: P07-T01, P14-T01
- 증거: `catchsecu-clone/docs/qa/R14-T01/`
- 완료 조건:
  - C 업로드job·행; R 검사결과·오류CSV·진행상태; U 매핑/동의증빙·재검증; D 미실행작업취소·파일정리. commit 이후 증빙은 보존.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [ ] R14-T02 개인정보 업로드·이관 — 서버 API·업무 처리

init/upload/inspect/validate/commit/retry/cancel/rows/errors.csv를 상태기계로 연결한다. 인코딩·크기·확장자·수식 주입·동의 근거 없는 데이터·중복행을 검사한다.

- 선행: R14-T01
- 대상: `src/server/imports.ts`; `src/server/import-csv.ts`; `src/server/import-worker.ts`; `src/server/legacy-migration.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P07-T01, P14-T01
- 증거: `catchsecu-clone/docs/qa/R14-T02/`
- 완료 조건:
  - 정상CSV3행+오류1행→검증수정→확정; 같은commit2번/worker재시작에도 중복없음; B파일주입차단; UTF8/한글·대용량·잘못된동의 증빙·CSV수식 안전성.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [ ] R14-T03 개인정보 업로드·이관 — 전체 화면·모달 연결

업로드 기본/동의/제공자 세 페이지에서 파일·매핑·검증오류·미리보기·확정·진행·재시도·취소를 연결한다. 기존 localStorage 이관은 사용자 선택 dry-run과 중복 보고 후 실행한다.

- 선행: R14-T02
- 대상: `src/components/forms/Imports.tsx`; `src/components/management/LegacyImport.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P07-T01, P14-T01
- 증거: `catchsecu-clone/docs/qa/R14-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [ ] R14-T04 개인정보 업로드·이관 — DB·브라우저·재시작 수용검증

정상CSV3행+오류1행→검증수정→확정; 같은commit2번/worker재시작에도 중복없음; B파일주입차단; UTF8/한글·대용량·잘못된동의 증빙·CSV수식 안전성.

- 선행: R14-T03
- 대상: `tests`; `scripts`; `docs/qa/R14-T04`
- 기존 작업 연결: P07-T01, P14-T01
- 증거: `catchsecu-clone/docs/qa/R14-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R15 광고 동의·수신거부

### [ ] R15-T01 광고 동의·수신거부 — 모델·규칙 대조 및 보완

주체·서비스·채널별 동의, 취득출처/일시/문구버전, 철회이벤트와 억제목록의 연결을 확인한다. 중복수신자 통합 기준과 목적별 동의범위를 명시한다.

- 선행: R11-T04, R13-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/marketing.ts`; `src/server/marketing-jobs.ts`; `src/server/suppression.ts`; `src/server/subject-query.ts`
- 기존 작업 연결: P07-T02
- 증거: `catchsecu-clone/docs/qa/R15-T01/`
- 완료 조건:
  - C 근거 있는 동의등록; R 동의목록·집계·내보내기; U 채널별 동의/철회; D 근거 삭제가 아닌 동의회수·보존정책 적용.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [ ] R15-T02 광고 동의·수신거부 — 서버 API·업무 처리

preferences CRUD/withdrawals/export/sources/summary를 실제 ConsentReceipt와 연결한다. 철회는 예약발송이 claim되는 시점에도 재검사되며 재동의는 새로운 근거를 요구한다.

- 선행: R15-T01
- 대상: `src/server/marketing.ts`; `src/server/marketing-jobs.ts`; `src/server/suppression.ts`; `src/server/subject-query.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P07-T02
- 증거: `catchsecu-clone/docs/qa/R15-T02/`
- 완료 조건:
  - 동의→검색→철회→예약발송억제; 중복제거 on/off 집계 대조; 원본 응답정정 시 잘못된 주체 재동의 방지; 권한없는 복호화·타회사 export 실패.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [ ] R15-T03 광고 동의·수신거부 — 전체 화면·모달 연결

/form/ad-manage 검색조건(동의일·이메일/전화 존재·중복제거), 채널/서비스/폼 필터, 선택철회·수정·내보내기와 marketing-detail 집계를 연결한다.

- 선행: R15-T02
- 대상: `src/components/forms/Marketing.tsx`; `src/components/forms/MarketingSettings.tsx`; `src/components/forms/FormLists.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P07-T02
- 증거: `catchsecu-clone/docs/qa/R15-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [ ] R15-T04 광고 동의·수신거부 — DB·브라우저·재시작 수용검증

동의→검색→철회→예약발송억제; 중복제거 on/off 집계 대조; 원본 응답정정 시 잘못된 주체 재동의 방지; 권한없는 복호화·타회사 export 실패.

- 선행: R15-T03
- 대상: `tests`; `scripts`; `docs/qa/R15-T04`
- 기존 작업 연결: P07-T02
- 증거: `catchsecu-clone/docs/qa/R15-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R16 보유기간·파기 일정·증명서

### [~] R16-T01 보유기간·파기 일정·증명서 — 모델·규칙 대조 및 보완

RetentionRule(service unique)→Form 지정→Submission.retentionUntil 우선순위, legalHold·승인·파기증명서를 대조한다. 파일/내보내기/캠페인 복제본까지 파기 범위를 추적한다.

- 선행: R11-T04, R06-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/retention-rules.ts`; `src/server/destruction.ts`; `src/server/destruction-worker.ts`; `src/server/collect-destruction.ts`; `src/server/destruction-access.ts`
- 기존 작업 연결: P07-T03, P07-T04
- 증거: `catchsecu-clone/docs/qa/R16-T01/`
- 완료 조건:
  - C 보유규칙/파기요청; R 기간·예정목록·증명서; U 보유기간·승인·보류·재예약; D 규칙보관·요청취소·승인된 실제파기. 증명서 수정/임의삭제 없음.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [~] R16-T02 보유기간·파기 일정·증명서 — 서버 API·업무 처리

기존 retention-rules CRUD와 /log/retention 신규 화면을 연결할 계약을 명시한다(원본 정상화면 미확인, 독립 제안). 파기 승인/거절/취소/재시도/재예약과 worker의 참조차단·재실행 안전성을 점검한다.

- 선행: R16-T01
- 대상: `src/server/retention-rules.ts`; `src/server/destruction.ts`; `src/server/destruction-worker.ts`; `src/server/collect-destruction.ts`; `src/server/destruction-access.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P07-T03, P07-T04
- 증거: `catchsecu-clone/docs/qa/R16-T02/`
- 완료 조건:
  - 짧은보유fixture→보류→만료worker실행(유지)→보류해제/승인→실제DB·파일삭제→증명서; 다운로드/발송/정정과 파기경합; worker중단후재개 중복증명서없음.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [~] R16-T03 보유기간·파기 일정·증명서 — 전체 화면·모달 연결

/log/retention 기간규칙목록/추가/편집/보관, 수집파기현황, 파기예정·요청상세·승인/보류·재예약, 증명서조회/다운로드. 파기 이후 빈값이 아닌 파기 상태/근거를 표시한다.

- 선행: R16-T02
- 대상: `src/components/management/destruction.tsx`; `src/components/management/CollectDestruction.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P07-T03, P07-T04
- 증거: `catchsecu-clone/docs/qa/R16-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [~] R16-T04 보유기간·파기 일정·증명서 — DB·브라우저·재시작 수용검증

짧은보유fixture→보류→만료worker실행(유지)→보류해제/승인→실제DB·파일삭제→증명서; 다운로드/발송/정정과 파기경합; worker중단후재개 중복증명서없음.

- 선행: R16-T03
- 대상: `tests`; `scripts`; `docs/qa/R16-T04`
- 기존 작업 연결: P07-T03, P07-T04
- 증거: `catchsecu-clone/docs/qa/R16-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R17 발신번호·문자 캠페인

### [ ] R17-T01 발신번호·문자 캠페인 — 모델·규칙 대조 및 보완

발신번호 검증·증빙파일 및 Campaign→CampaignDelivery→SmsReceipt 고유키, 크레딧예약/정산을 확인한다. 전화번호 정규화·중복 제거·예약 timezone·발신자 변경 버전 고정을 명시한다.

- 선행: R15-T04, R21-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/senders.ts`; `src/server/sender-providers.ts`; `src/server/campaigns.ts`; `src/server/campaign-scheduling.ts`; `src/server/campaign-worker.ts`; `src/server/sms-adapter.ts`; `src/server/campaign-ledger.ts`
- 기존 작업 연결: P08-T01, P08-T02, P08-T03, P08-T04
- 증거: `catchsecu-clone/docs/qa/R17-T01/`
- 완료 조건:
  - C 발신자·초안·수신자·템플릿; R 인증/발송내역; U 초안·예약·기본발신자; D 초안·발신자 비활성/예약취소. 발송완료는 receipt 이력 유지.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [ ] R17-T02 발신번호·문자 캠페인 — 서버 API·업무 처리

발신자 CRUD/검증증빙/disable, 폼응답·직접수신자 구성, 캠페인 preview/schedule/reschedule/cancel/retry와 receipt 서명/순서/중복 검증. 발송직전 동의·권한·잔액 재검사.

- 선행: R17-T01
- 대상: `src/server/senders.ts`; `src/server/sender-providers.ts`; `src/server/campaigns.ts`; `src/server/campaign-scheduling.ts`; `src/server/campaign-worker.ts`; `src/server/sms-adapter.ts`; `src/server/campaign-ledger.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P08-T01, P08-T02, P08-T03, P08-T04
- 증거: `catchsecu-clone/docs/qa/R17-T02/`
- 완료 조건:
  - 번호등록→시험검증→수신자2명→예약→취소/발송→receipt→잔액대조; 미승인번호거부; 철회직후발송차단; provider timeout 재시도 중복비용없음. 실제SMS도착증거 별도.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [ ] R17-T03 발신번호·문자 캠페인 — 전체 화면·모달 연결

sms 기본/폼선택/직접작성/번호관리/내역/번호없음 모두 실데이터. 번호등록 모달의 번호·설명·증빙4종·파일제한을 최신 캡처와 맞추고 작성내용·주소록·비용·예약확인을 구현한다.

- 선행: R17-T02
- 대상: `src/components/services/Senders.tsx`; `src/components/services/Campaigns.tsx`; `src/components/services/MessageTemplates.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P08-T01, P08-T02, P08-T03, P08-T04
- 증거: `catchsecu-clone/docs/qa/R17-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [ ] R17-T04 발신번호·문자 캠페인 — DB·브라우저·재시작 수용검증

번호등록→시험검증→수신자2명→예약→취소/발송→receipt→잔액대조; 미승인번호거부; 철회직후발송차단; provider timeout 재시도 중복비용없음. 실제SMS도착증거 별도.

- 선행: R17-T03
- 대상: `tests`; `scripts`; `docs/qa/R17-T04`
- 기존 작업 연결: P08-T01, P08-T02, P08-T03, P08-T04
- 증거: `catchsecu-clone/docs/qa/R17-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R18 발신메일·이메일 발송·수신거부

### [ ] R18-T01 발신메일·이메일 발송·수신거부 — 모델·규칙 대조 및 보완

템플릿 revision/발송당 HTML·첨부 snapshot, email suppression unique, 반송이벤트 idempotency를 대조한다. 발신 DNS/주소인증 상태는 서버 증거로만 변경한다.

- 선행: R17-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/email-policy.ts`; `src/server/email-feedback.ts`; `src/server/message-content.ts`; `src/server/message-templates.ts`; `src/server/campaign-files.ts`; `src/server/campaign-worker.ts`; `src/server/senders.ts`
- 기존 작업 연결: P09-T01, P09-T02, P09-T06
- 증거: `catchsecu-clone/docs/qa/R18-T01/`
- 완료 조건:
  - C 발신주소/메일초안/첨부/템플릿; R DNS·내역·반송; U 내용·예약·템플릿; D 초안·첨부·예약취소, 발신주소 비활성. 구독취소는 억제 이벤트.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [ ] R18-T02 발신메일·이메일 발송·수신거부 — 서버 API·업무 처리

발신주소 request/confirm/DNS/check, HTML 정제·개인화 preview·첨부다운로드, 송신/반송/불만/구독취소 token 처리와 retry를 연결한다. 조작된 수신거부 토큰·다른회사 receipt를 거부한다.

- 선행: R18-T01
- 대상: `src/server/email-policy.ts`; `src/server/email-feedback.ts`; `src/server/message-content.ts`; `src/server/message-templates.ts`; `src/server/campaign-files.ts`; `src/server/campaign-worker.ts`; `src/server/senders.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P09-T01, P09-T02, P09-T06
- 증거: `catchsecu-clone/docs/qa/R18-T02/`
- 완료 조건:
  - 메일작성/첨부→로컬메일함 수신본문과hash대조→반송→억제→재발송차단; 실제SMTP·DNS·수신함·unsubscribe 및 재시작 검증을 분리 기록.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [ ] R18-T03 발신메일·이메일 발송·수신거부 — 전체 화면·모달 연결

mail 폼/직접발송·발신주소/발송내역/주소없음 화면, 편집기·템플릿·미리보기·첨부·예약/취소·반송사유를 연결한다. 401/403을 빈목록으로 표시하지 않는다.

- 선행: R18-T02
- 대상: `src/components/services/Senders.tsx`; `src/components/services/Campaigns.tsx`; `src/components/services/MessageContent.tsx`; `src/components/services/EmailSuppressions.tsx`; `src/components/services/EmailUnsubscribe.tsx`; `src/components/services/CampaignFiles.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P09-T01, P09-T02, P09-T06
- 증거: `catchsecu-clone/docs/qa/R18-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [ ] R18-T04 발신메일·이메일 발송·수신거부 — DB·브라우저·재시작 수용검증

메일작성/첨부→로컬메일함 수신본문과hash대조→반송→억제→재발송차단; 실제SMTP·DNS·수신함·unsubscribe 및 재시작 검증을 분리 기록.

- 선행: R18-T03
- 대상: `tests`; `scripts`; `docs/qa/R18-T04`
- 기존 작업 연결: P09-T01, P09-T02, P09-T06
- 증거: `catchsecu-clone/docs/qa/R18-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R19 알림톡 채널·템플릿·발송

### [ ] R19-T01 알림톡 채널·템플릿·발송 — 모델·규칙 대조 및 보완

채널귀속·템플릿버전/심사상태/변수·버튼·이미지·fallback snapshot을 대조한다. KakaoMockReceipt는 실제카카오 receipt로 집계하지 않는다.

- 선행: R17-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/kakao.ts`; `src/server/kakao-binding.ts`; `src/server/campaign-worker.ts`; `src/server/campaigns.ts`
- 기존 작업 연결: P09-T03, P09-T04, P09-T06
- 증거: `catchsecu-clone/docs/qa/R19-T01/`
- 완료 조건:
  - C 채널·템플릿·발송초안; R 목록·상세·심사/발송내역; U 초안·반려수정·활성; D 미사용채널/템플릿보관. 승인본 수정은 재심사.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [ ] R19-T02 알림톡 채널·템플릿·발송 — 서버 API·업무 처리

채널 CRUD/verify, 템플릿 CRUD/preview/submit/review/send 및 심사 callback, 수신결과·SMS 대체발송의 과금 멱등성을 점검한다.

- 선행: R19-T01
- 대상: `src/server/kakao.ts`; `src/server/kakao-binding.ts`; `src/server/campaign-worker.ts`; `src/server/campaigns.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P09-T03, P09-T04, P09-T06
- 증거: `catchsecu-clone/docs/qa/R19-T02/`
- 완료 조건:
  - 채널등록→검증→템플릿등록→반려/수정/승인→변수발송→receipt; 승인템플릿수정시 재심사; 비활성채널거부; fallback중복방지; 실제카카오 승인/수신은 제공사시험 증거필수.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [~] R19-T03 알림톡 채널·템플릿·발송 — 전체 화면·모달 연결

/alimtalk/channels 현재 dispatcher 누락을 연결하고 /alimtalk·templates/register·id·id/edit·send·history 전부 실제 상태에 맞춘다. Playground는 미리보기 도구로서 저장이 필요한 동작만 템플릿 계약에 연결한다.

- 선행: R19-T02
- 대상: `src/components/services/KakaoTemplates.tsx`; `src/components/services/KakaoTemplateDetail.tsx`; `src/components/services/Campaigns.tsx`; `src/components/services/kakao.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P09-T03, P09-T04, P09-T06
- 증거: `catchsecu-clone/docs/qa/R19-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [ ] R19-T04 알림톡 채널·템플릿·발송 — DB·브라우저·재시작 수용검증

채널등록→검증→템플릿등록→반려/수정/승인→변수발송→receipt; 승인템플릿수정시 재심사; 비활성채널거부; fallback중복방지; 실제카카오 승인/수신은 제공사시험 증거필수.

- 선행: R19-T03
- 대상: `tests`; `scripts`; `docs/qa/R19-T04`
- 기존 작업 연결: P09-T03, P09-T04, P09-T06
- 증거: `catchsecu-clone/docs/qa/R19-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R20 알림 받기·웹훅·이메일 알림

### [ ] R20-T01 알림 받기·웹훅·이메일 알림 — 모델·규칙 대조 및 보완

integration→subscription(service/form/event)과 delivery/attempt, 암호화endpoint 및 generation을 검사한다. 화면에서 본 9이벤트를 서버 발생지와 일대일 대응시킨다.

- 선행: R11-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/notifications.ts`; `src/server/notification-worker.ts`; `src/server/notification-transport.ts`
- 기존 작업 연결: P09-T05, P09-T06
- 증거: `catchsecu-clone/docs/qa/R20-T01/`
- 완료 조건:
  - C 알림설정/이벤트구독; R 설정·전송이력; U 대상·채널·활성; D 설정해제·일괄삭제. 전달결과는 append-only.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [ ] R20-T02 알림 받기·웹훅·이메일 알림 — 서버 API·업무 처리

CRUD/options/test/enabled/bulk-delete/deliveries/retry를 검증하고 실제 업무 트랜잭션에서 outbox를 만든다. HTTPS목적지·내부주소차단·secret마스킹·재시도 상한을 점검한다.

- 선행: R20-T01
- 대상: `src/server/notifications.ts`; `src/server/notification-worker.ts`; `src/server/notification-transport.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P09-T05, P09-T06
- 증거: `catchsecu-clone/docs/qa/R20-T02/`
- 완료 조건:
  - 폼응답이벤트→정확한 대상1회전송→실패/재시도→비활성/삭제 즉시중단; 다른서비스이벤트누출없음; endpoint변경경합·타임아웃·내부망URL거부. Slack/Teams실제수신 별도.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [ ] R20-T03 알림 받기·웹훅·이메일 알림 — 전체 화면·모달 연결

목록·추가/편집 모달의 이름, webhook/email, 전체/선택 서비스·폼, 9이벤트, 활성토글·테스트·삭제·전송결과/재시도까지 연결한다.

- 선행: R20-T02
- 대상: `src/components/services/Notifications.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P09-T05, P09-T06
- 증거: `catchsecu-clone/docs/qa/R20-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [ ] R20-T04 알림 받기·웹훅·이메일 알림 — DB·브라우저·재시작 수용검증

폼응답이벤트→정확한 대상1회전송→실패/재시도→비활성/삭제 즉시중단; 다른서비스이벤트누출없음; endpoint변경경합·타임아웃·내부망URL거부. Slack/Teams실제수신 별도.

- 선행: R20-T03
- 대상: `tests`; `scripts`; `docs/qa/R20-T04`
- 기존 작업 연결: P09-T05, P09-T06
- 증거: `catchsecu-clone/docs/qa/R20-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R21 라이선스·결제수단·주문·원장·환불

### [ ] R21-T01 라이선스·결제수단·주문·원장·환불 — 모델·규칙 대조 및 보완

가격버전·회사구독·billing method·order/event/refund·복식원장 제약을 확인한다. 금액은 정수, 통화/가격snapshot, eventId unique, 잔액합계·환불누계 불변조건을 정의한다.

- 선행: R04-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/admin-plans.ts`; `src/server/entitlements.ts`; `src/server/payment-methods.ts`; `src/server/payments.ts`; `src/server/subscriptions.ts`; `src/server/subscription-worker.ts`; `src/server/billing-settlement.ts`; `src/server/ledger.ts`; `src/server/billing-reads.ts`; `src/server/billing-history.ts`
- 기존 작업 연결: P10-T01, P10-T02, P10-T03, P10-T04, P10-T05
- 증거: `catchsecu-clone/docs/qa/R21-T01/`
- 완료 조건:
  - C 구독/결제수단/주문/환불요청; R 상품·자산·원장·청구서; U 기본수단·예약해지/취소; D 수단삭제·구독해지. 승인결제/원장은 보정 이벤트만.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [ ] R21-T02 라이선스·결제수단·주문·원장·환불 — 서버 API·업무 처리

provider event 검증·order return·승인/실패/환불 상태기계와 멱등성을 재검증한다. 수정 중인 payment-events/payments/subscriptions를 보존하고 새계획의 검증만 추가한다. success URL은 조회 전용.

- 선행: R21-T01
- 대상: `src/server/admin-plans.ts`; `src/server/entitlements.ts`; `src/server/payment-methods.ts`; `src/server/payments.ts`; `src/server/subscriptions.ts`; `src/server/subscription-worker.ts`; `src/server/billing-settlement.ts`; `src/server/ledger.ts`; `src/server/billing-reads.ts`; `src/server/billing-history.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P10-T01, P10-T02, P10-T03, P10-T04, P10-T05
- 증거: `catchsecu-clone/docs/qa/R21-T02/`
- 완료 조건:
  - 시험주문→승인중복/역순event→1회잔액충전→부분/전액환불→원장합계0검증; 결제중해지409·과거취소구독충전차단 기존회귀 보존; 임의successURL로승인불가; 실제PG시험은 별도.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [ ] R21-T03 라이선스·결제수단·주문·원장·환불 — 전체 화면·모달 연결

license-service/membership/detail/method/billing-policy/history/usage/service-asset/bill/creditBill/refund와 성공/실패/type/errorCode 모든 변형을 연결한다. 대기/중복callback/권한없음·영수증·해지철회를 구분한다.

- 선행: R21-T02
- 대상: `src/components/services/payment.tsx`; `src/components/services/InvoiceDetail.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P10-T01, P10-T02, P10-T03, P10-T04, P10-T05
- 증거: `catchsecu-clone/docs/qa/R21-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [ ] R21-T04 라이선스·결제수단·주문·원장·환불 — DB·브라우저·재시작 수용검증

시험주문→승인중복/역순event→1회잔액충전→부분/전액환불→원장합계0검증; 결제중해지409·과거취소구독충전차단 기존회귀 보존; 임의successURL로승인불가; 실제PG시험은 별도.

- 선행: R21-T03
- 대상: `tests`; `scripts`; `docs/qa/R21-T04`
- 기존 작업 연결: P10-T01, P10-T02, P10-T03, P10-T04, P10-T05
- 증거: `catchsecu-clone/docs/qa/R21-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R22 개인정보·권한·활동 감사로그

### [~] R22-T01 개인정보·권한·활동 감사로그 — 모델·규칙 대조 및 보완

tenant/service/actor/resource/requestId·시간·detail의 최소증거 필드를 대조한다. 현재 UI에서 IP·고객번호·사유가 - 처리되는 영역은 합법적 수집근거/보존과 함께 수집·마스킹 계약을 확정한다.

- 선행: R04-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/audit.ts`; `src/server/audit-events.ts`; `src/server/form-audit-events.ts`; `src/server/activity-reviews.ts`; `src/server/exports.ts`
- 기존 작업 연결: P12-T01, P12-T04
- 증거: `catchsecu-clone/docs/qa/R22-T01/`
- 완료 조건:
  - C 실제업무 처리시 서버가 이벤트 추가; R 필터·상세·CSV; U/D 원장 직접 조작 없음. 검토요청·응답은 별도 resource 상태전이.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [~] R22-T02 개인정보·권한·활동 감사로그 — 서버 API·업무 처리

각 kind(info/marketing/service/member/authority/external/access/customer/mail)와 mine/form 범위 조회·export가 동일 필터를 사용하게 한다. 업무변경과 audit append 원자성, 개인정보원문 최소화·보존집행을 검증한다.

- 선행: R22-T01
- 대상: `src/server/audit.ts`; `src/server/audit-events.ts`; `src/server/form-audit-events.ts`; `src/server/activity-reviews.ts`; `src/server/exports.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P12-T01, P12-T04
- 증거: `catchsecu-clone/docs/qa/R22-T02/`
- 완료 조건:
  - 각 도메인 실제변경1회→해당kind1건→화면/CSV같음; 읽기전용 권한·타회사·허용필드 마스킹; 로그PATCH/DELETE미노출; 경계날짜/KST·대량export·동일시각페이지 누락없음.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [~] R22-T03 개인정보·권한·활동 감사로그 — 전체 화면·모달 연결

9종 로그와 내 활동·폼로그의 기간/서비스/처리자/검색/페이지크기/상세/내보내기, 개인정보활동 검토요청을 실제 컬럼에 연결한다. 403을 건수0으로 표시하지 않는다.

- 선행: R22-T02
- 대상: `src/components/management/AuditLogs.tsx`; `src/components/management/ActivityReviews.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P12-T01, P12-T04
- 증거: `catchsecu-clone/docs/qa/R22-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [~] R22-T04 개인정보·권한·활동 감사로그 — DB·브라우저·재시작 수용검증

각 도메인 실제변경1회→해당kind1건→화면/CSV같음; 읽기전용 권한·타회사·허용필드 마스킹; 로그PATCH/DELETE미노출; 경계날짜/KST·대량export·동일시각페이지 누락없음.

- 선행: R22-T03
- 대상: `tests`; `scripts`; `docs/qa/R22-T04`
- 기존 작업 연결: P12-T01, P12-T04
- 증거: `catchsecu-clone/docs/qa/R22-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R23 대시보드·통계·준수·월마감

### [ ] R23-T01 대시보드·통계·준수·월마감 — 모델·규칙 대조 및 보완

원천조회→서비스필터→기간버킷→snapshot과 근거hash를 대조한다. ComplianceClose와 BillingMonthClose를 다른 모델로 유지한다. 근거없는 점수/과태료를 실제 계산으로 제시하지 않는다.

- 선행: R15-T04, R16-T04, R21-T04, R22-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/analytics.ts`; `src/server/scoped-analytics.ts`; `src/server/compliance-evidence.ts`; `src/server/compliance-close.ts`; `src/server/compliance-exports.ts`; `src/server/analytics-period.ts`
- 기존 작업 연결: P12-T02, P12-T03, P12-T04
- 증거: `catchsecu-clone/docs/qa/R23-T01/`
- 완료 조건:
  - C 월마감 snapshot/출력job; R 대시보드·개인정보/광고통계·마감자료; U/D 수치 직접변경 없음, 출력취소/파일만 삭제 정책.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [ ] R23-T02 대시보드·통계·준수·월마감 — 서버 API·업무 처리

dashboard/privacy/marketing/compliance/closes/exports의 분모·시점·동의철회·파기 반영 기준을 계약화한다. 마감 unique와 정정이력·실패재시도·읽기권한을 검증한다.

- 선행: R23-T01
- 대상: `src/server/analytics.ts`; `src/server/scoped-analytics.ts`; `src/server/compliance-evidence.ts`; `src/server/compliance-close.ts`; `src/server/compliance-exports.ts`; `src/server/analytics-period.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P12-T02, P12-T03, P12-T04
- 증거: `catchsecu-clone/docs/qa/R23-T02/`
- 완료 조건:
  - 수집3→철회1→파기1 fixture로 각통계DB대조; 서비스B제외; KST월말 경계; 마감중복1개; 파기후snapshot의 개인정보비노출; export재시작/취소·다운로드권한.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [~] R23-T03 대시보드·통계·준수·월마감 — 전체 화면·모달 연결

대시보드7경로의 전체/서비스 선택과 기간/드릴다운, /log/month-monitoring의 고정Enterprise gate를 실제 월목록·상세·출력에 연결한다. 근거부족은 미평가로 표시한다.

- 선행: R23-T02
- 대상: `src/components/Dashboard.tsx`; `src/components/StatisticsPages.tsx`; `src/components/forms/Marketing.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P12-T02, P12-T03, P12-T04
- 증거: `catchsecu-clone/docs/qa/R23-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [ ] R23-T04 대시보드·통계·준수·월마감 — DB·브라우저·재시작 수용검증

수집3→철회1→파기1 fixture로 각통계DB대조; 서비스B제외; KST월말 경계; 마감중복1개; 파기후snapshot의 개인정보비노출; export재시작/취소·다운로드권한.

- 선행: R23-T03
- 대상: `tests`; `scripts`; `docs/qa/R23-T04`
- 기존 작업 연결: P12-T02, P12-T03, P12-T04
- 증거: `catchsecu-clone/docs/qa/R23-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R24 공지·도움말·문의·공통 경로

### [ ] R24-T01 공지·도움말·문의·공통 경로 — 모델·규칙 대조 및 보완

공지·첨부/가이드 게시상태·정렬·문의소유자/답변관계를 확인한다. 원본에 없는 관리자 authoring 경로는 독립운영 부가화면으로 별도 등록한다.

- 선행: R02-T04
- 대상: `prisma/schema.prisma`; `prisma/migrations`; `src/contracts`; `src/server/notices.ts`; `src/server/notice-attachments.ts`; `src/server/guides.ts`; `src/server/support-tickets.ts`
- 기존 작업 연결: P13-T01, P13-T02, P13-T03, P13-T04
- 증거: `catchsecu-clone/docs/qa/R24-T01/`
- 완료 조건:
  - C 관리자 공지/가이드·사용자문의; R 게시콘텐츠/상태; U 초안·답변·게시; D 초안/첨부보관. 로딩/오류/wildcard는 별도 CRUD 없음.
  - 사용 필드·관계·FK/unique/index·상태전이·보존/삭제 및 scope를 schema/DTO로 대조. 수정 필요 항목만 새migration; 기존DB 재사용.

### [ ] R24-T02 공지·도움말·문의·공통 경로 — 서버 API·업무 처리

콘텐츠 CRUD/게시·파일, 문의 생성/답변/종결/재개에 systemAdmin·자기문의 접근을 적용한다. 공개/로그인 경계와 안내 페이지의 실제 상태조회 계약을 명시한다.

- 선행: R24-T01
- 대상: `src/server/notices.ts`; `src/server/notice-attachments.ts`; `src/server/guides.ts`; `src/server/support-tickets.ts`; `src/app/api/v1`; `docs/planning/contracts/openapi.json`
- 기존 작업 연결: P13-T01, P13-T02, P13-T03, P13-T04
- 증거: `catchsecu-clone/docs/qa/R24-T02/`
- 완료 조건:
  - 관리자공지생성/게시→일반조회→수정/보관·첨부검증; 일반계정관리CRUD거부; 문의A/B격리; 잘못된경로404·보안fallback·새로고침·뒤로가기·키보드·모바일까지 검증.
  - 각 허용 C/R/U/D/action의 DB변화·감사/outbox 원자성·불허 U/D와 tenant/role/license 거부를 PostgreSQL 통합테스트로 확인.

### [ ] R24-T03 공지·도움말·문의·공통 경로 — 전체 화면·모달 연결

notice/id/help-center·관리자작성/편집·내문의, /·/IE·loading·access-not-allow와 /*·/security/* fallback을 명시적으로 처리한다. wildcards를 임의모든경로 허용 정규식으로 합치지 않는다.

- 선행: R24-T02
- 대상: `src/components/NoticePages.tsx`; `src/components/GuidePages.tsx`; `src/components/SupportPages.tsx`; `src/components/LoadingTransition.tsx`; `src/components/AccessDeniedPage.tsx`; `src/components/AppShell.tsx`; `src/components/CloneApp.tsx`; `src/data/route-manifest.json`; `src/data/menu.json`
- 기존 작업 연결: P13-T01, P13-T02, P13-T03, P13-T04
- 증거: `catchsecu-clone/docs/qa/R24-T03/`
- 완료 조건:
  - route-matrix의 이 도메인 모든 RR 경로: 정상/빈/로딩/검증오류/403·만료/충돌/실패재시도/새로고침 상태
  - 입력→API→DB 재조회→다른화면 반영; 선택/검색/정렬/페이지/URL/query·키보드포커스와모바일 가로넘침을 검증.

### [ ] R24-T04 공지·도움말·문의·공통 경로 — DB·브라우저·재시작 수용검증

관리자공지생성/게시→일반조회→수정/보관·첨부검증; 일반계정관리CRUD거부; 문의A/B격리; 잘못된경로404·보안fallback·새로고침·뒤로가기·키보드·모바일까지 검증.

- 선행: R24-T03
- 대상: `tests`; `scripts`; `docs/qa/R24-T04`
- 기존 작업 연결: P13-T01, P13-T02, P13-T03, P13-T04
- 증거: `catchsecu-clone/docs/qa/R24-T04/`
- 완료 조건:
  - 회사의 허용·거부역할 및 A/B 격리, 해당 C/R/U/D 전체 행동과 실패·중복·경합 시나리오를 독립 DB조회로 검증
  - 브라우저 상태변경 후 새로고침·서버/worker재시작·다른브라우저/재로그인으로 확인; 관련단위/통합·typecheck·lint·build 통과
  - 외부연동이 있으면 로컬어댑터와 실제 provider 수신증거를 분리. 로컬 수용을 통과하면 후속 내부 구현은 진행 가능하며, 실제 계정 미확보 시 해당 작업의 외부검증은 external_pending으로 유지.


## R25 전체 통합·최종 수용

### [ ] R25-T01 모든 경로·메뉴 행동·부가 운영화면 연결 검증

186 source entries + 별도 부가경로 register 전부를 fixture로 실제 열고 메뉴/모달/button을 API와 연결한다. 알려진정상화면과 제한안내를 혼동하지 않는다.

- 선행: R02-T04, R03-T04, R04-T04, R05-T04, R06-T04, R07-T04, R08-T04, R09-T04, R10-T04, R11-T04, R12-T04, R13-T04, R14-T04, R15-T04, R16-T04, R17-T04, R18-T04, R19-T04, R20-T04, R21-T04, R22-T04, R23-T04, R24-T04
- 대상: `src/components`; `src/data`; `scripts/qa-full-page-gate.ts`; `docs/qa/R25-T01`
- 기존 작업 연결: P13-T04, P14-T01
- 증거: `catchsecu-clone/docs/qa/R25-T01/`
- 완료 조건:
  - RR행 186개에 action별 증거와 상태; wildcard2는404/보안fallback 검사
  - 미연결메뉴/핸들러·고정제한안내·가짜저장·localStorage 업무원장·하드코딩통계 잔존0 또는 명시된순수미리보기예외

### [ ] R25-T02 전 도메인 교차 흐름·권한·경합 회귀

조직→문서→폼→승인게시→응답/업로드→공유/정보주체→동의→예약발송→과금→철회파기→로그/통계를 하나의 실제DB 흐름으로 검증한다.

- 선행: R25-T01
- 대상: `tests`; `scripts`; `docs/qa/R25-T02`
- 기존 작업 연결: P14-T02
- 증거: `catchsecu-clone/docs/qa/R25-T02/`
- 완료 조건:
  - 각 단계 원장·파일·집계·상태전이 일치; A/B회사와 역할변경경합
  - API제약 우회/오래된토큰/중복callback/파기와다운로드·발송경합을검증; 4단계 R/C/U/D가 있는 리소스는전부시험

### [ ] R25-T03 외부 제공사·기관·운영 스테이징 검증

SMS·SMTP·카카오·PG·IdP·GPKI/새올/그룹웨어·본인인증·Slack/Teams·S3/파일검사를 전용테스트계정/도메인으로 검증한다. 실제 원본서비스로 mutation을 보내지 않는다.

- 선행: R25-T02
- 대상: `src/server/*adapter*`; `docs/qa/R25-T03`
- 기존 작업 연결: P14-T03
- 증거: `catchsecu-clone/docs/qa/R25-T03/`
- 완료 조건:
  - 실제발신/수신/providerID·receipt/실패·재시도·중복·취소환불 증거
  - 자격증명/기관미확보 항목은 개별blocked 외부검증으로남김; 로컬mock통과로 전체완료표시금지

### [~] R25-T04 이관·백업·복구·운영 런북

기존샘플이관dry-run/검증, DB·파일·암호키 복구전략과 migration·worker운영·장애복구 절차를 시험한다.

- 선행: R25-T02
- 대상: `docs/operations`; `scripts`; `prisma/migrations`
- 기존 작업 연결: P14-T04
- 증거: `catchsecu-clone/docs/qa/R25-T04/`
- 완료 조건:
  - 백업→격리DB/저장소복원→로그인/파일/작업재개→레코드수·hash대조
  - 기존migration수정없이upgrade검증; test/mockcredential 운영차단; 운영설정빠짐을배포성공으로감추지않음

### [ ] R25-T05 UI·접근성·성능·원본 대조 마무리

실제접근가능 원본 화면과 현재캡처를 비교하고 미관찰화면은 독립설계 상태를 유지한다. 대량목록/API/내보내기·작업대기 상태를 실제시험자료로 측정한다.

- 선행: R25-T01
- 대상: `src/components`; `docs/qa/R25-T05`
- 기존 작업 연결: P13-T04
- 증거: `catchsecu-clone/docs/qa/R25-T05/`
- 완료 조건:
  - 데스크톱/모바일·키보드·focus·label·오류알림·한글줄바꿈 검증
  - 임의성능수치 대신 데이터량·측정환경·목표를 fixture계약에서고정; 새이미지diff와차이목록; 원본미확인에100%일치주장금지

### [ ] R25-T06 최종 수용·추적표·릴리스 보고

모든 개별Task evidence를 재검토하고 rootTASKS/tasks.json/goals/route/UI/API/외부검증 지표를 동기화한다.

- 선행: R25-T02, R25-T03, R25-T04, R25-T05
- 대상: `TASKS.md`; `.Codex/goals`; `docs/IMPLEMENTATION-STATUS.md`; `docs/qa/R25-T06`
- 기존 작업 연결: P14-T05
- 증거: `catchsecu-clone/docs/qa/R25-T06/`
- 완료 조건:
  - 미완료필수Task0·테스트실패0·차단미해결0일때만전체완료
  - 코드/DB/API/UI/외부공급사/원본충실도 각각검증범위·제약을보고; 변경기록과재현명령·백업복구자료 완비



- 2026-10-10 조직 이메일 소유 확인·state 로그인/초대 등록 전환·전용 복구 화면 구현. migration108/Prisma134, 고유7파일274시험·실제HTTP16/재시작HTTP1·로컬 메일·디렉터리v2/티켓0/감사12 해시 일치. 독립검토의 만료티켓 발급한도 소모 수정. 시작 브라우저 결합(login CSRF)·SSO outbound DNS/사설IP 차단·HTTPS IdP·Ego 화면 및 외부 인증 수용은 필수 후속. 전체51진행/56계획/0완료, goal active. 증거: `docs/qa/R07-T04/org-email/README.md`.

R08 F2 후속: 질문/보기 logical·DB ID 보존, label/value 분리, 복제/개정/조건 remap과 구 응답 표시 구현. migration111·기존8테이블 지문·새스키마 설치·스키마 차이0 확인. 회귀345→일괄저장144→최종검토67(중복 포함), 실제HTTP30·Ego·재시작 폼4/응답1/감사31건 일치. 직접입력/페이지/특수유형 및 전체상태 수용 잔여. [실행 근거](../../qa/R08-T02/identities/README.md).

F3 EXACT: 명시적 mode로 기존 min/max 의미를 보존하고 행렬 전체미응답/전행정확 검증을 서버·편집·공개·정정에 연결. 관련41·추가38개(중복 포함), HTTP10·Ego·112migration/기존8테이블 보존·재시작 폼1/응답2/감사7건 통과. 길이/특수유형/부가필드/페이지 및 전체상태 수용은 남음. [검증](../../qa/R08-T02/exact-selection/README.md).


F3 기타 직접입력: nullable isCustomValue/migration121·세 선택형/질문당1개/마지막 보기·100 UTF-16 strict 객체·현재 설정 보존/명시해제·기존 일반 답변/긴 이름 호환·조건/정정/공유/CSV 연결. 최종15파일182시험, 실제 Ego CRUD·자동저장 stale 확인 거절·공개 제출/개정/구 응답 정정·로컬메일 공유/회수·CSV/PDF 다운로드 통과. 폼1/게시2/응답1/정정1/감사36·production 재시작과 이전17fixture 지문 보존. FILE/보기 이미지/NLP/자동동의/다중페이지·시각/전체수용은 잔여.


## FILE·보기 이미지 로컬 체크포인트

F3 FILE·보기 이미지: migration122/123·암호화 blob/소유 자산·참조 pin·백신/용량/권한·복사/템플릿/승인/공개/정정/열람 구현. 중복제거24파일314시험·실제HTTP경계12·Ego CRUD/3폭/키보드·ClamAV·다운로드·공유회수 확인. 폼3/응답1/정정1/승인2/감사171·실제blob5와 이전18세트의 production재시작 해시 보존. NLP/자동동의·본문/설명 이미지·다중페이지·전체수용은 잔여. [검증 보고서](../../qa/R08-T02/question-metadata/author-assets/README.md). 공식 작업 상태는0완료/53진행/54계획 유지.

## 동의 항목 자동 집계 로컬 체크포인트

수동 문항 분류에서 `NON_PERSONAL_INFORMATION`을 제외하고 순서·중복을 보존한 항목을 폼 버전에 고정했다. migration141·엄격 JSON 제약·지연 트리거2개, 기존196버전 무백필 보존, 집중24·통합25·확장43시험, Ego 편집/공개/제출, 영수증/PDF, production82페이지와 재시작 해시를 확인했다. [검증 보고서](../../qa/R08-T02/question-metadata/consent-items/README.md). NLP/AI 분류와 법정 동의 문안 전체 생성, R08 전체 수용은 남아 있으므로 공식 상태는 완료0/진행53/계획54를 유지한다.
