# R02-T01 계정 인증·세션·복구 모델·규칙

2026-10-11 완료. 현재 Better Auth 1.7.7 계약을 유지하면서 dev/test PostgreSQL의 인증 모델 8개와 schema·DTO·migration·트리거를 다시 대조했다. 새 migration은 필요하지 않았다. 이 Task는 모델 단계이므로 브라우저 화면과 Route Handler 전체 수용은 각각 R02-T03·R02-T04에서 판정한다.

## 모델 결과

- `User`, `Account`, `Session`, `Verification`, `TwoFactor`, `RateLimit`, `PasswordHistory`, `PasswordDeferral`의 필수 필드 73개, 제약 21개, 인덱스 25개, 사용자 트리거 7개가 dev/test DB에서 일치했다.
- 이메일 소문자 CHECK와 unique, 세션 token unique, provider/account identity unique, 사용자별 credential 1개, 계정·세션·MFA·암호 이력 FK를 실제 위반 입력으로 확인했다.
- 유효한 `Verification`을 동시에 두 번 소비하면 한 건만 삭제된다. 만료된 proof는 소비되지 않고 남아 재요청 판단에 사용된다.
- `PasswordDeferral`은 회사·구성원·사용자 복합 FK, session/period 모드, 양수 정책 revision, 구성원별 한 건을 DB에서 강제한다.
- credential 변경 트리거는 기존 암호 hash를 이력에 추가하고 최신 9개만 보존한다. 같은 트랜잭션에서 모든 세션, 사용자 reset proof, 암호 유예를 지우고 request ID가 연결된 `password.changed`·`session.ended` 감사를 기록한다.
- 감사 이벤트가 있는 사용자의 직접 `DELETE`는 불변 감사 행의 FK 갱신을 시도하므로 거부된다. 계정 삭제는 이 모델 Task의 물리 삭제가 아니라 R05의 폐쇄 상태 전이로 처리한다.
- 암호 변경·초기화·유예 DTO는 알 수 없는 필드를 거부하고 UUID, 양수 revision, 암호 길이와 token 길이를 제한한다.

## 검증 결과

| 검증 | 결과 | 증거 |
|---|---:|---|
| dev DB 모델·제약·DTO·트리거 읽기 감사 | 통과 | `../model-audit/catchsecu_dev.json` |
| test DB 모델·제약·DTO·트리거 읽기 감사 | 통과 | `../model-audit/catchsecu_test.json` |
| 실제 PostgreSQL 모델 경계와 인증 상태 전이 회귀 | 8파일 148/148 | `auth-model-regression.json` |
| TypeScript·변경 파일 ESLint·production build | 모두 통과 | `quality-gates.json` |

148개에는 전용 모델 경계 6개와 기존 가입·이메일 인증·세션·비밀번호 재설정·MFA·복구코드·암호정책 회귀가 포함된다. 기존 회귀는 모델 상태 전이가 현재 스키마와 계속 맞는지 확인하는 근거이며, 후속 서버·화면 Task를 자동 완료시키는 증거로 사용하지 않는다.

## 실패와 수정

첫 시험은 Vitest 5에 없는 `describe.sequential` 호출 때문에 시험 실행 전 실패했다. 일반 `describe`로 고친 뒤 첫 동작 실행에서는 테스트 정리 코드가 불변 `AuditEvent`를 삭제하고 사용자 hard delete 성공을 기대해 6개가 실패했다. 제품 동작을 우회하지 않고 `catchsecu_test` 전용 DB 가드와 suite 전후 `TRUNCATE ... CASCADE`로 fixture 범위를 명확히 했고, hard delete 거부를 계약으로 수정했다. 최종 전용 6개와 전체 148개가 통과했다.

## 재현 명령

```bash
/Users/user01/.local/bin/node24 --env-file=.env.local --import tsx scripts/qa-rea-auth-model.ts
/Users/user01/.local/bin/node24 --env-file=.env.test.local --import tsx scripts/qa-rea-auth-model.ts
/Users/user01/.local/bin/node24 --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/r02-auth-model-boundaries.test.ts tests/server/foundation.test.ts tests/server/auth-navigation.test.ts tests/server/auth-session-gate.test.ts tests/server/auth-public-audit.test.ts tests/server/auth-mutations-audit.test.ts tests/server/credential-audit.test.ts tests/server/password-policy.test.ts
/Users/user01/.local/bin/node24 node_modules/typescript/bin/tsc --noEmit
/Users/user01/.local/bin/node24 node_modules/eslint/bin/eslint.js tests/server/r02-auth-model-boundaries.test.ts scripts/qa-rea-auth-model.ts
ALLOW_LOCAL_MAIL=1 ALLOW_LOCAL_KAKAO=1 ALLOW_LOCAL_PAYMENT=1 /Users/user01/.local/bin/node24 node_modules/next/dist/bin/next build
```

동작 시험은 localhost의 `catchsecu_test`만 허용하고 suite 전후 해당 시험 DB를 정리한다. dev DB 검사는 읽기 전용이며 운영·원본 DB, 실제 수신자, 외부 OAuth·SMTP·결제를 사용하지 않았다. 원본 서비스의 미관찰 DB 구조를 복원했다고 주장하지 않는다.
