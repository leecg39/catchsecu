# 공지 첨부와 가이드 다운로드 감사

2026-10-04. 공지 첨부/가이드의 실제 바이트 검증·응답 준비·감사 기록과 마지막 권한/기한 검사를 같은 transaction에서 처리했다. 관리자가 아닌 가이드 독자도 현재 사용자·세션·회사/서비스 권한을 재검사한다. root-client 감사 쓰기를 제거했다.

처음 fixture의 중복 값 오류와 scanner 미실행 결과는 [초기 기록](baseline-fixture-attempt.log), [이전 실행](tests-attempt1.log)에 보존했다. 실제 이전 구현에서 [8실패·4통과](baseline.log)를 재현하고, 실제 ClamAV 1.5.4/28141 엔진을 사용한 [4파일27개](tests-final.log)를 통과했다(신규 download 12개). 실제 PDF/암호화 저장의 바이트·감사 fault·현재 역할/서비스·세션 만료를 검사한다. scanner를 건너뛴 결과로 완료를 판정하지 않았다. [최종 통합 검증](../../completion/README.md).
