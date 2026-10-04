# P11-T04 GPKI·새올·그룹웨어 어댑터

## 개요

공공기관 및 엔터프라이즈 환경을 위한 행정전자서명(GPKI), 새올 행정정보시스템 및 조직 내부 그룹웨어 SSO 연동 어댑터 규격을 구현한다.

## 구현 내용

1. **조직 인증 어댑터 인터페이스**:
   - GPKI/EPKI 인증서 기반 로그인 및 본인확인 핸들러
   - 연계 기관 식별자 검증 및 조직 소속 확인
   - `/login/verified`, `/login/fail`, `/email-register` 경로 상태 연동
2. **보안 및 규정**:
   - 기관 인증서 서명 검증 및 인증서 유효기간/폐기(CRL/OCSP) 상태 확인
   - 임의 성공 처리(Mock bypass) 금지 및 정식 규격 충족

## 검증 내역

- 테스트 스위트: `tests/server/verification-configuration.test.ts`, `tests/server/auth-session-gate.test.ts`
- 주요 검증 항목:
  - 위조 인증서 및 서명 불일치 시 401 차단
  - 미승인 기관 식별자 접근 거부
  - 인증 성공 시 소속 회사/역할 자동 매핑 확인
