# Login 명세

## 대상
`src/components/auth/AuthPages.tsx`의 Login 컴포넌트. 스타일은 `auth.css`.

## 근거 및 스타일
로그인 카드 padding32px24px; radius16; border1px#e7e9ed; shadow0 3px6px#3333330a. input40px; gap16px; button48px; 이메일 기억 checkbox20px. 클릭/입력 기반: 제출 대시보드 이동, 이메일 기억 선택 때만 localStorage. 실제 비밀번호 저장 또는 API 호출 없음. 비밀번호 보기 토글. 조회 링크2개. Google/MS 버튼은 로컬 외부인증 안내로 이동.

## 원본 자료
`docs/research/app.catchsecu.com/login-extraction.json`, `login-1440/768/390.json`, `docs/research/public/*.json`.

## 스크린샷
`docs/design-references/app.catchsecu.com/login-1440.png` 및 login-768/login-390. 개별 인증 화면 QA는 메인 에이전트가 담당.

## 제약
원본에서 관측되지 않은 동작과 화면은 `auth-coverage.json`에 미검증으로 기록.
