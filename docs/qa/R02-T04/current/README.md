# R02-T04 인증 수용검증 — 내부 통과, 외부 대기

2026-10-11 현재 소스와 실제 PostgreSQL, Ego Lite 기록, production build를 기준으로 인증 도메인의 내부 수용조건을 다시 검증했다.

## 내부 검증 결과

- 모델·API·UI·권한·구독 경계 15파일, 28 suite, 249시험이 모두 통과했다. 실패·대기 시험은 0개다.
- 가입, 인증 링크 단일 소비, 로그인·로그아웃, 암호 재설정·변경, TOTP/OTP, 복구코드 재사용 거부, 다중 세션 폐기, tenant/role/license 거부와 실패·중복·경합 rollback을 포함한다.
- 기존 Ego Lite 여정은 로컬 mail worker의 개별 job 5건, 가입→인증→reset→MFA 등록/로그인/해제→암호 변경과 새로고침을 실제 UI·DB로 확인했다.
- 독립 HTTP 쿠키 세션을 두 번째 기기로 사용해 암호 재설정 뒤 DB 세션 삭제와 이전 쿠키 거부를 확인했다. 별도 브라우저 프로필이라고 주장하지 않는다.
- 현재 production build를 두 번 기동했다. 두 실행 모두 health 200·DB ready였고 로그인 HTML은 11,078 bytes와 같은 SHA-256이었다.
- 보존 합성 계정의 `emailVerified=true`, `twoFactorEnabled=false`, 유효 세션 1개, 감사 67건이 재시작 전후 동일했다.
- 현재 소스에서 typecheck, 대상 lint, production build 82페이지가 통과했다.

[검증 집계](verification-summary.json) · [249개 회귀](full-acceptance-regression.json) · [재시작 대조](restart-verification.json) · [외부 의존성](external-dependency.json) · [품질 게이트](quality-gates.json)

## 외부 의존성

공식 SMTP/API 공급자, 시험 도메인의 SPF/DKIM/DMARC, 외부 수신함, bounce/complaint callback은 실제 자격증명이 없어 실행하지 않았다. 로컬 outbox·SMTP transport 계약·worker·인증 링크는 검증됐지만 공식 수신 증거로 대체하지 않는다. 따라서 `R02-T04`는 `in_progress / external_pending`을 유지하며 완료로 처리하지 않는다. 이 계획의 완료 조건에 따라 후속 내부 구현은 진행할 수 있다.

기존 상세 증거: [인증 DB·메일·재시작](../authentication/README.md), [재시작 후 DB](../authentication/verified-after-restart.json), [두 번째 세션 폐기](../authentication/revoked-second-session.json), [현재 Ego Lite 재전송](../../R02-T03/current/retry-countdown-browser-db.json).
