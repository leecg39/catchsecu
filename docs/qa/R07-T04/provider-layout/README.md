# SSO 공급자 표·편집창 레이아웃 보완

2026-10-10 E5 부분 수용. [수정 전 측정](before.json)에서 1440px의 공급자 행이 최대272px, 로그인 URL은 높이177px였다. 좁아진 URL/관리 버튼 열을 SSO 전용 표 스타일로 보완했다. 편집 폼은 공통 설명의 음수 여백을 제거하고 grid 간격20px로 배치했다.

[390/768/1440px 목록 측정](responsive.json): 최대 행 높이119px, URL 높이54px, 문서 가로 넘침 없음. 넓은 표는 표 안에서 가로 스크롤하며 키보드 초점을 받을 수 있다. [편집창](editor.json)은 세 폭 모두 화면 내부에 배치되고 설명과 필드 사이20px 간격을 확인했다. 실제 UI 입력/목록 데이터는 서버의 동결 QA fixture를 조회했다.

화면: [1440 목록](overview-1440.png), [768 목록](overview-768.png), [390 목록](overview-390.png), [390 편집](editor-390.png), [768 편집](editor-768.png), [1440 편집](editor-1440.png). 스크린샷을 직접 확인했다. 키보드 초점/가로 스크롤 동작 중 화면은 list-*.png에 별도 보존한다.

[production 빌드](build.log)·[린트](lint.log) 통과. `.next-rea-sso-layout`을 새 프로세스로 실행해 검사했다. 기존 E4 fixture 해시03a81972…는 [읽기 전용 재검사](../provider-context/verify.json)에서 보존됐다. CSS/마크업만 변경했고 동일 서버 회귀를 중복 합산하지 않는다.

이번 폭별 검사는 SSO 공급자 목록/일반 편집창에 한정된다. 오류/충돌 문구를 포함한 모든 폭·모든 인증 경로·모든 키보드 흐름·SPA history Back/Forward 수용은 여전히 남는다. 전체 E5/전체 작업 완료로 표시하지 않는다.
