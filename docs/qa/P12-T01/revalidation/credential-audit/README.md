# 비밀번호 변경과 세션 종료 감사

2026-10-04. migration77은 비밀번호 변경 시 이전 세션 DELETE의 반환 행마다 `session.ended`를 기록하고 `password.changed`와 같은 요청 ID를 사용한다. HTTP mutation scope의 요청 ID를 transaction-local 설정에 연결했으며, 직접 DB 경로는 한 UUID를 생성한다. Account·PasswordHistory·Session·AuditEvent는 같은 transaction에서 롤백된다.

[기존 구현의 6실패·1통과](baseline.log)를 보존했다. 보완 뒤 [4파일75개](tests-attempt1.log)가 통과했다(신규 credential 7개, password24, public-auth26, auth-mutations18). 시험 DB에 [migration77](migrate-test.log)을 적용했다. 개발 DB도 [deploy](../../completion/migrate-dev.log) 뒤77개 migration/checksum 및 원장 불변 트리거를 확인했다. 개발 DB의 전체 변경 전 스냅샷은 trigger의 char 직렬화 오류로 확보하지 못했으므로 개발 DB 전체 행의 전후 동일성을 주장하지 않는다.

[실제 HTTP](../../completion/credential-http.json)는 제거된 세션1개의 종료, 비밀번호 변경, 교체 세션 생성3건의 요청 ID 일치를 독립 DB에서 확인한다. 비밀번호·쿠키는 비공개 .local 파일에만 있다. [최종 통합 검증](../../completion/README.md).
