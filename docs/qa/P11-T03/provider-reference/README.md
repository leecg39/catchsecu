# P11-T03 — 공급자 DB 참조와 실제 API 계약

2026-10-06. 공급자 연결 무결성과 계약 정합성을 보완했다. P11-T03은 진행 중이며 전체 완료17·진행41·계획14를 유지한다.

## 구현과 이유

기존 `Account.providerId` 문자열만으로는 존재하지 않는 공급자의 연결을 만들거나 연결된 공급자를 직접 삭제할 수 있었다. 두 실패 조건을 [baseline.log](baseline.log)로 재현했다.

- `Account.ssoProviderId`와 SsoProvider FK를 추가했다. DB BEFORE 트리거가 기존 `providerId=sso:<id>`에서 참조를 채우므로 Better Auth·이전 앱의 쓰기·직접 SQL에도 같은 규칙이 적용된다. CHECK는 두 표현의 일치를 강제한다. 비 SSO 계정은 NULL이다.
- FK RESTRICT가 고아 계정 생성·잘못된 공급자 변경·연결 중 공급자 삭제/ID 변경을 막는다. 정상 삭제 API는 기존의 마지막 로그인 수단 보호와 연결/세션/인증/감사 원자 정리를 거친다. 조회·해제·대체 로그인 판단·공급자 삭제가 명시적 관계를 사용한다.
- Migration은 기존 유효 참조를 채운다. 고아 계정이 발견되면 전체를 롤백하고 기존 행을 보존한다. 자동으로 고아 계정을 삭제하지 않는다.
- 공급자 삭제의 PostgreSQL 잠금 오류는 Prisma adapter의 중첩 SQLSTATE까지 읽어409 CONCURRENT_CHANGE로 응답한다. 실제 잠금을 잡은 테스트로 응답과 행/감사 보존을 확인했다.
- 실제 SSO Route Handler12개와 OpenAPI의 경로/메서드를 대조했다. 관리 CRUD/사전검사, 인증 시작/OIDC callback/SAML ACS, 본인 연결 목록/해제, 초대 공급자 조회/시작을 선언했다. 관리 응답의 비밀정보 제외, 302 성공/HTML303 실패/JSON 오류, SAML form과 Origin 예외, 초대 POST Origin 조건을 명시했다.
- 초기 `/identity-providers` 계획을 실제 `/security/sso` 계약으로 교체했다. 181경로 중 P11-T03의11개와 R161의 모델·API를 갱신했다. SAML 결과는 callback 리디렉션과 세션으로 확인하며 전체 화면/외부 IdP 수용 조건은 유지한다.

