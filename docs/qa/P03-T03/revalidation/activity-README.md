# 개인정보 활동 검토 — 모델·API 부분 구현

2026-10-04. P03-T03 프로필 진입점 및 P12-T01의 R097 검토 이력에 대한 독립 구현이다. 원본은 빈 목록/잘못된 접근만 관찰됐으므로 정상 원본과 동일하다고 주장하지 않는다. **현재 화면은 아직 빈 배열 구현이다. 이 보고서는 모델/API 검증이며 UI 완료 증거가 아니다.**

## 구현한 범위

ActivityReview와 ActivityReviewMessage를 추가했다. 원본 AuditEvent의 회사·서비스·처리자와 검토의 회사·서비스·대상자를 composite FK로 묶었다. 원본 감사·기존 개인 감사는 보존한다. 같은 사건의 열린 요청은 partial unique index로 제한하고 메시지 수정/삭제와 불법 상태 전이는 DB trigger로 거부한다. 본문은 암호화하며 감사에는 변경 필드만 남긴다.

GET/POST `/activity-reviews`, GET `/activity-reviews/{id}`, POST `/activity-reviews/{id}/actions`를 구현했다. 목록은 받은/보낸/회사 범위, 제목 검색·상태·기간·서비스·페이지 보정을 지원하며 본문을 반환하지 않는다. 상세는 권한 확인 후 메시지를 복호화한다. 요청은 원본 감사 처리자에게만 가능하고 본인 사건/비활성 대상자는 거부한다.

요청·종결에는 현재 security.write/audit.read와 서비스 범위가 필요하다. 대상자는 본인 수신 요청에 답변할 수 있으나 임의 종결은 불가하다. 이전 서비스 grant가 없어도 본인의 검토 요청은 확인·답변할 수 있다. 원래 개인정보/파일 자체를 읽는 권한을 부여하지 않는다. 서비스가 보관되면 변경은 막고 이력만 조회한다. 전문가 대상 배정이 저장 도중 만료되면 요청을 롤백한다.

requested→responded→resolved, requested/responded→cancelled 상태를 version으로 검사한다. 생성·동작에는 Idempotency-Key를 요구하고 캐시에는 ID만 저장한다. 재전송도 현재 권한/세션/서비스를 검사하며 최종 기한 실패는 업무·메시지·감사·키를 함께 롤백한다. 이메일 알림 API/외부 발송은 아직 없다.

## 검증

- 신규 API/서비스 시험20개 최종 통과. 기존 계정/프로필/감사3파일21개는 직전 관련 회귀에서 통과했다. 전체 저장소 회귀가 아니다. FK 시험은 중복 열린 요청 제약이 결과를 가리지 않도록 별도로 보완해 잘못된 처리자/회사/서비스에 실제 Prisma P2003을 확인했다(1개 재실행 통과, 나머지19개는 해당 필터에서 skipped).
- 초기 실패는 시험 helper의 count 옵션 위치, 마지막 owner를 제거하는 fixture, nested relation의 중복 tenantId, DB가 허용하지 않는 전문가 security 역할 준비에서 발생했다. 기존 DB 제약을 완화하지 않고 fixture를 수정했다. 시험 수정 중 취소 후 재요청 기대값을 잘못 바꾼 실행도 실패 로그를 보존했고 복구 후20개 통과했다. node-pg 경고도 보존했다.
- migration75개 빈 설치,74→75업그레이드, 실패 migration 원자 롤백·재실행을 catchsecu_shadow에서 확인했다. dev/test에75개 적용. dev의 기존74개 checksum과 Company/Service/Subprocessor/SubprocessorNotice/ServiceConsentDisplay/AuditEvent6테이블 전체 행 해시가 migration 전후 일치했다. 새 schema는119모델이다.
- v13 production 빌드/TypeScript와 변경파일 lint 통과. 최종 테스트 파일 보완 후 typecheck/lint도 별도 실행했다. OpenAPI284경로·411작업·정책37개에서 권한/입력/정책 누락0과 Task상태15개 완료 일치를 확인했다.
- 실제 Ego45/p1의 HTTP11회(회사 선택 포함)로 합성 owner/member 계정에서 요청→수신 목록/상세→답변→같은 키 답변 재전송→대상자 종결403→owner 종결→상세를 확인했다. 시작 감사는 syntheticQA=true인 합성 데이터이며 실제 개인정보 조회로 생성한 이벤트가 아니다. 로그인 응답·비밀번호·요청키를 증거에 출력하지 않았다. **브라우저 UI 버튼 조작 검증은 아직 아니다.**
- 동일 v13 서버 PID72656 종료→74637 재시작 후 상세200/생성키 재전송201 같은ID, 독립DB review1(resolved,v3)/message3/audit3/key3가 유지됐다. 해시:52d170794251ac65c89587485c08c62deea3ef1986579d8af4fcf84cab7b624e.

## 남은 조건·재개 정보

처리로그의 요청 버튼, 마이페이지 받은/보낸/회사 목록·상세·답변·처리·409복구·모바일, 실제 두 사용자 UI와 페이지/검색/재로그인 검증이 다음이다. 선택적 이메일 알림과 실제 외부 SMTP, 보유/파기 정책·원래 선행 및 공통 Task 조건도 미완료다. P03-T03/P12-T01 모두 진행 중이며 전체 완료15·진행21·계획36을 유지한다.

최신 자체QA3114 PID74637/exec75937/buildv13. 이전3113 종료, 사용자3100 유지. Ego45/p1은 owner 로그인/회사 선택 상태이며 `/my-page/info-activity-log`의 기존 빈 화면이다. 원래 작업공간45를 재사용한다. .local/recovery-activity.json은 review/event/요청키, .local/recovery-members.json은 합성 계정 정보를 가진다. 값을 출력하지 않는다. 원본 감사 eventId에 이미 완료된 검토가 하나 있으므로 UI 검증에서는 새 요청 키로 다시 요청할 수 있다. 기존 resolved 이력은 보존한다.
