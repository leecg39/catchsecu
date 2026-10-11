# R22-T02 감사로그·활동 검토 서버 API 검증

2026-10-11 현재 9종 감사로그, 나의 활동, 폼 감사, CSV, 개인정보 활동 검토의 서버 계약을 PostgreSQL에서 검증했다.

- service/info/marketing/customer/member/authority/external/access/mail 9종은 같은 필터의 목록과 CSV에서 같은 사건을 반환했다.
- owner 전체 범위, privacy 서비스 범위와 마스킹, viewer 거부, 미인증 거부, 타회사·타서비스 404를 확인했다.
- 원문 detail·토큰·검색어는 응답과 열람 감사에 노출되지 않는다. CSV는 수식 방어와 5,000행 상한을 적용한다.
- 같은 시각 행은 `createdAt DESC,id DESC`로 페이지 사이에 중복·누락되지 않는다. 감사 행의 직접 UPDATE·DELETE는 DB에서 거부된다.
- 검토 요청·답변·종결·알림·보유 기한·파기/보존은 권한, 버전, 멱등, 경합, 감사 원자성을 지킨다.
- 실제 사건 생산자를 포함한 16파일 313개 시험이 파일 순차 실행으로 통과했다.

## 증거

- [서버·생산자 회귀 313개](current/regression.log)
- [기존 실제 업무 참조 대조](audit-resources/README.md)
- [HTTP·DB 수용 35개](../R22-T04/current/api-before-restart.json)
