# P08-T04 발송 목록 라이브 게이트 (2026-10-04)

dev 앱 :3100 + catchsecu_dev 실측. [캠페인 브라우저 증거](../campaigns/README.md)의 API 경계 보강.

| 항목 | 실측 |
|---|---|
| 필수 범위 | `serviceId`·`channel` 없으면 **422** — 회사 전체 캠페인을 무차별 열지 않음 |
| 없는 serviceId | **404 NOT_FOUND**(테넌트 스코프) |
| 목록 | email·sms 각각 200 `{total, items, page}` 서버 페이지네이션 |
| 필터 검증 | `status=archived`(계약 외 값) → **422**; `pageSize=999` → **422** |
| 빈 상태 | total 0 → 200 빈 목록(오류 아님) |
| 화면 | `/mail/history`·`/sms/history` 셸 200 + 실제 목록 API 연결(P13-T04 스윕) |

## 미수용

- 기간·발신자 필터 조합·수신자별 성공/실패 상세·예약취소·실패재처리는 캠페인 README의 브라우저/테스트 증거가 담당 — 이번 실측은 목록 계약 경계.
