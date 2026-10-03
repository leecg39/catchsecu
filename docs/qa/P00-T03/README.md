# P00-T03 모델·API·권한 계약 확정

2026-10-03. 독립 구현의 모델·API·권한 기준선을 문서와 기계 판독 계약으로 고정했다. 이 작업은 계약을 확정하는 P00 범위이며 181개 화면의 전체 기능 완료 판정은 아니다.

## 결과물

- [계약 기준선](../../planning/contracts/README.md): ERD, 구현 DDL/미구현 설계안 구분, DTO·오류, 실제 역할×행위, 상태 전이와 삭제 의미.
- [OpenAPI 3.1](../../planning/contracts/openapi.json): 실제/부분/제안 상태, 경로·method·권한·입력 스키마·응답 상태. 현재 243개 경로·354개 작업.
- [작업별 정책 표](../../planning/contracts/operation-policy-matrix.csv): 모든 작업의 권한, 회사/서비스·토큰 범위, 입력 검증, 안전 DTO, 삭제와 금지 동작. [30개 정책](../../planning/contracts/domain-policies.json)에서 상속한다.
- [원본 불확실성 결정](../../planning/contracts/README.md): R162–R164의 P/C/OC 약어는 내부 문서 유형과 연결하지 않고, 국외이전 내부 유형은 별도 검증 규칙으로 둔다. 원본 의미 확인 전 별칭 공개를 금지한다.

## 검증

- `python3 scripts/verify-contracts.py`: 243경로·354작업·30정책의 누락 0, 권한 누락 0, 변경 API 입력 스키마 누락 0. `TASKS.md`와 `tasks.json`의 완료 3건도 일치한다. 결과는 [contract-check.json](contract-check.json).
- `npm run verify:plan`: 원본 CSV·manifest·계획의 181경로 일치, 메뉴 34개, 고유 E2E ID 181개, Task 72개, 의존성 순환 0.
- `prisma validate`는 현재 schema 유효성을 확인한다. [Prisma schema](../../../prisma/schema.prisma)와 migration SQL이 구현 DDL이다.
- Node 24에서 `npm run typecheck`와 변경 생성기 ESLint 오류 0. [전체 PostgreSQL 회귀](full-test.txt)는 26개 파일·414건 통과했고, [production build](build.txt)도 통과했다.

이 계약 검사는 API가 실제 외부 공급자와 연결됐다는 의미가 아니다. 제안 API 작업 52건과 원본 관찰 제한 128개 화면은 각 후속 Task에서 구현·재확인한다. 계약 문서의 재생성 명령은 `node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/generate-openapi.ts`, `python3 scripts/verify-contracts.py --write`다.
