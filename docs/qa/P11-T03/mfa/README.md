# P11-T03 SSO 개인 2FA 연결

2026-10-06. SSO 성공 후 개인 2FA를 생략하던 경로를 재현하고 수정했다. 전체 Task는 진행 중이다.

## 재현과 수정

실제 TOTP 등록/확인을 마친 계정의 OIDC 로그인에서 콜백이 `/dashboard`로 이동하며 세션을 발급했다. 기대한 `/login-otp`로 이동하지 않은 [실패 기록](baseline.log)을 보존했다.

- `twoFactorEnabled` 계정의 SSO 콜백은 로그인 세션을 만들지 않고 `/login-otp?returnTo=%2Fdashboard`로 이동한다. 기존 세션 쿠키를 비우고 HttpOnly/SameSite=Lax challenge 쿠키를 발급한다. HTTPS에서는 Secure 속성을 적용한다.
- Better Auth의 표준 challenge·시도 횟수·TOTP·이메일 코드·복구코드 검증을 재사용한다. 같은 `Verification` 저장소에 10분 만료의 암호화 SSO 바인딩을 함께 저장한다. 신규 DB migration은 없다.
- 바인딩은 원래 사용자, 회사, provider/version, 계정 연결, membership/version, 비밀번호 변경 시각, link 모드의 원래 세션을 고정한다.
- 코드 전송/확인 시 현재 계정·회사·직접 소속·provider·계정 연결·IP를 다시 검사한다. link의 원래 세션 종료/회사 전환/만료도 거부한다. 다른 기존 세션을 섞어 라이브러리의 인증코드 검증을 생략할 수 없다.
- 성공 세션은 최초 가입 회사가 아닌 SSO 대상 회사로 발급한다. 동일 트랜잭션에서 challenge·복구코드·바인딩 소비, 세션 생성, `session.created`와 `sso.login` 감사를 처리한다. 마지막 기한 검사와 감사 실패는 전체를 롤백한다.
- 2FA가 없는 SSO 로그인에도 공통 `session.created` 감사를 추가했다. 회사 정책상 MFA 설정 요구는 기존 정책 화면과 보호 API 검사로 유지한다.
- 기존 OTP/이메일/복구코드 화면과 API를 사용한다. 미설정·해제 계정, 현재 권한 변경, 만료된 challenge는 새 SSO 로그인을 요구한다.

## 검증 범위

| 항목 | 결과 | 증거 |
|---|---|---|
| SSO 전체 관련 시험 | 2파일 57개 통과, 이번 MFA 16개 포함 | [최종 SSO](sso-final.log) |
| 기존 인증·감사·MFA 회귀 | 3파일 70개 통과; 당시 SSO54개와 함께 5파일124개 실행 | [회귀](regression-first.log) |
| Production 빌드 | 별도 빌드 성공 | [빌드](build.log) |
| 타입·린트 | 변경 서버/라우트/QA 스크립트 및 최종 테스트 검사 통과 | [타입](typecheck-final.log), [린트](lint-final.log) |
| 실제 HTTP, 재시작 전 | 7개: 실제 MFA 등록→로그아웃→서명 SAML→challenge→보호 API401, DB 세션0 | [결과](http-before-restart.json) |
| 동일 빌드 재시작 후 | 11개: 대기 challenge 유지→TOTP 확인→본인/회사 세션→재사용401→이메일 코드→QA 설정 복구 | [결과](http-after-restart.json) |
| OTP 화면 연결 | HTTP200과 인증코드 입력 안내 HTML 확인; 브라우저 조작은 아님 | [화면/메일 확인](scoped-mail-and-page.json) |
| 소스 및 프로세스 | PID3358→3909, port3158, 같은 빌드 | [체크포인트](checkpoint.json) |

서로 다른 시험 수는 SSO57개와 기존 인증/감사/MFA70개로 총127개다. 최종 SSO 파일의 추가3개는 기존 세션 혼합 거부·원래 link 세션 종료·감사 실패 시 롤백을 검증한다. 최초124개 실행 이후 애플리케이션 소스는 변경하지 않았다.

