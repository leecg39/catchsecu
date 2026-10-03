# TwoStep 명세

## 대상
`src/components/auth/AuthPages.tsx`의 TwoStep 컴포넌트. 스타일은 `auth.css`.

## 근거 및 스타일
원본 title2단계 인증 하기; 이메일/OTP 인증 두 행 padding16px gap16px, 구분선#dbdee2. 설명13px#838991 line-height20.8px. 설정80x40. 클릭으로 각 로컬 인증 화면 이동. narrow viewport에서는 행 padding12px/button min-width60px(가용폭 대응, 원본 해당상태 미검증).

## 원본 자료
`docs/research/app.catchsecu.com/login-extraction.json`, `login-1440/768/390.json`, `docs/research/public/*.json`.

## 스크린샷
`docs/design-references/app.catchsecu.com/login-1440.png` 및 login-768/login-390. 개별 인증 화면 QA는 메인 에이전트가 담당.

## 제약
원본에서 관측되지 않은 동작과 화면은 `auth-coverage.json`에 미검증으로 기록.
