# Prisma 모델과 실제 DB 정합성

2026-10-11. 현재 migration 148개가 적용된 dev/test DB를 읽기 전용으로 다시 비교했다. 기존 SQL·DB 데이터·제약을 변경하지 않고 Prisma의 FK 이름/갱신 동작, 기본값, 인덱스 이름을 실제 DB에 맞춘 과거 정합화 결과를 현재 스키마까지 재검증했다.

## 최종 결과

- dev/test migration 148/148과 checksum 차이0을 확인한 뒤 다시 읽기 전용으로 대조했다. 아래 contract.json과 checked-diff.sql은 최신 결과이며, 102~104개 시점의 회귀·설계 기록은 보존한다.
- dev/test: 예상하지 않은 차이 **0개**. SQL에서만 관리하는 회사 폐쇄 요청자 FK **1개**가 유지됨을 실제 pg_catalog 정의와 validated 값으로 확인했다.
- `catchsecu_dev-contract.json`, `catchsecu_test-contract.json`과 각 checked-diff.sql이 최종 결과다. `scripts/verify-schema-contract.ts`는 이 FK 한 개 외의 모든 차이를 실패로 처리하며 DDL을 실행하지 않는다.
- `regression-final.json`: 회사 생성·계정 폐쇄·원장·환불·SSO·감사 관련 7파일 **88개 통과, 실패 0개**. Prisma validate/client 생성·전체 타입·변경 린트 통과.
- `schema-before.prisma`와 `changes.json`은 변경 전 모델, 최종 지문, 채택한 변경과 철회한 실험을 구분한다.

## 발견한 회귀와 수정

처음에는 회사 PK와 폐쇄 요청자 ID를 함께 사용하는 복합 FK를 Prisma 관계로 추가했다. raw diff는 dev/test 모두 0개였지만, 회사 nested create의 PK가 null로 처리되어 15개 회귀시험이 실패했다. 해당 관계에 `@ignore`를 붙여도 같은 실패가 재현됐다. 최종적으로 이 두 ORM 관계 필드를 제거하고 기존 SQL FK를 그대로 보존했다. 관계를 제거한 최종 스키마에서 88개 시험이 통과했다.

`current-diff-after.log`와 `test-diff-after.log`는 **회귀가 발견된 중간 스키마**의 기록이며 최종 성공 근거가 아니다. 실패 기록은 `regression-before-repair.json`, `repair-tests.json`에 보존했다. SQL 전용 제약의 이름·정의·원본 migration·사유는 `prisma/sql-only-constraints.json`에 관리한다.

Introspection이 제안한 부분 인덱스 preview와 계정/2FA 관계 cardinality 변경은 적용하지 않았다. PostgreSQL CHECK·트리거 등 Prisma가 완전히 표현하지 못하는 규칙은 기존 migration과 실제 통합시험으로 유지한다.
