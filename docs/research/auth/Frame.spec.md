# Frame 명세

## 대상
`src/components/auth/AuthPages.tsx`의 Frame 컴포넌트. 스타일은 `auth.css`.

## 근거 및 스타일
배경 #f0f2f8; 일반 padding45px20px24px, 로그인40.5px; max-width424; 로고206x25.9531; 일반 margin-bottom40px, 로그인32px. 반응형 컨테이너는 가용 폭에서 양옆20px 제외. 정적 구성.

## 원본 자료
`docs/research/app.catchsecu.com/login-extraction.json`, `login-1440/768/390.json`, `docs/research/public/*.json`.

## 스크린샷
`docs/design-references/app.catchsecu.com/login-1440.png` 및 login-768/login-390. 개별 인증 화면 QA는 메인 에이전트가 담당.

## 제약
원본에서 관측되지 않은 동작과 화면은 `auth-coverage.json`에 미검증으로 기록.
