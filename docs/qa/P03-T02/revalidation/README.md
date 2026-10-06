# P03-T02 재검증·현재 권한 보완

> 2026-10-06 후속: 아래의 남은 조건 중 전문가 충돌 복구·회수/만료 재배정·회사 A/B 전환·모바일·재시작 대조를 [새 증거](../expert-state-recovery/README.md)로 확인했다. 외부 SMTP·독립 브라우저/기기와 원본 미관찰 구간의 대조는 남아 있어 전체 완료 판정은 진행 중이다.

2026-10-04. 기준 HEAD 0934f4e에 대한 미커밋 수정이다. **P03-T02는 아직 진행 중이며 전체 목표는 미완료다.**

## 후속 보완: 전문가 운영자·초대 수락

- 전문가 생성/변경/회수/목록/상세/옵션은 트랜잭션에서 현재 사용자와 세션을 잠그고 검사한다. 철회된 운영자 권한으로 캐시된 사용자 정보를 재사용할 수 없다. 저장·감사 이후 세션 기한이 끝나면 배정·구성원·서비스 권한·감사를 함께 롤백한다.
- 초대 미리보기·수락은 현재 계정/세션을 검사한다. 수락 저장 중 세션 또는 초대 기한 종료도 전체 롤백한다.
- 수락 재요청은 현재 계정 이메일, 활성 회사, 수락자, 활성 일반 구성원 연결을 검사하고 최신 회사 이름을 반환한다. 중복 권한이나 감사를 생성하지 않는다.
- 별도 PostgreSQL 신규 전문가 15개 중 수정 전 12개 실패/3개 통과, 수정 후 기존 전문가 4개 포함 19개 통과. 초대 신규 최초 3개 모두 수정 전 실패했으며 재요청 5개를 추가했다.
- 최종 관련 6파일 **110개 통과/실패 0** (`current-authority-combined.json`). 신규 46개는 기존 구성원23 + 전문가15 + 초대8이다. 이는 전체 저장소 테스트 결과가 아니다.
- 최신 타입 검사/변경 린트 통과 (`authority-typecheck.log`, `authority-lint.log`). 최신 production 빌드 통과 (`build-with-authority.log`). 전문가 목록/회사 선택의 서버 페이지 반영도 연결했다 (`expert-pagination-lint.log`). 최초 빌드는 로컬 메일 허용 옵션 누락으로 실패했으며 (`build-authority-missing-local-mail-flag.log`), ALLOW_LOCAL_MAIL=1 지정 후 재실행이 통과했다.

## 보완한 실제 동작

- 구성원 목록/상세/변경/제외/소유권 이전, 초대 목록/생성/재발송/취소에서 현재 회사·구성원·계정·세션과 IP/2FA/암호 정책을 트랜잭션 안에서 다시 검사한다.
- 감사 저장 뒤 세션·임시 예외 등의 기한이 끝났으면 변경·발송 큐·감사 이벤트를 함께 롤백한다.
- 초대 생성의 성공 재요청도 현재 권한과 초대 상태를 확인한다. 재발송 뒤 이전 요청을 다시 보내면 최신 버전을 반환하며 메일을 중복 생성하지 않는다. 회수/만료/처리된 초대는 성공 캐시로 되살리지 않는다.
- 구성원/초대 목록의 범위를 벗어난 페이지를 보정하고 화면에 서버가 반환한 페이지를 표시한다.
- 동시 편집 VERSION_CONFLICT에서 최신 정보 재조회와 입력 복원을 제공한다. 재조회 전까지 오래된 버전으로 반복 저장하지 않는다. 회수/소유자/전문가 등 편집할 수 없는 상태로 바뀌면 창을 닫고 최신 목록을 안내한다.
- QA용 빌드/타입 설정 경로를 환경 변수로 분리해 기존 실행 서버의 .next를 덮어쓰지 않는다. 일반 실행의 기본값은 기존 경로다.

## PostgreSQL 검사

| 단계 | 결과 | 증거 |
|---|---|---|
| 기존 구성원·전문가 검사 | 21개 통과 | baseline-tests.json |
| 새 경계 조건 보완 전 | 17개 실패, 0개 통과: 회수/만료된 권한으로 작업이 성공함 | authority-before.json |
| 초기 수정 후 | 신규 17개 + 기존 21개 = 38개 통과 | authority-after.json |
| 재요청·페이지 검사 추가 후 | 4파일 87개 통과, 실패 0 | related-tests.json |

시험 DB는 로컬 catchsecu_test로 강제하며 다른 DB이면 실행하지 않는다. 신규 테스트 파일은 tests/server/member-current-authority.test.ts다. 감사 이후 기한 검사는 Vitest 시계를 전진시켜 실제 PostgreSQL 트랜잭션 롤백·메일/감사/권한 불변성을 확인한다. 실제 시간 대기 검증과 구분한다.

## 실제 브라우저·HTTP·DB 대조

Ego TaskSpace 45 / p1. 합성 QA 회사와 무작위 암호의 별도 사용자 3개를 만들었다. 이메일 인증 여부는 fixture에서 설정했으므로 이번 흐름은 신규 가입 이메일 인증 검증이 아니다.

