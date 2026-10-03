# 수집 목적·제공/수탁자 CRUD 검증

2026-10-02. **회사·서비스별 수집 목적과 제공/수탁자의 생성·조회·수정·보관·복원을 PostgreSQL, API, 두 기존 화면에 연결했다.** P05-T01의 부분 구현 증거이다. 선행 전체 게이트와 문서 생성·CSV 반영은 남아 있어 전체 완료 수는 올리지 않는다.

원본 두 화면은 라이선스 제한으로 정상 입력 화면을 확인하지 못했다. [사전 계획](PLAN.md)의 독립 계약을 구현했다. 원본과 동일한 업무 필드라고 단정하지 않는다.

## 구현 범위

- 수집 목적: 이름, 처리 목적, 수집 근거와 설명, 개인정보 항목별 분류·필수 여부, 보유 기준, 제공/수탁자 연결.
- 제공/수탁자: 제3자 제공·처리 위탁·원자료 제공자 유형, 국가·지역, 목적·항목·기간, 연락처, 국외 처리 방법·시기·거부 안내.
- 보유 기준: 일수(1~36500), 목적 달성까지, 별도 보존 기준. 일수 이외에는 종료/보존 기준을 입력한다. 비동의 근거는 설명을 요구한다.
- 목록 검색, 상태 필터, 페이지 이동, 상세·수정, 보관함·복원, 변경 이력. 마지막 페이지가 비면 유효한 페이지로 돌아간다.
- 현재 회사·소속·역할·서비스 권한을 다시 검사한다. 수정·보관·복원에는 version이 필요하다. 같은 서비스 변경은 DB 잠금으로 직렬화하며, 생성은 중복 요청 키로 보호한다.
- 다른 회사·서비스의 제공자를 연결하지 못한다. 활성 목적에 연결된 제공자는 보관할 수 없다. 목적을 복원하려면 연결된 제공자부터 복원해야 한다.
- 모든 변경은 불변 개정본과 감사를 함께 저장한다. 목적 개정본에는 당시 제공자의 설정도 남는다. DB 직접 쓰기로 본문이나 연결을 변경해 이력을 생략하는 것도 차단한다.

