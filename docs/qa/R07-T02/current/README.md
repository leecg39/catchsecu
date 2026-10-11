# R07 현재 서버 검증

검증된 OIDC 신규 신원은 바로 계정을 만들지 않고 가입 동의 요청을 발급한다. 기존 사용자 로그인·계정 연결과 SAML/가상기관 흐름은 기존 계약을 유지한다. 원본 화면 관찰은 [근거 문서](../../../planning/09-rea-fullstack/sso-source-evidence.md)에 기록했다.

- HttpOnly 쿠키·브라우저 결합·Origin·기한·현재 회사/IP/공급자 version/초대를 확인한다. 동의 수락에서 사용자·연결계정·구성원·서비스 권한·동의 영수증·세션·인증 근거·감사·요청 소비가 함께 커밋된다.
- 동의 시각과 인증 시각을 구분한다. 가입 확인에 시간을 써도 최근 인증 시각은 IdP 검증 후 요청을 발급한 원래 시각을 유지한다.
- 실제 PostgreSQL 회귀는 중복 제외 16파일471시험 통과. [집계와 소스 지문](signup-verification-summary.json), [최종 인증/가입/세션 175시험](signup-proof-final-regression.json), [나머지 관련 회귀](signup-and-related-regression.json). 초기 실행의 실패 두 건은 시험 fixture의 IP 규칙 누락과 사용자 삭제 FK 기대값 오류였으며 수정 후 재검증했다. 초기 보고서 전체를 성공으로 집계하지 않았다.
- [API 대조](api-contract.json): R07 관련18경로25작업(로그인 정책3작업 포함). 전체 OpenAPI는330경로469작업이다. 새 가입 GET/POST/DELETE는 세션 대신 가입 쿠키와 브라우저 결합을 사용한다.
- [실제 HTTP·Ego·재시작·worker 증거](../../R07-T04/signup/README.md), [DB 모델 대조](../../R07-T01/current/README.md).

공식 Google/Microsoft/GPKI/새올 어댑터 및 실제 제공사 수신 증거는 external_pending이다. 로컬 RSA/JWKS 시험 IdP나 가상기관 결과로 공식 제공사 수용을 대신하지 않는다. 최종 타입·린트·빌드 결과는 `quality-gates.json`에 기록한다.
