# R04-T01 구성원·초대·권한·전문가 모델·규칙 완료 검증

2026-10-11 현재 소스와 dev/test PostgreSQL을 기준으로 Membership, ServiceGrant, Invitation, AccessRequest, ExpertAssignment, ExpertAssignmentService 6개 모델과 DTO 규칙을 다시 대조했다.

## 결과

- dev/test 각각 6개 모델, 55개 열, 26개 제약조건, 26개 인덱스, 7개 트리거를 실제 PostgreSQL 카탈로그에서 확인했다.
- Membership은 회사·사용자별 유일하며 ServiceGrant는 회사·구성원과 회사·서비스 복합 FK, 회사·구성원·서비스 유일성을 사용한다.
- Invitation은 tokenHash와 회사·lower(email)의 유효 pending 초대를 유일하게 유지한다. 만료·재발송·취소·수락 1회, 역할·서비스 범위 입력은 서버 트랜잭션과 DTO에서 검증한다.
- AccessRequest는 요청자·검토자·서비스를 tenantId 복합 FK로 묶고 회사·요청자·서비스별 pending 요청 한 건과 상태·검토자·완료시각 조합을 DB가 보장한다.
- ExpertAssignment와 배정 서비스는 회사·전문가·서비스 범위를 복합 FK와 unique로 묶는다. 만료시각, active/revoked·revokedAt, version, 전문가용 Membership 연결을 DB와 서버가 함께 검사한다.
- 마지막 활성 owner 트리거가 회사 행을 잠그며, 두 owner를 동시에 강등해도 한 요청만 성공하고 활성 owner 한 명이 남는 것을 실제 PostgreSQL에서 확인했다.
- 모델·권한 회귀 10 suite 103개가 통과했다. TypeScript, 대상 ESLint, production build 82페이지도 통과했다.
- Prisma schema는 유효하고 dev/test 모두 148개 migration이 최신이다. 현재 완료 조건에 필요한 제약이 이미 있어 신규 migration은 만들지 않았다.

## 증거

- [검증 집계](verification-summary.json)
- [103개 모델·권한 회귀](model-regression.json)
- [schema·migration 상태](schema-migration.json)
- [품질 게이트](quality-gates.json)
- [dev 모델 감사](../model-audit/catchsecu_dev.json)
- [test 모델 감사](../model-audit/catchsecu_test.json)

이 작업은 내부 모델·규칙 단계이므로 외부 자격증명이 필요하지 않다. 초대 메일 실수신과 화면 동등성은 후속 R04-T02~T04에서 별도로 판정하며, 현재 작업의 원본 충실도는 `partial_observed`다.
