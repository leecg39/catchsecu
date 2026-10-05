# 개인정보 활동 검토 보유 기한·승인된 파기 — 구현·검증

P03-T03의 개인정보 활동 검토에 회사별 보유 기한과 승인된 파기를 연결했다. 검토 이력·감사는 보존하고 메시지 원문만 승인 후 삭제한다. 미완료 잔여: 실제 외부 전달·전체 브라우저 게이트(기존 부모 과제 게이트와 동일).

## 구현

- `SecurityPolicy.activityReviewRetentionDays` (nullable, 1–36500): NULL이면 보유 기한 미적용.
- `ActivityReview`에 `retentionUntil`/`destructionStatus`(`none|awaiting|kept|destroyed`)/`destroyedAt`/`destroyApproverId`(Membership composite FK RESTRICT) 추가. 인덱스 `(destructionStatus, retentionUntil)`.
- DB 방어(`20261014000000`, `20261014100000`):
  - 상태 CHECK: destroyed ⇔ destroyedAt, destroyed ⇔ destroyApproverId 쌍. 종결(resolved/cancelled)이 아니면 기한·파기 상태 금지.
  - `protect_activity_review_transition`: 종결(kept/destroyed) 상태는 어떤 변경도 거부. 파기 전이는 `none→awaiting`, `awaiting→destroyed|kept|none`만 허용. 종결 아닌 행의 파기 필드 금지.
  - `protect_activity_review_message`: DELETE는 트랜잭션 내 `app.activity_review_destroy=on` + 부모 행이 `awaiting`일 때만 허용(승인 트랜잭션 외 원문 삭제 불가). UPDATE/INSERT는 기존처럼 전면 거부.
- 서버: `actOnActivityReview` 종결 시점에 FOR SHARE 정책 잠금으로 `retentionUntil` 스냅샷(updatePolicy와 동일한 Policy→Review 잠금 순서로 ABBA 데드락 차단). `decideActivityReviewDestruction`(version·관리자·awaiting 검사, destroy 시 트랜잭션 플래그 + 메시지 원자 삭제 + 승인자 기록 + 감사). `sweepActivityReviewRetention`(회사·정책 FOR SHARE → SKIP LOCKED, 정책 해제 시 기한만 정리). `updatePolicy` 변경 시 종결된 none/awaiting 행의 기한을 `closedAt+새 기간`으로 재계산·해제 시 해제.
- API: `POST /activity-reviews/{id}/destruction` (Idempotency-Key, `{version, action: destroy|keep}` → 200).
- 워커: `scripts/worker.ts` 60초 정리 주기에 sweep 연결.
- UI: 정책 탭5에 활동 검토 보유 기한 체크+일수(미저장 경고·비밀번호 확인·버전 유지). 검토 목록에 `보유·파기` 열과 상세에 파기 승인/보존 2단계 확인 버튼(canDecideDestruction일 때만).

## 검증(실제 PostgreSQL catchsecu_test)

- 신규 `tests/server/activity-review-retention.test.ts` 8개: 종결 스냅샷·만료 sweep·승인 대기 전이·감사, 미지정 정책 비적용, 파기 승인 시 메시지만 삭제·이력/승인자 보존(감사 5건), 보존 확정의 종결성·raw UPDATE 방어, 권한/버전/상태/타회사 404·403·409, 동시 승인 단일 성공·동일 키 재시도·키 충돌 409, 정책 재계산·해제 되돌림, 승인 트랜잭션 밖 원문 삭제·진행 중 파기 필드 변경 거부.
- 회귀 `activity-reviews` 33 + 관련 정책/보안 suite 통과. 명령과 로그: 아래 산출물.
- tsc/eslint/production build 통과(eslint 신규 경고 0).

## 브라우저 검증(catchsecu_dev, dev 서버 3100, Playwright Chromium)

`scripts/qa-activity-review-retention.ts`가 실제 화면으로 전체 체인을 확인(결과 `activity-retention-browser.json` 7단계 전부 통과):

1. `policy-ui-save`: `/set/company/policy` 탭5에서 체크+1일 입력→비밀번호 확인→PATCH 200→DB `activityReviewRetentionDays=1` 반영.
2. `retention-snapshot`: API로 요청→답변→처리 완료 후 `retentionUntil=closedAt+1일` 스냅샷 확인. 정책 저장 시 기존 종결 검토 4건이 백필로 기한을 얻은 것도 함께 확인(첫 실행 sweep `pending=4`).
3. `sweep-awaiting`: 기한을 과거로 조정 후 서버 sweep → `destructionStatus=awaiting`.
4. `list-badge`/`detail-awaiting`: 목록 `보유·파기` 열에 `파기 승인 대기` 배지, 상세에 보유 기한·되돌림 불가 경고·승인 버튼 노출.
5. `destroy-approved`: `메시지 파기 승인`→`파기 승인 확정` 2단계 → `destroyed`, 메시지 0건, `destroyedAt`·승인자 기록, 상세 배지 `메시지 파기 완료`.
6. `mobile-no-extra-overflow`: 390px에서 신규 UI 추가 오버플로 없음(공통 헤더 `MY` 배지의 기존 sitewide 402px 오버플로는 본 변경과 무관 — 대시보드 동일 값).

스크린샷 `states/retention-*.png` 6장: 정책 필드·승인 대기 목록·상세 경고·확인 버튼·파기 완료·모바일.

## 산출물

- `activity-retention-tests.log`, `activity-retention-related.log`, `activity-retention-suite.log`
- `activity-retention-typecheck.log`, `activity-retention-lint.log`, `activity-retention-build.log`
- `activity-retention-migrations.log`
- `activity-retention-browser.json`, `states/retention-*.png`