추가 검증: provider 변경, 소속 회수, 계정 연결 삭제, 계정 폐쇄, 비밀번호 변경, 바인딩 누락/만료, IP 정책 변경, 복구코드 동시 소비, 이메일 코드, 잘못된 코드 시도 제한, 여러 회사 중 대상 회사 선택. 만료 시험은 시험 DB의 만료 시각을 과거로 변경했으며 실제10분 대기를 뜻하지 않는다.

HTTP는 기존 별도 QA 회사/사용자에 제한했다. 이전 연결 계정과 설정은 유지했다. 완료 후 QA 계정의 2FA를 원래 비활성 상태로 돌리고 세션0개를 확인했다. 대기 challenge용 임시 비공개 파일도 완료 상태만 남기도록 덮어썼다. 사용자 앱 서버와 전역 worker는 변경하지 않았다.

이메일 코드는 로컬 암호화 outbox에서 읽었다. 실제 SMTP 수신 검증은 아니다. SAML 응답은 실제 RSA/XML 서명이 있는 합성 IdP fixture이며 외부 SaaS IdP 성공 증거가 아니다.

## 실패 및 수정 이력

- 첫 수정에서 User에 없는 passwordRevision을 가정한 타입/바인딩 오류가 발생했다. 실제 passwordChangedAt 필드를 사용하고 APIError 변환을 보완했다. [첫 시험](first-test.log), [첫 타입](typecheck-first.log).
- 후속 시험 11개 통과/2개 실패는 계정 폐쇄의 소유권 이전 보호와 허용 규칙 없는 IP 정책을 잘못 만든 fixture였다. 소속 역할 변경과 실제 허용 규칙을 선행해 수정했다. [두 번째 시험](tests-second.log).
- 최종 QA 스크립트의 메일 조회를 QA 사용자 감사 이벤트의 job으로 제한했다. 최초 범위 제한 조회에서 메일 발송 감사는 tenantId=null이라는 기존 계약을 확인했고 사용자 actorId로 조회하도록 수정했다. 해당 조회와 OTP HTML은 별도로 재검증했다. HTTP18개 전체를 다시 실행한 것은 아니다.
- pg 동시 query 호출 폐기 예정 경고는 남아 있다.

## 남은 조건

- 현재 UI의 실제 Ego 조작, 외부 IdP 왕복, 초대가입/실패/회수 화면과 P11 원래 전체 수용 조건.
- SAML Status/Recipient를 정규식으로 읽는 경로와 subject 필수 검증을 원래 프로토콜 계약에 맞춰 점검한다. 로그인 실패가 JSON 응답으로 끝나는 현재 화면도 사용자 흐름에 연결한다.
- 이미 연결된 외부 계정의 소속 삭제 후 JIT 재가입 정책을 확인한다.
- 이전 [migration 체크섬4건 불일치](../callbacks/migration-verification.json)는 이 변경으로 해결되지 않았다.
- 기존 Ego 작업 공간45가 없어 새 공간 생성에 대한 사용자 응답을 기다린다. 다른 브라우저로 대체하지 않았다.

전체 완료17/72·진행41·계획14를 유지한다. 외부IdP·브라우저·전체 수용이 남아 P11-T03을 완료 처리하지 않는다.

## 재현 정보

- Node24.19.0, 분리된 catchsecu_test PostgreSQL과 `.env.test.local`.
- 관련 시험: `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/sso.test.ts tests/server/sso-saml.test.ts tests/server/auth-mutations-audit.test.ts tests/server/auth-public-audit.test.ts tests/server/mfa-policy.test.ts`.
- 빌드: `.local/qa-sso-mfa-20261006-build`, 설정 `.local/qa-sso-mfa-20261006-tsconfig.json`.
- HTTP: `scripts/qa-sso-mfa.ts` 최초 실행 후 같은 빌드 서버를 재시작하고 `--verify-restart` 실행. 이미 완료한 fixture는 재실행 전에 새 fixture 또는 정리 범위를 검토한다. 암호·시크릿·코드·쿠키는 출력하지 않는다.
