# R22-T03 감사로그·활동 검토 화면 연결

2026-10-11 현재 모든 감사로그 화면의 기간·서비스·검색조건·검색어·페이지·페이지당 행 수를 URL에 보존하도록 보완했다.

- 9종 회사 로그, 나의 활동, 개인정보 활동 검토 이력이 실제 API·DTO를 표시한다.
- 회사·폼 감사로그도 새로고침과 뒤로/앞으로 이동에서 필터와 페이지를 복원한다. 잘못된 UUID·날짜·검색 필드는 안전한 기본값으로 제한한다.
- Ego Lite에서 9종 사건, 동일 시각 21행의 2/3페이지 새로고침, KST `2026-10-11` 경계, 나의 활동, 검토 상세 원문을 확인했다.
- 1440px·390px에서 개인정보·권한 로그와 검토 모달의 문서 가로 넘침과 브라우저 오류는 0건이었다.
- URL 상태·폼 로그·감사 API 시험과 TypeScript·ESLint, production build 83페이지가 통과했다.

## 증거

- [재시작 전 Ego 화면](../R22-T04/current/browser-before-restart.json)
- [재시작 후 Ego 화면](../R22-T04/current/browser-after-restart.json)
- [production build](current/build.log)
- [화면 상태 시험](../R22-T02/current/regression.log)
