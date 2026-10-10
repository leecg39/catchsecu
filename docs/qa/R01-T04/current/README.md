# R01-T04 Outbox·worker·플랫폼 인증메일·감사 기반

2026-10-11 완료. Node 24.18.0, 실제 PostgreSQL 17.11 테스트 DB와 일회성 shadow DB, 실제 로컬 메일 파일, 격리된 Nodemailer SMTP 어댑터에서 현재 outbox·인증메일·감사 원자성을 검증했다. 브라우저 화면과 공식 외부 메일 공급자 수신은 이 교차 서버 task의 완료 조건이 아니다.

## 현재 결과

- 두 worker가 같은 queued 작업을 경쟁해도 한 worker만 claim한다. worker가 lease 상태에서 종료되면 다음 worker가 만료 lease를 회수하고 이전 시도를 `expired`, 새 시도를 `delivered`로 보존한다.
- 마지막 시도에서 worker가 종료된 작업은 다음 실행에서 `lease_exhausted` 시도와 dead 작업을 같은 트랜잭션으로 기록하며 다시 발송하지 않는다. 취소·완료 작업도 다시 claim하지 않는다.
- 로컬 메일은 임시 파일을 fsync한 뒤 작업 ID의 최종 파일로 hard-link한다. 동일 작업 재실행은 파일과 성공 감사 이벤트를 한 건만 유지했다.
- 공급자 전달 뒤 DB 영수증·감사 저장이 실패하면 이를 전달 실패로 가장하지 않고 `RECEIPT_PERSISTENCE_FAILED` 재시도로 남긴다. 감사까지 실패하면 leased 작업과 미완료 시도를 보존해 lease 복구가 이어진다.
- 작업 상태·JobAttempt·안전한 감사 이벤트는 같은 트랜잭션으로 끝난다. 감사 실패나 lease 만료가 발생하면 done/dead/cancelled 성공 상태와 시도 결과를 함께 롤백한다.
- 가입·인증 재발송·비밀번호 재설정·MFA OTP는 계정/proof·암호화 mail job·요청 ID 감사 이벤트를 같은 인증 트랜잭션에 기록한다. 어느 감사 쓰기든 실패하면 계정·proof·job·세션·쿠키 성공 결과가 남지 않는다.
- 로그인·로그아웃·MFA 설정/해제·세션 일괄 회수도 실제 변경과 감사가 함께 commit되며, 잘못된 비밀번호나 재전송은 성공 감사 또는 중복 side effect를 만들지 않는다.
- 회사·서비스·MarketingPreference가 0건인 상태에서 tenant 없는 인증 mail job을 SMTP로 전달했다. Nodemailer는 TLS·접근 차단 설정을 받았고 수신자 accepted 뒤 job `done`, 시도 `delivered`, 감사 `email.accepted`를 각각 한 건만 남겼다. 재실행은 SMTP를 다시 호출하지 않았다.
- JobAttempt와 감사에는 상태·시도 번호·안전한 오류 코드·transport만 저장한다. 수신자, 본문, 인증 URL, OTP, 비밀번호와 공급자 오류 원문은 증거나 감사에 남기지 않는다.

## 실행 결과

| 검증 | 결과 | 증거 |
|---|---:|---|
| shadow DB claim·lease 종료·재시작 | 통과 | `outbox-shadow.json` |
| 메일 job·시도·감사 원자성 | 10/10 | `mail-job-audit.json` |
| 공개 인증메일·proof·감사 트랜잭션 | 30/30 | `auth-public-audit.json` |
| 세션·MFA 변경 감사 원자성 | 20/20 | `auth-mutations-audit.json` |
| 로그인 세션·감사 원자성 | 3/3 | `audit-auth-atomicity.json` |
| 마케팅 비의존 인증메일 SMTP | 1/1 | `r01-outbox-boundaries.json` |
| TypeScript·ESLint | 통과 | 공통 서버·worker·시험 파일 |

총 5개 시험 파일의 64개 시험과 shadow outbox 재현이 통과했다. 환경과 수용 조건 집계는 `verification-summary.json`에 고정했다.

## 재현 명령

```bash
/Users/user01/.local/bin/node24 --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/with-shadow.ts scripts/verify-outbox.ts
/Users/user01/.local/bin/node24 --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/mail-job-audit.test.ts
/Users/user01/.local/bin/node24 --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/auth-public-audit.test.ts
/Users/user01/.local/bin/node24 --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/auth-mutations-audit.test.ts
/Users/user01/.local/bin/node24 --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/audit-auth-atomicity.test.ts
/Users/user01/.local/bin/node24 --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/r01-outbox-boundaries.test.ts
/Users/user01/.local/bin/node24 node_modules/typescript/bin/tsc --noEmit
```

공식 SMTP 공급자의 실제 수신·반송·complaint 영수증은 공급자 계정이 필요한 후속 이메일 연동 task에서 `external_pending`으로 관리한다. 이 task는 공급자 성공을 주장하지 않으며 outbox, 로컬 transport, SMTP 어댑터와 인증 트랜잭션 경계만 완료로 판정한다.
