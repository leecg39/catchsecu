# P03-T03 브라우저 게이트 — 2026-10-04 (Chrome DevTools 실제 브라우저)

환경: dev 서버(:3100) + `catchsecu_dev` PostgreSQL + chrome-devtools MCP Chrome.

## 프로필 `/my-page/info` — 저장·DB 지속성

- 실데이터 렌더: 회사명(수정 불가 표시)·이름·이메일(disabled)·부서명·직책·연락처·언어(한/영/일)
- 편집 저장 → `/my-page/info`로 이동·값 표시 → **PostgreSQL `User` 테이블 대조 통과**(department="QA 검증팀"·jobTitle·phone). 화면↔API↔DB 일치
- 로그인 보안: 비밀번호 변경·2단계 인증 등록 링크
- **로그인한 기기**: 현재 기기(UA 표시)+다른 기기 3개 세션, 각 "로그인 해제" 버튼 — 실제 세션 원장 데이터

## 회원탈퇴 `/my-page/delete` — owner 세션 적대 검증

- owner@ 로그인 상태에서 탈퇴 페이지: **"아래 회사의 소유권을 다른 활성 구성원에게 먼저 이전해주세요." + 회사명 + 구성원 관리 링크 + 회원탈퇴 버튼 비활성**
- 수용 조건 "owner 인계 전 탈퇴 실패"의 화면 측 직접 증거 — 클릭 불가 상태이며 사유와 해결 경로를 함께 표시
- 부수 확인: 탈퇴 시 모든 기기 로그인 해제·권한 회수 안내문, 회사 자료는 회사에 남는다는 보존 안내

## 나의 활동 로그 `/my-page/activity-log`

- 본인 감사 이벤트 **133건 실데이터**(14페이지): session.created·form.created/archived·analytics.dashboard_viewed·marketing.summary_viewed 등 처리일시·서비스명·수행내용·처리대상 컬럼
- 기간·검색 조건(처리내용/처리대상)·초기화·검색·새로고침·**CSV 내려받기**·페이지 크기 전부 렌더
- 하단 정직한 표기: "감사 원장에 저장되지 않은 접속 IP·고객번호·사유는 표시하지 않습니다."

## 남은 한계

- "탈퇴 후 세션/토큰 거부": 실제 탈퇴 실행은 시드 계정 파괴를 동반해 브라우저 미실행 — `tests/server/` 계정 폐쇄·세션 회수 시험과 production HTTP 증거(`http-finish.*`)로 유지
- "재시작 후 프로필 유지": DB 저장 확인으로 실질 커버(재시작 무관 영속 계층) — 기존 서버 재시작 증거도 README에 존재
- 외부 이메일 실전달(탈퇴·알림 메일)은 B04 SMTP 블로커
