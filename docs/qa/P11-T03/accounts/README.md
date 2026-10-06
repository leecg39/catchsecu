# P11-T03 — 본인 SSO 연결 관리

2026-10-06. P11-T03 진행 중, 공식 완료 17·진행 41·계획 14 유지.

## 구현

- `GET /api/v1/me/sso-accounts`: 현재 회사에 직접 소속된 본인의 SSO 계정과 사용 가능한 공급자·해제 가능 여부를 반환한다. 외부 subject·access/refresh token·클라이언트 비밀·인증 설정 URL은 제외한다.
- `DELETE /api/v1/me/sso-accounts/{id}`: `updatedAt`과 `confirm=true`, 현재 회사·본인 권한, 로그인 후 5분 이내 여부, 다른 사용 가능한 로그인 수단을 검사한다. 비밀번호가 없어도 다른 활성 SSO 연결이 있으면 해제할 수 있다.
- 비밀번호 변경과 같은 사용자별 잠금→회사 정렬 잠금→사용자/세션 검증 순서를 적용했다. 계정 제거·모든 본인 세션 삭제·본인 인증 proof 제거·연결 대기 state의 FK 삭제·감사 기록을 같은 트랜잭션에서 처리한다. 응답에서 세션/2FA 쿠키도 만료시킨다.
- 다른 로그인 수단은 비어 있지 않은 비밀번호 credential 또는 활성 회사의 직접 소속과 enabled/preflightOk 공급자에 연결된 계정이다. 실제 공급자의 순간적인 가용성을 보장한다는 의미는 아니다.
- 공통 인증 라이브러리의 `/unlink-account`, `/list-accounts`를 제한해 회사 범위·감사·해제 검사를 우회하지 못하게 했다.
- 계정 연결 시작과 콜백도 최근 5분 로그인을 요구한다. 세션 활동으로 갱신되는 updatedAt을 재인증 시각으로 사용하지 않는다. 연결 성공 시 `/link/oauth2/verified`로 이동하고 2FA 분기에서도 같은 복귀 경로를 사용한다.
- `/link/oauth2`, `/link/oauth2/verified`에 본인 계정 목록·공급자 선택·연결 시작·해제 확인·실패/충돌/재로그인 상태를 연결했다. 프로필의 로그인 보안 영역에 진입 링크를 추가했다.

5분 확인과 전체 세션 종료는 이번 독립 구현의 보안 규칙이며 원본 사이트와 같은 규칙이라고 확인한 것은 아니다. 해제 화면은 전체 세션 종료와 다른 수단으로 재로그인해야 함을 명시한다.

## 검증

| 항목 | 결과 | 근거 |
|---|---|---|
| SSO/OIDC/SAML/복구 + 새 계정 관리 | 147개 통과, 이번 신규 17개 | [tests-final.log](tests-final.log) |
| 인증·감사·MFA 회귀 | 70개 통과 | [auth-regression.log](auth-regression.log) |
| 타입 | 성공 | [typecheck.log](typecheck.log), 최종 타입 포함 [build.log](build.log) |
| 변경 린트 | 오류0·기존 img 경고4 | [lint.log](lint.log), 후속 DTO/QA [lint-final.log](lint-final.log) |
| production build | 성공 | [build.log](build.log) |
| 계약 | 292 경로·421 작업·39 정책, 미매핑0 | [contracts.log](contracts.log) |
| 실제 HTTP | 13개 통과 | [http.json](http.json), [http.log](http.log) |
| 서버 재시작 후 HTTP | 3개 통과 | [http-restart.json](http-restart.json), [http-restart.log](http-restart.log) |
| 소스 체크포인트 | 15파일 SHA-256 | [source-hashes.json](source-hashes.json) |

