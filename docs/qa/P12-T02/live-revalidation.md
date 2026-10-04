# P12-T02 대시보드 집계 라이브 재검증 (2026-10-04)

dev 앱 :3100 owner 세션으로 `/api/v1/analytics/dashboard`를 호출하고 **독립 SQL 집계와 대조**했다.

| 항목 | API 응답 | 독립 SQL | 판정 |
|---|---|---|---|
| 활성 서비스 | 2 | 2 | 일치 |
| 폼 | 7 | 7 | 일치 |
| 현재 보유 응답 | 3 | submitted 2 + corrected 1 = 3 | 일치 |
| 기간 내 접수(기본 월) | 3 | submittedAt 기간 필터 3 | 일치 |
| 빈 과거 기간(9/1~9/10) | periodSubmissions 0, retained 3 | 0 | 일치 — 기간 경계[from,to) 정상 |

## 경계·권한

| 시나리오 | 결과 |
|---|---|
| 타 회사 서비스 serviceId | 404 — 권한 밖 비노출 |
| 기간 400일 초과 | 422 `ANALYTICS_PERIOD` |
| 미래 기간 | 422 — "현재까지 지정" |

## 남은 조건

- 라이선스 원장·재집계 스냅샷 전체 비교는 선행 P10-T03(PG 외부) 게이트에 의존.
- 정정·철회·파기 반영의 라이브 브라우저 단은 기존 시험(analytics.test.ts·campaigns.test.ts 수신거부 흐름)으로 커버.

## 재집계·원장 라이브 대조 (2026-10-05 추가, `live-recompute.json`)

dev :3100 owner 세션 + 독립 SQL 동시 대조:

| 항목 | API | SQL | 판정 |
|---|---|---|---|
| 활성 서비스 | 2 | 2 | 일치 |
| 폼 | 13 | 13 | 일치 |
| 현재 보유 응답 | 7 | 7 | 일치 |
| 월 기간 접수(10월) | 7 | 7 | 일치 |
| 원장 available/held(KRW) | 0/0, total 0 | CreditAccount 0·LedgerTransaction 0 | 일치(빈 원장 경계) |

**월마감 재집계·불변**: `POST /analytics/closes {month:2026-10}`의 `close.totals`가 동시점 대시보드 재집계와 전 항목 일치. 재POST는 `created:false`+**스냅샷 완전 동일**(불변), GET도 동일 스냅샷 200. `checkedAt`·`evidence.hash` 기록됨.
