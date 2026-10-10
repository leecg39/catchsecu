# 접근 요청의 현재 권한·원자성

2026-10-10. 실제 PostgreSQL 잠금을 이용해 접근 요청 API의 세션/권한 변경 경합을 검사했다.

- `before-corrected.json`, `lock-before-corrected.json`: Company 행 잠금 대기 중 Session을 만료시켰는데 생성201·승인200·취소204가 저장되는 3개 실패를 재현했다.
- 현재 구현은 회사 잠금 다음에 사용자·멤버·세션·MFA·IP·비밀번호·전문가 만료를 확인한다. 목록도 현재 권한과 같은 트랜잭션에서 집계/조회/선택지를 만들고 유효한 마지막 페이지로 보정한다.
- 생성/승인/거절/취소는 감사 기록 뒤에도 만료를 확인한다. 승인에서 생성한 ServiceGrant·멤버 version·요청 상태·감사는 한 트랜잭션으로 롤백한다.
- 승인 대상 사용자/멤버와 서비스의 활성 상태를 검사한다. 관리자보다 높은 청구 권한 부여를 거부하며, 거절은 비활성 요청의 이력을 남길 수 있다.
- `regression-complete.json`: 5파일89개 통과·실패/미실행0. 새 경계 시험28개와 기존 접근요청·컨텍스트·멤버 회귀를 포함한다. `lock-observations.json`에 실제 PID·대기 SQL·응답 상태를 기록했다.

실패 이력도 보존한다. 최초 `before.json`/`fixture-error-before.json`은 시험 코드가 잘못된 AuditEvent 필드 `resourceType`을 사용해 실패했으므로 제품 결함 증거가 아니다. `after-corrected.json`의27통과/1실패는 시험 사용자 상태를 허용되지 않는 `disabled`로 넣은 오류다. 실제 DB 상태 `suspended`로 수정한 `regression-final.json`86개와 추가 업무 경계3개를 포함한 최종89개가 통과했다. 이 결과는 구조화 처리방침 시점의 전체1,834개와 실행 범위가 다르다.

[실제 화면](../../R03-T03/access-flow/README.md)과 [독립 HTTP·DB·재시작](../../R03-T04/access-flow/README.md)을 별도 증거로 남긴다. 전체 R03 또는 전체 역할 수용 완료가 아니다.
