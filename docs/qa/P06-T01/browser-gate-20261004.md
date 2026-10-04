# P06-T01 공개 폼·안전한 제출 — 브라우저·HTTP 게이트 (2026-10-04)

live dev(3100), 게시 폼 `49ceecf0` 고정 URL `projects/EKbnVOcot70…/form`, 계정 없음(공개)+`p03-member-471489ff`.

## 공개 렌더
- 게시 스냅샷만 노출: 제목·본문·질문(subjectRole name/email)·동의 번들(문서 v3·contentHash)·필수 체크박스. `closed/expiresAt` 필드. 서버가 허용 질문만 제공.

## 제출 검증 (서버 강제 — Origin `http://localhost:3100` + 실API)
| 시도 | 결과 |
|---|---|
| Origin 없음 | **403 ORIGIN_REJECTED** |
| 동의 미체크(consent:false) | **422 DOCUMENT_CONSENT_REQUIRED** |
| 필수 이메일 누락 | **422 REQUIRED_ANSWER "이메일 항목을 입력해주세요"** |
| 위조 문서 UUID 동의 | **422 INVALID_DOCUMENT_CONSENT "현재 폼에 표시된 동의 항목만"** |
| 폼에 없는 질문 ID 주입 | **422 UNKNOWN_QUESTION "폼에 없는 질문의 답변"** |
| Idempotency-Key 없음 | **400 IDEMPOTENCY_REQUIRED** |

## 멱등성
- 동일 `Idempotency-Key`로 2회 제출 → 두 응답 모두 201 + **같은 id·submittedAt** (재전송), DB 행 1건 — 중복 생성 0.

## 정상 제출
- 201 `{id, submittedAt, status:"submitted"}` → DB: `retentionUntil=submitted+30일`, `ConsentReceipt` 생성, `AuditEvent submission.created` — 관리자 목록에 즉시 표시.
- 브라우저 경로도 동일하게 접수번호 화면 표시 확인.
