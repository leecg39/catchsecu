# P10-T03 크레딧·사용량·원장 — 잔액 원장 부분 검증

> 2026-10-04: 실제 부분 구현을 근거로 planned에서 in_progress로 정정했다. 전체 완료는 아니다. [근거](../status-revalidation/README.md).

> **완료 판정 정정 (2026-10-04): 미완료.** 0934f4e의 일괄 완료 표시는 수용 조건의 증거를 충족하지 못해 철회했다. 아래 구현·시험 주장은 각 실제 파일/실행 결과와 다시 대조한다. 테스트 파일의 존재는 실행 통과나 브라우저/외부 연동 완료를 뜻하지 않는다. [재검증 계획](../../planning/05-completion-recovery.md).

2026-10-03. 회사·통화별 크레딧 계정과 균형 원장, 서비스 예약·사용 확정·실패 해제의 서버 기반을 구현했다. 외부 PG 승인과 서비스 사용량 원천은 아직 연결되지 않아 P10-T03을 완료로 표시하지 않는다.

## 구현 범위

- PostgreSQL `CreditAccount`, `LedgerTransaction`, `LedgerEntry`와 트리거로 잔액 변경·차변/대변 두 항목을 한 트랜잭션에 기록한다. 잔액 음수, 예약 초과 정산, 타 회사·서비스·통화 예약 정산과 직접 수정·삭제를 거부한다.
- 같은 회사·종류·원천의 재시도는 기존 거래를 돌려주고, 금액 등이 다른 재사용은 충돌로 거부한다. 내부 `postTrustedLedgerTransfer`만 원장에 쓸 수 있다.
- `GET /api/v1/ledger`는 `billing.read` 권한, 회사·서비스 범위, 통화·페이지 필터를 적용한다. 잔액은 큰 정수의 문자열로 반환하며 내부 원천 ID는 응답에서 제외한다. 공개 쓰기 API는 제공하지 않는다.
- `/pay/license-service`에 실제 회사 계정의 사용 가능·예약 중 잔액을 표시한다. 충전과 사용 버튼은 PG·공급자 연결 전까지 제공하지 않음을 화면에 명시했다. OpenAPI 조회 계약을 추가했다.

## 검증

- 분리된 로컬 PostgreSQL에서 동일 원천 동시 재시도와 충돌, 동시 예약의 초과 차감 차단, 부분 확정·실패 해제, 타 회사·서비스·통화 경계, 통화별 잔액과 원장 항목의 변경 불가를 시험했다. 테스트의 충전 이벤트는 격리된 DB에서 만든 합성 `pg_capture` 자료다.
- API 시험은 미로그인 401, 권한 없음 403, 타 회사 서비스 404, 잘못된 필터 422, 원천 ID 비노출을 확인했다. [브라우저 실행 기록](browser.txt)은 로컬 production 서버의 계정/거래 수를 독립 DB 조회와 대조하고, 공개 POST 405와 390px 화면의 잔액 표시·가로 넘침 없음을 확인한다. [390px 화면](credit-balance-mobile.png)을 저장했다.
- Node 24에서 타입 검사·변경 파일 ESLint·production build를 통과했다. [전체 회귀 시험](full-test.txt)은 26개 파일·414건 통과했다.

## 남은 조건

- PG sandbox의 **서명·승인된 실제 캡처**에서만 충전을 만들도록 결제 원천을 연결하고, 실패/중복/순서 역전·환불을 검증해야 한다. 현재 DB의 `sourceKind='pg_capture'` 값만으로 실제 PG 증명은 성립하지 않는다.
- 이메일·문자·본인인증 등 서비스별 사용 요청/공급자 영수증을 예약·확정·실패 해제에 연결하고, 실패 전송의 정산 정책과 월별 사용량 집계를 검증해야 한다.
- 원본 화면 대조, 결제/환불·마감 연계, 실제 외부 공급자 환경에서의 전체 E2E가 남아 있다.

## 2026-10-06 추가 구현 — 서명 승인 충전과 SMS 발송 정산

### 구현

- `applyPaymentEvent`가 서명된 `paid` 이벤트를 받으면 한 트랜잭션에서 주문 paid 전이·대기 구독 `active` 활성화(월간 +1개월/연간 +1년 기간, `activationSource='payment'`, `activated` 이벤트)·`kind='funding'`/`sourceKind='pg_capture'`/`sourceId=주문ID` 충전을 원자 커밋한다. 성공 주소 위조·무서명 본문으로는 절대 충전되지 않는다.
- 마이그레이션 `20261006110000_paid_activation`이 구독 `active` 상태와 `activated` 이벤트 종류를 허용하고, `pending→active`는 동액 paid 주문이 존재할 때만 허용하는 DB 트리거(`BILLING_ACTIVATION_WITHOUT_PAYMENT`)와 조기 만료 거부(`BILLING_EARLY_EXPIRATION`)를 추가했다.
- 캠페인 스케줄링이 SMS 발송 잡 페이로드에 `unitCost`(예약 시점 `MESSAGE_UNIT_COST_KRW` 스냅샷)를 암호화 저장한다.
- 캠페인 워커가 SMS 발송 전 `reserve`(원천키=`campaign_delivery:{deliveryId}`), 발송 수락 후 `capture`, 취소·확정 실패 시 `release`를 같은 트랜잭션에서 처리한다. `sending` 복구 시 영수증이 있으면 예약 재사용 후 확정한다. 이미 capture/release된 예약에는 재정산을 시도하지 않는다.
- 잔액 부족은 INSERT 예외 전에 `CreditAccount FOR UPDATE` 잠금 아래 잔액을 먼저 확인해 `INSUFFICIENT_CREDIT` 실패로 기록한다(트랜잭션 중단 오염 방지).

### 적대적 검증 (tests/server/billing-settlement.test.ts, payment-orders.test.ts — 5/5 통과)

- 서명 paid → 구독 active·기간 설정·`activated` 이벤트·funding 12,000·가용 잔액 일치 확인. 동일 이벤트 재적용은 duplicate이며 충전이 두 번 생기지 않는다.
- 연간 주기는 360~370일 기간으로 활성화. paid 주문 없이 `pending→active` 직접 변경은 DB가 거부하고, `active→expired` 조기 전이도 `BILLING_EARLY_EXPIRATION`으로 거부한다.
- 문자 발송 성공: funding→reserve→capture 순서로 원장에 기록되고 capture가 예약을 참조한다. 완료 잡 재실행(리플레이)에서도 원장 3건·지출 50 유지 — 이중 차감 없음.
- 잔액 30 < 단가 50: 발송은 `failed`/`INSUFFICIENT_CREDIT`으로 기록되고 원장은 funding만 남는다.
- 동의 변경으로 발송 취소된 경우 기존 예약이 `release`로 반환되어 가용 잔액이 복원된다.

### 여전히 남은 조건

- 실제 PG sandbox의 서명 캡처에서 충전되는 것을 외부 환경에서 확인해야 한다(현재 검증은 서명된 로컬 이벤트).
- 실패 전송의 정산 정책(공급자 수락 후 통신사 실패 등)과 월별 사용량 집계 뷰, 원본 화면 대조는 미완료다.
