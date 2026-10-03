# P02-T04 인증 화면·callback 연결

2026-10-03. 로컬 production 앱 `http://localhost:3100`, Ego Lite의 TaskSpace 34, 실제 PostgreSQL과 로컬 메일함으로 확인했다. 외부 SMTP 수신·SSO·본인인증은 이 항목의 완료 범위에 포함하지 않는다.

## 구현

- 가입·메일 재전송·로그인·암호 복구·TOTP·이메일 코드·복구코드를 실제 인증 API 결과에 연결했다.
- 미인증 이메일, 틀린 코드, 중복 요청, 만료·재사용 링크, 속도 제한을 화면에 표시한다. 사용할 수 없는 재설정 링크는 비밀번호 입력창을 숨기고 재요청으로 연결한다.
- 가입부터 복구·2단계 인증까지 내부 `returnTo`를 유지한다. 외부 주소·프로토콜 상대 주소·백슬래시·인코딩한 우회 주소는 서버에서 거부한다.
- MFA 필수 회사에서 보호 페이지에 접근하면 설정 화면으로 보낸다. 등록 완료 후 원래 페이지로 이동하며, 로그인 challenge가 끝나기 전에는 보호 API를 사용할 수 없다.

## 실제 브라우저 검증

1. 합성 계정을 화면에서 가입했다. 미인증 로그인은 실패했고, 재전송한 인증 메일을 실제 worker가 로컬 메일함에 기록했다.
2. 전달된 링크를 열고 로그인해 `/my-page/info`와 보호 context API 200을 확인했다.
3. 합성 회사의 MFA 정책을 적용했다. TOTP 등록→계속하기→로그아웃→다시 로그인→틀린 코드 오류→이메일 코드 인증을 확인했다.
4. 메일로 받은 암호 재설정 링크를 만료시켰다. 오류·입력창 숨김·`returnTo` 유지를 확인했다. 재요청한 링크로 암호를 변경하고, 링크 재사용이 실패하는 것을 확인했다.
5. 새 암호와 일회용 복구코드로 다시 로그인했다. 독립 DB 조회에서 기존 암호 해시는 불일치, 새 암호는 일치, 이메일 인증·MFA 활성화를 확인했다.

`scripts/qa-auth-flows.ts`는 로컬 개발 DB·로컬 메일함에서만 실행된다. 회사/Membership 준비와 만료 시각 조정에만 fixture를 사용했으며, 가입·재전송·등록·복구·로그인은 화면에서 수행했다. 비밀번호·인증 키·복구코드·메일 링크는 Git에서 제외한 `.local/`에만 저장했다. 실제 계정 대신 합성 계정을 사용했다.

## 증거와 검사

- `signup-mail-requested.png`, `unverified-login.png`, `verified-profile.png`, `invalid-otp.png`, `expired-reset.png`, `reset-complete.png`
- `database.json`: 화면에서 재설정한 암호의 독립 DB 검증
- `tests/server/auth-navigation.test.ts`: callback 13건
- `full-test.txt`: 전체 30파일·439개 통과
- `typecheck.txt`, `lint.txt`: 타입 통과·린트 오류 0, 기존 이미지 경고 4
- 최종 공통 production 빌드: `../P03-T01/build.txt`

회귀 시험 전에 ClamAV가 꺼져 있어 파일 관련 10건이 실패했다. 실제 스캐너를 시작한 후 전체 439건이 통과했다. 최초 진단 로그는 `full-test-before-scanner.txt`에 보관했다.

실행: `npm test`, `npm run typecheck`, 변경 파일 `npx eslint`, `ALLOW_LOCAL_MAIL=1 npm run build`. 브라우저 준비는 `node --env-file=.env.local --import tsx scripts/qa-auth-flows.ts prepare`부터 시작하며, 이전 합성 fixture를 덮어쓰기 전에 필요한 증거를 보관해야 한다.
