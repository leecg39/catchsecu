# P11-T03 — 전문가 이력이 있는 구성원의 SSO 재초대

2026-10-06. SSO 재초대의 전문가 배정 정리를 이메일 초대 수락과 일치시켰다. P11-T03은 진행 중이며 전체 완료17·진행41·계획14를 유지한다.

## 확인한 결함과 수정

회수된 전문가 소속을 초대로 다시 활성화할 때 이메일 수락은 기존 ExpertAssignment를 종료했지만 SSO 수락은 Membership만 직접 소속으로 바꿨다. 이전 배정은 active/version1로 남았다. 활성·기한 만료·동시 수락에서 이 불일치를 [3개 실패](baseline.log)로 재현했다.

- 두 초대 수락 경로가 `revokeInvitedExpert`를 호출한다. 동일 회사·동일 사용자·기존 배정 ID가 일치하는 active 배정만 revoked로 바꾸고 종료 시각/버전을 기록한다.
- `expert.revoked`와 `invitation.accepted` 감사는 같은 수락 트랜잭션에 저장한다. 새 소속·서비스 권한·초대 수락·세션 생성 중 실패하면 배정 종료도 롤백된다.
- 이미 종료된 배정의 시각/버전은 유지하며 다른 회사의 배정은 변경하지 않는다. 이전 ExpertAssignmentService는 이력으로 보존하고 실제 ServiceGrant는 새 초대의 범위로 교체한다.
- 활성 전문가 소속을 초대로 덮어쓰지 않는다. 두 SSO 요청이 동시에 수락해도 한 번만 배정을 종료하고 세션을 발급한다.

DB schema/migration 및 API 입력·응답 형식 변경은 없다. 원래 전체 수용 조건을 축소하지 않았다.

## 검증

| 범위 | 결과 | 근거 |
|---|---|---|
| 결함 재현 | 신규6개 중3실패·3통과 | [baseline.log](baseline.log) |
| SSO·SAML·이메일 초대·전문가 배정/현재 권한 | 5파일174개 통과 | [tests.log](tests.log) |
| 타입 | 최종 통과 | [typecheck-final.log](typecheck-final.log) |
| 변경 린트 | 최종 오류0·경고0 | [lint-final.log](lint-final.log), [HTTP 스크립트 최종](lint-http-final.log) |
| Production build | 성공 | [build.log](build.log) |
| 기존 계약 정합성 | 298경로426작업42정책, 통과 | [contracts.log](contracts.log) |
| 실제 HTTP 최종 확인 | 8개 통과 | [http.json](http.json), [http.log](http.log) |
| 동일 빌드 재시작 후 확인 | 3개 통과 | [http-restart.json](http-restart.json), [http-restart.log](http-restart.log) |
| 소스 식별 | SHA-256 | [source-hashes.json](source-hashes.json) |

신규 검증7개는 SSO의 active/expired/revoked 배정·감사 롤백·활성 소속 보호·동시 수락6개와 이메일 경로1개다. 다른 회사 배정/이전 이력/서비스 권한·전문가 목록의 회수 표시도 검사한다. PostgreSQL 테스트는 격리 catchsecu_test에서 순차 실행했다. 기존 pg query deprecation 경고는 남아 있다.

처음 테스트 fixture가 중첩 관계 생성에 불필요한 tenantId를 넣어 준비 단계에서 실패한 기록은 [baseline-fixture-failed.log](baseline-fixture-failed.log)에 보존했다. 이를 수정한 뒤의 baseline이 실제 결함 재현이다.

### 실제 HTTP 범위와 실패 후 확인

QA3165에서 소유자로 새 서비스·초대를 API로 생성했다. 과거 상태 재현을 위해 전용 QA 사용자/SSO 신원·회수된 전문가 소속·활성 배정·이전 범위는 DB fixture로 준비했다. 이 준비는 전문가 배정 생성 UI 검증을 의미하지 않는다.

실제 서명된 SAML 초대 콜백으로 직접 소속 전환과 배정 종료가 이뤄졌다. 이후 이전 서비스 접근의 실제 응답403을 스크립트가404로 기대해 중단됐다. [실패 로그](http-expected-status-failed.log)를 보존했다. 보호 API는 접근을 차단한 상태였으며 제품 코드 수정은 필요하지 않았다.

기존 준비 데이터를 중복 생성하지 않고 `--resume-prepared`로 이어서 검사했다. 배정 revoked/version2·직접 editor 소속·정확히1개 새 서비스 권한·수락/회수 감사 각1개를 확인하고 중단 당시의 전용 QA 세션1개를 정리했다. 실제 SAML 재로그인→본인 정보→전문가 목록 revoked/canSelect=false→새 서비스200→이전 서비스403→콜백 재사용401→로그아웃까지8개를 통과했다. 첫 중단 실행의 요청 수를 최종8개에 합산하지 않았다.

동일 빌드 PID12489→13575 재시작 후 DB 상태·서비스 범위 유지와 소유자 로그인/구성원 조회/로그아웃3개를 확인했다. 원래 공급자/소유자의 연결 계정 해시가 이전 provider-reference 증거와도 일치했다. 검증용 소유자·새 구성원 세션은0개다. 새 QA 사용자·배정 이력·초대·서비스는 재시작 증거로 남겼다. 사용자 앱3100과 전역worker는 변경하지 않았다. 이전 단계의 전용 QA3164만 종료했다.

## 실행 명령

Node24 런타임을 사용했다.

```sh
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/sso.test.ts tests/server/sso-saml.test.ts tests/server/invitation-current-authority.test.ts tests/server/expert-assignments.test.ts tests/server/expert-current-authority.test.ts
node node_modules/typescript/bin/tsc --noEmit --project .local/qa-sso-expert-reinvitation-20261006-tsconfig.json
python3 scripts/verify-contracts.py
```

빌드: `.local/qa-sso-expert-reinvitation-20261006-build`, 해당 tsconfig와 ALLOW_LOCAL_MAIL=1/ALLOW_LOCAL_KAKAO=1. 실제 서버는 APP_PORT3165, BETTER_AUTH_URL 루프백이다. HTTP 스크립트는 `scripts/qa-sso-expert-reinvitation.ts`와 `--resume-prepared`, `--verify-restart`를 사용했다. marker `.local/qa-sso-expert-reinvitation.json`은 complete이며 최초 실행/준비 복구를 반복하지 않는다. 실제 외부 메일·IdP 인증은 수행하지 않았다.

## 남은 수용

- 공급자 비활성화·인증서/키 교체가 대기 인증·기존 세션·마지막 로그인 수단에 미치는 정책의 검증/보완.
- 브라우저에서 초대·SSO·2FA·연결 관리·오류 복구·모바일 동작의 전체 수용.
- 외부 OIDC/SAML IdP 시험. [외부 준비 보고서](../../../../../outputs/external-auth-requirements/external-auth-requirements.md).
- 기존 migration 체크섬4건과 운영 갱신/복원 검증은 별도 잔여다.

Ego 작업 공간 복구 응답 대기는 유지한다. [skill](/Users/user01/.agents/skills/ego-browser/SKILL.md)의 “Never use a new TaskSpace to recover … stop and ask the user”에 따라 공간을 임의 생성하지 않았다. 이번 서버/HTTP 결과로 브라우저 수용을 완료 처리하지 않는다.
