# Message 명세

## 대상
`src/components/auth/AuthPages.tsx`의 Message 컴포넌트. 스타일은 `auth.css`.

## 근거 및 스타일
공유 auth 카드+20px700 제목+14px 설명+40px 복귀 버튼. not-allow-ip 및 email-complete 원문 반영. SSO/만료/실패 일부는 미검증 데모 안내. 실제 외부 인증 연결 없음.

## 원본 자료
`docs/research/app.catchsecu.com/login-extraction.json`, `login-1440/768/390.json`, `docs/research/public/*.json`.

## 스크린샷
`docs/design-references/app.catchsecu.com/login-1440.png` 및 login-768/login-390. 개별 인증 화면 QA는 메인 에이전트가 담당.

## 제약
원본에서 관측되지 않은 동작과 화면은 `auth-coverage.json`에 미검증으로 기록.