PostgreSQL 테스트는 격리 `catchsecu_test`에서 순차 실행했다. 다른 사용자/회사, 오래된 로그인, 버전 충돌, 마지막 수단, 비활성 대체 공급자, 소속 회수, 오래된 Context, 확인 누락/CSRF, 동시 해제, 일반 unlink 우회, 감사 실패 롤백을 포함한다. 감사 실패 시험은 주입 지점 도달 여부도 검사해 다른 500을 성공으로 오인하지 않는다.

초기 실행은 테스트가 진행되는 중 DTO를 공통 계약으로 옮겨 모듈 캐시가 이전 정의를 참조했고 8개가 실패했다. 해당 기록 [tests.log](tests.log)를 보존했다. 소스를 고정하고 재실행한 최종 147개는 모두 통과했다. pg query deprecation 경고는 남아 있다.

HTTP는 전용 QA 서버 3161에서 PID 32044→32765로 재시작했다. 기존 QA 사용자의 비밀번호 로그인→실제 서명된 SAML 계정 연결→목록→일반 API 우회 거부→오래된 버전409→정상 해제→기존 세션401→비밀번호 재로그인·조회→로그아웃을 확인했다. 이번 실행에서 새로 만든 연결만 해제했다. 기존 provider와 기존 계정의 해시를 전후·재시작 후 대조했다. 최종 QA 세션은0이며 사용자 서버3100·전역worker는 변경하지 않았다. 신규 migration은 없다.

OpenAPI와 작업별 정책 매트릭스를 갱신했다. 공통 계약 검사 보고서도 현재 수치로 갱신했으며 이전 보고서는 [contract-check-before.json](contract-check-before.json)에 보존했다.

### 실행 명령

지원 Node24 런타임을 사용한다. 최초 HTTP 스크립트는 기존 증거가 있으면 거부한다. 비공개 fixture·인증서·키를 로그나 보고서에 포함하지 않는다.

```sh
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/sso.test.ts tests/server/sso-saml.test.ts tests/server/sso-recovery.test.ts
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/auth-mutations-audit.test.ts tests/server/auth-public-audit.test.ts tests/server/mfa-policy.test.ts
node node_modules/typescript/bin/tsc --noEmit -p .local/qa-sso-accounts-20261006-tsconfig.json
ALLOW_LOCAL_MAIL=1 ALLOW_LOCAL_KAKAO=1 CATCHSECU_BUILD_DIR=.local/qa-sso-accounts-20261006-build CATCHSECU_TSCONFIG=.local/qa-sso-accounts-20261006-tsconfig.json node node_modules/next/dist/bin/next build
QA_SSO_BASE=http://127.0.0.1:3161 node --env-file=.env.local --import tsx scripts/qa-sso-accounts.ts
QA_SSO_BASE=http://127.0.0.1:3161 node --env-file=.env.local --import tsx scripts/qa-sso-accounts.ts --verify-restart
python3 scripts/verify-contracts.py
```

## 남은 작업

- 실제 브라우저의 입력·선택·확인/취소·오류 복구·모바일은 이번에 수행하지 않았다. HTTP 페이지200/제목 확인을 브라우저 상호작용 검증으로 계산하지 않는다. Ego 공간 복구 관련 사용자 응답 대기는 유지한다.
- 기존 초대 화면의 토큰 검증에서 SSO 초대가입으로 이어지는 진입·수락 UI와 실제 외부 IdP 전체 수용은 남아 있다.
- 공급자 관리의 삭제는 현재 provider 행만 제거한다. Account.providerId가 문자열이므로 연결 계정의 참조·정리·사용자 잠금 방지 정책을 다음에 보완해야 한다. 현재 본인 목록은 존재하는 회사 공급자를 기준으로 하므로 삭제된 공급자의 고아 연결을 표시하지 못한다. 이를 완료된 관리 기능으로 간주하지 않는다.
- 공급자 비활성화·인증서 교체와 기존 인증/연결 수명주기, 기존 migration 4건 불일치도 별도 확인이 남는다.
