# 최신 Mock DB·파일 백업 복구 리허설

2026-10-06, 지원 Node24에서 `scripts/verify-mock-restore.mjs` 실행. **통과**. [전체 결과](report.json) · [복원 후 앱 검사](api.json).

- 원본: 격리된 `catchsecu_mock_admin`, 첨부 저장소 `.local/mock-page-storage`.
- 새 무작위 `catchsecu_mock_restore_*` DB에 논리 백업 복원. 기존 DB를 덮어쓰지 않는다.
- 마이그레이션100개, 테이블128개·617행의 정렬된 행 해시 전부 일치.
- 컬럼·제약조건·인덱스·함수·트리거·열거형2,747개 및 시퀀스 상태 일치.
- 암호화된 첨부 객체1개 복사 전후 해시 일치.
- 복원 DB의 실제 앱 경로6검사: 소유자 로그인200, 암호화 파일 복호·다운로드 원문해시 일치200, 익명401, 공유 다운로드200, 공유 회수 후 기존 쿠키401, 재파기 후410.
- 재파기 결과: 응답 destroyed·답변0·첨부 객체 실제 제거·파기증명서1.
- 복원본 로그인·권한 회수·재파기 후에도 원본 DB 및 원본 객체 해시는 그대로다.
- 전체 타입 검사와 변경 스크립트 린트 통과.

## 재실행

1. [동적 Mock fixture 준비](../dynamic-fixtures/README.md)를 재실행해 파일·30분 인증 세션을 새로 만든다.
2. 프로젝트 루트에서 지원 Node22/24로 `node scripts/verify-mock-restore.mjs` 실행.
3. 로컬 PostgreSQL 관리자 OS 계정의 createdb 권한이 필요하다. 앱 비밀값은 CLI 인자로 전달하지 않는다.

백업·복원 파일은 비공개 `.local/mock-restores/<새DB명>/`에 남는다. DB 덤프0600·상위폴더0700, 원문은 커밋하지 않는다. 복원 후 앱 검사 스크립트는 DB 이름과 저장소가 같은 전용 복원 경로인지 검증한 뒤 재파기를 실행한다. 보고서는 행 내용/쿠키 대신 개수·해시·상태만 기록한다.

## 최초 실패와 수정

[first-attempt.json](first-attempt.json): 데이터는 일치했으나 CHECK 식10개의 AND 괄호 출력이 pg_dump/restore 과정에서 정리되어 문자열 해시가 달랐다. PostgreSQL `pg_get_constraintdef(..., true)` 정규 출력으로 비교해 해결했다. 임의로 조건 문자열의 괄호를 제거하지 않는다.

[fixture-query-failure.json](fixture-query-failure.json): 후속 앱 검증에서 ShareGrant에 없는 `status` 필드를 조회한 시험 코드 오류. 실제 모델의 `revokedAt: null` 조건으로 수정하고 전체 백업·복원·앱 검사를 재실행했다.

이 리허설은 **합성 데이터의 로컬 논리 복구**다. 운영 S3, WAL 증분/PITR, 실제 운영 데이터 복구, 브라우저 화면 수용을 증명하지 않는다.
