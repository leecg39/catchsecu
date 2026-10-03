# ChangePassword 명세

## 대상
`src/components/auth/AuthPages.tsx`의 ChangePassword 컴포넌트. 스타일은 `auth.css`.

## 근거 및 스타일
원본 정기적인 비밀번호 변경 안내/안전한 캐치시큐 이용을 위해 비밀번호를 변경해주세요. 입력2개.8~20영문숫자특수문자 !@#$%^&* 검증과 일치 확인. 완료 로컬 메시지. 원본 passwordChange 경로 dashboard redirect여서 password-change-rule 시각 재사용.

## 원본 자료
`docs/research/app.catchsecu.com/login-extraction.json`, `login-1440/768/390.json`, `docs/research/public/*.json`.

## 스크린샷
`docs/design-references/app.catchsecu.com/login-1440.png` 및 login-768/login-390. 개별 인증 화면 QA는 메인 에이전트가 담당.

## 제약
원본에서 관측되지 않은 동작과 화면은 `auth-coverage.json`에 미검증으로 기록.
