# 개인정보 활동 검토 알림 후속 검증

2026-10-04. 전체 Task는 진행 중이다. 이전 [UI 검증](activity-ui-README.md) 뒤 명시적 이메일 알림을 추가했다.

## 구현

- 담당자가 상세 화면의 ‘이메일 알림 요청’을 누르면 POST `/activity-reviews/{id}/notifications`가202를 반환한다. 현재 권한·세션·정책·최종 기한, version과 활성 수신자를 검사한다. 임의 이메일은 입력받지 않는다.
- 답변 대기 상태당 Job1건. 같은 요청 키 재시도는 같은 접수 ID를 반환하며 다른 키의 중복은409다. 접수·감사·요청 키는 같은 transaction이다. 검토 version/메시지 수는 알림 접수로 바뀌지 않는다.
- 신규 작업 형식 `mail.activity-review.v1`을 사용해 이전 worker가 일반 메일로 잘못 보내지 않도록 했다. Job에 고정한 전송 환경과 현재 환경이 다르면 발송을 취소한다.
- 지정 worker는 현재 회사·서비스·담당자 권한/MFA·수신자 재직/인증/이메일/전문가 기한·검토 version/상태·lease를 다시 확인한다. 발송 직전 기한을 재검사한다. 제목/본문은 메일에 복사하지 않고 로그인 후 상세 확인 링크만 안내한다.
- 화면은 대기/처리/재시도/실패/취소/로컬 시험 전달/메일 서버 접수/보관 종료를 구분한다. 외부 수신 성공으로 표시하지 않는다. 중복 클릭·409·요청 키 유지 동작은 기존 검토 상세의 저장 방지와 연결했다.

## 실제 검증

- [검토 및 알림33개 통과](activity-mail-tests-final.log): 기존20+신규13. 신규는202 계약·동일/다른 키·동시 접수·임의 주소/미인증/버전/역할 거부, 답변/수신자 정지/이메일 변경/담당자 회수/서비스 보관/전송환경 변경 후 전송 차단, 최종 기한 롤백과 실제 파일 공개 직전 전문가 만료, 원문 삭제 후 재요청을 포함한다.
- [관련 다른3파일109개 통과](activity-mail-related.log): invitation-current-authority, senders, marketing. 초기 알림30개도 [통과](activity-mail-tests-first.log)했고 후속3개를 더했다. pg 동시 query deprecation 경고는 남아 있으며 시험 실패는 없다.
- [production v15 빌드](activity-mail-build-first.log), [최종 타입](activity-mail-types.log), [린트](activity-mail-lint.log) 통과. schema/migration 변경 없음. API계약285경로/412작업/37정책. 최초 계약 검사에서는 파생 operation matrix가 이전 버전이어서 실패했다. `verify-contracts.py --write`로 갱신한 뒤 일반 검사를 재실행해 통과했다.
- Ego45/p1에서 owner로 합성 검토1건의 알림 버튼을 조작했다. [대기](activity-mail-ui-queued.txt) → 해당 tenant/job만 worker로 처리 → [로컬 전달](activity-mail-ui-delivered.txt)을 확인했다. 이 자료는 앞서 직접 DB에 생성한 합성 페이지 행이며 실제 개인 열람 기록이 아니다.
- [390px 이미지](activity-mail-mobile.png)를 확인했다. 문서 scrollWidth=390이며 모달은 세로 스크롤한다.
- [독립DB/로컬메일](activity-mail-db-deliver.json): Job done1/attempt1/알림감사1, 기존 검토version1/message1 유지. 메일 수신주소는 시험 member이며 제목·본문이 메일에 없음을 검사했다. 원문 메일은 `.local/`에만 남겼다.
- [동일빌드 재시작](activity-mail-db-restart.json): PID96966→99341, Job/검토/메시지/감사/attempt/로컬메일 SHA-256 `2ecff005d9c9a3373160841326a147d24735db4a5f0ae2bab71a9e2649939788` 일치. [화면 재조회](activity-mail-ui-restarted.txt)도 확인했다.
- [기계 판독 결과/소스 해시](activity-mail-summary.json).

## 환경과 남은 조건

Node24, customserver3116, `.local/recovery-production-v15`, ALLOW_LOCAL_MAIL=1. 전역 worker를 실행하지 않고 `.local/activity-mail-check.ts deliver`에서 해당 시험 Job만 처리했다. `restart` 인자로 해시 대조한다. 이전 자체3115 서버는 종료했고 사용자3100은 유지한다.

실제 SMTP·외부 수신과 보유/파기 정책, 전체 원본/공통 Task 게이트는 남아 있다. 공식 완료15·진행21·계획36 유지. 다음은 임의 고정 기간을 적용하지 않는 회사별 검토 보유 정책과 승인된 파기 흐름이다.
