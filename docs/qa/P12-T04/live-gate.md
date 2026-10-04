# P12-T04 로그·통계 라이브 게이트 (2026-10-04)

dev 앱 :3100 + catchsecu_dev 실측. `scripts/qa-audit-events.ts` 전체 통과 + 보강 검사.

| 수용 조건 | 실측 |
|---|---|
| 존재하지 않는 serviceId | `GET /api/v1/audit-events?serviceId=99999999-…` → **404**, `GET /api/v1/analytics/dashboard?serviceId=99999999-…` → **404** |
| 다른 회사 serviceId | owner-b가 회사 A 서비스 조회 → **404**(목록·CSV export 동일) — QA 스크립트 통과 |
| pagination 경계 | pageSize=1 → 1건/total 241; page=99999 → 최대 페이지 242로 보정(오류 아닌 클램프); pageSize=100 → 정확히 100건; pageSize=101 → **422** |
| 로그 화면 | `/log/service`·`/log/info-monitoring`·`/log/member`·`/log/access-history`·`/my-page/activity-log` 전부 200; viewer `/log/member` → 307 `/access-not-allow?reason=role` |
| 권한 | viewer 회사 로그 API·CSV → **403**; `scope=mine`은 본인 활동만 200(actorId·serviceId·actor 검색 무시) |
| 읽기 전용 | PATCH·DELETE `/api/v1/audit-events` → **405** |
| CSV 일관성 | export 행 = 목록 id 순서 동일·UTF-8 BOM·다운로드 자체가 `audit.exported`(행 수·actor 기록) |
| 대량조회 plan/index | AuditEvent 2,964행: 목록 쿼리 → **Index Only Scan** `tenantId_createdAt_id_idx`; 서비스 필터 → **Bitmap Index Scan** `tenantId_serviceId_id_actorId_key`. seq scan 없음 |
| 서비스별 동적 대시보드 | `analytics/dashboard?serviceId=제한서비스` → 200(권한 서비스만 수용, 미권한·없음 404) |

## 미수용

- 진짜 대규모(10만 행+) 데이터에서의 계획/지연 측정 없음 — 현재 2,964행 기준.
- 선행 P12-T03·P11-T05 게이트 미충족.
