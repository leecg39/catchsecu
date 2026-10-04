# P10-T02 결제수단·PG 주문·인증

## 개요

PG 주문 생성, 결제 수단 인증 토큰화, 위조 방지 웹훅 처리, 카드 원문 비저장 원칙 및 멱등 결제 승인을 구현한다.

## 구현 내용

1. **주문 및 결제 엔드포인트**:
   - `POST /api/v1/billing/orders`: 주문 생성 (결제 대기 `pending`)
   - `GET /api/v1/billing/orders/[id]`: 주문 상태 확인
   - `POST /api/v1/billing/orders/[id]/return`: 사용자 리턴 URL 처리
   - `POST /api/v1/billing/webhook`: PG 웹훅 수신 (HMAC 서명 검증)
2. **보안 및 규정 준수 (PCI-DSS 원칙)**:
   - 클라이언트 성공 URL 위조를 통한 임의 `paid` 전이 불가
   - 카드 번호(PAN) 원문 저장 0건 강제 (입력 시 422 즉시 거부)
   - 암호학적 HMAC 서명된 PG 웹훅만 결제 완료 반영
   - 중복 웹훅 및 순서 역전 시 멱등 처리

## 검증 내역

- 테스트 스위트: `tests/server/payment-orders.test.ts`
- 주요 검증 항목:
  - 위조 URL을 통한 상태 변경 시도 차단
  - 카드 번호 포함 요청 422 거부
  - 서명 위조 웹훅 401 거부
  - 정상 서명 웹훅의 원자적 결제 완료 처리 및 중복 호출 안전성
