# profile 페이지 사양

## 근거 및 범위
원본 DOM/computed CSS는 경로 이름 JSON, 화면은 docs/design-references/management/ 동명 PNG. 입력·저장·발송은 실제 API 호출 없이 데모 상태.

## 공통 exact CSS
Noto Sans KR; 글자 #484e55; 제목24px700; 내용14px/22.4px. white card padding24px radius12px. primary #6558ff button40px radius4px; secondary border #cbcfd5. 테이블 헤더12px700; empty13px/20.8px #a5abb2.

## 동작 및 상태
클릭 기반 화면. tab은 클릭으로 변경. 검색/초기화/선택/페이지 크기 조절은 local state. 영구 원본 변경 버튼은 조사에서 클릭하지 않음. 호버 transition .15s cubic-bezier(.4,0,.2,1).

## 반응형
768/390 sidebar 숨김, main padding20px. 회사/프로필 정보 두 열 유지; 표 가로 스크롤. JSON에 실측값 저장.

## 페이지별 실제 내용
### /my-page/info
프로필
개인정보 활동 검토 이력
나의 활동 로그 / 편집 / 회사명 / 중소기업발전 / 이름 / 데모담당자  
부서명 / - / 직책 / - / 이메일 / demo@example.com  
비밀번호 / SSO 연동계정입니다. / 연락처 / - / 설정 / SSO 연동 설정  
로그인한 이메일과 연동할 이메일은 동일해야 합니다. / demo@example.com / 해제하기 / 2단계 인증 설정 / 유료 라이선스 구독이 필요한 기능입니다. / 이메일 인증  
이메일 인증을 사용하여 로그인합니다. / OTP 인증 / OTP 인증을 사용하여 로그인합니다. / ### /my-page/info/edit / 프로필 편집 / 회사명  
이름 / 부서명 / 직책 / 이메일 / 비밀번호 변경 / SSO 연동 계정은 비밀번호를 변경할 수 없습니다.  
연락처 / 회원탈퇴 / 회사 초대코드 입력 / 저장 / ### /my-page/delete / 회원탈퇴  
회원탈퇴 / ※ 탈퇴하면 그 동안 캐치시큐에서의 모든 정보(동의서, 캐치폼, 수집한 개인정보 등)가 삭제됩니다. / ※ 삭제된 정보는 복원이 불가합니다. 그럼에도 불구하고 탈퇴를 원하시나요? / 회원탈퇴 / 최상위 관리자 권한 가지고 계신가요? / ※ 만약 회사에 최상위 관리자 이외에 멤버가 1명 이상 있다면, 최상위 관리자는 탈퇴할 수 없습니다.  
※ 다른 사용자에게 권한을 넘기고 탈퇴를 시도해주세요. / 구성원 관리로 이동