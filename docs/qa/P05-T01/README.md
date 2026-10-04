# P05-T01 수집 목적·제공/수탁자 CRUD — 진행 중

> **완료 판정 정정 (2026-10-04): 미완료.** 0934f4e의 일괄 완료 표시는 수용 조건의 증거를 충족하지 못해 철회했다. 아래 구현·시험 주장은 각 실제 파일/실행 결과와 다시 대조한다. 테스트 파일의 존재는 실행 통과나 브라우저/외부 연동 완료를 뜻하지 않는다. [재검증 계획](../../planning/05-completion-recovery.md).

후속 변경: [P05-T02](../P05-T02/README.md)에서 공통 함수의 문서 모듈 참조를 제거하고 문서·문구·폼의 문서 선택에도 같은 현재 권한 검사를 적용했다. 이 문서의 검증 요약·소스 해시는 해당 실행 시점의 기록이다.

2026-10-03. 기존 수집 목적·개인정보 항목·보유기간·제공자/수탁자 CRUD에 현재 세션·이메일 인증·전문가 배정 검사를 보완했다. 선행 P03-T01은 완료했다. 수정 후 브라우저 검증과 원본 대조가 남아 공식 완료는 15/72로 유지한다.

## 이번 변경

- `currentServiceScope`를 폼의 기존 권한 검사에서 추출했다. 폼과 수집 근거가 같은 검사 순서를 사용한다.
- 회사·구성원·서비스 grant와 사용자·세션을 transaction 안에서 잠그고 다시 읽는다. 로그아웃·만료·미인증 상태의 이전 Context는 읽기·변경 모두 거부한다.
- 전문가 배정의 활성 상태·만료·배정 서비스 범위를 검사한다. 여분 grant가 남아 있어도 배정되지 않은 서비스는 조회하지 못한다.
- 보관 서비스의 상세·변경 이력은 유지하고 생성·수정·보관·복원은 거부한다.
- 기존 필드·기간 검증·정규화 이름 중복·같은 서비스 연결·version 충돌·불변 개정본·감사·중복 요청 보호를 유지했다. 새 모델이나 migration은 추가하지 않았다.

## 검증

| 검사 | 결과 | 증거 |
|---|---|---|
| 신규 현재 권한/세션 검사 | 실제 PostgreSQL 7개 통과 | [시험](../../../tests/server/catalog-access-gate.test.ts), [로그](gate-after.txt) |
| 기존 카탈로그·폼·CSV 관련 회귀 | 35개 통과; 당시 신규 1개는 만료 fixture 오류 | [로그](gate-after-expiry-fixture.txt) |
| 전체 PostgreSQL 회귀 | 37개 파일·515개 통과, 실패·대기 0 | [로그](full-test.txt), [JSON](full-test.json) |
| 타입·변경 파일 린트 | 통과, 오류 0 | [타입](typecheck.txt), [린트](lint.txt) |
| Production build | 통과 | [로그](build.txt) |
| 생성·검증·수정·보관·복원 | 실제 HTTP 34개 통과 | [실행](http-prepare.txt), [결과](http-prepare.json) |
| 재시작 후 상세·이력·로그아웃 | 실제 HTTP 8개 통과 | [실행](http-finish.txt), [결과](http-finish.json), [재시작](restart.json) |
| Task·API 계약 | 181개 경로·72개 Task·순환 0, API 249개 경로·363개 작업·정책 누락 0 | [계획](plan-check.txt), [계약](contract-check.txt) |

HTTP는 별도 합성 소유자와 로컬 `catchsecu_dev`의 QA 서비스만 사용한다. 수집 목적 3개·제공/수탁자 3개·각 개정본 6개·총 감사 12개를 독립 DB 연결과 대조했다. 국내 제3자 제공·국외 수탁자·원자료 제공자, 일수·목적 달성·별도 보존 기준, 필수/선택 항목을 실제 저장했다. 최초 목적 개정본의 당시 수탁자 설정과 기간은 수정·보관·복원·서버 재시작 후에도 유지됐다. 시험 세션은 모두 로그아웃했다. 사용자 관리자 계정과 세션은 변경하지 않았다.

검증 스크립트는 [qa-catalog-gate.ts](../../../scripts/qa-catalog-gate.ts)다. Node.js 24로 `.env.local`을 로딩해 `prepare` → 서버 재시작 → `finish`를 실행한다. 분리된 시험 DB에서 신규 통합 시험을 실행하려면 `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/catalog-access-gate.test.ts`를 사용한다. 최종 전체 회귀와 소스 해시는 [검증 요약](verification.json)에 기록한다.

## 최초 실패와 수정

- [첫 실행](gate-before-fixture.txt)의 전문가 3개 실패는 회사를 선택하지 않은 fixture 때문이었다. 실제 회사 선택 API를 호출하도록 수정했다. [진단](fixture-check.txt)에는 비밀값을 저장하지 않았다.
- [수정 전 시험](gate-before.txt)의 실패 6개 중 5개는 실제 권한 누락이었다. 나머지 1개는 전문가 만료 시각을 생성 시각보다 앞서 설정해 DB 제약에 걸린 fixture 오류였다. 미래의 짧은 기한을 저장하고 실제 시간이 지난 뒤 만료를 확인하도록 수정했다.
- [첫 보완 회귀](gate-after-expiry-fixture.txt)는 42개 중 41개를 통과했다. 만료 fixture를 고친 뒤 신규 7개가 모두 통과했다.
- [첫 HTTP 실행](http-before-idempotency.txt)은 중복 이름 시험에 필수 요청 키를 빠뜨려 400을 받았다. 생성 요청에 키를 넣은 뒤 실제 이름 중복 409와 중복 생성 키·상이한 본문 거부를 확인했다. 이 실패는 제품 결함으로 집계하지 않는다. 실패 실행에서 만든 합성 수탁자 1개는 별도 QA 자료이며 최종 3개 자료/12개 감사 집계에 포함하지 않았다.
- [최초 계약 검사](contract-before-matrix.txt)는 갱신한 권한 정책과 생성된 계약 표가 달라 실패했다. 표를 다시 생성하고 읽기 전용 검사로 일치를 확인했다.

## 기존 증거와 남은 게이트

[2026-10-02 CRUD 검증](../processing-catalog/README.md)의 서버 시나리오 15개·두 화면 저장/복원·검색·390px 기록은 당시 실행 증거다. 이번 변경 후의 브라우저 증거를 대신하지 않는다. 원본 두 화면은 라이선스 제한으로 정상 입력 화면을 확인하지 못했으므로 [독립 계약](../processing-catalog/PLAN.md)에 따라 구현했다. 원본 업무 필드와의 동일성은 미확정이다.

기존 Ego 작업 창의 제어 재개 응답 후 수정된 권한 검사·두 CRUD 화면·검색·복원·모바일을 재검증해야 한다. [Ego 브라우저 스킬](/Users/user01/.agents/skills/ego-browser/SKILL.md:74)의 “if it cannot continue, stop and ask the user” 규칙에 따라 새 작업 창이나 다른 브라우저로 제어 제한을 우회하지 않는다. 문서·CSV 반영은 별도 Task의 전체 게이트를 따라 관리한다. P05-T01은 진행 중이다.
