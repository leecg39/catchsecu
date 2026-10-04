# P14-T04 백업·복구·재파기·운영 리허설 — 부분 통과

2026-10-04/05 실측. 별도 DB·스토리지·포트 환경으로 복원→인증→승인→워커 재파기, 빈 DB 클린 설치,
키 회전(전수 재암호화·폐기 증명), 워커 mid-flight SIGKILL 재기동까지 **실행 검증**했다.
외부 객체저장소·WAL/PITR 등 아직 불가한 항목은 아래 한계에 명시한다.

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
- 조회 해시(`tokenHash`)는 `DATA_LOOKUP_KEY`(미지정 시 암호화 키와 동일)로 고정 — 암호화 키 회전이 저장 해시·해시 조인을 깨지 않는다.

## 키 회전 리허설(2026-10-05 복원 DB 실측)

구현: `decrypt`는 현재 키 → `DATA_ENCRYPTION_KEY_PREVIOUS` 순 시도, 신규 암호문은 현재 키만 사용.

**리허설 중 발견한 실제 함정**: 앱 역할 UPDATE가 통과하는 테이블(Answer 등)에서는 도메인 트리거가
발동한다 — `marketing_source_correction`이 `valueCipher` 변경을 원본 정정으로 해석해 연결된
마케팅 동의를 삭제했다(시범 실행에서 7건 소거됨). 따라서 재암호화는 반드시 `ROTATION_DATABASE_URL`
슈퍼유저 세션의 `session_replication_role='replica'`로 전량 우회해야 하며, 앱 역할 경로는
불변성 트리거(AccountClosure·ConsentReceipt·ApprovalRequest 등)에도 차단된다.
또한 Answer/Publication 등 일부 테이블은 앱 UPDATE가 트리거를 발동시키며 부분 성공하므로
앱 역할만으로는 안전하게 회전할 수 없다 — 운영 절차상 슈퍼유저 유지보수 세션을 요구한다.

| 단계 | 실측 |
|------|------|
| 회전 전 | `catchsecu_restore` 전체 48개 Cipher 컬럼 1345셀 전량 구키 복호 성공 |
| 회전 중 | `DATA_ENCRYPTION_KEY=신` + `…_PREVIOUS=구` + `DATA_LOOKUP_KEY=구` → 폴백 복호 70/70, 해시 다이제스트 동일 |
| 신키 단독(회전 전 상태) | 0/70 복호 — 구키 데이터가 신키로 안 열림을 확인 |
| 재암호화 | `scripts/rotate-data-key.ts` → 1345셀 재암호화, 0 실패 |
| 회전 후 | 신키 단독 전수 감사 0/1345 불가 / 구키 단독 1345/1345 불가 — 폐기 증명 |
| 도메인 보존 | 회전 후 `MarketingPreference` 상태 불변 — 전량 replica 세션 적용 확인 |
| 앱 경로 | 회전 env로 서버 기동(:3101) → 로그인·컨텍스트·폼 목록·응답 상세 200, 파기 증명서 `integrityVerified:true` — 조회 해시·digest 검증이 회전 후 정상 |

단위 테스트 `tests/server/crypto-rotation.test.ts` 4/4: 폴백 복호·재암호화·변조 거부·해시 안정성·동일키 부팅 거부.

## 빈 환경 클린 설치(2026-10-05 실측)

- `catchsecu_fresh` 빈 DB에 `prisma migrate deploy` → **85개 마이그레이션 전량 적용** 성공.
- 빈 DB 서버 기동 → 신규 가입 → 이메일 인증 → 로그인 → 회사 등록 → 대시보드 도달을 브라우저로 실측.
- 빈 테넌트 `/dashboard`·`/compliance`·`/marketing-detail`·`/privacy-detail`이 실제 0건 집계를 렌더(placeholder 아님).

## 워커 프로세스 재기동(mid-flight SIGKILL, 2026-10-05 실측)

`scripts/qa-worker-restart.ts` — 실제 `scripts/worker.ts` 프로세스를 띄워 처리 도중 `SIGKILL`했다.

| 항목 | 실측 |
|------|------|
| 작업 큐 | 메일 작업 60건 enqueue |
| 중도 kill | 처리 중 SIGKILL → kill 시점 `done:31, queued:27, leased:2`(1건은 사전 배치한 dead-worker 리스) |
| 유효 리스 존중 | 재기동 워커가 dead-worker 소유 유효 리스 작업을 **가로채지 않음**(`status=leased, owner=dead-worker-…` 유지), 나머지 59건 drain 완료 |
| 고아 리스 회수 | 리스 만료 후 재기동 → `JobAttempt` `1:expired → 2:delivered` 전이 확인 |
| 정확히 한 번 발송 | jobId별 mail 파일 60/60 정확히 1개, `.tmp` 잔여 0(부분 쓰기는 발행되지 않음) |
| 최종 상태 | 60/60 `done`, stuck(leased/queued/retry 잔류) 0 |

결과: `10/10` 체크 통과(run `fb5c8631`). SIGKILL 종료 코드는 `null`(signal 사망)로 기대값과 일치.

## 한계(솔직한 잔여)

- 로컬 디스크 스토리지만 검증 — S3/외부 객체저장소 미검증.
- pg_dump 논리 백업만 — WAL 증분·PITR·MVCC 시점복구 미검증.
- worker 재기동은 로컬 mail 작업군으로 검증 — campaign/import/export/destruction 각 워커의 중도 kill은 해당 유닛의 lease·영수증 테스트로 커버되며 별도 프로세스 실증은 미수행.

관련: [scripts/qa-restore-enqueue.ts](../../../scripts/qa-restore-enqueue.ts), [scripts/qa-restore-destroy.ts](../../../scripts/qa-restore-destroy.ts), [src/server/destruction-worker.ts](../../../src/server/destruction-worker.ts)
