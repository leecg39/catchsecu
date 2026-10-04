# P06-T02 응답 목록·정정·내보내기 — 브라우저 게이트 (2026-10-04)

live dev(3100), `/form/manage/applicant/49ceecf0`, 계정 `p03-member-471489ff` (회사 전환 POST /api/v1/context 확인).

## 목록·상세
- 필터: 제출 기간·상태(전체/제출완료/정정/철회/파기요청/처리중/파기)·응답 ID 검색·초기화
- 행: #·응답 ID·내용(복호화)·제출일·보유 기한·상태 — API 제출분 포함 2건
- 상세: 정정/철회/보존조치/파기요청/기한변경 + 파기처리·메모·변경이력·동의이력(증거·영수증 PDF)

## 정정 — 원본 이력 보존
- "멱등1"→"멱등1 정정됨" + 사유 → 상태 **정정**, 변경 이력에 `이름: 멱등1 → 멱등1 정정됨` + 사유·시각 기록
- DB: `status=corrected·version=2`, AuditEvent `submission.created → viewed → submission.corrected → viewed`
- 철회(5cf9819a): `status=withdrawn`, 변경 이력 + 동의 이력(동의→철회 시각) — 상태머신으로 불가 액션 버튼 제거

## CSV 내보내기 (동기, 실파일)
- `GET /api/v1/forms/{id}/submissions/export` → 200, `content-disposition: attachment; filename="responses-{id}.csv"`, `text/csv`, `x-content-type-options: nosniff`, UTF-8 BOM
- 헤더: 응답 ID·게시 버전·제출일시(UTC)·보유 기한(UTC)·상태·보존 조치·원문 열람 상태·`[v1 · 질문 1] 이름`·`[v1 · 질문 2] 이메일` — 버전별 질문 열
- 데이터는 **정정 후 최신 값**(멱등1 정정됨)과 상태(정정·철회)를 즉시 반영
- 비동기 내보내기 섹션: 10만건·20MB 상한, 24시간 보관, 권한 변경 시 재요청 문구 — 작업 요청 버튼 존재

## 권한 경계 (직전 검증 재확인)
- 미로그인/무회사 세션 → 403 COMPANY_REQUIRED; 회사 전환 API로 컨텍스트 확정 후에만 조회·내보내기 가능
