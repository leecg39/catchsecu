# R07 로그인 정책을 위한 인증 근거 체크포인트

2026-10-10. **정책 저장·집행·화면은 아직 미완료**다. 이번에는 실제 세션의 SSO 인증 근거와 정책 데이터 모델을 추가했다. 기존 연결 계정이 있다는 이유로 비밀번호 세션에 SSO 권한을 부여하지 않는다.

## 구현

- migration106: SsoLoginPolicy의 NONE/AZURE/GOOGLE·version, SsoSessionProof의 세션/사용자·공급자/회사·연결계정/공급자/사용자 복합 FK와 수정 금지. 세션/계정 삭제 시 근거도 제거된다. 과거 세션의 인증 방식은 추정해서 채우지 않는다.
- OIDC/SAML/가상기관 성공 및 MFA 완료 시 세션·근거·감사를 같은 트랜잭션으로 저장한다. MFA 설정/확인/해제 때 세션이 바뀌어도 원래 인증 시각을 보존한다. 비밀번호 로그인 및 비밀번호+MFA에는 SSO 근거가 없다.
- Google/Microsoft 분류는 issuer뿐 아니라 인증/토큰/JWKS 주소 전체를 확인한다. Google은 [공식 discovery](https://accounts.google.com/.well-known/openid-configuration)의 조합을 사용한다. Microsoft는 [공식 OIDC 문서](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc)에 따른 구체 tenant UUID의 v2 endpoint 조합을 사용한다. 일반 OIDC/SAML/가상기관은 OTHER이며 표시 이름으로 바뀌지 않는다. 분류만으로 토큰 서명 검증을 대신하지 않는다.
- 상품 기능 키 security.sso_login_policy를 추가했지만 기존 불변 상품 버전과 기존 구독 권한은 변경하지 않았다. 정책 쓰기 API의 구독 집행은 후속이다.

## 검증

- [기본 시험](../../R07-T02/session-evidence/initial.json): 24개 통과. 복합 FK, 불변 근거, 삭제 정리, 표시 이름/주소 위조, MFA 회전을 검사했다.
- [프로토콜·기능 회귀](../../R07-T02/session-evidence/regression.json): 9파일283개 통과. OIDC의 실제 RSA/JWKS, SAML XML 서명, MFA·감사 실패 롤백과 구독 회귀를 포함한다.
- [인증 후속 회귀](../../R07-T02/session-evidence/auth-regression.json): 4파일70개 통과. 중복14개를 제외해 두 회귀의 고유 시험은 **12파일339개**다. MFA 해제 회전과 일반 인증/감사/회사 경계도 검사했다. [읽기 전용 검토](../../R07-T02/session-evidence/read-only-review.json)에서 해당 범위의 추가 결함은 발견되지 않았다.
- Google/Microsoft 형태의 서명 시험은 **전송을 통제한 합성 RSA fixture**이며 실제 외부 계정 인증이 아니다. 잘못된 서명에서는 세션/근거0, 올바른 서명 후에만 분류된 근거를 저장한다.
- [dev 모델](../../R07-T01/session-evidence/catchsecu_dev.json), [test 모델](../../R07-T01/session-evidence/catchsecu_test.json): 2모델11컬럼9제약·불변 트리거, 마이그레이션106. [dev 스키마](../../R07-T01/session-evidence/schema/catchsecu_dev-contract.json), [test 스키마](../../R07-T01/session-evidence/schema/catchsecu_test-contract.json)는 예상 밖 차이0.
- [실제 HTTP15개](http.json): 비밀번호 로그인→가상기관 연결→MFA 설정/세션 회전→로그아웃→비밀번호+MFA→SSO+MFA. 원래 인증 시각 보존, 잘못된 출처 상속 없음, 최종 근거1개. 이메일 인증 완료와 회사/owner 소속은 합성 fixture로 준비했다. 외부 기관 인증 성공이 아니다.
- [Ego 화면](browser.json), [재시작 후 Ego](browser-after-restart.json), [재시작 후 DB/API](verified-after-restart.json): 실제 HTTP 발급 세션으로 공급자 화면·본인 프로필·MFA 상태 확인.1440px 넘침0. UI가 정책 화면으로 바뀌었다는 증거는 아니다.
- [기존 CRUD fixture 보존](prior-fixture-preserved.json): 공급자3/구성원12/감사32와 기존 상태 해시 유지, 과거 세션 근거 자동 생성0.
- 최초 HTTP 실행은 서버 ready 전에 시작해 [연결 거부](http-startup-failed.json)가 발생했다. 생성 행0을 확인한 뒤 실패 fixture를 보존하고 재시도했으며, 실행기에 사전 readiness 검사를 추가했다.

최종 상태 해시: `368aae9c06b010862a11d53f9975cc3dbd464c93e7f9e96ffb857dd4e9fbd44d`. 빌드 `.next-rea`, PID70976→72344 재시작. 소비형 HTTP fixture는 재실행하지 않는다.

## 다음 필수 작업

[실행 계획 C4 후반~C8](../../../planning/09-rea-fullstack/sso-execution.md): 실제 회사 접근에서 정책 집행, 대상 회사 전환/초대/계정 연결 복구, 제한 중 개인 해제 금지·공급자 중지 영향 확인, 이메일 재인증과 정책 CRUD API, 원본 두 화면 구현 및 전체 인증 경로 수용. 현재 모델만으로 제한 정책이 집행된다고 표시하지 않는다.
