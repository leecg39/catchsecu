# 공통 인증 route 수용 증거

검증일: 2026-10-11 05:09 KST  
실행 환경: Node.js 24.18.0, 로컬 격리 PostgreSQL `catchsecu_test`

## 범위

기존 인증 회귀가 내부 `auth.handler`를 직접 호출하던 부분을 실제 Next.js `GET/POST /api/v1/auth/[...all]` export를 통과하도록 변경했다. 다음 OpenAPI operation 13개가 공통 route에서 실행된다.

- 이메일 가입·로그인
- 비밀번호 재설정 요청·재설정·로그인 중 변경
- 로그아웃·현재 세션 조회
- MFA 등록·TOTP 확인·이메일 OTP 전송/확인·백업 코드 확인·MFA 해제

## 결과

- 대상 테스트 파일 3개, 시험 71개 통과
- 공통 인증 route operation 13개 직접 실행
- 실제 PostgreSQL 계정·세션·인증 수단·증명 및 감사 트랜잭션 확인
- 실패 주입·경합·세션 회전·재사용 방지·rate limit 회귀 통과
- 타입 검사와 변경 파일 ESLint 통과
- API 감사: 직접 handler 시험 연결 444→457, 미연결 22→9

[Vitest JSON 결과](regression.json)와 [전체 API 감사](../api-audit/README.md)를 함께 사용한다. 로컬 메일 worker를 사용하는 내부 수용 결과이며 실제 외부 메일 제공사의 수신 증거로 집계하지 않는다. R00-T02 전체 완료나 남은 9개 operation의 실행 성공도 뜻하지 않는다.

## 재현

```bash
PATH=/Users/user01/homebrew/bin:$PATH npm test -- \
  tests/server/auth-public-audit.test.ts \
  tests/server/auth-mutations-audit.test.ts \
  tests/server/password-policy.test.ts
PATH=/Users/user01/homebrew/bin:$PATH npm run verify:api-audit
```
