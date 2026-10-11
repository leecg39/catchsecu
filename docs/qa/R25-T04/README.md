# R25-T04 이관·백업·복구·운영 런북 — 로컬 검증

`scripts/qa-r25-ops-runbook.ts`가 운영 리허설 4단계를 실제 DB/API/워커 코드로 검증한다.
결과: **4/4 PASS** — [acceptance/ops-runbook.json](acceptance/ops-runbook.json)

## 실행

```bash
QA_ORIGIN=http://localhost:3121 node --env-file=.env.local --import tsx scripts/qa-r25-ops-runbook.ts
```

출력:

```text
PASS legacy-dryrun {"dryApplied":false,"secretsRejected":[api_key,password],"unknown":["unknownSection"],"applied":true,"audited":true}
PASS migration-state {"applied":151,"rolledBack":[3건],"stuck":0}
PASS worker-crash-recovery {"jobType":"mail","reclaimed":true,"finalStatus":"done","attempts":1}
PASS backup-recovery-evidence {"backup":true,"restore":true,"digestTables":131,"envKey":true}
R25-T04 ops rehearsal: 4 steps passed
```

## 단계별 검증 내용

### 1) legacy-dryrun — 기존 샘플 이관 dry-run/검증 (`src/server/legacy-migration.ts`, `POST /api/v1/migration/legacy`)

- `dryRun:true` POST → `applied:false`, `rejectedSecrets`에 `api_key`·`password` 격리 표시, `unknownSections`에 `unknownSection` 표시.
- dry-run 직후 DB 재조회로 `User.version` 동일·이름 미변경 확인(쓰기 없음).
- `dryRun:false` POST → `applied:true`, DB에 이름 반영·비밀 문자열이 어떤 컬럼에도 유입되지 않음.
- `auditEvent action="migration.legacy_imported"` 기록 확인.

### 2) migration-state — 마이그레이션 상태 분류

- `_prisma_migrations` 전수 조회: 적용 151건.
- `finished_at IS NULL AND rolled_back_at IS NULL` 인 행 = 진짜 정체 migration → **0건**.
- `rolled_back_at`이 있는 3건(`20261002143000_private_files`, `20261003050000_campaign_delivery_lifecycle`, `20261004110000_verification_foundation`)은 설계된 되돌리기 이력으로 분류 — 정체가 아님. 이전 이름으로 되돌린 뒤 새 이름으로 재적용된 정상 경로.

### 3) worker-crash-recovery — 워커 크래시 복구 (lease 만료 재인수)

- 게시 폼의 실제 공유 승인 생성으로 `mail` Job 큐잉.
- 해당 작업을 `status='leased'`, `leaseOwner='dead-worker-x'`, `leaseUntil=과거`로 표시해 죽은 워커 상태를 시뮬레이션.
- `runOneJob("r25-ops-recovery", {tenantId, jobId})` 실행 → 만료 lease를 재인수(`claimJob`의 `leased AND leaseUntil < now()` 분기)하고 로컬 메일 어댑터로 발송 완료.
- 재조회: `status='done'`, `attempts=1`, lease 초기화. 크래시 워커의 작업이 유실·영구 stuck 없이 다른 워커가 완료함을 확인.

### 4) backup-recovery-evidence — 백업/복구 지표 재확인

- R01-T01 리허설 산출물 존재 확인: `docs/qa/R01-T01/db-rehearsal/09-backup.log`, `10-restore.log`, `restored-table-digests.json`(131개 테이블 count·hash 대조 — 격리 DB에 pg_dump/pg_restore 후 동일).
- `DATA_ENCRYPTION_KEY`가 env 주입이며 `file:` 경로가 아님을 확인.
- 저장소 루트에 `*secret*`·`key.pem/json` 파일 부재 확인.

## 수용 조건 대조

- 백업→격리 복원→레코드·hash 대조: R01 리허설 산출물로 충족(131 테이블 다이제스트 일치).
- 기존 migration 수정 없는 upgrade: `_prisma_migrations` 정체 0건.
- test/mock 자격증명 운영 차단: 비밀키 격리 로직이 이관 경로에서 동작 확인. 단, 로컬 어댑터(`MAIL_TRANSPORT=local`)로 실행한 검증이며 **운영(실제 SMTP·프로바이더) 배포 차단 검증은 R25-T03 외부 스테이징 영역**으로 남긴다.
- 운영 설정 빠짐 미은폐: 미설정 env는 스크립트가 실패로 보고한다(숨기지 않음).

## 한계

- 백업/복원은 R01-T01 산출물 재확인이며, 이번 라운드에서 새 pg_dump/pg_restore를 재실행하지 않았다(산출물 시각 2026-10-10).
- 워커 복구는 로컬 메일 어댑터 기준. 외부 프로바이더 장애 재시도는 R25-T03 범위.
