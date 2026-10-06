# P11-T03 — 토큰 기반 초대 SSO 진입과 수락

작성일: 2026-10-06. 공식 상태는 진행 중이며 전체 집계는 완료 17 / 진행 중 41 / 계획 14를 유지한다.

## 변경한 동작

- `/oauth2/invite/signup?token=...`에서 이메일 로그인/가입과 회사 SSO 선택을 제공한다. 기존 이메일 계정은 로그인 후 수락하고 명시적으로 SSO를 연결한다. 이메일 주장만으로 기존 계정을 자동 연결하지 않는다.
- `POST /api/v1/invitations/sso/options`: 43자 bearer token으로 유효한 초대를 확인하고 같은 회사의 활성·사전검사 통과 공급자 `id/name/protocol`만 반환한다. 이메일·역할·token/hash·공급자 비밀 설정은 반환하지 않는다.
- `POST /api/v1/invitations/sso/start`: token/providerId를 본문으로 받아 IdP redirect를 반환한다. 같은 Origin·회사·IP·초대 상태와 공급자를 검사한다. 토큰은 IdP URL에 포함하지 않는다.
- 기존 `GET /auth/sso/{providerId}?mode=invite&invitation={id}`는 422로 거부한다. GET은 login/link에만 사용한다.
- `SsoState.invitationVersion/invitationTokenHash`를 추가했다. 콜백은 현재 초대의 버전·해시와 비교한다. 이전 토큰, 재발송, 만료, 취소, 시작 이후 변경, 바인딩 없는 구버전 state는 수락할 수 없다.
- 초대자 권한과 역할 상한, 서비스, 정원 및 이메일을 다시 검사한다. 수락·회원·권한·감사·세션 생성은 트랜잭션으로 처리한다. 같은 초대를 서로 다른 인증 state로 수락해도 한 번만 성공한다.
- 개인 2FA가 있는 기존 연결 계정은 초대 수락 후에도 코드 확인 전까지 새 세션을 발급하지 않는다. 초대 수락은 SSO 신원 확인 트랜잭션에서, 로그인 세션 발급은 개인 2FA 검증에서 처리한다.
- 초대 페이지에 no-referrer/no-store/noindex를 적용했다. 실제 화면 클릭·키보드 조작은 아직 검증하지 않았다.

## 검증 결과와 범위

| 검사 | 결과 | 증거 |
|---|---|---|
| 변경 전 UUID만으로 초대 SSO 시작 | 422 기대에 실제 302, 결함 재현 | [baseline.log](baseline.log) |
| 1차 관련 시험 | 183 통과 / 기존 SAML 초대 fixture 1 실패; 구 GET 방식이 원인 | [tests.log](tests.log) |
| 최종 관련 시험 | 4파일 186개 통과 | [tests-final.log](tests-final.log) |
| 실제 HTTP 초기 | 15개 통과: 초대 생성, 안전 DTO, 기존 UUID 차단, 재발송, 이전/다른 이메일 거부, 새 대기 state | [http.json](http.json) |
| 실제 서버 재시작 후 | 5개 통과: 대기 SAML 인증 수락, 회원·권한·감사·세션 DB 확인, 이미 수락된 초대/응답 재사용 거부, 로그아웃 | [http-restart.json](http-restart.json) |
| 타입 검사 | 오류 0 | [typecheck.log](typecheck.log) |
| 린트 | 오류·경고 0 | [lint.log](lint.log) |
| Production build | 통과 | [build.log](build.log) |
| 선언된 API 계약 | 294경로·423작업·40정책, 미매핑 0 | [contracts.log](contracts.log) |
| 새 schema 설치/개발 DB 업그레이드 | 94개, 신규 제약과 기존 행 보존 확인 | [migration-verification.json](migration-verification.json) |
| 전체 migration 체크섬 | 기존 4건 불일치로 실패 유지 | [migration.log](migration.log) |

관련 시험은 OIDC, SAML, 오류 복구, 기존 초대 현재 권한 검사를 포함한다. 전체 프로젝트 시험 또는 181개 경로 수용을 뜻하지 않는다. 계약의 미매핑 0은 선언된 OpenAPI 작업의 정책 검사이며 실제 모든 라우트가 명세에 등록되었다는 증거는 아니다.

실제 HTTP 첫 실행은 QA 회사에 서비스가 없어 요청 전 준비 검사에서 중단됐다([기록](http-setup-failed.log)). 이후 전용 서비스를 실제 API로 생성해 시험했다. 최초 실행의 초대/인증 부작용은 없었다. 새 QA 초대·회원·서비스와 감사 이력은 검증용으로 남겼으며 기존 공급자·연결 계정 해시는 보존했다. QA 소유자 및 신규 회원의 세션은 0개다.

## 재현 환경과 명령

- Node 24.19.0 / 실제 PostgreSQL `catchsecu_test`와 `catchsecu_dev`.
- 테스트 DB 시험은 직렬 실행한다. 기존 개발 데이터 또는 사용자 계정을 테스트 초기화 대상으로 사용하지 않는다.
- QA 앱: `http://127.0.0.1:3163`, PID 53903 → 54674. 사용자 앱 3100과 전역 worker는 변경하지 않았다.
- 빌드: `.local/qa-sso-invitations-20261006-build`, tsconfig: `.local/qa-sso-invitations-20261006-tsconfig.json`.
- 실제 HTTP는 로컬 키로 서명한 SAML 응답과 실제 앱/DB를 사용한다. 외부 SaaS IdP 검증은 아니다.

```sh
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/sso.test.ts tests/server/sso-saml.test.ts tests/server/sso-recovery.test.ts tests/server/invitation-current-authority.test.ts
node node_modules/typescript/bin/tsc --noEmit -p .local/qa-sso-invitations-20261006-tsconfig.json
node --env-file=.env.local --import tsx scripts/generate-openapi.ts
python3 scripts/verify-contracts.py
```

`qa-sso-invitations.ts`의 최초 실행은 중복 방지가 있으므로 그대로 재실행하지 않는다. `--verify-restart`도 대기 state를 소비하는 일회 검증이다. 비공개 marker는 완료 식별자만 남겼다. 재시험은 기존 증거·fixture를 확인한 뒤 새 전용 자료로 수행한다. `qa-sso-invitation-migration.ts`는 임의 이름의 격리 schema에서 빈 설치하고 제거한다. 기존 migration 체크섬은 덮어쓰지 않는다.

## 남은 수용 조건

- 최신 Ego 브라우저에서 초대 링크→SSO 선택→인증→수락, 기존 계정 로그인 후 수락/연결, 오류·재시도·2FA·모바일 동작을 실제 조작하고 DB와 대조한다.
- 외부 OIDC/SAML IdP로 초대·연결·취소·키/인증서 교체를 검증한다.
- 실제 `/security/sso`, `/auth/sso` 경로와 계획 `/identity-providers` 계약을 대조하고 공급자 문자열 참조 모델을 보강한다.
- 공급자 비활성화·키 교체 정책 전체와 전문가 배정 이력이 있는 재초대 수락의 정리 동작을 추가 점검한다.
- 이전 migration 4건의 적용 SQL·현재/빈 설치 DDL 차이를 조사한다.

브라우저 검증은 기존 Ego 작업 공간 복구에 대한 사용자 응답 대기다. [ego-browser SKILL.md](/Users/user01/.agents/skills/ego-browser/SKILL.md)의 “Never use a new TaskSpace to recover … stop and ask the user” 규칙을 따른다. 이 의존성은 별도의 서버·DB 구현을 막지 않는다.