- 3101 dev: owner 로그인 → 초대 생성 → 재발송 → 해당 회사/작업에 한정한 로컬 메일 worker → 수신자 로그인 → 초대 수락 → 조회자 구성원 관리 거부.
- 3102 production: owner 재로그인 → 역할 editor/서비스 B 저장 → 새로고침 → 독립 DB의 version 2·역할·서비스 B 일치.
- 화면에서 서비스 전체 회수 → 독립 DB grants 0 및 수신자 HTTP 목록 0.
- 화면에서 구성원 정지 → 독립 DB suspended/version 4 및 이전 세션 HTTP 401.
- 390px 화면에서 다시 활성/서비스 A 저장 → 독립 DB active/version 5·서비스 A·수락 초대와 감사 14건 대조.
- 390×844에서 document scrollWidth=390. 테이블 내부 가로 스크롤과 실제 편집 창의 상태 변경을 확인했다. 캡처를 시각적으로 확인했다.
- 다른 HTTP 세션의 version 5→6 변경 뒤 기존 편집 화면의 저장 충돌을 재현했다. 수정 후 3103 production에서 version 6→다른 세션 7→충돌→최신 정보 조회→version 8 저장을 실제로 실행하고 독립 DB로 확인했다 (browser-conflict-reload.txt/png, browser-conflict-saved.txt/png, conflict-recovery-database.json). 오래된 버전 저장 버튼의 disabled 상태도 DOM에서 확인했다.

핵심 증거: browser-resend.txt/png, local-mail.json, browser-accepted.txt, browser-viewer-denied.txt, database-browser-role.json, service-revocation.json, suspension.json, browser-mobile.png, browser-mobile-restored.txt/png, database-browser-final.json, conflict-external-change.json, browser-conflict-before.txt.

## 최신 전문가 화면 검증 (3104 production)

동일 Ego 45/p1, 새 빌드 .local/recovery-production-v3에서 합성 회사/계정을 사용했다.

- 운영자 화면: 새 배정 → 서비스 A 저장 → 서비스 B로 변경 → 새로고침 후 목록 유지. 독립 DB 배정 version 2/활성, 구성원 viewer/version 2, 서비스 B 한 개의 배정과 grant를 대조했다 (`browser-expert-created.txt`, `browser-expert-updated.txt/png`, `expert-updated-database.json`).
- 전문가 계정: 회사 선택 화면에 배정 회사/서비스 B 표시 → 회사 선택 → 대시보드. 운영 화면 직접 접근은 시스템 운영자 권한 안내로 거부됐다 (`browser-expert-selection.txt`, `browser-expert-dashboard.txt`, `browser-expert-admin-denied.txt`).
- 운영자 재로그인 후 회수 → 전문가 재로그인 → 회사 선택의 회수 표시와 radio/start 버튼 disabled를 DOM에서 확인했다. 독립 DB 배정·구성원 version 3/revoked, grant 0, 해당 회사를 선택한 세션 0, 생성/변경/회수 감사 3건을 확인했다 (`browser-expert-revoked.txt`, `browser-expert-revoked-selection.txt/png`, `expert-revoked-database.json`). 두 캡처는 시각 확인했다.
- 날짜 위젯의 CLI fill은 빈 값을 남겨 Invalid time value를 표시했다. 실제 DOM을 확인하고 관찰된 datetime-local 입력의 native setter와 input/change 이벤트로 입력한 후 저장했다. 이 과정은 날짜 키보드 접근성 검증이 아니다.
- 자동 대기에서 로그인 후 회사 선택 이동을 가정했지만 실제로 dashboard로 이동했다. 전문가 선택은 직접 경로에서 검증했다. 권한 거부도 API 문구가 아니라 실제 화면의 시스템 운영자 권한 안내를 기록했다. 동일 “로그아웃” 제목/버튼의 모호한 선택자는 버튼 역할로 바꿨다. 실패한 대기를 성공 증거로 집계하지 않는다.

## 정적·빌드 검사

- Node 24.19.0, TypeScript --noEmit --incremental false 통과 (typecheck.log).
- 변경 서버/API/UI/테스트 린트 통과 (lint.log), 분리 빌드 설정 린트 통과 (lint-config.log).
- 최초 UI 충돌 보완 전 production build 통과 (build.log).
- 충돌 복구 UI를 포함한 최신 production 빌드와 타입 검사 통과 (build-with-conflict-ui.log), 변경 UI/설정 린트 통과 (lint-with-conflict-ui.log).

초기 별도 빌드는 전용 tsconfig가 생성되기 전에 실행돼 실패했다 (build-initial-missing-tsconfig.log). 설정 파일 생성 뒤 다시 통과했다. 브라우저 시험 중 기본 서비스가 선택돼 있는 것을 선택 없음으로 가정한 대기와 권한 거부 문구를 잘못 지정한 대기는 실패했다. 실제 화면을 다시 확인해 초대 성공과 “구성원 관리 권한이 없습니다.”를 기록했다. 이를 제품 성공/실패와 혼동하지 않는다. database-before-role.json은 화면 저장 완료 이전의 조회이며 저장 후 증거는 database-browser-role.json이다.

