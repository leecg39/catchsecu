# Slack·Teams 알림 관리 구현 계획

2026-10-03. P09-T05와 P01-T04/P06-T02의 부분 범위다. 전체 Task의 선행 게이트와 외부 채널 수신 검증은 별도로 유지한다.

## 현재 확인한 상태

- 원본 조사 `docs/research/services/integration__message.json`에서 서비스·대상·등록자 필터, 추가·선택 삭제, 사용여부·역할·서비스·대상·이름·연동 방식·이벤트·일자·관리 열을 확인했다. 생성/설정 모달의 정상 동작은 미관찰이다.
- 현재 `/integration/message`는 React 배열에 이름만 저장한다. URL·사용여부·편집은 DB와 연결되지 않았다. 아래는 독립 구현 계약이며 원본의 비공개 서버 동작을 추측하지 않는다.
- Slack Incoming Webhook은 비밀 URL에 JSON을 POST한다. [공식 문서](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/).
- Teams는 Workflows의 `When a Teams webhook request is received`와 Adaptive Card를 지원한다. 이번 어댑터는 Anyone 인증 URL에 한정한다. 토큰 인증 방식은 별도다. [공식 계약](https://learn.microsoft.com/en-us/connectors/teams/#when-a-teams-webhook-request-is-received), [설정 안내](https://support.microsoft.com/en-us/workflows/send-messages-in-teams-using-incoming-webhooks).

## 데이터·권한·전달 계약

- NotificationIntegration: 회사·서비스·작성 구성원·이름·Slack/Teams·암호화 URL·호스트 마스크·local/webhook 환경·사용여부·삭제 시각·버전. URL·구독·사용여부 변경마다 generation을 바꾸고 기존 대기를 취소한다. 삭제하면 URL과 이름을 지우고 발송 이력용 tombstone만 남긴다.
- NotificationSubscription: 연결별 `submission.created`/`import.completed` 유일 키. 이벤트별 전체 또는 특정 폼/CSV 업로드를 선택한다. 다른 회사·서비스·종류의 대상은 DB에서도 거부한다.
- NotificationEvent: 실제 응답 접수/CSV 반영 트랜잭션에 함께 저장하는 불변 이벤트. 원문 답변·연락처·웹훅 URL을 포함하지 않는다. 공개 폼 제출은 응답당 한 번, CSV 반영은 완료 버전당 한 번 기록한다.
- NotificationDelivery/Attempt: 이벤트+연결 유일, 생성 당시 generation/환경 고정, 임대·횟수·다음 시각·최종 상태·안전한 오류 코드와 불변 시도 이력. 알림 본문은 이벤트 종류·시각·집계·참조 ID만 쓴다.
- `integration.read/manage`는 소유자·관리자에게 부여한다. API는 현재 구성원·회사·서비스를 재확인하고 worker는 등록자의 현재 권한도 검사한다. 다른 역할·회사·중지 서비스·제외된 등록자·이벤트 범위 우회를 거부한다.
- HTTPS·표준 포트·정해진 Slack/Teams 호스트와 경로만 받는다. userinfo·fragment·IP literal·중복/알 수 없는 query를 거부한다. 연결 직전 DNS의 모든 주소를 검사하고 검증한 공개 IPv4 주소로 소켓을 고정한다. TLS 원래 호스트 검증·8초 제한·리디렉션 금지·응답 크기 제한을 적용한다. IPv6 전용 대상은 명확한 오류로 남긴다.
- 로컬 모드도 같은 URL 구문을 검사하지만 네트워크에 보내지 않고 합성 알림 파일을 원자적으로 기록한다. 설정의 환경을 고정하여 나중에 서버 환경이 바뀌어도 기존 로컬 자료가 외부로 발송되지 않게 한다.
- 전송 시작 상태를 외부 I/O 전에 커밋한다. 실제 I/O 동안 설정/권한 잠금을 유지한다. 중지·교체가 먼저 커밋되면 전송하지 않는다. I/O 도중 끊긴 작업은 결과 불명으로 복구하며 자동 재전송하지 않는다.
- 명시적인 429와 로컬 저장 실패는 제한적으로 재시도한다. 외부 5xx·전송 후 시간초과/단절은 결과 불명, 3xx/4xx는 실패다. 성공/결과 불명은 수동 재전송하지 않는다. 실패 중 안전하게 재시도할 수 있는 경우에만 버전·멱등키로 재처리한다.
- 실제 외부 Slack/Teams 발송은 허용된 시험 채널과 자격증명을 확보한 뒤 별도 수신 증거로 검증한다. 현재 작업은 로컬 실제 전달과 모의 외부 응답 계약까지다.

## 상세 실행 Task

1. **N01 계약·기반**: 위 DTO/스키마·상태전이·환경·오류를 코드로 고정한다. 등록 50개/서비스, 구독 2개/연결, 목록 최대100개·안정 정렬, 필터·멱등·버전 충돌을 정의한다.
2. **N02 DB**: 신규 migration과 복합 FK·check·불변/상태/범위 트리거를 적용한다. 직접 SQL의 다른 회사/서비스, 원인 이벤트 위조, 구독·전달 바인딩 변경을 거부한다.
3. **N03 CRUD/API**: 목록/옵션/상세/생성/수정/사용 전환/단일·선택 삭제/시험 발송/이력/안전한 실패 재처리를 구현한다. URL은 쓰기 전용이며 응답·로그·감사·멱등 응답에서 원문을 돌려주지 않는다.
4. **N04 이벤트 연결**: 공개 폼 제출·CSV 마지막 배치 반영과 이벤트+알림 큐를 같은 DB 트랜잭션에 넣는다. 미구독·비활성·다른 대상은 큐가 생기지 않는다. 중복 요청과 rollback도 시험한다.
5. **N05 worker/어댑터**: lease·전송 의도·잠금·환경/권한/기한 재검사, 파일 전달 및 Slack/Teams JSON, DNS/SSRF·응답/재시도·불확실 복구를 구현한다. 독립 worker 루프에 연결한다.
6. **N06 화면**: 원본 표 구조를 유지하며 실데이터 검색·필터·페이지·서비스 전환·생성/수정 모달·사용여부·선택 삭제·시험 발송·이력/재처리를 연결한다. 저장한 URL은 마스크만 표시하고 교체 입력은 비워 둔다. 오류·빈 상태·권한 없음·처리 중을 구분한다.
7. **N07 통합 시험**: CRUD 영속성·멱등/경합·역할/회사·삭제/교체·이벤트 필터·두 worker·임대 복구·실패 재시도·불확실 전송·URL 공격·DNS 재바인딩·리디렉션/과대 응답·직접 SQL·비밀 미노출을 PostgreSQL에서 시험한다.
8. **N08 Ego 검증**: 고정 합성 자료로 생성→편집→시험 발송→실제 로컬 파일/DB 대조→폼 응답 이벤트→CSV 완료 이벤트→필터/중지/교체/선택 삭제·모바일390px·재시작을 조작한다. 외부 운영 메신저에는 보내지 않는다.
9. **N09 최종 게이트**: 전체 테스트·타입·lint·production build·migration 상태·OpenAPI·181경로 대응을 확인한다. 실패를 수리한 뒤 필요한 검증을 반복한다. 증거·남은 외부 조건을 README와 Task 부분 구현 기록에 반영한다.

진행 상태는 위 완료 증거가 생길 때 갱신한다. 전체 Task를 자동 완료 처리하지 않는다.

## 2026-10-03 실행 결과

N01~N07의 독립 계약·DB·API·이벤트·worker·화면·통합 시험을 구현하고 [368개 회귀 및 Ego 증거](README.md)를 기록했다. N08에서 로컬 생성/수정/시험 전송·폼/CSV 실제 이벤트·중지 취소·선택 삭제·390px·재시작을 검증했다. 수정 화면의 DTO 오류와 모바일 잘림을 발견해 수리했다. N09의 타입·린트·최종 빌드·migration·OpenAPI를 통과했다.

남은 수용조건은 허용된 외부 Slack/Teams 시험 채널의 실제 수신과 관련 선행 Task의 전체 게이트다. 현재 `local` 환경의 파일 전달을 외부 수신으로 해석하지 않는다. 정식 Task 상태는 planned, 전체 완료 수는 2/72다.
