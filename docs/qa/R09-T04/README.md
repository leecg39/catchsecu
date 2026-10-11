# R09-T04 — 폼 승인·게시·고정 URL: DB·브라우저·재시작 수용검증

## 결과: 통과 (로컬 수용)

외부 제공사 연동 없음 — `external_status: not_applicable` (R09-T02 계약과 동일).

## 수용 범위 대조

| 수용 기준 | 증거 | 결과 |
|---|---|---|
| 초안→승인→게시→외부접속→중단→재개 | 브라우저: 승인(사유 포함)→"게시하고 공유하기"→공유 화면→익명 공개 접속→목록 "일시 중지"→공개 410 종료 화면→재개→공개 복구 | `browser-acceptance-round2.json` |
| 승인본 바꿔치기 거부 | R09-T02 계약 테스트: 결정 시 현재 폼 버전·해시·정책 리비전 재검사 | `tests/server/r09-publish-contract.test.ts`, R09-T02 회귀 |
| 고정URL 대상 교체·이전 링크 정책 | 생성/이름변경/사용 종료 브라우저 수용 + 대상 교체·이전 링크 테스트(R09-T02 회귀 143건) | 위와 동일 |
| 같은 slug 경쟁 409 | 모달에서 사용 중 slug 제출 → POST /fixed-urls 409 + "이미 등록된 값입니다." | `browser-acceptance-round2.json` |
| 링크 복사만으로 게시 안 됨 | URL 복사 토스트만 발생, 게시·감사 이벤트 없음 (계약 테스트 pin 포함) | R09-T02 + `browser-acceptance-round2.json` |
| A/B 테넌트 격리·권한 거부 | viewer 멤버십(읽기 전용): 게시/저장 disabled, 결정 컨트롤 없음, 고정URL 쓰기 컨트롤 없음, 로그 열람 가능 | `browser-acceptance-round2.json`, `qa-r09-viewer.ts` |
| 브라우저 상태변경→새로고침 | `?pageSize=10&page=2` 전체 리로드 후 동일 상태, 검색 `?q=` 유지 | `browser-acceptance-round2.json` |
| 서버 재시작→세션·공개 URL | production server.ts SIGTERM→재기동, `/api/v1/health` ok, 세션 유지, `/url/r09-accept-qa01` 공개 폼 정상 | `browser-after-restart.json` |
| DB 지문 before==after | forms 14 / approvals 13 / publications 5 / fixedUrls 13 / audits 43 — sha256 `02e85f6b…437ad` 동일 | `acceptance-database-before.json`, `acceptance-database-restart.json`, `scripts/qa-r09-acceptance.ts` |
| typecheck·lint·build | 83페이지 production build 통과, typecheck/lint clean | `docs/qa/R09-T03/current/build.log`, `typecheck.log`, `lint.log` |

## 재시작 절차 증거

1. `scripts/qa-r09-acceptance.ts before` — DB 지문 저장 (SHA-256 over R09 fixture tenants' forms/approvals/publications/fixedUrls/audits).
2. `kill <pid>` → `APP_PORT=3121 … node --env-file=.env.local --import tsx scripts/server.ts` 재기동.
3. `GET /api/v1/health` → `{"status":"ok","database":"ready"}`.
4. `scripts/qa-r09-acceptance.ts restart` — 지문 재계산·before와 동일 확인.
5. 브라우저 세션 유지·고정URL 공개 해석 재확인.

재시작 시 APP_PORT/`ALLOW_LOCAL_*` 가드 미설정 시 즉시 실패하는 것도 확인 — 운영 환경 provider guard 정상 작동.

## 비고

- 이 도메인은 외부 제공사 수신 증거가 필요한 경계가 없음(메일/결제/카카오 미사용). 로컬 어댑터 가드만 관련됨.
- worker는 본 QA 환경에서 상주하지 않음 — outbox/idempotency 원자성은 R09-T02 통합 테스트로 검증됨.
