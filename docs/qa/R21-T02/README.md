# R21-T02 결제 서버 API·업무 처리 검증

2026-10-11 현재 소스와 격리 PostgreSQL `catchsecu_test`에서 검증했다.

## 결과

- R21-T02 소유 OpenAPI 작업 34개를 21개 실제 Route Handler와 대조했다. 누락됐던 환불 목록/요청, PDF 청구서, 월마감 조회/생성 5개 작업을 생성 원본에 추가했고 전체 계약은 333 path·474 operation·474 정책 행으로 일치한다.
- 결제 이력·원장·환불·청구서·월마감이 요청 시작 때 만든 오래된 역할을 신뢰하던 공백을 수정했다. 각 조회·변경·멱등 재요청은 트랜잭션 안에서 현재 역할, 세션, 활성 회사, MFA/IP/암호 정책과 처리 후 기한을 다시 검사한다.
- 동일 환불 요청을 정산 뒤 재전송하면 과거 `requested` 캐시 대신 최신 `refunded`·version 2를 반환한다.
- 환불 요청과 월마감은 감사 저장이 실패하면 업무 행, 감사, 멱등 키를 함께 롤백한다.
- 승인 중복·승인/실패 역순·환불 경합·결제 중 해지·과거 취소 구독 승인 차단·임의 success URL 무효·부분/전액 환불을 포함한 결제 회귀 14파일 169시험이 통과했다.
- 실제 DB 독립 대조 결과 불균형 원장 거래 0, 결제액 초과 환불 주문 0, 교차 회사 주문 0, 중복 provider event 0이다.
- 타입 검사와 변경 파일 ESLint, 계약 생성/정책 검사, 활성 계획·경로 기준 검사가 모두 통과했다.

실제 결제 제공사 계정 수신 증거는 이 로컬 API 작업의 완료 조건과 분리하며 R21-T04에서 `external_pending` 여부를 판정한다.

## 증거

- [API·DB 대조](current/api-audit.json)
- [결제 14파일 169시험](current/billing-regression.log)
- [현재 권한 수정 전 실패](current/current-authority-baseline.log)
- [현재 권한 수정 후 집중 시험](current/current-authority-fixed.log)
- [OpenAPI 계약](../../planning/contracts/openapi.json)
- [작업별 정책 행렬](../../planning/contracts/operation-policy-matrix.csv)
