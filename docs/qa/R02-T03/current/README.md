# R02-T03 인증 화면 연결 완료 검증

2026-10-11 현재 production build와 Ego Lite를 기준으로 인증 도메인의 15개 원본 경로와 상태 전환을 다시 대조했다.

## 구현과 수정

- API의 429 응답에서 `Retry-After`를 보존한다.
- 인증메일과 이메일 OTP 재전송 버튼에 남은 초를 표시하고 대기 중 중복 요청을 막는다.
- 서버가 별도 대기값을 주지 않는 429는 60초, 비정상 값은 60초, 최대값은 3600초로 제한한다.
- 가입 직후 이미 메일이 생성된 화면도 60초 대기 후 재전송할 수 있다.

## 검증 결과

- route-matrix의 R02-T03 경로 15개가 fallback 없이 각각의 인증 화면에 연결됐다.
- 정상, 로딩, 빈 상태, 검증 오류, 401/403, 만료, 409 충돌 표시, 실패 재시도와 새로고침 상태를 상태 매트릭스로 대조했다.
- 안전한 `returnTo`만 링크에 유지하고 외부·인코딩 우회 주소를 버린다.
- IP 제한 화면의 회사 검색, 빈 상태, 선택, 이전/다음 페이지 상태를 확인했다. 이 도메인에는 정렬 UI가 없어 정렬은 적용 대상이 아니다.
- 새 회귀 4파일 56시험이 통과했다.
- 기존 실제 인증 여정은 가입→메일 인증→로그인→reset→TOTP/OTP/복구코드→해제→암호 변경과 DB 재조회를 포함한다.
- 기존 15경로 × 390/768/1440px 45개 화면은 가로 넘침 0이고, 가입 화면의 Tab 순서와 약관 링크를 확인했다.
- 새 production build에서 Ego Lite로 합성 가입을 실행했다. 버튼은 `처리 중…`에서 `59초 후 다시 요청`, `55초 후 다시 요청`으로 감소한 뒤 `인증 메일 다시 받기`로 재활성화됐다. PostgreSQL에는 사용자·credential·감사와 암호화 mail job이 함께 생성됐다.
- typecheck, 대상 ESLint, production build 82페이지가 통과했다.

[검증 집계](verification-summary.json) · [상태 매트릭스](state-matrix.json) · [UI/API 56시험](auth-ui-regression.json) · [Ego Lite·DB 증거](retry-countdown-browser-db.json) · [품질 게이트](quality-gates.json) · [소스 지문](source-fingerprints.json)

기존 실제 화면 증거는 [인증 여정](../authentication/README.md), [15경로·3폭](../authentication/routes-responsive.json), [키보드·약관](../authentication/signup-final-check.json)에 보존돼 있다. 공식 SMTP·DNS·외부 수신함은 UI 완료 조건이 아니며 `R02-T04`의 `external_pending`으로 유지한다. 원본 서비스의 모든 시각적 세부와 공식 공급자 결과를 동일하다고 주장하지 않는다.
