# R03-T03 회사·서비스·초기 설정 화면 수용

2026-10-11. `/company-info`, `/service/none`, `/set/company`, `/set/company/edit`, `/set/service`, `/set/service/modification` 여섯 경로의 화면 상태와 실제 저장 흐름을 완료 기준으로 다시 대조했다.

## 결과

- Ego Lite에서 회사 생성·편집·409 복구·사업자 파일 첨부/교체/삭제·폐쇄 요청/취소·새로고침을 실행했다.
- 서비스 생성·편집·409 복구·보관/복원·참조 중 보관 실패/재시도를 실행했다. 현재 검증에서는 서비스 25개를 만들고 첫 페이지 20개, 둘째 페이지 5개, 이전/다음 버튼 상태와 `R03 서비스 01` 검색 후 1개 결과·1페이지 초기화를 확인했다. 서비스명 오름차순을 선택하면 첫 두 행이 `R03 서비스 01`, `R03 서비스 02`로 바뀌는 것도 확인했다.
- 권한 없는 조회자에게 서비스가 비어 있는 화면을 확인하고 `R03 서비스 01` 접근요청을 화면에서 생성했다. PostgreSQL은 대기 요청 1개, 조회자 grant 0개, `access_request.created` 감사 1개를 저장했다.
- 기존 접근요청 브라우저 증거는 생성·취소·거절·경합409·승인·권한 즉시 반영·조회 실패/재시도·process 재시작을 포함한다.
- 회사, 서비스, 요청자, 검토자 화면은 390/768/1440px에서 문서 가로 넘침이 0이다. 좁은 표는 표 컨테이너 안에서만 스크롤한다.
- 화면·API·경로 회귀 4 suite 19개와 TypeScript, ESLint, local-provider 명시 허용 production build 82페이지가 통과했다. 허용 플래그는 로컬 빌드용이며 외부 공급자 완료로 집계하지 않았다.

## 상태별 증거

- [상태 행렬](state-matrix.json)
- [Ego Lite와 PostgreSQL 대조](ego-browser-postgresql.json)
- [화면 계약 회귀](ui-contract-regression.json)
- [반응형 요약](responsive-summary.json)
- [품질 게이트](quality-gates.json)
- [검증 요약](verification-summary.json)
- [회사 흐름](../company-flow/README.md)
- [서비스 흐름](../service-flow/README.md)
- [접근요청 흐름](../access-flow/README.md)

원본에서는 `/set/company`와 `/set/service` 정상 화면만 직접 관찰했고 나머지 네 경로는 정적 선언 또는 제한 화면까지만 확인됐다. 따라서 원본 충실도는 `partial_observed`로 기록하며, 독립 제품의 CRUD 동작 검증과 원본 화면 관찰 범위를 구분한다.
