# P12-T04 로그·통계 게이트

> **완료 판정 정정 (2026-10-04): 미완료.** 0934f4e의 일괄 완료 표시는 수용 조건의 증거를 충족하지 못해 철회했다. 아래 구현·시험 주장은 각 실제 파일/실행 결과와 다시 대조한다. 테스트 파일의 존재는 실행 통과나 브라우저/외부 연동 완료를 뜻하지 않는다. [재검증 계획](../../planning/05-completion-recovery.md).

## 개요

개인정보 처리로그, 광고동의로그, 서비스이용로그, 구성원로그, 외부열람자로그, 마감데이터, 이메일발송현황 등 10개 모니터링 경로 및 대시보드 통계의 데이터 일치성과 성능을 통합 검증한다.

## 구현 내용

1. **모니터링 경로 전수 연결**:
   - `/log/info-monitoring`, `/log/ad-monitoring`, `/log/service`, `/log/member`, `/log/external-viewer`, `/log/month-monitoring`, `/log/mail`
   - 대시보드 종합 지표 (`/dashboard`)
2. **성능 및 보안**:
   - 복합 인덱스를 통한 대량 감사 로그 조회 최적화
   - 존재하지 않는 서비스 ID 또는 타 회사 리소스 요청 시 404 차단
   - 0개, 1개, 다수 행 페이징 정상 처리

## 검증 내역

- 테스트 스위트: `tests/server/audit-events.test.ts`, `tests/server/analytics.test.ts`
- 주요 검증 항목:
  - 10개 로그 화면 전반의 테넌트/서비스 격리 검증
  - 페이지네이션 및 검색 필터링 안정성 확인
  - 대시보드 통계 수치와 세부 로그 합계 간 정합성 일치

## 경계 페이지네이션·실행계획 재검증 (2026-10-07)

`tests/server/log-gate.test.ts` — 격리 test DB에서 결정적 경계 검증 (4/4 통과):

| 수용 조건 | 실측 |
|---|---|
| 비UUID serviceId | `audit-events?serviceId=not-a-uuid` → **422** |
| 존재하지 않는 serviceId | 무작위 UUID → **404** (audit·dashboard 동일) |
| 다른 회사 serviceId | 회사 B 서비스 → **404** (audit·dashboard 동일) |
| 권한 밖 스코프 | privacy(서비스A grant)의 무필터 목록에 타사·타서비스 이벤트 0건 |
| pagination 0건 | `kind=mail`(이벤트 없음) → total 0, items [] |
| pagination 1건 | pageSize=1 → 정확히 1건, total 25 |
| pagination 11건 | pageSize=11 → p1=11건, p3=3건(25건 경계 정확) |
| pagination 100건 | pageSize=100 → 25건 전부 1페이지 |
| 범위 초과 페이지 | page=99 → 마지막 페이지(3)로 클램프, 5건 |
| 경계 거부 | pageSize=0 → 422, pageSize=101 → 422 |
| 대량조회 plan/index | 4,000행 bulk insert + ANALYZE 후 `EXPLAIN (FORMAT JSON)` → **`AuditEvent_tenantId_createdAt_id_idx` Index Scan**, Seq Scan 없음 |

관련 회귀: audit-events·audit-current-authority·analytics **40/40 통과**, tsc·eslint 0 오류.
