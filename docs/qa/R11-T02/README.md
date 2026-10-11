# R11-T02 응답 API 계약 점검

2026-10-14. 공개 토큰 조회/제출·응답 관리 API·원자성·중복/경합·파일 소유를 계약(OpenAPI·정책 매트릭스)과 실측으로 점검했다.

## 공개 API (익명)

| 경로 | 계약 | 실측 |
|---|---|---|
| `GET /public/forms/{token}` | 게시본 폼 데이터(tenantId 등 내부 필드 없음) | 200 — `title/content/consentBundle/closed/expiresAt/token`만. 내부 식별자 유출 없음(P06-T07 재확인) |
| `GET /public/urls/{slug}` | 고정 URL → 게시본 해석 | 200 — `r09-accept-qa01` slug → 활성 폼 |
| `POST /public/forms/{token}/submissions` | 201 접수영수증, 멱등키 | 실측 하단 |
| `POST /public/forms/{token}/uploads` | 업로드 권한 발급 | 201 `uploadToken` |
| `PUT /uploads/{id}/content` + `POST /uploads/{id}/complete` | 바이트+ClamAV 완료 | `scanStatus:clean` |
| `POST /public/forms/{token}/participation-challenges[-verify]` | 참여 제한 인증 | 별도 게이트 증거 유지 |
| `GET /public/forms/{token}/author-assets[/{id}/download]` | 저작 에셋 공개 범위 | 기존 author-assets 증거 |

## 응답 관리 API (인증)

- `GET /forms/{id}/submissions`(목록·필터) / `GET /submissions/{id}`(상세) / `PATCH /submissions/{id}`(정정, version 낙관잠금·충돌 409)
- `POST /submissions/{id}/withdraw`·`/hold`·`/destruction-request` / `PATCH /submissions/{id}/retention`
- `POST|PATCH|DELETE /submissions/{id}/notes[/{noteId}]`
- `GET /forms/{id}/submissions/export`(CSV) / `GET /submissions/{id}/pdf`·`/receipts/{receiptId}/pdf`
- 공유 열람: `GET /viewer/submissions[/{id}]`·`GET /viewer/files[/{id}[/download]]`
- 파일: `GET /files[?submissionId]`·`GET /files/{id}`·`GET /files/{id}/download`

## 원자성

- 제출 트랜잭션(`submitForm`→`idempotent` 내부): responseCount 증가 + Submission + 첨부 바인딩·권한 회수 + Answer 일괄 + 영수증 + 참여 세션 카운트 + 감사 + outbox 알림 — 단일 tx.
- 정정: Correction+암호화 Payload+답변 갱신+version 증가 동일 tx, 기존 browser-flow 증거.

## 중복·경합·소유 실측 (R11-T04 acceptance.json)

| 검사 | 결과 |
|---|---|
| 동일 Idempotency-Key 재제출 | 동일 id 반환·responseCount 1 유지(중복 행 0) |
| 필수 동의 누락 | `422 CONSENT_REQUIRED` |
| 만료 게시 | 공개 조회 `closedReason:"expired"` + 제출 `410 PUBLICATION_CLOSED` |
| 타 회사 응답/파일 | 상세·정보·다운로드 모두 404 |
| 공유 범위 밖 파일 | 열람자 정보·다운로드 모두 404 |
| 철회 응답 공유 상세 | 410 |
| 내보내기 권한 | viewer 403 / owner 200(CSV 2행) |
| 파일 소유 | `files` API가 `(submissionId, questionId)` 결합 검사 — 다른 조합 404 |

## 정책 매트릭스 일치

OpenAPI 336경로·477오퍼레이션 — R11 소속 오퍼레이션은 모두 `operation-policy-matrix.csv` 행 존재(verify:plan 통과, 글로벌 점검 재사용). 익명 공개 경로는 `public:*` 레이트리밋 정책 행과 일치.
