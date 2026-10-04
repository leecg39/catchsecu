# P11-T04 GPKI·새올·그룹웨어 어댑터 — 미완료

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

다른 본인확인 설정과 미연결 화면만 있음. 이번 소스 조사만으로 테스트 실행·브라우저·외부 연동 통과를 주장하지 않는다.

- [src/server/verification.ts](../../../src/server/verification.ts) — lockVerificationContext, getVerificationState, createVerificationIntegration, replayVerificationIntegration
- [tests/server/verification-configuration.test.ts](../../../tests/server/verification-configuration.test.ts)

## 남은 구현·수용

GPKI/새올/그룹웨어 공식 SDK·기관 인증 전체.

원래 범위: 계약/SDK와 조직 식별자를 확인하고 login/verified/fail/email-register 경로를 연결한다.

수용 조건: 공식 sandbox/테스트환경의 성공·실패 증거; SDK/접근권 없으면 블로커 유지; 임의 성공 처리 금지

선행: P11-T03. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.
