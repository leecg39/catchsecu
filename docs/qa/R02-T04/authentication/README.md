# 인증 DB·메일 worker·서버 재시작 검증

2026-10-10. 새 합성 계정 `4faf340a-5e6f-4896-b16e-2f25d0c69160`으로 가입→이메일 인증→비밀번호 재설정→MFA 등록/로그인/해제→로그인 중 암호 변경을 실행했다. 최종 데이터는 재실행용으로 보존했다. prepare와 상태 변경 시나리오를 다시 실행하지 않는다.

- 사용자 생성과 실제 인증/암호/MFA 변경은 Ego Lite UI에서 실행했다. 만료 시나리오만 이 합성 계정의 proof를 제한적으로 과거로 변경했다.
- 실제 인증 메일1개, 재설정 메일2개, 로그인 OTP 메일2개를 각각 해당 job ID로만 worker에 전달했다. status=done, attempt=1, 로컬 전달 파일 SHA-256과 job 영수증1개를 mail-*.json에 기록했다. 모든 큐를 일괄 실행하지 않았다.
- 비밀번호 재설정 전에 독립 Node HTTP 클라이언트로 두 번째 기기 세션을 만들었다. 재설정 후 DB행 삭제, 옛 서명 쿠키의 get-session=null, session.ended 감사1개를 확인했다. 이것은 별도의 HTTP 쿠키 세션 시험이며 별도 브라우저 프로필을 사용했다고 주장하지 않는다.
- 초기 비밀번호와 재설정 비밀번호는 최종 상태에서 모두 거부되고, 최종 변경 비밀번호만 실제 해시 검증에 성공한다. PasswordHistory2개, TwoFactor0개, twoFactorEnabled=false, 유효 세션1개다.
- 계정에 연결된 감사67건: session.created17/session.ended16, password.changed2, 이메일 인증1, MFA 등록1/활성1/해제1, 성공한 복구코드3건 등을 DB에서 읽어 대조했다. 익명 거부 로그 전체를 이 숫자에 합산하지 않는다.
- 서버를 새 프로세스로 시작하고 같은 브라우저 세션·폐기된 별도 세션·독립 DB 검증을 반복했다. 비즈니스 상태 지문은 `014fef23ab077a5934eb18c3b6c73921d2b0e6d2c8cd157dfdcf3726721e1e3f`로 같았다.

[재시작 전 DB](verified.json) · [재시작 후 DB](verified-after-restart.json) · [폐기된 별도 세션](revoked-second-session.json) · [화면 증거](../../R02-T03/authentication/README.md) · [서버205개 시험](../../R02-T02/authentication/README.md)

읽기 검증: `node --env-file=.env.local --import tsx scripts/qa-rea-authentication.ts verify verified-after-restart`. fixture의 비밀번호/비밀키/복구코드/쿠키는 .local 아래0600 파일에 두고 공개 증거에 포함하지 않았다. 상태 변경 이후 이 최종 지문과 같을 것이라고 가정하지 않는다.

최종 typecheck, 변경6파일 ESLint 오류/경고0, production build, git diff --check 통과. 신원·메일·결제의 외부 provider 수신은 이번 로컬 시험에 포함하지 않았다. R02 전체 및 전 페이지 구현 완료를 뜻하지 않는다.
