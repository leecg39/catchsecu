# R16-T01 보존·파기 모델 대조

2026-10-14. RetentionRule·Form 지정→Submission.retentionUntil 우선순위·legalHold·승인·증명서·파기 범위를 `prisma/schema.prisma`와 워커 코드로 대조했다.

## 보유기한 우선순위 (제출 시점 확정)

`submitForm` — `formVersion.retentionDays ?? form.designatedRetentionDays ?? companyRetentionDays(tenantId, serviceId)`:

1. 게시본(`FormVersion.retentionDays`) 개별 지정 — 최우선
2. 폼 지정(`Form.designatedRetentionDays`)
3. 회사·서비스 규칙(`companyRetentionDays` — RetentionRule service unique `@@unique([tenantId, serviceId])`)

`retentionUntil`과 `originalRetentionUntil`을 함께 저장 — 이후 보유기간 정정(`retention_changed` 정정 이력, 암호화 전후값)과 무관하게 최초 기한 보존.

## legalHold·상태 게이트

- `Submission.legalHold` — 만료 후에도 워커 수집 제외(`destruction-worker` 수집 쿼리 `NOT legalHold`), 만료 요청 생성 차단.
- 워커 대상: `status IN (submitted,corrected,withdrawn) AND retentionUntil<=now`. 실행 직전 동일 조건 재검사(대기 중 보류·정정 반영).
- `DestructionRequest.retentionKey` 유니크 — 동일 보유기한 버전의 자동 재생성 방지. 취소·반려 후에는 명시 재요청만.

## 승인·실행

- `DestructionRequest`: source(retention/manual)·previousStatus·dueAt·requester/approver(회사 범위 Membership)·status 전이(pending→approved→running→completed/failed)·attempts/maxAttempts·leaseOwner/leaseUntil(60초 임대 회수)·reasonCipher/decisionCipher 암호화 사유.
- 승인·반려·취소·재시도·재예약은 현재 회사 관리자 권한 재검사. 일정 변경은 승인 초기화, 실행 시작 후 취소·보존·수정 차단.
- 자동 파기는 기본 off — 회사 정책에 따라 만료 요청을 승인대기 또는 예약으로 접수.

## 증명서

- `DestructionCertificate`: `submissionId`·`requestId` 유니크(중복 증명서 불가), `scope`(active-database-and-private-storage)·`method`·`counts` JSON(항목별 삭제 수)·`digest` HMAC(수량·식별자·시각 무결성), 트리거로 DB 수정·삭제 금지 — 실삭제 완료 tx에서만 생성.

## 파기 범위 추적 (worker 실삭제 목록)

FileObject(암호화 객체 unlink+deleted·파일명/해시/크기 제거)·VerificationReceipt·캠페인 수신자 복제본(`eraseCampaignContacts`)·마케팅 잡/동의 출처·Answer·SubmissionNote·CorrectionPayload·Correction·ConsentEvent·ConsentReceipt·ImportEvidence — 식별자·최소감사·재실행방지 표식만 잔존. 삭제 후 `FILEOBJECT … status!='deleted'` 잔여 검사(`FILES_REMAIN` 시 재시도).

## 대조 결과

- 스키마·제약·관계는 구현과 일치 — migration 신규 불요. 파일/내보내기·캠페인 복제본까지 파기 범위 추적 확인.
- 외부 제공사 차원 없음(로컬 PostgreSQL·로컬 저장소).
