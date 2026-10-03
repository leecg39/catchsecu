# Password 명세

## 대상
`src/components/auth/AuthPages.tsx`의 Password 컴포넌트. 스타일은 `auth.css`.

## 근거 및 스타일
input height40 border1px#cbcfd5 radius4 padding10px12px; 우측 visibility-off.svg24px. 클릭으로 type=password/text 토글. required 검증. 상태는 컴포넌트 메모리에만 보관.

## 원본 자료
`docs/research/app.catchsecu.com/login-extraction.json`, `login-1440/768/390.json`, `docs/research/public/*.json`.

## 스크린샷
`docs/design-references/app.catchsecu.com/login-1440.png` 및 login-768/login-390. 개별 인증 화면 QA는 메인 에이전트가 담당.

## 제약
원본에서 관측되지 않은 동작과 화면은 `auth-coverage.json`에 미검증으로 기록.
