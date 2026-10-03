# P03-T02 구성원·초대·권한·전문가 — 진행 중

2026-10-03. 이 기록은 전문가 배정 신규 구현의 증거다. P03-T02 전체 수용 조건과 선행 작업 게이트는 아직 완료로 판정하지 않는다.

## 전문가 배정 구현

- Migration 49: `ExpertAssignment`(회사·전문가 계정·배정자·기한·버전·회수 상태), `ExpertAssignmentService`(회사/서비스 복합 FK), 전문가 전용 Membership 연결. DB 제약은 회사/계정 일치, 조회자 역할, 회사별 중복 배정과 서비스 범위를 검사한다.
- 시스템 운영자만 기존 활성·이메일 인증 계정을 회사별 활성 서비스에 배정·수정·회수·재배정한다. 일반 회사 구성원 관리 API는 전문가 역할 변경·제외·소유권 이전을 거부한다.
- 전문가 선택 화면은 실제 계정명·배정 회사·서비스·만료/회수 상태를 조회한다. `/context` 회사 선택은 현재 배정·만료·서비스 범위를 재검사한다. 서비스 목록과 상세도 명시된 범위만 허용한다.
- 회수는 구성원 상태와 grant를 바꾸고 활성 회사 선택을 해제한다. 만료는 요청 단계에서 즉시 차단하고 worker가 남은 grant·세션 선택을 정리한다. 감사 이벤트는 보존한다.
- 새 운영 화면 `/admin/expert-assignments`에서 회사·전문가 이메일·서비스·만료일을 입력해 생성/수정/회수/재배정할 수 있다.

`tests/server/expert-assignments.test.ts`는 실제 PostgreSQL과 API Route Handler에서 401/403/404, 타 회사 서비스 배정 거부, 미배정 회사 선택 거부, 서비스 범위·직접 grant 우회 차단, 일반 구성원 관리 승격 차단, 범위 수정·오래된 버전 409, 회수 직후 API 차단, 만료·worker 정리·재배정, DB 복합 FK를 검사한다. 신규 시험 4건 통과.
보관된 서비스는 전문가의 `/context` 서비스 목록에서 제외하고 직접 상세 조회 404를 반환하는 시험도 추가했다.

전체 회귀 `npm test`는 23개 파일·395개 시험 통과했다. 최신 코드에서 `npm run typecheck`, 변경 파일 ESLint(오류 0, 기존 이미지 경고 2건), `ALLOW_LOCAL_MAIL=1 npm run build`, `npm run verify:plan`도 통과했다.

로컬 production 서버와 실제 `catchsecu_dev`에서 [HTTP 실행 기록](http.txt)을 확인했다. 전문가 선택·운영 화면 GET 200, 배정 POST 201, 본인 배정 목록 GET 200, 회사 선택 POST 200, 배정 서비스만 조회 GET 200, 회수 DELETE 204, 회수 후 같은 회사 재선택 POST 404였다. 테스트에 쓰인 전문가 배정/구성원/grant는 제거했고 임시 운영자 권한을 복원했다. 재현 명령: `node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa-expert-assignments.ts`.

## 근거와 남은 게이트

- 원본 [`/expert/select-company` 조사 기록](../../research/public/_expert_select-company.json)은 검색창과 배정 회사가 없는 화면만 보여준다. 배정된 회사의 실제 UX/권한 범위는 관찰되지 않았다. 현재 전문가의 서비스별 `viewer` 역할은 독립 구현의 보수적 범위이며 원본 동일성을 주장하지 않는다.
- 구성원 초대·수락·정지·회수 전체 경로의 최신 브라우저 시험, 마지막 소유자 보호와 외부 전문가 운영 정책 검토, 원본 배정 상태 화면 대조가 남아 있다.
- 실제 브라우저 회사 선택·뒤로가기·모바일, 회사 A/B 직접 URL·새로고침, 배정 관리 화면 사용성 검증이 남아 있다.
