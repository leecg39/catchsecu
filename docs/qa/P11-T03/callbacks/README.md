# P11-T03 SSO 콜백·계정 연결·DB 바인딩 검증

2026-10-06. P11-T03은 진행 중이다. 설정 관리의 이전 검증은 [이전 기록](../revalidation/README.md)에 보존한다.

## 변경 내용

- SSO 시작 시 현재 회사·설정의 사용 가능 여부를 잠금 안에서 확인하고 providerVersion을 저장한다. 콜백의 외부 토큰/JWKS 요청과 서명 검증 뒤에도 현재 회사·설정·버전·기한을 다시 검사한다.
- link 요청에 원래 userId와 sessionId를 저장한다. 로그아웃·만료·회사 전환·권한 변경 뒤 완료할 수 없다. SAML의 cross-site POST에는 기존 세션 쿠키가 없어도 저장된 원래 세션을 확인한다.
- 다른 사용자에게 이미 연결된 외부 계정은 현재 사용자에게 연결하지 않는다. IdP 이메일만 일치하는 기존 로컬 계정은 자동 연결하지 않고 기존 계정 로그인 후 명시적 연결을 요구한다.
- 초대 검증은 기존 연결 계정에도 적용한다. 초대의 회사·이메일·유효기간·상태와 초대자 현재 권한·서비스를 검사한다. 취소된 소속의 재초대는 새 역할과 서비스 권한으로 수락한다.
- 신규 JIT 회사 가입에 실제 구성원 정원과 대기 중인 초대를 반영한다. 실패하면 사용자·계정·소속 쓰기를 롤백한다.
- DB 복합 FK는 state의 회사/provider와 사용자/session을 묶는다. session 삭제 시 link state도 삭제된다. 새 state CHECK는 link의 원래 사용자/session 누락을 거부한다.
- 기존 state의 providerVersion 기본값 0은 새 코드에서 거부한다. 기존 진행 중 인증은 다시 시작해야 한다. 사업 데이터나 기존 세션을 삭제하지 않는다.

## 확인한 증거

| 범위 | 결과 | 기록 |
|---|---|---|
| SSO PostgreSQL/프로토콜 | 2파일 41개 통과, 이전 27개에 콜백/DB 바인딩 14개 추가 | [시험](tests-second.log) |
| 인증/감사/MFA 회귀 | 3파일 70개 통과 | [회귀 기록](auth-regression.log) |
| Production HTTP | 3157 전용 서버, 실제 RSA 서명 SAML 요청 포함 15개 통과 | [결과](http.json), [실행](http-run.log) |
| 재시작 | PID 91086 → 91702, 같은 빌드에서 로그인/목록/로그아웃 3개 통과 | [결과](http-restart.json) |
| 독립 DB | 원래 사용자/session·providerVersion 일치, 성공 계정 연결 1개, 종료 후 QA 사용자 세션 0개 | [HTTP/DB 결과](http.json) |
| 타입·린트 | 변경 파일·QA 스크립트 포함 통과 | [타입](typecheck-final.log), [린트](lint-final.log) |
| Production 빌드 | 별도 빌드 디렉터리에서 통과 | [빌드](build-final.log) |
| 입력·환경 | 소스 해시와 전후 프로세스 기록 | [체크포인트](checkpoint.json) |

HTTP 시나리오는 기존 별도 QA 회사/사용자/provider만 사용한다. 성공 연결 → 새 세션의 본인 확인 → 로그아웃, 원래 세션 로그아웃 후 콜백 401, provider 수정 후 이전 콜백 409, 기존 이메일만 맞는 새 외부 subject의 자동 연결 409를 확인했다. 재시작 검증은 새 로그인 이후 DB의 설정 해시와 연결 계정 유지 확인이며 이전 세션의 연속성을 뜻하지 않는다.

실제 네트워크와 서명을 사용했으나 로컬 합성 IdP 인증서/응답이다. 외부 SaaS IdP 성공이나 브라우저 UI 완료를 뜻하지 않는다. 사용자 앱 서버와 전역 worker는 변경하지 않았다.

