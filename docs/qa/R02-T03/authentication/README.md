# 인증 화면 검증

2026-10-10. Ego Lite 기존 space3/p1에서 새 합성 계정으로 실제 UI를 사용했다. 원본 경로 R02 15개는 모두 열었으며 이 검증은 원본 화면의 완전한 동등성 수용과 구분한다.

| 시나리오 | 결과와 증거 |
|---|---|
| 가입 필수 입력·포커스 | 빈 제출을 브라우저 검증이 차단하고 이름에 포커스. 실제 가입·메일 안내: signup.json |
| 이메일 미인증 | 인증 전 로그인 거부. 전달된 로컬 메일 링크로 인증하고 returnTo 유지: verification.json |
| 링크 재사용 | EMAIL_ALREADY_VERIFIED와 한국어 안내. 인증 성공으로 다시 처리하지 않음: verification-replay.png |
| 로그인 | 잘못된 비밀번호 거부, 정상 로그인은 요청한 프로필 경로로 이동: login.json |
| 비밀번호 재설정 | 실제 메일 worker 파일의 링크 사용. 만료 시험은 이 합성 계정 proof만 과거로 옮겼다. 만료/불일치/한 번 성공/재사용 거부: reset-expired.json, password-reset.json |
| 새 비밀번호 | 이전 비밀번호 거부 후 새 비밀번호 로그인: reset-login.json |
| MFA 등록 | 현재 비밀번호 확인·키와 복구코드 생성·TOTP 확인·새로고침 유지: mfa-setup.json, mfa-enabled.json. 비밀키/복구코드는 증거에서 가렸다. |
| TOTP 로그인 | 잘못된 코드 거부 후 실제 시간 기반 코드 성공: totp-invalid.json, totp-success.json. 회사 없는 새 계정의 dashboard 요청은 회사 등록으로 이동했다. |
| 이메일 OTP | 합성 계정에 바인딩된 OTP proof만 만료시켜 거부 확인, 재전송한 코드로 로그인: email-otp-expired.json, email-otp-success.json |
| 복구코드 | 사용한 코드는 새 로그인에서도 거부, 다른 미사용 코드는 성공. 영문 오류를 한국어로 수정하고 재검증: backup-code.json, backup-code-korean.json |
| MFA 해제 | UI 해제·새로고침 유지·최종 로그인에서 MFA 미요구: mfa-disabled.json, final-login.json |
| 로그인 중 암호 변경 | 잘못된 현재 암호 거부, 정상 변경 시 현재 세션도 종료: password-change.json |
| 네트워크 오류·재시도 | context, 암호 정책, 회사 목록을 실제 브라우저 네트워크에서 차단. 재시도 버튼 누락과 정책 오류 중 변경 폼 노출을 수정. 차단 해제·다시 시도 후 정상 복구: resource-failure-before.json, resource-failure-after.json |
| 15개 경로·화면 폭 | 390/768/1440px 총45개 관측에서 path·returnTo 유지와 가로 넘침0: routes-responsive.json. 모든 행동/상태 조합을 검증했다는 뜻은 아니다. |
| 모바일 가입 약관 | signup-390.png 직접 검토에서 단어 중간 분리 발견. 안내를 한 문장으로 감싸고 줄바꿈을 보완. signup-390-final.png 직접 확인, signup-final-check.json의3개 폭·Tab 순서 확인. |
| 서버 재시작 | 같은 사용자/같은 세션으로 프로필 유지: browser-after-restart.json |

가입 약관의 키보드 순서는 이름→이메일→비밀번호→표시 전환→동의 체크박스→이용약관→처리방침→가입 버튼이다. 동의가 필요한 기능 및 기존 링크는 유지했다.

보존한 중간 실패는 QA 도구의 오래된 ref, 모호한 버튼 텍스트, 비동기 상태 대기, 회사가 없는 계정의 dashboard→회사등록 기대값 오류다. 이 때문에 시나리오가 진행되지 않았을 때 성공으로 기록하지 않고 현재 화면과 DB를 확인해 이어 실행했다.

전체 원본 UX 대조, 회사 정책 강제 변경/유예의 실제 브라우저 조합, 재전송 제한의 화면 대기 UX 및 실제 외부 SMTP 수신은 후속 수용 범위다. 현재 보고서는 로컬에서 수행한 위 시나리오만 통과로 기록한다.
