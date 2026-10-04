# P01-T01 DB 마이그레이션·seed

2026-10-04T07:42:51.823Z. 프로젝트 shadow 데이터베이스에서 빈 설치, 직전 migration에서의 업그레이드, 실패한 migration의 롤백과 재실행, 회사 교차 참조 거부, 이메일 중복 거부, seed를 확인했다. dev/test 데이터는 변경하지 않았다.

## 결과

- 빈 스키마에 migration 76개를 설치했다.
- 마지막 migration을 제외하고 적용한 뒤 `migrate deploy`로 나머지를 올렸다.
- 의도적으로 실패한 migration은 테이블과 완료 기록을 남기지 않았다. `migrate resolve --rolled-back`으로 실패 기록을 닫고 파일을 제거한 뒤 재실행은 대기 migration 없음으로 끝났다.
- 회사 B가 회사 A의 서비스를 참조하는 폼 삽입은 SQLSTATE 23503이다.
- 같은 이메일 사용자 두 명은 SQLSTATE 23505이다.
- shadow seed 후 회사 2개와 fixture 계정이 있다.

실행: `npm run verify:p01-db`. 결과: `db-rehearsal.json`.
이 검증은 181개 화면 CRUD 완료가 아니다.
