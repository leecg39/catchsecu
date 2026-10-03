# P02-T02 암호 복구·2FA·복구코드

2026-10-03. 같은 foundation 테스트 43개에서 복구와 2단계 인증을 확인했다.

- 재설정 메일의 링크로 비밀번호를 바꾼 뒤 같은 토큰은 다시 쓸 수 없다.
- 만료시킨 재설정 토큰은 비밀번호를 바꾸지 못한다.
- TOTP 확인 전의 세션은 보호 API에 들어갈 수 없다.
- 복구코드는 한 번 성공한 뒤 다시 거부된다.
- `000000` TOTP는 통과하지 못한다.
- 비밀번호가 바뀌면 이전 세션은 401이 된다.

로컬 메일함의 링크를 실제로 열었다. 외부 SMTP 수신 증명은 아니다.

실행: `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/foundation.test.ts`
