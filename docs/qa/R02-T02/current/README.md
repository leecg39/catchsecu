# R02-T02 인증 서버 API 완료 검증

2026-10-11 현재 소스와 실제 `catchsecu_test` PostgreSQL을 기준으로 계정 인증 서버 동작을 다시 검증했다.

## 완료한 범위

- 이메일 가입, 암호 로그인, 로그아웃, 세션 조회와 다른 기기 세션 폐기
- 로컬 시험메일의 이메일 인증·암호 재설정 링크 생성, 한 번 사용, 동시 사용 직렬화와 재사용 거부
- 틀린 암호, 만료된 reset/OTP, 잘못된 TOTP, 이미 사용한 복구코드 거부
- OTP/TOTP 등록·확인·해제, 복구코드 소비, 세션 교체와 정책 변경 후 기존 세션 집행
- 계정 존재 여부를 드러내지 않는 재설정 응답, 재전송·로그인 rate limit, same-origin `returnTo` 검증
- 가입·암호 변경·세션 폐기·MFA 변경의 DB, 감사, 암호화 mail outbox 원자성 및 실패 rollback
- A/B 회사 격리, 역할·직접 소속·현재 세션 재검사, 구독 만료·미포함 상태의 정책/IP/MFA 쓰기 거부와 무변경

## 실행 결과

- 인증·세션·정책 회귀: 12파일, 24 suite, 206시험 모두 통과
- 보안 기능 구독 경계: 1파일, 1 suite, 27시험 모두 통과
- 합계: 13파일, 25 suite, 233시험, 실패·대기 0
- 보존된 실제 계정 상태 재검증: 이메일 인증 유지, MFA 해제 유지, 유효 세션 1개, 관련 감사 67건
- typecheck, 대상 ESLint, production build 82페이지, 계획 검증 통과

[검증 집계](verification-summary.json) · [인증 API 회귀](auth-api-regression.json) · [구독·권한 경계](security-entitlements.json) · [재시작 영속 상태](restart-persistence-verification.json) · [소스 지문](source-fingerprints.json) · [품질 게이트](quality-gates.json)

## 증거 경계

이 작업의 완료 조건은 로컬 시험메일이다. 공식 SMTP·DNS·실제 외부 수신함은 실행하지 않았고, 후속 `R02-T04`의 `external_pending`으로 유지한다. 기존 Ego Lite 화면과 서버 재시작 수용 기록은 [R02-T03 화면 증거](../../R02-T03/authentication/README.md)와 [R02-T04 재시작 증거](../../R02-T04/authentication/README.md)에 있다. 이번 완료는 서버 API 작업에 한정하며 인증 화면 작업 `R02-T03`과 전체 수용 `R02-T04`를 완료로 바꾸지 않는다.
