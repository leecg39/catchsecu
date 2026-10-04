# P03-T05 — 관리 페이지 CRUD 게이트 라이브 검증 (2026-10-05)

## A/B 회사 격리 E2E (`ab-tenancy.json`, `scripts/qa-ab-tenancy.ts`)

- 세션 컨텍스트: owner→회사A(…0001), owner-b→회사B(…0002)
- 교차 읽기 전부 **404**: service/form/sender/campaign/member/document + `analytics/dashboard?serviceId`(타사) + `ledger?serviceId`(타사)
- 교차 쓰기: B→A service PATCH·DELETE 모두 **404**(버전 유출 없음), A→B 동일
- 구성원 목록 상호 비포함: A 목록에 owner-b@ 없음, B 목록에 owner@ 없음
- 자사 정상: A→A·B→B service 200

## 관리 목록 검색·페이지·경계 (`admin-lists.json`)

- members: total 10, 미스매치 검색어 0건, 히트 검색어로 owner 포함
- forms: pageSize=2 페이지 1·2 **id 중복 0**(disjoint), page=0·pageSize=101 → 422
- campaigns: 제목 검색 실매칭
- documents·notices 목록 200 + 실데이터

## 하드코딩 제거 (커밋 c3023ae)

- `management/service.tsx` 데드 파일(중소기업발전·데모담당자 고정 행) 삭제
- `management/logs.tsx`+`log-filter.ts` 데드 경로(빈 sourceRows·하드코딩 서비스 옵션) 삭제 — 실경로는 AuditLogs/ActivityReviews 제공
