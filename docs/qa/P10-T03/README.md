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

## 2026-10-13 추가 구현 — 수신 결과 정산·크래시 복구·서비스별 월 집계

### 발견된 결함과 수정

- `applySmsReceipt`(공급자 webhook)은 영수증만 기록하고 미정산 `reserve`를 정산하지 않았다 — 워커 크래시 후 `unknown`으로 종결된 발송의 홀드가 영구 `held`로 샜다. 이제 수신 결과가 미정산 예약을 종결한다: `accepted`→`capture`, `failed`·`timeout`→`release`(원천키 `campaign_delivery:{deliveryId}`·`:fallback`, `reservationId` 역참조로 이미 정산된 홀드는 건너뛴다). `unknown`은 DB 생명주기상 종결 상태라 상태는 유지하고 원장만 정산한다.
- `sms-solapi` 복구 경로가 영수증 부재 시 재전송으로 떨어져 공급자 수락~finish 사이 크래시에서 문자를 중복 발송할 수 있었다. 이제 영수증 없는 `sending` solapi 발송은 `unknown`+`DELIVERY_UNCERTAIN`으로 보존하고 잡을 `dead`로 마감해 webhook 대사가 정산한다.
- `cleanupCampaigns` 고아 잡 수리가 원장을 건드리지 않아 `sending` 복구 건의 홀드가 그대로 남았다. 이제 수리 결과별로 정산한다: 영수증 확인 발송은 `capture`(예약 재사용), 실패·미확인·미전송은 `release`. 단 `sms-solapi` 영수증 부재만은 webhook이 올 수 있으므로 홀드를 보류한다.
- 월마감 `MonthCloseRecord`에 `services[]`(serviceId·serviceName·captured·released)를 추가했다. 라이브 조회는 당월 원장을 서비스별로 집계하고, `closeMonth`는 집계 결과를 `totals.services`에 스냅샷한다. 마감 월 재조회는 재계산 없이 스냅샷을 반환하고, 서비스 없는 원장 거래는 집계에서 제외된다.

### 적대적 검증 (tests/server/billing-settlement.test.ts — 8/8 통과)

- 수신 결과 정산: accepted→`accepted`+`capture`, failed→`failed`+`release`, timeout→`unknown`+`release`, 기존 `unknown` 발송에 늦은 accepted webhook → 상태는 `unknown` 유지·원장만 `capture` 정산.
- solapi 무영수증 크래시 복구: `solapi.com` 외부 호출 0회·잡 `dead:DELIVERY_UNCERTAIN`·발송 `unknown`·홀드 보류 → 뒤늦은 webhook이 `capture`로 정산.
- 로컬 전송 크래시 수리: 영수증 파일이 있으면 `local_delivered`+`capture`, 없으면 재전송 없이 `unknown`+`release`.
- 캠페인 취소 E2E: 발송 완료 1건은 `reserve`+`capture`, 미발송 1건은 `cancelled`(잡도 취소·원장 기록 없음), 취소된 잡 직접 재claim해도 변화 없음.
- 서비스별 월 집계: 두 서비스의 capture/release가 각각 집계되고, 마감 생성·재조회가 스냅샷 `services`를 반환한다.
- claim 순서 의존 제거: `runOneJob`을 `{tenantId, jobId}`로 스코핑해 병렬/순차 실행 모두 결정적이다.

### 여전히 남은 조건

- 실제 PG sandbox의 서명 캡처·환불과 Solapi 실환경 수신 결과(실제 webhook 서명·재시도)는 외부 자격 증명이 필요하다.
- 원본 화면 대조·전체 게이트는 미완료다.
