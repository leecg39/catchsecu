# R01-T01 실행환경·DB 변경 이력·스키마 정합성

2026-10-11 완료. 현재 채택 환경인 Node 24.18.0, PostgreSQL 17과 Prisma 7.10.0을 기준으로 dev/test/shadow 로컬 DB를 검증했다. 운영 DB와 외부 서비스는 사용하지 않았다.

## 현재 결과

- dev와 test DB는 source migration 148개가 모두 적용됐고 checksum 차이, 미적용, 미완료 migration이 각각 0개다.
- Prisma schema와 dev/test 실제 DB의 예상 밖 차이는 0개다. Prisma가 표현하지 않는 `Company_closure_requested_by_fkey` 한 개는 원본 migration과 `pg_catalog` 정의·validated 상태를 별도 검사한다.
- author asset 관련 migration 9개, CHECK 10개, unique index 1개, 함수 16개, trigger 24개를 적용 source와 실제 DB에서 대조했다.
- shadow 빈 DB에 migration 148개를 설치했다. 147개 상태에서 마지막 migration을 올리는 upgrade도 148개로 끝났다.
- 의도적으로 실패시킨 migration은 테이블이나 완료 기록을 남기지 않았다. rollback 표시 후 재실행은 정상 복구됐다.
- 회사 B 폼이 회사 A 서비스를 참조하는 삽입은 FK `23503`, 중복 이메일 사용자 삽입은 unique `23505`로 거부됐다.
- shadow seed 후 회사 2개와 fixture 사용자 10개를 확인했다.

## checksum 복구

사전점검에서 세 migration의 적용 checksum과 source checksum 차이를 발견했다. 적용 당시 바이트와 같은 도달 불가 Git blob을 찾아 비교한 결과, 세 파일 모두 SQL 본문은 같고 마지막 빈 줄 한 개만 사라져 있었다. 각 파일을 해당 blob으로 byte-for-byte 복원했다. dev/test 재검사에서 148/148 checksum 차이 0을 확인했다. 적용 이력과 DB checksum은 수정하지 않았다.

세부 blob과 checksum은 `checksum-recovery.json`에 있다. 자격증명이나 DB 연결 문자열은 기록하지 않았다.

## 재현 명령과 증거

- `npm run verify:p01-db`: shadow 빈 설치·upgrade·실패 복구·제약·seed (`db-rehearsal.json`)
- `/Users/user01/.local/bin/node24 --env-file=.env.local --import tsx scripts/qa-preflight.ts`: dev Node/DB/ClamAV와 148 checksum
- `/Users/user01/.local/bin/node24 --env-file=.env.test.local --import tsx scripts/qa-preflight.ts`: test Node/DB/ClamAV와 148 checksum
- `npm run verify:schema`: dev schema 계약
- `/Users/user01/.local/bin/node24 --env-file=.env.test.local --import tsx scripts/verify-schema-contract.ts`: test schema 계약

이 검증은 DB 기반의 완료 증거다. 207개 페이지의 CRUD 실행 완료를 뜻하지 않는다.
