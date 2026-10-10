# 잔여 API route 수용 증거

검증일: 2026-10-11 05:20 KST  
실행 환경: Node.js 24.18.0, 로컬 격리 PostgreSQL `catchsecu_test`

## 범위

- 본인 SSO 연결 목록·해제 2개 operation
- 청구서·사용량 조회 2개 operation
- 초대 SSO 공급자 선택·시작 2개 operation
- 문자 수신확인 webhook 1개 operation
- SSO 공급자 사전검사 1개 operation
- 기관 이메일 등록 인증번호 요청 1개 operation

동적 import 또는 서비스 직접 호출로만 시험하던 경로를 정적 route import와 실제 `Request` 호출로 연결했다. 로컬 OIDC IdP, 실제 서명한 SAML 응답, 로컬 기관 인증메일 worker, 서명한 문자 webhook, PostgreSQL 권한·세션·경합 fixture를 사용했다.

## 결과

- 현재 소스 대상 테스트 파일 5개, 시험 228개 모두 통과
- 잔여 route operation 9개 직접 실행
- 타입 검사와 변경 파일 ESLint 통과
- API 감사: 직접 handler 시험 연결 457→466, 미연결 9→0
- handler/메서드·정책·작업 소유자 누락 모두 0

최초 5파일 실행은 문자 webhook 비밀키가 비어 있어 서명 검사 전에 503이 반환됐고 228개 중 227개가 통과했다. 시험 구간에만 합성 비밀키를 설정하고 원상복구하도록 수정한 뒤 문자 파일 3/3, 전체 5파일 228/228을 다시 통과했다. 최초 실패는 [initial-regression.json](initial-regression.json), 집중 재시험은 [sms-retry.json](sms-retry.json), 최종 단일 녹색 실행은 [regression.json](regression.json)에 보존한다.

[전체 API 감사](../api-audit/README.md)의 직접 import 연결은 정적 진입점 증거다. catch-all 285개 operation의 모든 분기 실행 성공을 뜻하지 않는다. 실제 외부 OIDC·SAML 기관, 메일 제공사, 문자 제공사 자격증명을 사용한 검증도 `external_pending`으로 남긴다.

## 재현

```bash
PATH=/Users/user01/homebrew/bin:$PATH npm test -- \
  tests/server/sso.test.ts \
  tests/server/sso-saml.test.ts \
  tests/server/org-auth.test.ts \
  tests/server/billing-read-authority.test.ts \
  tests/server/sms-adapter.test.ts
PATH=/Users/user01/homebrew/bin:$PATH npm run verify:api-audit
```
