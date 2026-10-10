# R00-T02 API 진입점 대조

2026-10-10T21:39:28.497Z

현재 계약 466개 작업, handler 파일 158개. 진입점/메서드 누락 0개, 정책 누락 0개.

Node 24 전체 회귀 docs/qa/R00-T02/full-tests-current.json이 단일 실행으로 통과했다. handler를 직접 import한 통과 시험이 연결된 operation은 466개이고, 직접 연결이 없는 operation은 0개다. 작업 소유자 연결이 없는 operation은 0개다.

실제 route wrapper 추적 25374건 중 24948건을 계약에 연결했고, 성공 응답이 관측된 operation은 466개다. catch-all 285개 중 분기 성공이 관측된 것은 285개다. 나머지는 실제 분기와 실행 증거를 추가 확인해야 한다. handler import나 테스트 파일 전체 통과만으로 API별 성공 판정을 만들지 않는다. [정규화된 런타임 추적](../runtime-route-trace.json)

[기계 판독 결과](operations.json)에 handler→서버 함수·DTO 계약/handler import·권한/이벤트 문자열·정책·원래 계약·현재 테스트 파일과 소스 해시를 기록했다.
