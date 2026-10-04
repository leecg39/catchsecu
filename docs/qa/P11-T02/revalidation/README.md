# MFA 화면 경로·검색·모바일 보완

2026-10-04. P11-T02 부분 검증이며 전체 완료가 아니다.

- CloneApp의 Dashboard 분기에 회사 MFA 현황/설정 두 주소가 포함돼 MfaPolicy가 가려졌다. 분기에서 두 주소를 제거해 기존 ManagementPages로 연결했다.
- 검색어가 바뀔 때마다 API 조회 중 입력창이 제거되어 포커스가 BODY로 옮겨갔다. 검색 입력과 적용 값을 분리하고 검색 버튼/Enter로 조회하게 했다.
- 정의되지 않은 mg-table-wrap 대신 공통 cs-table-wrap을 사용했다. 390px에서 페이지가609px로 늘어나던 문제를 해결해 표 내부만 스크롤한다.

## 근거

- [수정 전 대시보드](mfa-route-before.txt), [이전 검색 포커스](mfa-search-focus-before.json), [이전 모바일 넘침](mfa-route-mobile-overflow.png).
- [최종 설정 화면](mfa-route-setting-final.txt), [현황 화면](mfa-route-overview-after.txt), [검색 및 너비 수치](mfa-route-final.json), [최종390px](mfa-route-mobile.png). 실제 Ego45/p1 조작과 이미지 검토를 수행했다.
- 현황→설정 이동/새로고침, 입력 중 focus 유지/검색 전2행 유지, 검색 후 member1행, 화면 이동 후2행을 확인했다. 최종 innerWidth390/scrollWidth390, 표308px 안의569px 콘텐츠만 스크롤한다. 이전 innerWidth와scrollWidth를 서로 비교한 검사만으로는609px 확대를 놓쳐, 설정 너비390과 직접 비교하도록 보완했다.
- [독립DB](mfa-route-db.json)의 활성 직접구성원2/인증등록0/강제false/version1이 화면과 일치한다. 이번에는 정책과 예외를 변경하지 않았다.
- [관련37개](mfa-route-tests.log): auth-navigation/mfa-policy2파일 통과. [최종v18 빌드/타입](mfa-route-build-final-v18.log), [lint](mfa-route-lint.log) 통과. v16/v17도 빌드는 성공했지만 각각 검색/모바일을 보완한 뒤 최종v18로 UI를 재검증했다.
- [요약/소스 해시](mfa-route-summary.json). 신선한production3119 PID14510. 이전 자체3116/3117/3118을 종료했고 사용자3100은 유지했다.

전체 정책/예외·원본 대조·선행 게이트는 이전 QA와 함께 완수해야 한다. 이 수정으로 P11-T02를 완료 처리하지 않는다.
