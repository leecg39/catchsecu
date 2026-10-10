# P10-T02/T04 — 결제 이벤트와 구독 취소 무결성

2026-10-07. 현재 HEAD308a003에서 다시 조사했다. 기존 결제 동시 처리 구현은 유지하고, 재현된 입력·상태 전이 결함을 수정했다. 전체 목표와72개 수용 조건은 유지한다.

## 재현 및 수정

1. paid/failed 이벤트가 refundId를 받아들였다. 이벤트 종류별 공통 계약으로 분리해 승인·실패에는 refundId를 금지하고, refunded/refund_rejected에는 반드시 요구한다.
2. 이미 반영된 환불 이벤트에서 refundId를 빼고 재전송해도 성공 응답이 나왔다. 요청 종류 검사를 재전송 조회 전에 수행한다. 다른 환불 대상을 같은 이벤트 ID로 보내면409다.
3. 서명은 맞지만 JSON이 잘못된 본문은500으로 끝났다. 이제400 INVALID_JSON을 반환한다. 종류/필드 불일치는422 INVALID_PAYMENT_EVENT다.
4. 결제 주문이 pending인데 구독 요청을 취소할 수 있었다. 이후 승인되면 구독은 cancelled인데 원장만 충전됐다. pending 주문이 있는 구독 취소는409 PAYMENT_IN_PROGRESS로 거부한다. 실패가 확정된 주문은 구독 취소를 허용한다.
5. 과거 코드에서 만들어질 수 있던 cancelled 구독+pending 주문에 뒤늦은 paid가 오면409 SUBSCRIPTION_UNAVAILABLE로 거절하고 이벤트·주문·감사·원장을 변경하지 않는다.

회사 잠금으로 승인과 취소가 직렬화된다. 승인/취소 경합은 활성 구독·paid 주문·원장 충전1회로 끝나고 취소는409다. 거부된 취소 요청 키는 저장하지 않아, 결제 실패 확인 뒤 같은 키로 정상 취소할 수 있다.

새 DB 마이그레이션과 UI 변경은 없다. 기존 화면은 서버의409 안내를 표시한다. 실제 PG에서 이미 승인된 과거 취소 구독은 공급자 결과 대조·정산/환불 처리 대상이며, 이번 변경이 실제 공급자 결제를 자동 취소하지 않는다.

## 검증 결과

| 검사 | 결과 | 근거 |
|---|---|---|
| 수정 전 재현 | 유효 fixture에서7개 실패 | [red-valid.log](red-valid.log) |
| 1차 영향 회귀 | 7파일69개 통과 | [green.log](green.log) |
| 최종 영향 회귀 | 7파일74개 통과, 신규12개 포함 | [green-final.log](green-final.log) |
| 타입 | 전체 통과 | [typecheck-final.log](typecheck-final.log) |
| 린트 | 변경 파일 오류/경고0 | [lint-final.log](lint-final.log), [contracts-qa-lint.log](contracts-qa-lint.log) |
| Production 빌드 | 통과 | [build.log](build.log) |
| 계약 |308경로440작업42정책, 미매핑0 | [contracts-final.log](contracts-final.log) |
| 실제 HTTP |18개 통과 | [http.json](http.json) |
| 같은 빌드 재시작 |5개 통과·업무 해시 동일·QA세션0 | [http-restart.json](http-restart.json) |
| 실행 소스·프로세스 | SHA256 및 두 QA 프로세스 종료 | [result.json](result.json) |

최초 red.log의 환불2개는 존재하지 않는 requestedBy fixture 필드 오류였다. fixture를 수정한 red-valid.log에서7개 모두 실제 기대 동작 실패를 확인했다. 1차69개와 최종74개는 합산하지 않는다. 최초 재시작5개는 쿠키를 포함했고, 최종 재시작 검사는 승인·환불 이벤트의 쿠키/Origin을 빼고 다시 실행했다. 이 중간 기록은 http-restart-with-session.json에 보존하며 HTTP 합계23개에 중복 가산하지 않는다.

OpenAPI가 누락했던 환불 두 종류와 필수 환불 식별자, X-Payment-Signature 필수 헤더 및 쿠키/Origin 면제 조건을 실제 라우트와 맞췄다. 앱 빌드 뒤 계약·QA 스크립트만 추가 정정했으며 최종 전체 타입/변경 린트/계약 검사를 재실행했다. 기존 pg query 중첩 deprecation 경고는 남아 있다.

## 증거 범위와 남은 작업

- 실제 PostgreSQL catchsecu_test와 자체 production QA3197을 사용했다. 사용자3100·기존3189·개발DB·상주worker는 변경하지 않았다.
- HTTP 승인과 환불은 합성 비밀로 서명한 로컬 이벤트다. 실제 PG 승인·환불·입금 대사를 증명하지 않는다.
- 현재 Ego 목록에서 기존 캐치시큐 공간56이 없어 새 공간 생성 여부를 사용자에게 질문했다. 이 턴에서 다른 공간을 가져오거나 새 공간을 만들지 않았다. 브라우저·모바일·원본 대조는 미실행이다.
- 전체 상태는 완료17·진행42·계획13이다. P10-T02/T04를 완료로 바꾸지 않는다. 모든 화면·역할·외부 연동·출시 조건이 충족됐다는 증거는 아니다.
- 새 전체 회귀를 실행했다고 주장하지 않는다. 기존 전체 회귀 기록과 이번74개 영향 회귀를 구분한다.
