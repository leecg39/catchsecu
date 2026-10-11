# R05-T02 MY·프로필·활동 검토·탈퇴 서버 API 검증

2026-10-11 현재 소스와 PostgreSQL로 R05의 14개 경로·18개 API 작업을 확인했다. 프로필·세션·활동 기록·탈퇴·SSO 연결 해제·비밀번호 정책과 활동 검토의 요청/답변/종결/알림/파기 처리를 포함한다.

## 수정한 결함

검토 대상자가 관리자 권한을 가지면 본인 검토의 메시지를 직접 파기하거나 영구 보존할 수 있었다. OpenAPI와 업무 정책의 `not recipient` 조건이 파기 처리 함수와 화면용 권한 값에서 누락돼 있었다. 관리자 승격 후 실제 HTTP handler 호출이 두 행동 모두 200을 반환하는 것을 먼저 재현했다.

현재 수신자와 행위자를 비교하는 기존 담당자 규칙을 파기/보존 요청과 멱등 응답 재사용 경로에도 적용했다. 상세 응답의 `canDecideDestruction`에도 같은 제한을 적용해 본인 화면의 승인 버튼을 숨긴다. 관리자 대상자의 두 요청은 403이며 검토·메시지·감사·멱등 기록은 바뀌지 않는다. 별도 담당자는 계속 승인할 수 있다.

- [수정 전 두 건 실패 재현](self-approval-before.json): 의도된 RED 기록이며 최종 회귀 실패로 집계하지 않는다.
- [수정 후 보유·파기 10개 시험](self-approval-after.json)
- [서버 회귀 9파일·263개](server-api-regression.json): 본인/회사 격리, 현재 권한, 프로필 경합과 원자 롤백, 계정 폐쇄·소유권/최종 관리자 보호, 세션 회수, SSO 마지막 수단 보호, 검토 상태·권한·중복·보유 기한을 검증했다.
- [추가 알림 실패·재시도 1개](notification-retry.json): 전달 실패를 주입한 첫 시도는 retry, 같은 job의 다음 시도는 실제 로컬 파일 전달이다. 시도 이력은 retry→delivered이고 세 번째 실행은 작업을 다시 발송하지 않는다. 원문은 바뀌지 않고 메일에도 노출되지 않는다. `-t`로 선택하지 않은 기존 33건은 이 파일에서만 pending이며 위 263개 실행에서 이미 통과했다. 고유 시험 합계는 264개다.
- [OpenAPI→handler 정적 대조](api-contract.json) · [집계](verification-summary.json) · [품질 게이트](quality-gates.json)

## 실제 production HTTP·Ego Lite·재시작

기존 서버와 분리한 `localhost:3121`에서 새 합성 회사·사용자·서비스로 검토 2건을 요청→답변→종결했다. [준비 기록](self-approval-fixture.json)의 계정·소속·trial·원본 감사 및 보유 시계는 명시적인 fixture 입력이며 제품 CRUD나 실제 외부 연동 성공으로 세지 않는다.

- [관리자 대상자의 버튼 숨김](self-approval-browser-recipient.json)을 Ego Lite에서 확인했다.
- 다른 담당자로 로그인해 [실제 파기 승인](self-approval-browser-destroy.json)과 [실제 보존 승인](self-approval-browser-keep.json)을 클릭했다.
- [처리 후 독립 HTTP·DB](self-approval-http-final-before-restart.json): 파기 건 v5/메시지0, 보존 건 v5/메시지3, 도메인 감사8건. 대상자의 직접 파기/보존 요청 4건은 모두403이며 DB 상태가 변하지 않는다.
- [새 서버 프로세스](self-approval-http-after-restart.json)에서도 기존 HTTP 세션의 권한과 동일 DB 지문을 확인했다. [Ego 새로고침](self-approval-browser-restart.json)에서도 보존 메시지3건을 읽은 뒤 로그아웃했다.

최종 재시작 전후 지문: `366a6bf82ee187df447c62c4267616c070f871371d66bcf53304216ca1a043b9`.

HTTP 재로그인은 재시작 전에 확인했다. 재시작 직후 추가 로그인은 짧은 시간의 반복 로그인으로 429를 받아, 제한을 해제하지 않고 기존 세션의 지속성 검증으로 구분했다. 시험용 서버는 검증 후 종료하며 합성 이력은 후속 검증을 위해 보존한다. 비밀번호·쿠키는 Git에서 제외된 `.local/rea-fullstack/r05-self-approval.json`에만 있다.

타입 검사·변경 파일 ESLint·전체 ESLint 오류0(기존 경고29)·production82페이지 빌드를 통과했다. 처음 별도 빌드 설정의 경로 오류는 로컬 QA tsconfig의 상대 경로를 바로잡아 해결했으며 제품 설정은 변경하지 않았다. 모델 대조는 [R05-T01](../../R05-T01/current/README.md)에 기록했다.

이 작업의 서버 API 검증은 완료한다. R05-T03 전체 화면 상태·URL 복원과 R05-T04 전체 수용, 실제 SMTP 수신·외부 IdP 성공은 별도 작업이며 완료 처리하지 않는다. 사용자의 요청에 따라 이 체크포인트를 커밋·푸시한 뒤 목표를 일시정지한다.
