# Verification 명세

## 대상
`src/components/auth/AuthPages.tsx`의 Verification 컴포넌트. 스타일은 `auth.css`.

## 근거 및 스타일
OTP title20px700 line-height28px. description14px22.4px margin-top20px. 인증코드 입력 행 margin-top24px gap8px; 확인80x40. 이메일 문구 동일, 개인 이메일은 demo@example.com 대체. 코드6자리 숫자만, 완료 dashboard. 이메일 재발급은180초 로컬 타이머와 데모 안내.

## 원본 자료
`docs/research/app.catchsecu.com/login-extraction.json`, `login-1440/768/390.json`, `docs/research/public/*.json`.

## 스크린샷
`docs/design-references/app.catchsecu.com/login-1440.png` 및 login-768/login-390. 개별 인증 화면 QA는 메인 에이전트가 담당.

## 제약
원본에서 관측되지 않은 동작과 화면은 `auth-coverage.json`에 미검증으로 기록.
