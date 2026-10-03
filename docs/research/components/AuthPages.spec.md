# 인증 화면
## 구조·스타일
로그인: docs/design-references/app.catchsecu.com/login-1440/768/390.png, 동일명의 JSON computed CSS.
배경#f0f2f8 padding40.5px20px24px, max-width424 centered, logo206x25.953 mb32.
카드white padding32px24px border#e7e9ed1 radius16 shadow0 3px6px#3333330a.
이메일/비밀번호 inputheight40 padding10px12 border1#cbcfd5 radius4; placeholder#aab0b8.
로그인button margin-top22 height48 radius6 primary#6558ff white14px500; hover#532cff transition.15s.
이메일 기억하기 checkbox20px, 아래 signup row center. divider or. Google/MS buttons48 heightborder#e7e9ed, 실제 로컬 로고.
관련 조회카드 margin-top12 white radius16 padding24; 링크 infoOwner/find,shared-privacy/verify.
testimonials 3개 actual text and logos from login extraction, carousel dots and autoplay; scroll-driven 아니다.
## 상태·행동
비밀번호 표시 토글, 이메일 기억하기, required validation. 로그인은 로컬 demo dashboard로 이동. 실제 인증/메일/토큰 API 없음. 비밀번호 저장 금지.
OTP 6자리 local 입력 검증; 재발급은 화면 타이머만. 데모 세션으로 안내 가능.
2단계: 제목 '2단계 인증 하기', 설명 '관리자가 2단계 인증을 필수로 설정하였습니다. 아래의 인증 수단 중 하나를 선택해 설정을 진행해주세요.' 이메일 인증/OTP 인증 카드+설정.
password-change-rule 실제 title '정기적인 비밀번호 변경 안내', subtitle '안전한 캐치시큐 이용을 위해 비밀번호를 변경해주세요.',새비밀번호/확인,8~20자리 영문숫자특수문자. 완료는 로컬 only.
not-allow-ip: 제목 허용되지 않은 IP 접근 제한,본문 보안 담당자가 사전에 등록한 IP주소로만 로그인할 수 있습니다. 사무실과 같은 허용된 장소에서 접속하세요.,확인.
password-change-email/complete: 이메일을 확인해주세요. 입력하신 이메일로 비밀번호 재설정 메일을 보내드렸어요. 로그인으로 돌아가기.
login-failed: 로그인에 실패했습니다. 다시 시도해 주세요.
## 제약
SSO callbacks 빈 원본/외부요구. 가입 및 복구 일부 로그인 상태로 원본 dashboard redirection됨. 데모로 구현 시 coverage에서 미검증 명시.

## 구현 구성 및 검증
`src/components/auth/AuthPages.tsx` / `auth.css` 구현. 소형 컴포넌트 명세는 `docs/research/auth/*.spec.md`, 경로별 상태는 `docs/research/auth/auth-coverage.json`.
타입 검사 `npx tsc --noEmit` 통과. 시각 QA 메인 에이전트 진행. 로그인 이메일 보관은 사용자가 체크한 경우에만 수행, 암호는 저장·전송 안 함. 개인 이메일 원문은 demo@example.com으로 대체. 후기 원문3개+로고3개 보존; 자동전환 주기6초는 원본 미검증 데모 값.
