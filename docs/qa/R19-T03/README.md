# R19-T03 — 알림톡 채널·템플릿·발송: 전체 화면·모달 연결

실제 서버(localhost:3121)·실제 DB·로그인 세션에서 브라우저 검증. `ServicesPages` dispatcher가 `/alimtalk` 전 경로를 연결한다.

| 경로 | 확인 내용 |
|---|---|
| `/alimtalk`, `/alimtalk/channels` | 채널 목록: 이름·검색용 아이디·상태("확인 전 확인 요청"·"확인됨")·수정·삭제·보관 액션, 서비스 선택(기본/제한), 채널 등록 버튼 |
| `/alimtalk/templates`, `/alimtalk/templates/register` | 채널 선택(확인 상태 표시) + 템플릿 목록: 이름·버전·상태(초안/심사 요청/승인), "승인되지 않은 템플릿은 발송할 수 없습니다. 내용을 바꾸면 다시 심사해야 합니다." 규칙 고지, 초안 저장 |
| `/alimtalk/templates/:id` | 상세: 심사 상태·저장 버전·귀속 채널·본문, 템플릿 수정, 변수 값 입력 미리보기(확인 버튼), 심사 요청, 삭제·보관 |
| `/alimtalk/templates/:id/edit` | 편집 모드 동일 상세 컴포넌트 |
| `/alimtalk/send` | 알림톡 보내기: 캠페인명, 승인/초안 상태 표시된 템플릿 선택, 내용 작성 단계 안내("연락처 직접 입력·CSV · 내용 저장 후 수신자를 선택합니다") |
| `/alimtalk/history` | 알림톡 발송 내역: 캠페인 행(상태·수신자·"접수·로컬 전달 N" 결과·예약/생성 시각), 상태·기간·보관 필터, 페이지네이션, "외부 공급자 연결은 별도 확인이 필요합니다" 고지 |
| `/kakao-playground` | 미리보기 컴포넌트 플레이그라운드: basic/additional-info/channel-add/complex/emphasis/image/item-list 유형 렌더(검수 도구임을 제목에 명시) |

부수 확인: 채널 searchId 변경 후 템플릿이 "초안"으로 복귀한 것이 목록·상세에 실시간 반영됨(DB `channel-reset` 케이스와 일치). 401/403은 빈 목록이 아니라 인증 게이트로 처리됨.
