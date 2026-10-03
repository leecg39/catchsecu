# Testimonials 명세

## 대상
`src/components/auth/AuthPages.tsx`의 Testimonials 컴포넌트. 스타일은 `auth.css`.

## 근거 및 스타일
로그인 원본 텍스트3개, sparkplus102px/eventus57px/monymony87px 이미지. click+time-driven, 점 클릭과6초 자동 순환. 원본 자동 순환 주기 미검증. 실제 문구는 AuthPages.tsx reviews에 보존. 반응형 텍스트 줄바꿈.

## 원본 자료
`docs/research/app.catchsecu.com/login-extraction.json`, `login-1440/768/390.json`, `docs/research/public/*.json`.

## 스크린샷
`docs/design-references/app.catchsecu.com/login-1440.png` 및 login-768/login-390. 개별 인증 화면 QA는 메인 에이전트가 담당.

## 제약
원본에서 관측되지 않은 동작과 화면은 `auth-coverage.json`에 미검증으로 기록.
