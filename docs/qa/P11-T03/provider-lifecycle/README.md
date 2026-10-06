# P11-T03 — 사용 중지·인증 정보 교체와 로그인 수단 보호

2026-10-06. 내부 구현·검증을 우선한다는 사용자 요청에 따라 외부 계정/승인/실제 외부 연동 시험은 대기한다. 전체 Task 상태는 완료17·진행41·계획14다.

## 구현과 동작 규칙

삭제에만 적용되던 마지막 로그인 수단 보호를 사용 중 공급자의 수동 비활성화·시크릿/스코프/인증서 변경에도 적용했다. 수정 전에는 유일한 SSO를 사용 중지하거나 인증 정보를 교체해 비활성화할 수 있었다. [3개 실패로 재현](baseline.log)했다.

- `assertProviderCanStop`를 수정/삭제가 공유한다. 활성 직접 소속 구성원 각각의 다른 사용 가능한 로그인 수단을 확인한다. 같은 공급자의 계정 여러 개는 대체 수단으로 세지 않는다.
- 공급자 PATCH에도 SERIALIZABLE과 회사/공급자/사용자 잠금을 사용한다. 회사가 달라도 공통 구성원의 마지막 수단을 동시에 없애지 못한다. 직렬화/데드락/잠금 시간 초과는409 CONCURRENT_CHANGE로 안내한다.
- 이름만 수정하면 기존 사용 상태를 유지한다. 시크릿/스코프/인증서 변경은 비활성화·사전검사 초기화 후 검사 성공과 명시적인 재활성화를 요구한다.
- 사용 중지/교체는 새 로그인과 이전 version의 진행 중 인증을 막고 기존 앱 세션은 유지한다. 계정·세션 전체 정리는 공급자 삭제/연결 해제의 별도 동작이다. UI의 중지 확인창·수정 안내·완료 메시지에 이 차이를 명시했다.
- 사전검사 자체가 실패한 공급자는 대체 수단 유무와 무관하게 비활성화한다. 검증에 실패한 인증서를 계속 신뢰하는 상태로 되돌리지 않는다. 기존 앱 세션은 유지돼 관리자가 복구할 수 있다.
- 변경과 감사 기록은 한 트랜잭션이며 감사 실패 시 활성 상태·버전·계정·세션이 보존된다.

위는 독립 구현의 동작 규칙이다. 원본 서비스의 내부 정책을 확인했다는 의미는 아니다. DB schema/migration과 응답 DTO 변경은 없다. OpenAPI 및 정책 문구를 실제 동작에 맞췄다.

## 검증 결과

| 범위 | 결과 | 근거 |
|---|---|---|
| 넓은 SSO/SAML/복구/DB참조/계약 회귀 | 205개 중203통과·기대값2개 실패 | [tests.log](tests.log) |
| 기대값 보완 후 중지/교체/동시성/계약 재검증 | 15개 통과; 나머지144개는 해당 실행에서 선택 제외 | [tests-final.log](tests-final.log) |
| TypeScript | 통과 | [typecheck.log](typecheck.log) |
| 변경 린트 | 오류0·기존 경고1 | [lint-final.log](lint-final.log) |
| Production build | 성공 | [build.log](build.log) |
| API 선언 정합성 | 298경로426작업42정책, 통과 | [contracts.log](contracts.log) |
| 실제 로컬 HTTP | 20개 통과 | [http.json](http.json), [http.log](http.log) |
| 동일 빌드 재시작 후 HTTP | 3개 통과 | [http-restart.json](http-restart.json), [http-restart.log](http-restart.log) |
| 소스 식별 | SHA-256 | [source-hashes.json](source-hashes.json) |

두 기대값 실패는 같은 version 동시 수정에서 SERIALIZABLE의409 CONCURRENT_CHANGE가 반환된 점과 PEM 입력의 끝 개행이 기존 입력 스키마에서 trim된 점이다. 한 번만 변경·409 거부·동일 인증서 보존이라는 조건은 유지하면서 기대값을 수정했다. 실패2개는 재검증15개에 포함돼 통과했다. 203+15는 중복 범위가 있으므로 전체218개로 합산하지 않는다. 기존 pg query deprecation 경고는 남아 있다.

