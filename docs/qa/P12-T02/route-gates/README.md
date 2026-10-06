# P12-T02 — 집계 경로 권한·빈 상태·모바일 브라우저 수용

- 실행: `npx tsx scripts/qa-analytics-routes.ts` (dev 서버 3100 + catchsecu_dev)
- 일자: 2026-10-16 · 결과: `route-gates-results.json` — 8/8 PASS

| 단계 | 결과 |
|---|---|
| owner `/dashboard` — 활성 서비스 2개·실제 집계 표시 | PASS |
| owner `/dashboard/{serviceA}` 서비스 상세 | PASS |
| owner `/privacy-detail` 실제 수치(예시 더미 없음) | PASS |
| owner `/marketing-detail/{serviceA}` 요약 | PASS |
| owner `/compliance` — 데모 점수(20/100·1원) 제거 확인 | PASS |
| member(viewer) 범위: 서비스 A API 200·화면 표시, 서비스 B API 404·화면 미표시, 마케팅 B 403(capability 부재로 범위 검사 전 거부 — 올바른 거부) | PASS |
| 빈 상태: 제출 0건에서 0/없음 표시 | PASS |
| 390px 5개 경로 최대 오버플로 12px 이하 | PASS |

잔여 공식 수용: 원본 Ego 화면 대조 — 원본 서비스 접근이 필요해 별도 차단.
