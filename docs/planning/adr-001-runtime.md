# ADR 001: 서버 기반과 검증 경계

상태: 채택. 실제 PostgreSQL 통합·Ego 브라우저·production build 시험 통과. 2026-10-02.

- Node 22.23.1 LTS를 고정한다. 시스템 기본 Node 25는 Vitest 5의 지원 대상이 아니므로 사용하지 않는다.
- 기존 Next.js 16.3.8 App Router와 React 19.2.8을 유지한다. 설치된 Next 문서의 Route Handlers와 authentication 가이드를 검토했다.
- 로컬 PostgreSQL 17.11이 실행 중이다. 프로젝트 전용 비관리자 역할과 dev/test/shadow DB만 새로 만든다. 다른 데이터베이스는 변경하지 않는다.
- Prisma 7.10.0과 pg adapter를 사용한다. npm latest인 8.0.0-rc.19는 시험판이라 채택하지 않는다. migration SQL을 버전 관리한다.
- Better Auth 1.7.7의 이메일/비밀번호·인증 메일·복구·세션·2FA를 사용한다. 인증 암호 프로토콜을 직접 작성하지 않는다. CLI 스키마와 실제 인증 API 통합으로 호환성을 검증한다.
- 회사/서비스 권한은 도메인 모델과 명시적 허용표로 관리한다. 회사와 서비스의 복합 외래키로 교차 참조를 막는다.
- 세션 저장은 라이브러리의 기본 DB session 모델을 사용한다. 이 버전은 DB에 세션 token을 보관한다. 초기 설계의 tokenHash와 다른 부분이며 임의 변환으로 인증 라이브러리 계약을 깨지 않는다. DB 접근 제한·HttpOnly 서명 쿠키·만료·폐기·서버 권한 검사를 적용한다. 앱이 발급하는 공개/초대 token은 별도 HMAC 해시로 보관한다.
- Better Auth가 지원하는 verification identifier 해시와 2FA secret 암호화를 사용한다. 메일 작업 payload 및 앱 민감 데이터는 AES-256-GCM으로 암호화한다.
- 외부 메일 자격증명이 없으므로 로컬 전용 비공개 메일함으로 링크/코드 roundtrip을 시험한다. 이를 외부 실제 발송 성공으로 집계하지 않는다.
- Vitest 5.0.3 / Playwright와 실제 PostgreSQL로 시험한다. 테스트 DB명·호스트를 검증한 뒤 테스트 fixture만 정리한다.

## 검토한 공식 자료

- [Better Auth 설치](https://better-auth.com/docs/installation)
- [Prisma adapter](https://better-auth.com/docs/adapters/prisma)
- [2FA](https://better-auth.com/docs/plugins/2fa)
- [Prisma 7 변경](https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v7)

## 도구 의존성
최초 npm audit에서 Prisma CLI의 deepmerge-ts와 mysql2 전이 의존성 경고가 확인되었다. 실제 사용하는 PostgreSQL 런타임과 분리해 평가하고, 호환성 검증 후 해결 상태를 기록한다. 확인 없이 audit fix --force를 실행하지 않는다.

## 시험 결과

Prisma CLI 전이 의존성을 deepmerge-ts 8.0.2 / mysql2 3.24.5로 고정했다. 설정 파싱·스키마 검사·실제 DB 통합 12개·빌드가 통과했고 npm audit는 0건이다. 증거: `../qa/P00-T02/`.