## migration 결과와 미해결 불일치

신규 migration: `20261014110000_sso_state_binding`.

- 고유한 임시 schema에 93개 migration 빈 설치·체크섬·신규 FK/CHECK를 확인하고 해당 임시 schema만 정리했다.
- 개발 DB에 신규 migration을 적용했고 기존 Company/User/Membership/Session/SsoProvider/SsoState 행의 비교 대상 해시를 보존했다.
- 신규 migration 체크섬은 일치한다. 개발 DB의 **기존 4개 migration 체크섬이 다르므로 전체 migration 검사는 실패**다.
  - `20261006100000_payment_methods`
  - `20261006110000_paid_activation`
  - `20261006120000_refund_closing`
  - `20261007000000_sso_providers`
- 이력 SQL이나 DB 체크섬을 고치지 않았다. 원래 적용 SQL과 현재/빈 설치 DDL을 대조한 뒤 필요한 후속 migration으로 해결해야 한다.

[검사 JSON](migration-verification.json) · [빈 설치](fresh-install.log) · [개발 DB 적용](dev-upgrade.log) · [최종 실행](migration-final-run.log).

## 실패와 검증 한계

- [초기 baseline](baseline.log), [첫 수정 시험](tests-first.log), [첫 타입 검사](typecheck-first.log)를 보존했다. 초대 fixture의 잘못된 상태값, 기존 이메일 조회보다 초대 검사를 먼저 해야 하는 오류, Context 타입 오류를 수정했다. 초기 baseline의 모든 실패를 제품 결함 수로 계산하지 않는다.
- 첫 migration 스크립트는 첫 체크섬 불일치에서 멈췄다. 후속 스크립트는 4건 모두와 행 보존을 기록하며 실패 코드로 종료한다. [최초 기록](migration-run.log).
- pg 동시 query 호출 폐기 예정 경고가 남아 있다.
- SSO의 `completeSso → mintSession`은 개인 2FA challenge를 거치지 않고 세션을 발급한다. 이번 코드 대조로 확인한 결손이며 실제 MFA 계정의 SSO 재현/수정은 다음 우선 작업이다. 정상 이메일 로그인 MFA 회귀 통과만으로 SSO MFA가 안전하다고 판정하지 않는다.
- SSO 세션 생성의 공통 `session.created` 감사와 기존 외부 계정의 소속 삭제 후 재가입 정책도 함께 대조한다.
- Ego 기존 작업 공간 45가 없어 새 공간 생성에 대한 사용자 응답을 기다린다. 현재 UI·실제 외부 IdP·초대가입 화면은 미검증이다.
- 전체 181개 경로·외부 연동·운영 복구의 완료 조건은 그대로 남는다. 공식 완료 17/72를 유지한다.

## 재현

Node 24.19.0, 실제 로컬 PostgreSQL, `.env.test.local`의 분리된 시험 DB를 사용한다.

- SSO 시험: `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/sso.test.ts tests/server/sso-saml.test.ts`
- HTTP: `.env.local`과 `BETTER_AUTH_URL/QA_SSO_BASE=http://127.0.0.1:3157`로 `scripts/qa-sso-callbacks.ts` 실행. 최초 실행은 한 번만 허용하며 재시작 검증에는 `--verify-restart`를 사용한다.
- 빌드: `CATCHSECU_BUILD_DIR=.local/qa-sso-callbacks-20261006-build`, `CATCHSECU_TSCONFIG=.local/qa-sso-callbacks-20261006-tsconfig.json`, 로컬 QA용 `ALLOW_LOCAL_MAIL=1 ALLOW_LOCAL_KAKAO=1`.
- DB 검사: `scripts/qa-sso-state-migration.ts`. catchsecu_dev와 catchsecu_test의 자체 생성 schema에 제한한다. 기존 이력 불일치가 남아 있으면 실패 종료가 정상이다.