국가·지역은 [Unicode CLDR의 고정 버전](https://github.com/unicode-org/cldr/blob/b873ba0be9200a5877ec8443e576fb0a4b744d70/common/validity/region.xml)의 regular 코드 257개를 사용한다. [출처·해시](region-source.json), [자료](../../../src/data/region-codes.json), [라이선스](../../../src/data/UNICODE-LICENSE.txt)를 포함했다.

## 실제 검증 결과

| 검사 | 결과 | 근거 |
|---|---|---|
| 수집 근거 통합 시나리오 | 15개 통과 | [테스트](../../../tests/server/processing-catalog.test.ts), [실행 로그](tests-second.log) |
| 기존 기능 포함 통합 검사 | 131개 통과 | [전체 실행](tests-all.log) |
| 타입 검사·프로덕션 빌드 | 통과 | [타입](typecheck.log), [빌드](build.log) |
| 린트 | 오류 0, 기존 경고 21 | [로그](lint.log) |
| 개발·테스트 DB migration | 15~17 적용 | [개발](migrate-dev.log), [테스트](migrate-test.log) |
| 화면 입력·새로고침·두 경로 | 실제 PostgreSQL과 일치 | [최종 DB 대조](database-final.json) |
| 11개 검색·2페이지·범위 보정 | 마지막 항목 보관 뒤 1/1, 10행 | [2페이지](browser-page-two.txt), [보정 후](browser-page-clamped.txt) |
| 390px 편집창 | 문서 390px, 대화창 342px, 가로 넘침 없음 | [측정](browser-mobile.json), [화면](browser-mobile.png) |

[계획 대조](plan-check.log)는 CSV 181개·메뉴 34개·Task 72개의 연결을 확인했다. 전 경로 동작 완료를 뜻하지 않는다. [migration 상태](migrations.log)는 17개 적용을 확인한다. [문서 링크](links-check.json)와 [출력 비밀값 검사](secret-check.json)도 통과했다.

테스트는 별도 `catchsecu_test`에서 실제 API 핸들러와 PostgreSQL을 실행한다. 회사·역할·서비스 권한 회수, 이전 context 재사용, Origin 거부, 잘못된 기간·항목·국가, 연결 의존성, NFKC 이름 중복, 동시 수정 충돌, 중복 생성, 이력 페이지, DB 직접 변경 거부를 확인했다.

[첫 실행](tests-first.log)에서 연결만 직접 삭제하면 개정본을 생략할 수 있는 문제를 재현했다. migration 17의 지연 제약으로 트랜잭션 종료 시 현재 연결과 개정본을 대조하게 수정했다. 테스트의 감사 모델 참조 오타도 수정했다. 이후 15개와 전체 131개가 통과했다.

## Ego에서 조작한 흐름

1. 국외 수탁자를 등록했다. 이전 방법·시기·거부 안내가 비어 있으면 저장되지 않았다. [등록](browser-recipient-created.png).
2. 계약 근거, 필수 이름·선택 이메일, 목적 달성까지의 기간, 수탁자 연결을 가진 수집 목적을 저장했다. 새로고침 뒤에도 유지됐다. [화면](browser-purpose-reload.png), [DB](database-created.json).
3. 수탁자 목적을 변경하고 수집 목적 기간을 45일로 수정했다. 첫 개정본에는 종전 제공 목적과 보유 기준이 남았다. [이력](browser-history-preserved.png), [DB](database-updated.json).
4. 사용 중인 수탁자 보관이 거부됐다. 목적을 먼저 보관한 뒤 수탁자도 보관했다. [거부](browser-archive-blocked.png), [보관함](browser-archived.png), [DB](database-archived.json).
5. 수탁자가 보관된 상태에서 목적 복원을 시도하면 거부됐다. 수탁자→목적 순으로 복원했다. [거부](browser-restore-blocked.png), [복원](browser-restored.png), [DB](database-restored.json).
6. 서버를 재시작하고 `/basic/info-usage-purpose/privacy-policy`에서 별도 보존 기준으로 변경했다. 새로고침과 `/basic/info-usage-purpose` 재진입에서도 같은 값이 보였다. [처리방침 자료](browser-policy-final.png), [수집 목적](browser-purpose-final.png).
7. 페이지 시험용 합성 자료 11개를 API로 준비한 뒤 UI 검색·행 수 변경·2페이지 이동·마지막 행 보관을 조작했다. 빈 2페이지 대신 1페이지로 돌아왔다. [시험 자료](browser-pagination-fixtures.json), [이동 전](browser-page-two.png), [보관 후](browser-page-clamped.png). 검증 뒤 시험 자료 11개 모두 보관했다. [정리 기록](browser-pagination-cleanup.json).

[독립 DB 대조 스크립트](../../../scripts/qa-processing-catalog.ts)는 목적 5개 개정본, 제공자 4개 개정본, 쓰기 감사 9건, 연결 FK, 선택 항목, 최초 개정본의 당시 제공자 값을 확인한다. 위 두 주 QA 자료는 이후 검증을 위해 활성 상태로 남겼다. 원본 운영 데이터는 변경하지 않았다.

## 모델·API와 남은 범위

[모델](../../planning/01-data-models.md), [API](../../planning/02-api-contracts.md), [OpenAPI 125개 경로](../../planning/contracts/openapi.json)에 계약을 반영했다. 새로운 CRUD와 이력·복원 API를 구현 상태로 표시하고, 미구현 API는 planned 상태로 유지한다.

- [migration 15: 모델·검증·관계](../../../prisma/migrations/20261002163000_processing_catalog/migration.sql)
- [migration 16: 본문·개정본 일치](../../../prisma/migrations/20261002164000_catalog_revision_guards/migration.sql)
- [migration 17: 연결·개정본 일치](../../../prisma/migrations/20261002165000_catalog_link_revision_guard/migration.sql)
- [서버](../../../src/server/processing-catalog.ts), [화면](../../../src/components/forms/ProcessingCatalog.tsx), [입력 계약](../../../src/contracts/processing-catalog.ts)

문서 초안 생성·게시·PDF, 서비스의 문서 표시 설정과 실제 동의 증거 연결, CSV 업로드·미리보기·반영·실패행 다운로드는 후속 작업이다. 수집 근거 설정을 저장했다고 기존 응답의 보유 기한이나 동의 내역이 바뀌지는 않는다. 전체 181개 경로의 CRUD·외부 연동·전체 게이트는 계속 진행 중이다.