새로운 검증9개는 중지/시크릿/스코프 마지막 수단 보호3개, 회사 간 동시 중지, 표시 이름 변경, 대기 callback/신규 로그인 차단과 기존 세션 유지, 검사 실패 시 비활성화, 감사 롤백, 실제 다른 SAML 인증서 교체 보호다. PostgreSQL 테스트는 catchsecu_test에서 순차 실행했다. 기존 MFA version 재검사도 넓은 회귀에 포함됐다.

린트 경고1개는 기존 삭제 후 본인 세션이 끝났을 때 `window.location.assign`으로 전체 페이지를 갱신하는 코드다. 변경한 중지 안내에서 발생한 새 경고가 아니다.

## 실제 HTTP 범위

QA3166에서 새 SAML 공급자 생성·활성화 후 전용 SSO-only 사용자/구성원/계정을 DB fixture로 준비했다. 그 구성원이 활성 상태일 때 수동 중지·시크릿·다른 실제 인증서 교체가 모두409로 거부되고 버전이 보존됐다.

해당 전용 구성원만 API로 회수한 뒤 대기 연결 인증을 시작했다. 공급자 중지→새 로그인404→이전 callback409→기존 세션의 /me200을 확인했다. 새 X.509 인증서 저장→사전검사 전 활성화409→검사 성공→명시적 활성화→새 개인키로 서명한 SAML 연결302→/me200이 통과했다. 마지막 공급자 삭제로 이번 계정2·세션2를 정리했다.

동일 빌드 PID19218→19462 재시작 뒤 삭제 상태와 기존 provider/account 해시가 유지됐다. 최종 QA 세션0이며 임시 공급자는 삭제됐다. 새 QA 사용자의 회수된 구성원 이력은 보존했다. 기존 공급자와 계정은 변경하지 않았다. 사용자 앱3100·전역worker는 유지했고 이전 전용 QA3165만 종료했다.

HTTP 스크립트는 `scripts/qa-sso-provider-lifecycle.ts`, 완료 marker는 `.local/qa-sso-provider-lifecycle.json`이다. 최초 실행은 반복하지 않는다. 자체 생성 키는 `.local`에 저장했고 증거에 개인키·자격증명 원문을 넣지 않았다. 실제 외부 공급자에 인증하거나 발송하지 않았다.

## 재현 명령

Node24를 사용한다.

```sh
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/sso.test.ts tests/server/sso-saml.test.ts tests/server/sso-recovery.test.ts tests/server/sso-provider-reference.test.ts tests/server/sso-contracts.test.ts
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/sso.test.ts tests/server/sso-saml.test.ts tests/server/sso-contracts.test.ts -t 'P11 공급자 중지|SAML 인증서 교체|같은 version 동시 변경|SSO 계약'
node node_modules/typescript/bin/tsc --noEmit --project .local/qa-sso-provider-lifecycle-20261006-tsconfig.json
python3 scripts/verify-contracts.py
```

빌드 디렉터리 `.local/qa-sso-provider-lifecycle-20261006-build`, 같은 이름의 tsconfig를 사용했다. ALLOW_LOCAL_MAIL=1/ALLOW_LOCAL_KAKAO=1, APP_PORT3166, BETTER_AUTH_URL 루프백이다. 실제 HTTP 후 `--verify-restart`로 재시작을 검사했다.

## 잔여

관리 확인창·초대·연결·오류 복구·MFA의 최신 브라우저 전체 수용, 외부 IdP 수용, 기존 migration 체크섬4건은 남아 있다. 다음 내부 점검은 migration 이력/DDL 대조와 나머지 모듈 통합 검증이다. [외부 의존 항목](../../../../../outputs/external-auth-requirements/external-auth-requirements.md)은 별도로 대기한다.

Ego 작업 공간 복구 응답 대기는 유지한다. [skill](/Users/user01/.agents/skills/ego-browser/SKILL.md)의 “Never use a new TaskSpace to recover … stop and ask the user”에 따라 임의 새 공간을 만들지 않았다. 다음 브라우저 재개 시에는 현재 사용 가능한 공간부터 다시 확인한다.
