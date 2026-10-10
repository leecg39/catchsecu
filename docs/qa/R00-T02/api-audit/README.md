# R00-T02 API 진입점 대조

2026-10-10T20:30:31.657Z

현재 계약 466개 작업, handler 파일 158개. 진입점/메서드 누락 0개, 정책 누락 0개.

Node 24 전체 회귀 docs/qa/R00-T02/full-tests-current.json은 SSO DB 초기화 hook timeout 2건으로 단일 실행 실패다. 같은 현재 소스의 SSO 파일 재실행 docs/qa/R00-T02/sso-node24-retry.json은 131/131 통과했다. 이 둘을 결합한 실행 증거를 사용하며 단일 전체 회귀 성공으로 집계하지 않는다. handler를 직접 import한 통과 시험이 연결된 operation은 466개이고, 직접 연결이 없는 operation은 0개다. 작업 소유자 연결이 없는 operation은 0개다.

실제 route wrapper 추적 807건 중 766건을 계약에 연결했고, 성공 응답이 관측된 operation은 57개다. catch-all 285개 중 분기 성공이 관측된 것은 34개다. 나머지는 실제 분기와 실행 증거를 추가 확인해야 한다. handler import나 테스트 파일 전체 통과만으로 API별 성공 판정을 만들지 않는다. [정규화된 런타임 추적](../runtime-route-trace.json)

[기계 판독 결과](operations.json)에 handler→서버 함수·DTO 계약/handler import·권한/이벤트 문자열·정책·원래 계약·현재 테스트 파일과 소스 해시를 기록했다.
