# R21-T04 결제·원장·환불 수용검증

2026-10-11 현재 격리된 로컬 PostgreSQL, production 서버, 작업 처리기와 Ego Lite에서 결제 수명주기의 내부 수용을 실행했다. 실제 PG 시험 계정과 공식 수신 영수증은 없어 외부 검증은 `external_pending`으로 유지한다.

## 내부 수용 결과

- 임의 성공 URL과 return 요청만으로는 결제가 승인되지 않았다. 서명된 공급자 승인만 주문·구독·크레딧 원장을 한 번 변경했고, 중복 승인과 늦은 실패 이벤트는 멱등 또는 역순 오류로 처리됐다.
- 결제 진행 중 구독 취소는 `409 PAYMENT_IN_PROGRESS`, 과거 취소 구독의 뒤늦은 승인은 `409 SUBSCRIPTION_UNAVAILABLE`, 초과 환불은 `409 REFUND_EXCEEDS_PAID`로 거부됐다.
- 부분 환불 뒤 잔액 전액 환불을 처리했다. 최종 사용 가능·보류 크레딧은 모두 0이고 세 원장 거래의 차변·대변 합계는 각각 0이었다.
- owner·billing·admin·미인증·타회사 행위와 A/B 테넌트 격리를 실제 HTTP와 독립 DB 조회로 확인했다.
- 서버와 worker를 재시작한 뒤 주문 2건, 환불 2건, 공급자 이벤트 3건, 원장 거래 3건, 감사 10건의 상태 지문 `2c2969271e3f2b78afbd7907ef8bdc764e3f4804d2bb57029912fa5c3deaaa52`가 유지됐다. 승인·환불 이벤트를 다시 보내도 지문은 변하지 않았다.
- Ego Lite에서 저장 세션 복원과 로그아웃 후 새 로그인을 확인했다. 결제 결과·이력·환불·환불 가능 주문 소진 화면은 1440px와 390px에서 브라우저 오류와 가로 넘침 없이 통과했다.
- 결제 회귀 15파일 197개, TypeScript, 변경 파일 ESLint, production build 83페이지가 통과했다.

## 외부 대기

로컬 서명 공급자 경로는 검증했지만 실제 PG sandbox/상용 계정에서 발생한 승인·실패·부분 환불·전액 환불 webhook 영수증은 없다. 실제 공급자 검증을 완료할 때까지 R21-T04는 `in_progress / external_pending`으로 유지한다.

## 증거

- [재시작 전 DB·HTTP 검증](current/database-before-restart.json)
- [재시작 후 동일 지문](current/database-after-restart.json)
- [재시작 전 Ego 검증](current/browser-before-restart.json)
- [재시작 후 세션·재로그인 검증](current/browser-after-restart.json)
- [결제 회귀 검사](current/regression.log)
- [프로덕션 빌드](current/build.log)
- [품질 게이트](current/quality-gates.json)
- [외부 대기 목록](current/external-pending.json)
