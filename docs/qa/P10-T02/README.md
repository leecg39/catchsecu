# P10-T02 결제수단·PG 주문·인증 — 진행 중

## 최신 내부 보완

2026-10-06 결제수단·주문 내부 보완: 현재 권한·세션·정책/최종 기한 검사, 대표 교체 version 갱신, 주문 재요청 최신 상태, 다른 수단 주문 충돌 및 동시 생성/해지 직렬화를 구현했다. 이름 수정 UI와 실패 입력 보존·409 최신 목록 조회를 추가했다. PostgreSQL 86개·HTTP 25개(재시작4 포함)·전체 타입·변경 린트·production 빌드·계약 300경로/431작업 검증 통과. 실제 PG/브라우저는 미완료, 공식 완료17·진행42·계획13 유지. [상세 증거](current-authority/README.md).

## 구현 (2026-10-06)

### PG 토큰 결제수단 CRUD·대표수단 (신규)

- `PaymentMethod` 모델 + 마이그레이션 `20261006100000_payment_methods`
  - 토큰은 `tokenHash`(HMAC-SHA256 조회용)·`tokenCipher`(AES-256-GCM)만 저장 — 원문 미저장
  - 트리거 `check_payment_method`: tenantId/tokenHash/tokenCipher/provider 불변, 기본수단은 active 필수
  - CHECK `PaymentMethod_shape`: kind/status/provider 형식 + `label`의 숫자열(비숫자 제거 후 13자리 이상) 저장 거부 — 카드 원문 DB 차단
  - 부분 유일 인덱스 `PaymentMethod_single_default`: 회사별 활성 대표수단 최대 1개를 DB가 보장
- `src/server/payment-methods.ts`
  - 등록: `pm_*` 토큰 형식 검증, 토큰·라벨의 카드원문(연속 13~19자리 또는 비숫자 제거 13자리 이상) 거부 `422 CARD_DATA_REJECTED`
  - 첫 수단 자동 대표 지정, `setDefault` 원자 전환, 중복 토큰 `409 METHOD_EXISTS`(회사 행 잠금 + P2002 매핑으로 경합 직렬화)
  - 수정: version 낙관 잠금 `409 VERSION_CONFLICT`
  - 삭제: soft-delete `revoked`, 진행 중 주문 있으면 `409 METHOD_IN_USE`, 대표 삭제 시 최장기 활성 수단 자동 승격
  - `resolveMethodToken`: provider 승인 경로 전용 복호화 — DTO에 토큰·암호문 미노출
- API: `GET/POST /api/v1/billing/methods`, `PATCH/DELETE /api/v1/billing/methods/{id}` — `billing.read`/`billing.write` 권한, 테넌트 격리
- 주문 연결: `POST /api/v1/billing/orders`가 `methodId` 수용 — 복합 FK `(tenantId, methodId)`로 타사 수단 바인딩을 DB가 거부, 해지 수단 `409 METHOD_INACTIVE`

### 기존 구현(이전 검증 유지)

- `createPaymentOrder`(대기 구독 멱등), `rejectPaymentReturn`(성공 URL 위조 시 `409 PAYMENT_UNCONFIRMED`), `applyPaymentEvent`(HMAC 타이밍세이프 서명·providerEventId 멱등·종료 후 이벤트 `409 OUT_OF_ORDER`·카드원문 수신 거부)

## 검증

- `tests/server/payment-methods.test.ts` 3개: 등록/목록/대표 전환, 카드원문·중복·경합·권한(viewer 403·익명 401·타사 404), 대표 삭제 승격·METHOD_IN_USE·주문 methodId 바인딩
- `tests/server/payment-orders.test.ts` 1개: 위조 성공 URL·서명 불일치·중복 이벤트·순서 역전

## 미완료 (외부 차단)

- 실제 PG sandbox 승인 — PG 가맹점 테스트 키 없음. `PAYMENT_WEBHOOK_SECRET`을 사용한 로컬 HMAC 이벤트만 검증했다. 실제 공급자의 인증·요청·응답 계약과 승인은 별도 검증이 필요하다.
- provider 종류는 `local`만 지원. 실PG 어댑터는 키 확보 후 연결.
