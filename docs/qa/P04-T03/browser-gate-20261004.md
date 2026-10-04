# P04-T03 승인·게시·고정 URL — 브라우저 게이트 (2026-10-04)

live Chrome + dev 서버(3100), 폼 `49ceecf0-e481-4678-a1d3-448db0596d4e` 게시 E2E.

## 승인 정책
- 설정 단계 "캐치폼 사용 승인": "현재 회사 정책에서는 바로 게시할 수 있습니다." + 승인 요청 내역 없음 — 승인 정책 분기 UI 존재

## 게시 → 고정 URL 발급
- "게시하고 공유하기" → "캐치폼이 게시되었습니다." + 고정 공개 URL: `/projects/EKbnVOcot70WIZKtl3hdqwK-hNtRHN9dgRm6PLj_Ghs/form` (불투명 토큰 — ID 추론 불가)
- **DB**: `Form.status=published`, `FormVersion #1 status=published·publishedAt 기록`, consentRequired=t·retentionDays=30·maxResponses=10 그대로 게시

## 공개 폼 렌더 (비로그인 접근 가능)
- 제목·편집된 본문, Q1·Q2 필수 표시, 수집·이용 동의 섹션(목적 "게이트 QA 수집 목적"·"제출일로부터 30일"), 연결 문서 "동의서 · v3" 전체 보기 + [필수] 동의 체크박스 2개
- **게시 스냅샷**: 게시본이 초안과 분리 저장(편집 후 재게시 전 공개 폼은 게시본 유지)

## 응답 제출 E2E
- 공개 폼에서 이름/이메일 + 동의 2건 체크 → 제출 → "제출이 완료되었습니다." + 접수번호 `5cf9819a-…` + 제출 후 안내 화면(설정 반영)
- **DB**: `Submission` submitted·`retentionUntil = submitted+30일`(2026-11-03)·ConsentReceipt 생성·`AuditEvent submission.created` 기록
