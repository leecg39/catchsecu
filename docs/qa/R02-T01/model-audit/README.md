# R02 인증 모델 대조

2026-10-10. 실제 로컬 개발/시험 PostgreSQL을 읽기 전용으로 조사했다. 각각 8개 모델, 73개 컬럼, 21개 제약, 24개 인덱스, 7개 사용자 트리거를 대조했다. 신규 migration은 필요하지 않았다.

- User: 이메일 유일성, 활성 상태, 이메일 인증, 비밀번호 변경시점, MFA 활성 여부.
- Account: providerId/accountId 유일성, 사용자 CASCADE, credential 암호 해시, SSO 연결 FK.
- Session: 서명 쿠키와 별도로 DB 세션 존재/만료 확인, token 유일성, 사용자 CASCADE, 회사 삭제 시 SET NULL. activeServiceId는 앱의 서비스 권한 검사로 검증하며 이 컬럼 자체에 서비스 FK가 있다고 주장하지 않는다.
- Verification: 식별자는 해시 저장, 만료시점/소비는 maintained auth adapter와 트랜잭션으로 처리. 이메일 인증은 서명 JWT와 사용자 인증 플래그를 사용하고, 재사용 및 동시 확인은 사용자 잠금 안에서 거부한다.
- TwoFactor: 사용자 FK, 암호화된 인증 앱 비밀키/복구코드, 실패 횟수와 잠금시점. 복구코드 소비와 감사 기록은 인증 요청 트랜잭션에 포함된다.
- RateLimit: 키 유일성, 횟수/최근 요청시각. 인증 요청 속도 제한 상태를 DB에 보존한다.
- PasswordHistory: 사용자 FK, 변경 이력. credential 트리거가 기존 암호 해시를 저장하고 최근 이력 한도를 유지한다.
- PasswordDeferral: 회사/멤버/사용자 복합 FK, 회사/멤버 유일성, session/date 모드 제약, 암호 정책 revision과 만료. 실제 암호 변경 시 유예를 삭제한다.

credential 변경 트리거는 비밀번호 변경, 과거 세션 삭제, 인증 proof 삭제, `password.changed`와 `session.ended` 감사 기록을 같은 트랜잭션에서 처리한다. 메타데이터 검사와 동작 검증은 별개이며, 동작 증거는 R02-T02/T04에 기록한다.

실행: `node --env-file=.env.local --import tsx scripts/qa-rea-auth-model.ts` 및 `.env.test.local`.

[개발 DB](catchsecu_dev.json) · [시험 DB](catchsecu_test.json)
