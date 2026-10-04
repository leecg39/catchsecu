# /log/collect-destruction 서버 연결 구현 (2026-10-04)

## 변경 내용

| 구성요소 | 파일 |
|---|---|
| 계약 | `src/contracts/analytics.ts` — `collectDestructionQuery`, `CollectDestructionList/Row/Source/Totals` |
| 집계 서버 | `src/server/collect-destruction.ts` — `collectDestructionDaily`, `collectDestructionCsv` |
| 목록 API | `GET /api/v1/analytics/collect-destruction` |
| CSV 내보내기 | `GET /api/v1/analytics/collect-destruction/export` (BOM·수식 방어·5000건 상한) |
| 화면 | `src/components/management/CollectDestruction.tsx` (신규) — `ManagementPages`에서 `/log/collect-destruction` 라우팅, `logs.tsx` 정적 설정 제거 |
| 인덱스 | `prisma/migrations/20261006090000_submission_tenant_submitted_index` — `Submission(tenantId, submittedAt)` |

## 집계 의미

- 행 단위: `일자(Asia/Seoul) × 서비스 × 원천(Form.sourceType='form'|‘import')` — 수집 또는 파기 이벤트가 있는 날만 표시
- `수집한 개인정보`: 해당 원천의 누적 제출 수(기간 필터와 무관, 삭제 폼 제외)
- `당일 수집`: `Submission.submittedAt` 일별 건수
- `당일 파기`: `DestructionCertificate.completedAt` 일별 건수(제출→폼버전→폼으로 원천 귀속)
- `당일 잔여`: 당일 수집 − 당일 파기 (이전 수집분 파기 시 음수 가능 — 원본 FAQ와 일치)
- `데이터 합계`: 필터 적용 전체 행 합계 + 원천별 누적 수집 합계

## 권한·격리

- `requireContext("service.read")` + `documentScope` 현재 권한 재검사(FOR SHARE 잠금)
- 비관리자는 ServiceGrant 보유 서비스만; 범위 밖 serviceId 지정 시 빈 결과
- 소스 드롭다운(`sources`)도 동일 범위로 제한
- 조회 `analytics.collect_destruction_viewed`·내보내기 `analytics.collect_destruction_exported` 감사 이벤트 동일 트랜잭션

## 검증

- SQL CTE 직접 실행(개발 DB): 일자·원천·파기 잔여·누적 수집이 기대와 일치 (`psql` 출력 본문 기록)
- EXPLAIN: `Submission_tenantId_submittedAt_idx` 생성 확인, tenant+기간 스캔 경로 확보
- `npm run typecheck` 통과, eslint 대상 파일 오류 0
- `tests/server/collect-destruction.test.ts`: 집계 정확성(누적·KST 경계·음수 잔여)·서비스/원천/검색/기간 필터·페이지·권한 범위·타사 격리·CSV BOM+수식 방어·조회/내보내기 감사 이벤트·422 — **8/8 통과** (2026-10-04, 격리 DB `catchsecu_test2` — 다른 검증 스위트가 catchsecu_test를 공유해 TRUNCATE 경합, `^/catchsecu_test` 접두 가드로 격리)
- `npm run typecheck` 통과·eslint 대상 파일 오류 0 (최종 상태 기준)
- 라이브 서버 검증 (2026-10-04, `npm run dev` :3100 + 개발 DB):
  - `GET /log/collect-destruction` 200 — CollectDestruction 셸(필터·검색·도구모음) 렌더, 비로그인은 `/login` 307
  - `GET /api/v1/analytics/collect-destruction` 실세션 200 — 행 3건(일자·서비스·원천·수집/파기/잔여·누적), sources 7건
  - `GET .../export` 실세션 200 — BOM(`EF BB BF`) + 원본 헤더 + CRLF 확인
  - **Chrome 실제 브라우저 인터랙티브 확인 (2026-10-04)**: admin 세션으로 테이블 3행·합계 행·필터(서비스 선택 시 원천 드롭다운 연동 축소)·빈 상태·페이지·**엑셀 다운로드 클릭→export 200**·1440px/390px(햄버거·세로 필터·가로 스크롤) 확인
