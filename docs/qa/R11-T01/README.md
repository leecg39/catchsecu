# R11-T01 응답 도메인 모델 대조

2026-10-14. Submission→FormVersion→Answer/ConsentReceipt·파일 바인딩·원본 보존·정정 암호화·파일 검사 상태·export 참조·파기 후 비노출을 `prisma/schema.prisma`와 서버 코드로 대조했다.

## 관계 바인딩

| 모델 | 바인딩 | 근거 |
|---|---|---|
| Submission | `(tenantId, formVersionId)`→FormVersion, `(tenantId, publicationId, formVersionId)`→Publication, 복합 FK | `Submission` — 제출 시점 버전에 고정되어 이후 게시본 개정이 응답 스냅샷을 바꾸지 않음 |
| Answer | `(tenantId, submissionId, formVersionId)`→Submission + `(tenantId, formVersionId, questionId)`→Question, `@@unique([submissionId, questionId])` | 답변 원문 `valueCipher` 암호화, `valueType`에 제출 시점 문항 유형 보존 |
| ConsentReceipt | `(tenantId)` + submissionId 유니크 계열 | 동의 문구·수신 시각·보유기간 스냅샷 — 제출 트랜잭션(`submitForm`)에서 `createConsentReceipt` 원자 생성 |
| ConsentEvent | `(tenantId)` | 동의 수신/철회 이벤트 별도 적재 |
| Correction + CorrectionPayload | `correctionId` 유니크, `beforeCipher`/`afterCipher` | 정정 사유·전후 값 모두 암호화 — 감사 원장에는 원문 없음(기존 browser-flow 증거 재확인) |
| SubmissionNote | `(tenantId)` + submissionId 인덱스 | 관리자 메모 — 삭제 시 잔여 없음(기존 증거) |
| FileObject | `(tenantId, publicationId, formVersionId)` + `(tenantId, formVersionId, questionId)` + `(tenantId, submissionId, formVersionId)` 복합 FK, `uploadTokenHash` 유니크 | 공개 업로드 권한 해시만 저장 → 제출 트랜잭션에서 `attachPublicFiles`로 바인딩+권한 회수 |

## 원본 보존

- Answer는 **제출 시점 FormVersion의 Question**에 복합 FK로 고정 — 문항 원문·유형은 Question 스냅샷(`valueType`)에 보존.
- ConsentReceipt는 제출 시점 동의 문구 전체를 스냅샷 — 이후 문구 개정이 소급하지 않음.
- `submittedAt`, `retentionUntil`/`originalRetentionUntil`, `visitedPageKeys`/`pagePathVersion`/`terminationKind`(분기 경로·종료 유형) 보존.

## 정정 payload 암호화

- `CorrectionPayload.beforeCipher/afterCipher` — 전후 값 암호화 저장. 감사 이벤트에는 사유와 식별자만.

## 파일 검사 상태

- `FileObject.scanStatus`(pending/clean/…) + `scanEngine` — ClamAV 실검사(실측 `file.scan_passed` 감사). 미검사·제출 전 공개 파일·삭제 중 파일은 다운로드 불가(`sharedFile`/다운로드 경로 상태 검사).
- 파일 바이트 AES-256-GCM 비공개 저장 + 객체 ID를 추가 인증 데이터로 사용(파일 도메인 기존 증거).

## export source 참조

- `ExportJob`/`ExportChunk`/`ExportSource` — 내보내기 산출물의 출처 참조 보존. 폼 응답 CSV 내보내기는 `submission.read` 요청 시점 권한 재검사(실측 viewer 403).

## 파기 후 불가역 비노출

- destruction-request→approve→워커 파기→`DestructionCertificate` digest + 연결 파일 0건(P06-T07 E2E 실측).
- 철회된 응답은 공유 열람자 상세에서 `410`(이번 수용 실측) — 외부 열람 경로에서 비노출.
- `originalRetentionUntil`은 보유기간 단축/연장 정정과 무관하게 최초 기한을 보존.

## 미해결 설계 리스크

- 외부 제공사(실 SMS/메일·실 ClamAV 대체·S3)는 로컬 어댑터 범위 — 외부 영수증 없음(`external_pending` 유지).
