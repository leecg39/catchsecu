# 서비스 화면 후속 점검

2026-10-10. 구조화 처리방침 부분 수용 뒤 R03 확인을 시작했다. 아직 R03 수용 통과가 아니다.

- 새 서비스 화면의 서비스명·외부 공개명에 미저장 값을 입력한 뒤 취소 링크를 클릭했다. 확인창 없이 `/set/service`로 이동하며 입력이 사라졌다. `cancel-before.json`은 실제 Ego 관측이다. 이 재현에서는 DB 생성 요청을 실행하지 않았다.
- 공통 GuardedLink 연결 뒤 취소→계속편집으로 입력 유지, 취소→나가기로 이동을 확인했다. `cancel-after.json`.
- 실제 UI에서 서비스 생성→동시 API 편집→409 입력 보존→최신 재조회 취소/확정→다시 편집 저장→보관→보관 목록→복원을 확인했다. `created.json`, `concurrent.json`, `conflict*.json`, `archived.json`, `restored.json`.
- 검증 서비스 `7c3d767e-0eaa-401a-934e-ad6fcd41917f`는 최종 active·version5다. 기존 합성 서비스의 업무 참조 때문에 보관이 거부되는 흐름과 오류 뒤 목록 재조회도 확인했다. `dependency-before.json`, `dependency-recovered.json`.
- 서버 경계 문제는 별도 실제 DB 시험으로 재현·수정했고 관련135개가 통과했다. [서버 증거](../../R03-T02/authority/README.md). 재시작과 독립 DB·HTTP 결과는 R03-T04에 보존한다.
- 전체 접근요청·모든 오류/역할·원본 화면 동등성은 후속 수용 범위다.
- 390/768/1440폭에서 목록의 문서 가로 넘침이 없고390폭 스크린샷도 확인했다. `responsive.json`, `list-390.png`.
- 미저장 서비스 입력 중 서비스 전환의 계속 편집은 입력·선택 서비스를 유지했다. 나가기 확인 뒤에는 새 선택 서비스와 저장된 입력을 재조회했으며 중복 브라우저 확인창은 없었다. `context-guard-after.json`. 시험 뒤 기본 서비스 선택을 복원했다.
