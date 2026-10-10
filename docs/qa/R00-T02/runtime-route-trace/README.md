# R00-T02 런타임 route 추적

## 최종 결과

- 지원 Node 24.18.0 전체 회귀를 한 번에 실행해 **196개 파일·261개 suite·2,877개 테스트 전부 통과**했다. 실패·대기·todo는 0이다.
- 실제 Next route wrapper 요청 **25,374건** 중 **24,948건**을 OpenAPI method+path에 연결했다. 계약 밖 요청 426건은 성공 수에 포함하지 않았다.
- 계약 **466개 operation 전부**에서 400 미만 성공 응답을 관측했다.
- catch-all handler의 **285개 분기 전부**에서 성공 응답을 관측했다.
- 마지막 6개 경로 회귀는 6개 파일·117개 테스트가 모두 통과했다.

## 증거

- [정규화된 전체 추적](../runtime-route-trace.json)
- [API operation 대조](../api-audit/operations.json)
- [지원 Node 전체 회귀](../full-tests-current.json)
- [마지막 6개 경로 회귀](final-six-regression.json)
- 단계별 회귀 결과는 이 폴더의 `core-regression.json`, `extended-regression.json`, `supplemental-regression.json`, `remaining-routes-regression.json`과 재시도 기록에 보존했다.

## 재현

~~~bash
CATCHSECU_ROUTE_TRACE_FILE=.local/r00-t02-route-trace.jsonl npm test
npm run verify:route-runtime
npm run verify:api-audit
~~~

원시 추적은 동적 ID와 query를 포함할 수 있어 `.local`에만 둔다. 저장소에는 OpenAPI 템플릿과 상태 코드로 정규화한 결과만 보존한다. 외부 공식 공급자 자격증명이 필요한 흐름은 이 감사만으로 외부 검증 완료 처리하지 않는다.
