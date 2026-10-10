# R06 기능별 구독 권한 보완

원본 IP·회사 정책의 Enterprise 분기와 MFA의 별도 조건을 동일한 요금제로 단정하지 않는다. 아래는 원본 관찰을 참고한 독립 구현 계약이다. 원본 서버의 라이선스 매핑은 미확인이다.

1. BillingPlanVersion에 불변 `capabilities` 배열을 추가한다. 회사 정책, IP 관리, 회사 MFA 관리의 세 식별자를 허용하고 표시용 features와 분리한다. 기존 trial-v1은 7일 전체 기능 체험으로 명시하고 기존 유료 버전에는 회사 MFA만 부여한다. 원본과 같은 상품 매핑이라고 주장하지 않는다. 이후 변경은 새 상품 버전으로만 가능하다.
2. 현재 회사의 구독 상태·시작일·종료일·예약 해지일을 트랜잭션에서 검사한다. 동일 기능을 주는 여러 구독 중 하나라도 유효하면 허용한다. 구독 행을 잠그고 응답/커밋 직전 만료를 다시 검사한다. 구독 없음도 허용하지 않는다.
3. 회사 정책·IP·회사 MFA의 모든 변경 경로와 생성 요청 재시도에 연결한다. 회사 정책에서 MFA를 바꾸는 우회 경로도 별도로 검사한다. 역할 권한이 기능 권한보다 먼저 검사된다.
4. 현재 설정 조회는 기존 역할 권한으로 유지한다. 구독 없음·만료·미포함은 화면에 구별해서 표시하고 변경 버튼을 제한한다. 이미 적용 중인 IP/MFA/비밀번호/세션 보호는 구독 상태와 무관하게 계속 집행한다. 개인 MFA 등록·복구 기능에는 상품 제한을 추가하지 않는다.
5. 기능 포함/미포함/없음/만료/예약 시작·해지, 다른 회사 구독, 동시 만료·해지, 재시도, 불변 버전 및 DB 제약을 시험한다. 기존 보안 관련 회귀와 실제 HTTP·브라우저·재시작 검증을 수행한다. R06 기존 증거와 fixture는 보존하고 별도 fixture를 사용한다.

완료 증거는 R06-T02/security-entitlements 및 R06-T04/security-entitlements 아래 기록한다. 전체 R06 완료 판정과 원본 관찰 공백은 별도로 유지한다.

## 원본 근거와 제한

- 원본 번들 main.183e9d2c.js SHA256 `3538d47856c6ba1b4207059dc09434066c7ca692a5907ed792dd9e27c7dba78f`. AST-R123/124는 IP에 isEnterprise, AST-R129는 정책 조회에 Enterprise를 검사한다. AST-R125/126 MFA는 ROOT/SECURITY와 two_factor/two_factor_policy이며 직접 Enterprise 검사는 없다.
- AST-R130 정책 설정 직접 경로와 조회/설정 버튼의 조건이 달라 원본 서버의 최종 허용 여부는 확정하지 않는다. MFA LICENSE_FORBIDDEN/136 처리도 있어 실제 활성 상품별 서버 시험이 필요하다.
- 원본 정적 증거: [라우트](../../../../outputs/catchsecu-reverse-2026-10-09/static/route-inventory.json), [함수](../../../../outputs/catchsecu-reverse-2026-10-09/static/focused-evidence.json), [메뉴](../../../../outputs/catchsecu-reverse-2026-10-09/static/menu-bindings.json). 관찰 2026-10-09.
