# P14-T04 백업·복구·재파기·운영 리허설 — 부분 통과

2026-10-04 실측. 별도 DB·스토리지·포트 환경으로 복원→인증→승인→워커 재파기까지 **실행 검증**했다.
키 회전·외부 객체저장소·빈환경 설치는 아래 한계에 명시한다.

## 수행 절차(전부 실측)

| 단계 | 명령·방법 | 결과 |
|------|-----------|------|
| 덤프 | `pg_dump` (dev DB → SQL) | 성공 |
| 별도 DB | `catchsecu_restore` 생성(슈퍼유저 — 앱 역할은 CREATE DB 권한 없음, 정상 설계) | 성공 |
| 복원 | 덤프 → `catchsecu_restore` 적용 | 성공 |
| 객체저장소 | `.local/catchsecu_restore_storage` 별도 디렉터리 | 분리됨 |
| 복원 앱 | `APP_PORT=3101 node --env-file=.env.restore.local --import tsx scripts/server.ts --dev` — `:3101` 기동·`ready` 이벤트 | 성공 |
| 인증 | 복원된 사용자로 로그인→`/api/v1/me` 200 | 성공 |
| 대상 선정 | `383f8ea0` 응답 `retentionUntil` 과거로 되돌림 | — |
| 만료 접수 | `scripts/qa-restore-enqueue.ts` → `{"created":1}` | 성공 |
| 승인 | 복원 앱 HTTP `POST /api/v1/destruction-requests/073d3cdb/approve` → `scheduled` v2 | 성공 |
| 워커 | `scripts/qa-restore-destroy.ts` → `true` (claim·실행) | 성공 |

## 재파기 검증 결과

| 항목 | 확인 방법 | 결과 |
|------|-----------|------|
| 요청 상태 | DB | `completed` |
| 응답 상태 | DB·HTTP | `destroyed`, `contentAvailable:false` |
| 답변 삭제 | DB | `Answer` 2건 → 0 |
| 영수증·동의·import 증거 | 증명서 counts | `receipts:1, consentEvents:1, importEvidence:1` 삭제 기록 |
| 증명서 | HTTP `GET /api/v1/destruction-certificates/{id}` | `digest`·`counts`·`integrityVerified:true` |
| **기존 증명서 재검증** | 목록 API | 복원 전 생성된 2건도 `integrityVerified:true` — **복원 후 digest 검증이 기존 데이터에 정상 작동** |
| 감사 추적 | AuditEvent | `retention_requested → approve → started → completed` |
| 멱등 재실행 | 워커 재실행 | `false`(claim 없음)·pending 0건 |
| 사후 접근 | HTTP 상세 | `destroyed`·`values:{}`·`attachments:[]` — 내용 비노출 |
| 승인자 재검사 | 워커 내부 | 멤버십·역할·MFA 재검사 경로 통과 후 삭제 실행 |

## 스키마 업그레이드

복원 DB에 최신 마이그레이션 상태가 그대로 적용됨(dev → restore 동일 스키마). Prisma 마이그레이션 테이블도 덤프에 포함.

## 비밀·키 보관 정책(문서)

- `DATA_ENCRYPTION_KEY`·Better Auth 시크릿·DB 자격증명은 `.env*.local`에만 존재, git 미추적·문서 비기재.
- 객체 스토리지 파일은 저장 시 암호화(`encryptStoredObject`) — 복원 스토리지 이관 시 같은 키 필요.
- 키 회전 절차(정책): ①신키를 `DATA_ENCRYPTION_KEY_NEXT`로 배포 ②복호는 구키→신키 순 시도 ③재암호 배치 후 구키 폐기.

## 한계(솔직한 잔여)

- **키 회전 미실증** — 단일키 복호만 검증. 이중키 로테이션 경로가 코드에 없으므로 실증 불가 → 위는 정책 문서 수준.
- 로컬 디스크 스토리지만 검증 — S3/외부 객체저장소 미검증.
- pg_dump 논리 백업만 — WAL 증분·PITR·MVCC 시점복구 미검증.
- 빈환경 클린 설치 리허설 미수행(기존 노드 환경 재사용).
- mail worker 재기동은 검증하지 않음(로컬 mail 디렉터리 분리만).

관련: [scripts/qa-restore-enqueue.ts](../../../scripts/qa-restore-enqueue.ts), [scripts/qa-restore-destroy.ts](../../../scripts/qa-restore-destroy.ts), [src/server/destruction-worker.ts](../../../src/server/destruction-worker.ts)
