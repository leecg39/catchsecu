# R23-T02 통계·준수 서버 검증

대시보드, 개인정보, 마케팅, 준수 현황, 월마감과 출력 작업의 서버 계약을 실제 PostgreSQL에서 검증했다.

- 개인정보 통계는 전용 `/analytics/privacy`, 마케팅 통계는 `/analytics/marketing`을 사용한다. 회사·서비스 A/B와 역할 범위를 서버에서 다시 검사한다.
- 수집 3건, 동의 철회 1건, 파기 1건 fixture에서 현재 보유 2건·기간 접수 3건·보존 조치 1건·기간 파기 1건을 독립 DB와 API로 대조했다.
- 날짜 입력은 KST 반개구간으로 변환하며 월말과 윤일을 호스트 시간대와 무관하게 계산한다.
- 대시보드·개인정보·마케팅·준수 API의 중복 query는 422로 거부한다. 마감 중복 요청은 같은 불변 snapshot 한 건으로 수렴한다.
- 회사/서비스·viewer·타회사·미인증·없는 서비스와 PATCH/DELETE 405를 포함한 HTTP 23개 검증이 재시작 전후 통과했다.
- 관련 서버·UI 회귀 9파일 146개가 통과했다. 최초 실행 실패는 `.env.test.local`을 누락한 시험 명령 오류이며 최종 회귀와 분리했다.

## 증거

- [최종 회귀 146개](current/regression-final.log)
- [재시작 전 HTTP·DB](../R23-T04/current/api-before-restart.json)
- [재시작 후 HTTP·DB](../R23-T04/current/api-after-restart.json)
