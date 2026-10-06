# P11-T03 — 공급자 삭제와 연결 수명주기

2026-10-06. P11-T03 진행 중, 공식 완료17·진행41·계획14 유지.

## 구현

- 기존 삭제는 SsoProvider 행만 제거해 문자열 providerId를 사용하는 Account가 남을 수 있었다. 현재 DELETE는 공급자의 모든 연결 계정을 제거하고, 영향받는 사용자의 모든 세션·본인 ID에 연결된 인증 proof·대기 계정 연결 state와 해당 공급자의 로그인 state를 함께 정리한다.
- 활성 직접 소속 구성원이 다른 로그인 수단을 갖고 있는지 검사한다. 같은 공급자에 연결된 여러 Account는 하나의 공급자 수단이므로 모두 제외하고 판단한다. 비어 있지 않은 비밀번호 또는 다른 활성 회사/직접 소속의 enabled·preflightOk SSO를 대체 수단으로 인정한다. 회수된 소속의 이미 사용 불가능한 연결은 정리할 수 있다.
- 최상위 관리자 현재 권한·회사·정책·세션·설정 version을 재검사하며, 최근5분 로그인도 요구한다.
- SERIALIZABLE 트랜잭션과 회사/provider/사용자 잠금을 사용한다. 동시 변경·직렬화 실패·데드락·잠금 대기는409 재시도 안내로 변환한다. 연결 제거·세션 종료·공급자 삭제의 감사 기록은 동일 requestId와 같은 트랜잭션에 저장한다.
- 삭제 확인창에서 연결 계정 제거와 구성원의 모든 기기 로그인 종료를 설명한다. 삭제한 연결에 관리자 본인도 포함되면 로그인 페이지를 새로 연다. 최근 로그인 오류에는 재로그인 진입을 제공한다.
- 이미 검증을 시작한 콜백도 최종 provider 조회에서 삭제를 확인하면 계정/세션을 복원하지 않는다.

DB schema 변경은 없다. 인증을 끝내는 데 필요한 사용자 proof를 제거하며, 별도로 암호화된 만료 바인딩 행까지 전부 물리 삭제했다는 의미는 아니다. 삭제된 계정/provider를 참조하는 바인딩은 인증 검사를 통과하지 못한다.

## 검증

| 검사 | 결과 | 근거 |
|---|---|---|
| SSO/OIDC/SAML/복구/연결 관리 | 3파일154개 통과 | [tests.log](tests.log) |
| 다른 회사의 공급자 동시 삭제 | 추가1개 통과, 나머지82개는 이 실행에서 선택 제외 | [cross-company.log](cross-company.log) |
| TypeScript | 성공 | [typecheck.log](typecheck.log) |
| 변경 린트 | 오류0·경고1 | [lint.log](lint.log), [최종 테스트 린트](lint-tests-final.log) |
| production build | 성공 | [build.log](build.log) |
| 기존 선언 계약 검사 | 통과 | [contracts.log](contracts.log) |
| 개발 DB 기존 고아 연결 조사 | SSO Account1개, 고아0개 | [existing-accounts.json](existing-accounts.json) |
| 실제 HTTP | 12개 통과 | [http.json](http.json), [http.log](http.log) |
| 동일 빌드 재시작 후 HTTP | 3개 통과 | [http-restart.json](http-restart.json), [http-restart.log](http-restart.log) |
| 소스 | 6파일 SHA-256 | [source-hashes.json](source-hashes.json) |

이번 신규 검증은8개이며 전체 관련155개가 통과했다. 마지막 로그인 수단·동일 provider 중복계정·회수된 소속·감사 롤백·최근 로그인/버전·진행 중 콜백·같은 회사 및 다른 회사의 동시 삭제를 포함한다. PostgreSQL 테스트는 격리 catchsecu_test에서 순차 실행했다. 기존 pg query deprecation 경고는 남는다.

린트 경고1개는 Next의 내부 이동에 window.location.assign 대신 router를 권장하는 항목이다. 현재 삭제로 관리자의 인증도 종료된 경우 클라이언트 상태를 버리는 전체 페이지 이동을 사용한다. 오류는0이다.

계약 검사는 등록된292경로·421작업·39정책의 정합성 검사다. 실제 모든 SSO Route Handler가 OpenAPI에 등록되었다는 검증은 아니며, 원래 identity-providers 계획과 실제 security/sso·auth/sso 경로의 계약 정리는 후속 수용에 남는다.

실제 HTTP는3162에서 PID40252→41074로 재시작했다. 전용 QA 사용자로 새 SAML 공급자 생성→사전검사 결과 확인→활성화→실제 서명된 SAML 연결→대기 로그인→오래된 버전409→삭제→기존 세션401→비밀번호 재로그인/조회/로그아웃을 검증했다. 공급자1개·연결1개·세션2개가 제거됐고 같은 요청의 감사4건을 확인했다. 재시작 후 삭제 상태가 유지되고 기존 provider/account 해시는 동일했다. 최종 QA 세션0, 기존 연결 보존. 사용자3100·전역worker는 변경하지 않았다.

### 실행 명령

지원 Node24 런타임으로 실행한다. HTTP 최초 실행은 기존 증거 또는 이전 실행 표식이 있으면 거부한다. `.local/qa-sso-provider-removal.json`은 현재 complete이며 최초 실행을 반복하지 않는다.

```sh
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/sso.test.ts tests/server/sso-saml.test.ts tests/server/sso-recovery.test.ts
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/sso.test.ts -t '다른 회사의 두 공급자'
node node_modules/typescript/bin/tsc --noEmit -p .local/qa-sso-provider-removal-20261006-tsconfig.json
ALLOW_LOCAL_MAIL=1 ALLOW_LOCAL_KAKAO=1 CATCHSECU_BUILD_DIR=.local/qa-sso-provider-removal-20261006-build CATCHSECU_TSCONFIG=.local/qa-sso-provider-removal-20261006-tsconfig.json node node_modules/next/dist/bin/next build
QA_SSO_BASE=http://127.0.0.1:3162 node --env-file=.env.local --import tsx scripts/qa-sso-provider-removal.ts
QA_SSO_BASE=http://127.0.0.1:3162 node --env-file=.env.local --import tsx scripts/qa-sso-provider-removal.ts --verify-restart
```

## 남은 수용

- 실제 브라우저 확인창·재로그인·오류 복구·모바일 검증은 수행하지 않았다. Ego 공간 복구 사용자 응답 대기는 유지한다. HTTP를 실제 브라우저 검증으로 계산하지 않는다.
- 초대 토큰에서 SSO 초대가입으로 이어지는 UI, 외부 IdP 수용, 비활성화·인증서 교체의 전체 상태 전이 검증은 남는다.
- Account.providerId는 Better Auth의 문자열 필드다. 현재 애플리케이션 삭제 경로는 연결을 정리하지만 DB 직접 삭제까지 막는 SSO FK/참조 모델은 후속 검토가 필요하다. 기존 고아 데이터는 이번 개발 DB 조사에서0개였다.
- 기존 migration4개 체크섬 불일치는 해결하지 않았으며 이력을 덮어쓰지 않았다.
