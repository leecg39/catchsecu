# R14-T01 개인정보 업로드·이관 모델 대조

2026-10-14. ImportJob·ImportRow·ImportEvidence·연결 Submission/FileObject를 `prisma/schema.prisma`와 import-worker로 대조했다.

## 파이프라인 관계

- `ImportJob`: tenant·service·creator·committer(회사 범위 Membership 복합 FK)·fileId unique·`purposeId`/`sourceRecipientId`+버전 핀(동의/출처 증빙 스냅샷)·headersCipher·mappingCipher·snapshotCipher 암호화·상태 기계(uploading→…→committing→completed/partialFailed/archived)·행 카운터(total/valid/invalid/skipped/imported)·임대(leaseOwner/leaseUntil/leaseGeneration·attempts·nextAttemptAt)·expiresAt.
- `ImportRow`: `(tenant, jobId, rowNo)` unique — 재시도·재커밋 시 중복 불가. `duplicateOf` 자기참조로 중복행 보고·`errors` JSON·`payloadCipher`·`digest`·`submissionId` 연결.
- `ImportEvidence`: submissionId unique — 행→응답 변환의 동의 근거를 암호화 보존(파기 시 함께 삭제, R16 범위와 연결).

## 정책·파일 수명

- 오류행은 `skippedRows`로 분리(부분 성공), invalidRows 집계; worker는 유효행만 Submission으로 변환.
- 원본 CSV FileObject는 커밋 완료 후 `deleted` + 암호화 객체 unlink — 스테이징 미보존.

## 대조 결과

스키마=구현 일치, migration 불요. 외부 제공사 차원 없음.
