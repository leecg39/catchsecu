# R04-T02 구성원·초대·권한·전문가 서버 API 완료 검증

2026-10-11 현재 Route Handler, OpenAPI 계약과 실제 `catchsecu_test` PostgreSQL을 기준으로 구성원·초대·서비스 접근 요청·전문가 배정의 서버 업무 처리를 다시 검증했다.

## 결과

- R04-T02 소유 OpenAPI 15개 경로 23개 작업이 모두 `implemented`이며 권한과 계약 정책을 선언하고 실제 Route Handler의 HTTP export에 연결된다.
- 초대 생성·목록·미리보기·수락·재발송·취소, 구성원 목록·상세·변경·제외·소유권 이전, 접근 요청 생성·조회·결정·취소, 전문가 배정 CRUD·옵션을 실제 PostgreSQL 통합 테스트로 확인했다.
- tenant ID 교체, 역할 상승, 다른 회사 접근, 구독·좌석 제한, 만료·중복 초대, 재수락, 전문가 만료·회수·재배정, 현재 세션·계정·회사·MFA·역할 변경을 거부한다.
- 서비스 권한 회수 직후 기존 세션의 직접 URL과 목록이 차단되고, 진행 중 트랜잭션도 커밋 전에 현재 권한과 기한을 다시 검사한다.
- 같은 소유자가 두 대상에게 동시에 소유권 이전을 요청하면 한 건만 성공하고 활성 소유자 한 명과 감사 한 건을 보존한다. DB 직접 동시 강등도 마지막 활성 소유자를 보존한다.
- 업무 변경·감사·초대 mail outbox가 같은 트랜잭션에서 커밋되며, 권한·기한 실패 때 변경·감사·job을 함께 롤백한다. 재발송은 이전 대기 job을 취소하고 새 버전 job만 만든다.
- 서버 회귀 12 suite 239개, 타입 검사, 전체 ESLint 오류 0, production build 82페이지, 계획 검증을 통과했다.

## 증거

- [검증 집계](verification-summary.json)
- [23개 API 계약](api-contract.json)
- [239개 서버 회귀](server-api-regression.json)
- [감사·outbox 원자성](outbox-atomicity.json)
- [품질 게이트](quality-gates.json)

초대 SSO options/start의 내부 토큰·회사·IP·공급자 결합은 로컬 합성 공급자로 검증했다. Google·Microsoft·기관 SSO의 공식 외부 왕복은 공동 소유 작업 R07-T02 및 최종 수용에서 별도 증거로 판정하므로 이 서버 API 작업은 외부 공급자 성공을 주장하지 않는다.
