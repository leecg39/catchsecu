# Slack·Teams 알림 관리: 부분 구현 검증

2026-10-03. `/integration/message`의 독립 구현 계약이다. 원본에서 확인한 목록·필터·열 구조는 [계획](PLAN.md)에 기록했다. 원본의 비공개 설정 화면과 서버 동작은 확인하지 못했다. P09-T05, P01-T04, P06-T02의 부분 증거이며 전체 181경로·72 Task 완료 판정은 아니다.

## 구현 범위

- 회사·서비스 범위의 Slack/Teams 연결 생성·조회·수정·사용 전환·단일/선택 삭제, 이벤트/대상/등록자/방식/사용여부/이름 필터와 페이지, 시험 전송·상태/시도 이력·안전한 실패 재처리를 화면과 API에 연결했다.
- migration 39에 연결·구독·이벤트·전달·불변 시도 모델과 복합 FK, 범위/상태/불변 제약을 적용했다. URL은 암호화하고 조회 DTO에는 호스트만 준다. 삭제 시 URL·이름을 지운 tombstone을 남긴다.
- 실제 공개 폼 제출과 CSV 반영 트랜잭션이 이벤트와 알림 대기를 기록한다. worker는 현재 권한·서비스·구독·연결 세대를 다시 검사하고 전송 시작 상태를 먼저 기록한다. 로컬 모드는 같은 payload를 실제 파일로 기록한다. 외부 공급자 URL에는 호스트/경로·DNS·TLS·응답 제한과 리디렉션 금지를 적용한다.
- 현재 실행 환경은 `NOTIFICATION_TRANSPORT=local`이다. Slack·Teams 실제 채널로 메시지를 보내거나 수신을 확인한 증거는 없다. 공급자별 JSON·응답/실패 처리는 격리 시험으로 검증했다.

## 자동 검증

| 검사 | 결과 |
|---|---|
| PostgreSQL 알림 통합 [25개](integration-final.log) | 통과 |
| 전체 회귀 [368개, 17파일](regression.log) | 통과 |
| [타입](typecheck-after-qa.log), [린트](lint-after-qa.log), [최종 빌드](build-after-editor-fix.log) | 타입·빌드 통과, 린트 오류 0·기존 이미지 경고 19 |
| [개발](migration-dev-status.log)·[시험](migration-test-status.log) migration 상태 | 39까지 적용 |
| [OpenAPI](openapi.log) | 216 paths |

통합 시험은 권한/회사·서비스 분리, 버전/멱등, 직접 SQL 범위 위조, 공개 폼·CSV 중복/rollback, 두 worker 경쟁·복구, 중지와 전송의 직렬화, 재시도와 결과 불명, SSRF/DNS 재바인딩/리디렉션/응답 한도, 비밀값 미노출을 포함한다.

## Ego 화면과 독립 DB·파일 대조

Ego TaskSpace 30의 p1(공개 폼은 p3), `localhost:3100`, 합성 회사·서비스·자료만 사용했다. 읽기 전용 검증 스크립트는 [qa-notifications.ts](../../../scripts/qa-notifications.ts)다. 각 JSON은 DB와 로컬 전달 파일을 별도로 조회해 만든 판정이다.

1. [Slack 연결 생성](01-created.png) → [DB 암호화·서비스 범위](created.json) → [시험 발송 완료 화면](02-test-delivered.png) → [파일·불변 시도 1개](test-delivered.json)를 확인했다.
2. 최초 390px 설정 모달에서 [내용 잘림](03-mobile-detail.png)을 발견해 CSS를 고쳤다. [수정 후 화면](04-mobile-fixed.png)은 대화상자 client/scroll 너비가 모두 312px이고 페이지 가로 넘침이 없다.
3. 목록의 구독 수정/복원은 version 1→3으로 저장·재조회됐다([화면](05-edited.png)). 이 과정에서 조회용 `targetName`이 PATCH에 섞여 거절되는 결함을 발견해 입력 DTO 매핑을 수정했다. 방식 필터는 Teams 0건·Slack 1건으로 동작했다.
4. worker를 멈춘 상태에서 [시험 작업 대기](06-pending.png), [DB queued](pending-before-disable.json)를 확인했다. 목록에서 사용을 중지하자 [화면](07-disabled.png)과 [DB·파일 부재](disabled-effect.json)에 `CONFIG_CHANGED` 취소가 남았다. worker를 재시작한 뒤 연결을 다시 사용으로 전환했다.
5. [실제 공개 폼 제출](form-event.json)이 `submission.created` 이벤트·로컬 파일을 만들었다. 알림 본문에 합성 답변 비밀값이 없는 것을 검사했다([이력 화면](08-form-event.png)).
6. [합성 CSV](browser-notification.csv)를 파일 선택기로 올려 수집 근거·컬럼을 저장하고 정상 1행을 검증·반영했다. `import.completed` 이벤트·반영 건수·파일을 [DB에서 대조](csv-event.json)했고 [이력 화면](09-csv-event.png)을 확인했다.
7. Teams 연결을 생성해 [선택 삭제](10-deleted.png)한 뒤 [DB tombstone의 URL·이름 제거](deleted.json)를 확인했다. [390px 목록](11-mobile-list.png), [가로 스크롤 표](12-mobile-table.png)의 페이지 너비는 390px, 표 viewport 308px, 내부 표 1391px다.
8. 앱과 worker를 모두 재시작했다. [화면](13-after-restart.png)과 [DB 판정](restart-persistence.json)에 연결·완료된 시험 전달·취소된 대기 작업이 유지되고 취소 작업 파일은 없었다.

초기 실패 로그와 수정 전 화면을 보존했다. 최종 판정은 위 수정 후 빌드·검사·실제 화면·DB 자료를 기준으로 한다. 외부 시험 채널의 실제 수신, 운영 DNS/자격증명, 관련 선행 Task의 전체 수용조건은 남아 있다. 정식 완료 수는 2/72로 유지한다.