## 소유권 이전·재초대·재시작 추가 검증

- 실제 화면에서 잘못된 암호로 소유권 이전을 거부하고 올바른 암호로 이전했다. 이전받은 계정으로 재로그인해 소유자 권한을 확인하고 다시 인계했다. 독립 DB에서 활성 소유자 1명과 감사 이벤트를 확인했다 (`browser-transfer-password-denied.txt`, `browser-transfer-saved.txt`, `browser-transfer-restored.txt`, `transfer-database.json`).
- 기존 구성원을 화면에서 제외하고 같은 이메일을 다시 초대했다. 합성 회사/작업에만 한정한 로컬 worker로 전달했다. 다른 계정의 링크 열람은 거부하고 수신자 재로그인/수락 후 같은 링크의 재사용도 거부했다 (`browser-reinvite-*.txt`, `reinvitation-local-mail.json`). 캡처의 토큰은 제거했다.
- UI 쓰기 완료 후 독립 DB에서 기존 구성원 행의 viewer/active/version 12, 원소유자 owner/version 3, 수락 초대 2개, 관련 감사 18개를 대조했다. 서버 PID 63031→75305 재시작 전후 업무 스냅샷 SHA-256이 동일했다 (`ownership-reinvite-before-restart.json`, `ownership-reinvite-after-restart.json`). 재시작 후 브라우저 대시보드도 서비스 A로 복원됐다 (`browser-reinvite-after-restart.txt`).
- 대시보드에서 같은 서비스명이 여러 요소에 표시되어 모호했던 대기를 실제 서비스 선택 요소의 DOM 조건으로 바꿨다. 최초 실패 대기는 정상 완료 증거에서 제외한다.

## 원래 수용 조건별 증거

| 수용 조건 | 최신 확인 |
|---|---|
| 다른 이메일 초대수락 거부 | `browser-reinvite-wrong-account.txt` 및 관련 서버 검사 |
| 마지막 owner 제거 차단 | `current-authority-combined.json`의 foundation owner 보호·암호 이전, member-management-gate 동시 소유자 회수 검사; UI 이전 후 활성 소유자 1명 독립 DB |
| 권한 회수 직후 API 차단 | `service-revocation.json`, `suspension.json`, 최신 전문가/구성원 권한 서버 검사 및 `expert-revoked-database.json` |
| 화면 쓰기·재로그인·재시작과 독립 DB | 소유권 이전/재초대/역할·서비스·전문가의 위 UI와 해시 증거 |

공통 조건 중 실메일 도달/반송, 추가 회사·독립 브라우저·권한/실패 UI 대조와 관련 선행 게이트는 남아 있다. 위 수용 조건의 개별 통과와 전체 Task 완료를 구분한다.

## 남은 완료 조건

- 전문가 재배정/만료·여러 회사 전환·추가 모바일 시나리오. 생성/변경/회수/단일 회사 선택은 위 최신 UI와 DB를 대조했다.
- 다른 권한/회수 상태로 바뀌는 충돌 복구와 추가 UI 시나리오. 소유권 이전·재초대는 위 UI·DB·재시작 검사를 통과했다. 초대 수락/재요청의 현재 상태·최종 기한 검사는 위 PostgreSQL 검사를 통과했다.
- 회사 A/B, 역할, 다른 기기/브라우저, 정책과 원본 미관찰 구간의 독립 구현 범위 정리.
- 최신 입력에서 필요한 통합/재시작 검사 후 수용 항목별 증거를 대조한다.
- 외부 SMTP는 검증하지 않았다. 로컬 메일 성공을 실제 공급자 성공으로 집계하지 않는다.

## 재현

```sh
qa_node=/Users/user01/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$qa_node" --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/member-current-authority.test.ts tests/server/member-management-gate.test.ts tests/server/expert-assignments.test.ts tests/server/foundation.test.ts
"$qa_node" node_modules/typescript/bin/tsc --noEmit --incremental false
"$qa_node" node_modules/eslint/bin/eslint.js src/server/members.ts src/app/api/v1/invitations/route.ts src/components/management/members.tsx tests/server/member-current-authority.test.ts next.config.ts
```

비밀번호·쿠키·초대 링크는 .local의 0600 파일에만 저장한다. 검증 결과에는 기록하지 않는다. 테스트 중 전체 worker는 실행하지 않았다.

## 현재 실행 환경

검증용 이전 서버 3101/3102/3103은 종료했다. 최신 production 3104 (재시작 후 PID 75305, exec session 41465, build .local/recovery-production-v3)와 Ego TaskSpace 45/p1은 후속 작업을 위해 유지한다. 현재 브라우저는 합성 전문가의 회수된 회사 선택 화면이다. 기존 3100 서버 PID 30204는 변경하지 않았다. 3103 첫 접근은 ready 전이라 연결 거부였고, ready/리스닝 상태 확인 후 동일 페이지에서 정상 검증했다. 다음 실행은 PID/공간의 실제 상태를 다시 확인한다.
