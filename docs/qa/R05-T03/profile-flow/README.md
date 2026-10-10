# R05 MY 화면·활동 검토·탈퇴 검증

Ego Lite의 기존 작업 공간 3 / p1에서 합성 계정으로 실행했다. 원본 서비스에는 쓰기 작업을 하지 않았다. 구현 변경은 프로필/기기 조회 재시도, 미저장 입력 보호, 충돌 복구, 활동 검토 파기 오류 노출, 탈퇴 완료 안내다.

| 흐름 | 확인한 동작 | 근거 |
| --- | --- | --- |
| 프로필 | 조회 실패 재시도, 동시 수정 409, 입력 유지/버리기 선택, 네트워크 실패 후 저장, 재로그인 후 DB 값 유지 | [조회 복구](resource-failure-after.json), [충돌/재시도](profile-conflict-after.json), [재로그인](profile-after-relogin.json) |
| 기기 | 해제 취소/확인, 독립 HTTP 쿠키 401, 현재 브라우저 200 | [세션 회수](session-revocation.json) |
| 내 활동 | 2페이지 이동, 처리내용 검색/빈 결과, CSV 다운로드 | [조회](own-activity-log.json), [CSV](own-profile-events.csv) |
| SSO | 마지막 로그인 수단 버튼 비활성/HTTP 409, 해제 취소, 네트워크 실패 후 재시도, 모든 세션 종료 | [마지막 수단](sso-last-method.json), [해제](sso-unlink.json) |
| 검토 요청/답변 | 요청 생성, 닫기/알림 갱신 시 미저장 입력 확인, 답변 실패 후 재시도 | [요청 입력](review-request-unsaved-after.json), [메시지 입력](review-message-unsaved-after.json), [답변](review-response.json) |
| 검토 처리 | UI 처리 완료/취소, 로컬 알림 상태, 파기 네트워크 실패/재시도, 동시 보존 처리 후 409/최신 조회 | [완료](review-resolved.json), [취소](review-cancelled.json), [알림](review-notification.json), [파기](destruction-success.json), [충돌](destruction-conflict.json) |
| 검토 목록 | 상태 필터의 빈 결과, 제목 검색, 대상자 탈퇴 및 서버 재시작 뒤 이력 보존 | [검색](review-filters.json), [탈퇴 후](review-after-recipient-closure.json), [재시작 후](review-after-server-restart.json) |
| 탈퇴 | 소유자 거부, 입력 닫기 보호, 틀린 비밀번호/네트워크 실패, 프로필 동시 변경 409, 조건 재조회 후 입력 유지, 실제 폐쇄와 로그인 거부 | [소유자](closure-owner-blocked.json), [입력](closure-unsaved-after.json), [실패](closure-errors.json), [충돌](closure-conflict.json), [완료](closure-success.json), [로그인 거부](closed-account-login.json) |
| 완료 안내 | 실제 폐쇄 후 로그인 화면에 안내가 없는 것을 확인하고 추가, 같은 완료 URL을 새 빌드에서 재조회 | [수정 전](closure-feedback-before.json), [수정 후](closure-feedback-after.json) |

[6개 원본 경로 × 3개 화면 폭](route-widths.json)은 390/768/1440px에서 가로 넘침이 없었다. [탈퇴 확인창](closure-modal-layout.json) 3개 폭과 Escape→확인창→Tab 4단계도 확인했다. [화면 캡처](screenshots/) 중 모바일 프로필·편집 및 태블릿 검토 목록은 실제 이미지를 열어 확인했다.

`*-before.json`은 수정 전 재현을 보존한다. 비밀번호와 세션 쿠키는 공개 증거에 기록하지 않았다. SSO 연결은 비활성 합성 제공자/계정을 직접 준비했고, 마지막 로그인 수단을 만들기 위한 비밀번호 유무도 시험용으로 조정했다. 복원 때 실제 credential 트리거가 세션을 폐기해 재로그인했다. 이는 외부 SSO 로그인 성공의 증거가 아니다. 보유 기한/승인 대기 상태는 해당 합성 검토 행만 조정했으며, 공유 개발 DB에서 전역 보유기간 worker를 실행하지 않았다.

모든 역할·라이선스 조합, 별도 브라우저 프로필, 원본 내부 동작과의 완전한 동일성 및 실제 SMTP/IdP 수신 검증은 남아 있다.
