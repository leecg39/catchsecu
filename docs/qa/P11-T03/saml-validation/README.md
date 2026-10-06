# P11-T03 SAML 필수 정보·본문 검증 및 소속 복구 방지

2026-10-06. SAML의 서명 검증 이후 필수 필드 검증과 SSO의 삭제된 소속 처리 방식을 보완했다. 전체 P11-T03은 진행 중이다.

## 실제 재현

- 잘못된 응답13종의 거부 시험에서 12종이 실패했다. 수신 주소·상태·사용자 식별자·bearer 방식·요청 식별자 누락, 다른 Destination, 잘못된 Subject 네임스페이스, 가짜 Recipient, 따옴표/공백 차이의 거부 상태 우회를 재현했다. 만료 필드 누락1종은 기존 라이브러리가 거부했다. [baseline](baseline.log).
- 이미 외부 계정이 연결된 사용자의 Membership을 삭제해도 다음 SSO가 viewer 소속을 다시 생성하는 동작을 재현했다. [JIT baseline](jit-baseline.log).

## 구현

- 정규식으로 읽던 Status/Recipient 검사를 제거했다. `@xmldom/xmldom@0.8.15`를 직접 의존성으로 선언하고 네임스페이스와 직접 자식 위치를 확인한다. 이미 설치되어 있던 전이 의존성과 같은 버전이며 다른 패키지 버전은 변경하지 않았다.
- Response의 타입/버전·현재 요청 ID·Destination(있을 때)·정확히 하나인 성공 Status를 확인한다. 이 포장 정보는 응답을 거부하는 용도로만 사용한다.
- 로그인할 사용자와 bearer 확인은 node-saml의 서명 검증 결과인 `profile.getAssertionXml()`에서 읽는다. 원래 응답의 임의 속성이나 Attribute가 NameID를 대신할 수 없다.
- 서명된 Assertion의 타입/버전·Issuer·AuthnStatement·Subject·NameID를 확인한다. NameID는 공백만 있거나 300자를 넘으면 거부한다.
- 유효한 bearer 확인에서 Recipient=현재 ACS, InResponseTo=원래 요청, 만료 시각과 NotBefore 금지 조건을 검사한다. 시간 허용 오차는 기존 라이브러리와 같은60초다. 대체 가능한 정상 bearer 확인이 있으면 지원한다.
- 정상 Response 서명과 Assertion 서명을 모두 지원한다. 네임스페이스 접두사, XML 속성의 따옴표/공백 차이를 오류로 취급하지 않는다.
- DTD/ENTITY 선언·XML 파싱 오류·잘못된 UTF-8을 거부한다. SAML POST는 표준 form-urlencoded만 받고, 필드 중복 및1,000,000바이트 초과를 선언 길이와 실제 읽은 길이 양쪽에서 차단한다.
- 서명 검증 오류에 외부 XML 상세나 라이브러리 오류 문자열을 그대로 돌려주지 않는다.
- 이미 연결된 계정의 회사 소속이 사라졌다면 자동 JIT 재가입 대신 새 초대를 요구한다. 최초 신규 사용자 가입과 유효한 재초대 흐름은 유지한다.

프로토콜 근거: [OASIS SAML Profiles2.0 §4.1.4.2–4.1.4.3](https://docs.oasis-open.org/security/saml/v2.0/saml-profiles-2.0-os.pdf)의 bearer 확인 요구사항. 설치된 node-saml5.1.0의 `validatePostResponseAsync`와 `processValidlySignedAssertionAsync`도 읽어, 검증된 assertion XML과 원래 response XML을 구분했다. 이 보완으로 전체 SAML/기관 인증 표준을 모두 지원한다고 주장하지 않는다.

## 검증

| 범위 | 결과 | 기록 |
|---|---|---|
| 실제 PostgreSQL/서명/SSO 회귀 | 2파일86개 통과. 기존57개에 SAML28개·JIT1개 추가 | [최종 시험](sso-final.log) |
| 최초 수정의 SAML 시험 | 당시28개 통과; 이후 추가5개도 최종 시험에 포함 | [첫 시험](first-test.log) |
| 타입·린트 | 변경 서버/라우트/시험/QA 스크립트 통과 | [타입](typecheck-final.log), [린트](lint.log) |
| Production 빌드 | 별도 디렉터리 빌드 성공 | [빌드](build.log) |
| 실제 HTTP |15개 통과 | [결과](http.json), [실행](http-run.log) |
| 동일 빌드 재시작 | PID16716→17259, 새 로그인/목록/로그아웃3개·설정 해시/계정 ID 보존 | [재시작](http-restart.json) |
| 소스/환경 | 포트3159·소스 해시 | [체크포인트](checkpoint.json) |

HTTP 시험에서는 신뢰된 합성 IdP 키로 잘못된 Recipient/NameID/Status 문서를 각각 서명해 거부를 확인했다. 초과 본문413·중복 RelayState422, 정상 서명 로그인→본인 확인→로그아웃과 재전송401도 확인했다. 모든 시험 후 QA 사용자 세션0개다. 실패 시 생성한 이번 QA state만 정리했다.

따옴표/공백 변경으로 기존 검사를 우회하는 시험은 서명 후 XML 표기만 바꿔도 canonical XML의 서명이 유효한 경우를 사용한다. 성공/실패 케이스가 단순히 서명 불일치만 시험하지 않도록 PostgreSQL 시험과 HTTP 시험에서 실제 키로 서명했다.

재시작 검증은 새 로그인 후 설정/계정 보존 확인이다. 이전 세션 연속성은 이전 [MFA 대기 challenge 재시작](../mfa/README.md)과 구분한다. 외부 SaaS IdP·실제 사용자 메일·브라우저 조작은 이번 검증에 포함되지 않는다.

## 작업 이력과 제한

- npm의 첫 호출은 잘못된 번들 npm-cli 경로로 실행되어 실패했다. PATH에 지원되는 Node24를 지정한 정상 npm 호출로 설치했다. [최초](dependency-install.log), [설치](dependency-install-final.log).
- npm이 변경한 이번 작업과 무관한 dev 메타데이터는 되돌렸다. package.json/lock의 변경은 직접 의존성 선언1줄씩이다.
- pg 라이브러리의 동시 query 호출 폐기 예정 경고는 남아 있다.
- 이번 보완에는 스키마 변경이 없다. 이전 개발 DB migration 체크섬4건 불일치는 그대로 미해결이다.
- 기존 Ego 작업 공간45가 없어 새 공간 생성에 대한 사용자 응답을 기다린다. 다른 브라우저로 우회하지 않았다.

## 다음 수용 작업

- SSO 취소·만료·설정 변경·계정 연결 필요 등 실패 응답을 사용자가 복구할 수 있는 로그인 화면에 연결한다.
- OIDC/SAML·초대가입·MFA 흐름을 실제 UI와 외부 IdP에서 확인한다.
- P11-T01/T02 선행 및 P11-T03 전체 수용 조건을 대조한다. 공식 완료17/72·진행41·계획14는 유지한다.

## 재현

- Node24.19.0, `.env.test.local`의 로컬 catchsecu_test.
- `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/sso.test.ts tests/server/sso-saml.test.ts`.
- 빌드 디렉터리 `.local/qa-sso-saml-20261006-build`, 타입 설정 `.local/qa-sso-saml-20261006-tsconfig.json`.
- HTTP는 `scripts/qa-sso-saml-validation.ts` 최초 실행 후 같은 빌드 서버를 재시작하고 `--verify-restart` 실행. 사용 완료 fixture는 재사용 전 기록/정리 범위를 확인한다. 비밀값을 출력하지 않는다.
