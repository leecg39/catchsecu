# RecoverOrSignup 명세

## 대상
`src/components/auth/AuthPages.tsx`의 RecoverOrSignup 컴포넌트. 스타일은 `auth.css`.

## 근거 및 스타일
원본 signup/password-change-email은 로그인된 브라우저에서 dashboard redirect. UI는 동일 로그인 디자인 토큰을 이용한 데모 대체이며 원본 일치 미검증. 이름/이메일/비밀번호/약관 입력; 가입 로컬 완료; 복구 기존 complete 화면. 실제 정보전송 없음.

## 원본 자료
`docs/research/app.catchsecu.com/login-extraction.json`, `login-1440/768/390.json`, `docs/research/public/*.json`.

## 스크린샷
`docs/design-references/app.catchsecu.com/login-1440.png` 및 login-768/login-390. 개별 인증 화면 QA는 메인 에이전트가 담당.

## 제약
원본에서 관측되지 않은 동작과 화면은 `auth-coverage.json`에 미검증으로 기록.