PostgreSQL의 [BEFORE 트리거](https://www.postgresql.org/docs/17/trigger-definition.html)와 [참조 제약](https://www.postgresql.org/docs/17/sql-createtable.html)을 사용했다.

## 검증 결과

| 범위 | 결과 | 근거 |
|---|---|---|
| 관련 SSO·SAML·초대·인증·MFA·DB/계약 | 9파일268개 통과 | [tests-final.log](tests-final.log) |
| 실제 생성 응답의 계약 보완 후 재검증 | 2파일5개 통과, 그 실행에서106개 선택 제외 | [contracts-regression.log](contracts-regression.log) |
| TypeScript / 변경 린트 | 최종 오류0 | [typecheck-final.log](typecheck-final.log), [lint-final.log](lint-final.log), [기존 변경 검사](lint.log) |
| Production build | 최종 성공 | [build-final.log](build-final.log) |
| OpenAPI 선언 정합성 | 298경로426작업42정책, 구현390/계획36 | [contracts-final.log](contracts-final.log) |
| 빈 DB 설치 | migration95개, 체크섬 일치 | [fresh-install.log](fresh-install.log), [상세 결과](migration-verification.json) |
| 기존 개발 DB 갱신 | migration95개; 비교 대상 기존7종 행 보존; SSO계정2/잘못된 참조0 | [dev-upgrade.log](dev-upgrade.log), [상세 결과](migration-verification.json) |
| Migration 방어 조건 | 고아 행이 있으면 전체 롤백; 유효 기존 참조 채움 | [상세 결과](migration-verification.json) |
| 실제 HTTP | 14개 통과 | [http.json](http.json), [http.log](http.log) |
| 동일 빌드 재시작 후 HTTP | 3개 통과 | [http-restart.json](http-restart.json), [http-restart.log](http-restart.log) |
| 소스 식별 | SHA-256 기록 | [source-hashes.json](source-hashes.json) |

268개와 재실행5개는 중복 범위가 있어 합산하지 않는다. DB 테스트는 catchsecu_test에서 순차 실행했다. 신규 참조 테스트7개는 missing provider·직접 삭제·참조 위조·비SSO·ID변경·정상 삭제·실제 INSERT/DELETE 경합을 검증한다. 기존 pg query deprecation 경고는 남아 있다. 계약 검사의 구현390 표시는 선언 상태이며 전체390개 실제 동작을 이번에 시험했다는 뜻이 아니다.

기존 개발 DB의 migration 체크섬4건 불일치는 남아 있어 migration 검증 명령 전체 종료코드는1이다. 이번 신규 migration은 일치하고 행 보존·빈 설치는 통과했다. 기존 SQL/적용 이력을 고쳐 일치한 것처럼 처리하지 않았다. P01-T01/P14-T04 후속 조사 대상으로 유지한다.

### 실제 HTTP와 실패 기록

전용 QA 앱3164에서 새 SAML 공급자 생성→활성화→목록 응답 검사→서명된 SAML 연결→DB 파생 참조/본인 목록 확인→대기 로그인→오래된 version409→공급자 삭제→기존 세션401→비밀번호 재로그인/조회/로그아웃을 확인했다. 생성·변경·목록·본인 목록 응답을 실제 스키마로 파싱했다. 공급자1·연결1·세션2가 정리됐고 동일 요청의 관련 감사4건을 확인했다. PID99393→191 재시작 이후 삭제 상태와 기존 provider/account 해시가 유지됐다. 최종 QA 세션0. 사용자 앱3100과 전역worker는 변경하지 않았다.

처음 HTTP에서 생성 응답에 실제로 포함된 `preflight`를 계약이 누락한 것을 발견했다. [실패 로그](http-contract-failed.log)를 보존하고 생성/사전검사 응답 스키마를 통일했다. 그 실행의 새 임시 공급자를 API로 삭제하고 전용 QA 세션을 정리한 [기록](http-failed-cleanup.json)이 있다. 수정한 실제 CRUD 회귀와 최종 HTTP가 통과했다.

처음 넓은 회귀의1개 실패는 PostgreSQL55P03 오류의 중첩 위치를 잘못 기대한 테스트였다. [tests.log](tests.log)를 보존했고 올바른 adapter 오류 형태를 검사하도록 고쳤다. 이 확인을 계기로 API의 잠금 오류 처리도 함께 보완했다.

## 재현 명령

Node24 런타임을 PATH 앞에 놓고 실행했다. 비밀 설정 원문은 기록하지 않는다.

```sh
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/sso-provider-reference.test.ts tests/server/sso-contracts.test.ts tests/server/sso.test.ts tests/server/sso-saml.test.ts tests/server/sso-recovery.test.ts tests/server/invitation-current-authority.test.ts tests/server/auth-mutations-audit.test.ts tests/server/auth-public-audit.test.ts tests/server/mfa-policy.test.ts
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/sso-contracts.test.ts tests/server/sso.test.ts -t 'SSO 계약|SSO 제공자 CRUD'
node --env-file=.env.local --import tsx scripts/generate-openapi.ts
python3 scripts/verify-contracts.py
node node_modules/typescript/bin/tsc --noEmit --project .local/qa-sso-provider-reference-20261006-tsconfig.json
```

빌드 설정은 `CATCHSECU_BUILD_DIR=.local/qa-sso-provider-reference-20261006-build`, `CATCHSECU_TSCONFIG=.local/qa-sso-provider-reference-20261006-tsconfig.json`, `ALLOW_LOCAL_MAIL=1 ALLOW_LOCAL_KAKAO=1`이다. QA는 해당 빌드를 APP_PORT3164/BETTER_AUTH_URL루프백으로 실행했다. HTTP 증거 생성기는 `scripts/qa-sso-provider-reference.ts`와 `--verify-restart`다. `.local/qa-sso-provider-reference.json`은 complete이므로 최초 실행을 반복하지 않는다. 새로운 시험은 별도 실행 기록과 QA 행으로 준비한다.

## 남은 수용

- 공급자 비활성화·인증서/키 교체 때 현재/대기 로그인과 마지막 수단의 정책을 일관되게 적용하는지 점검·보완.
- 전문가 배정 이력이 있는 구성원을 SSO로 재초대할 때 기존 배정 정리를 이메일 초대 수락과 일치시키는지 점검.
- 실제 브라우저에서 관리·로그인·연결/해제·초대·실패/재시작·MFA·모바일 전체 흐름 검증.
- 외부 IdP의 실제 SSO와 회수·키 교체 검증. [외부 준비 보고서](../../../../../outputs/external-auth-requirements/external-auth-requirements.md).
- 기존 migration 체크섬4건 조사와 운영 갱신/복구 검증.

Ego 작업 공간45가 없어 복구 승인을 기다리는 상태다. 해당 skill의 “Never use a new TaskSpace to recover … stop and ask the user”에 따라 새 공간을 임의 생성하지 않았다. [규칙](/Users/user01/.agents/skills/ego-browser/SKILL.md). 브라우저 검증을 이번 HTTP 결과로 대신 완료 처리하지 않는다.
