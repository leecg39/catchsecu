# R00-T02 런타임 route 추적

## 결과

- 지원 Node 24.18.0에서 실제 Next route handler를 호출하는 6개 테스트 파일, 86개 테스트가 모두 통과했다.
- route wrapper가 발행한 요청 807건 중 766건을 OpenAPI method+path에 연결했다.
- 59개 operation이 관측됐고, 그중 57개에서 400 미만 응답을 확인했다.
- catch-all 285개 operation 중 34개 분기의 성공 응답을 확인했다. 남은 251개는 미검증 상태다.
- 계약에 매칭되지 않은 41건은 성공 operation 수에 포함하지 않았다.

## 재현

~~~bash
CATCHSECU_ROUTE_TRACE_FILE=.local/r00-t02-route-trace.jsonl PATH=/Users/user01/homebrew/bin:$PATH npm test --   tests/server/auth-public-audit.test.ts   tests/server/auth-mutations-audit.test.ts   tests/server/password-policy.test.ts   tests/server/notices.test.ts   tests/server/guides.test.ts   tests/server/support-tickets.test.ts --reporter=dot
PATH=/Users/user01/homebrew/bin:$PATH npm run verify:route-runtime
PATH=/Users/user01/homebrew/bin:$PATH npm run verify:api-audit
~~~

원시 추적 파일은 동적 ID 등 실제 요청 경로를 포함할 수 있어 .local에만 둔다. 저장소에는 OpenAPI 템플릿·상태 코드 집계·원본 SHA-256만 담은 [정규화 결과](../runtime-route-trace.json)를 보존한다. handler import나 테스트 파일 전체 통과만으로 분기 성공을 판정하지 않는다.

외부 공식 공급자 자격증명이 필요한 흐름은 이 추적으로 완료 처리하지 않으며 external_pending을 유지한다.
