# R16-T04 파기 라이프사이클 라이브 수용

2026-10-14. `scripts/qa-destruction-lifecycle.ts`(QA_ORIGIN=http://localhost:3121, production 빌드) 3단계를 현재 빌드에서 재실행했다.

## prepare — 33 HTTP 케이스 ([http-prepare.json](lifecycle/http-prepare.json))

독립 회사·서비스·폼 생성 → 실제 파일 업로드+ClamAV → 공개 제출 → 암호화 메모 → **legalHold가 파기 요청 409 차단** → 보류 해제 → 수동 요청 → 취소 → 재요청 → 목록 검색·페이지 보정·중복/미지원 쿼리 422·stale version 409 → **재예약(승인 초기화)** → 승인 → `runOneDestruction` → 증명서 무결성 확인·다운로드 → 원문 answers `{}` → 파일 다운로드 410 → 메모 멱등 재생 410 → 스케줄/증명서 경로 도달.

## finish — 서버 재시작 후 7 케이스 ([http-restart.json](lifecycle/http-restart.json))

프로덕션 서버 재기동(ALLOW_LOCAL_* 플래그 동일) 후 새 로그인 → 보존된 요청 2건(1건 completed, 모두 작업 불가) → 증명서 `integrityVerified` 유지 → 파기 파일 410 유지 → 로그아웃 세션 401.

## database — 독립 DB 대조 ([database.json](lifecycle/database.json))

- `status=destroyed`, answers/notes/corrections/receipts/verificationReceipts/correctionPayloads 전부 0건
- FileObject `deleted` + nameCipher/sha256/size 제거, 암호화 객체 `ENOENT` 실삭제
- 멱등 캐시 3건 무효화(responseCipher·requestHash 제거), 요청 사유 암호문 제거
- 대조군(전체 회사·서비스·폼·제출·사용자) 해시 무결

## 누적 보완 증거

- worker SIGKILL 후 재개·임대 회수·중복 증명서 없음 — [qa-destruction-restart.ts](../../scripts/qa-destruction-restart.ts), [destruction/](../destruction/)
- 만료 경계·다운로드/정정 경합·410 회귀 — destruction.test.ts 18건 + 통합 116건
- `/log/retention` HTTP 21건 + 브라우저 CRUD — [route-connection](route-connection/)

## 판정

로컬 수용 완료(실제 DB·파일·재시작 대조). 외부 제공사 차원 없음 — S3/외부 공유 복제본은 증명서 scope 문구대로 범위 외.
