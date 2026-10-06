# P11-T03 — SSO 오류 화면과 재시작

검증 기준: 2026-10-06. P11-T03은 진행 중이며 전체 공식 집계는 완료 17·진행 41·계획 14다.

## 변경

- OIDC/SAML 시작·콜백의 브라우저 문서 요청 오류를 `303 /login?error=<고정 코드>`로 연결했다. 일반 API 요청은 기존 JSON과 실패 상태를 유지한다.
- 취소/거절, 만료/재사용, 설정 변경, 기존 계정 연결 필요, 다른 계정과 연결 충돌, 초대, 소속/접근, 공급자 장애, 요청 제한에 맞는 안내를 표시한다. 오류 메시지·토큰·SAML 원문·외부 returnTo를 리디렉션에 복사하지 않는다.
- 요청 ID·no-store·429 Retry-After를 유지하고, SSO 응답에 no-referrer를 적용한다. 일반 Origin 검사와 SAML의 독립 인증 경계는 유지한다.
- `/login/oauth2`, `/login/saml`, `/login/saml/start`에 회사 SSO 주소/연결 ID 입력 화면을 연결했다. 현재 사이트의 UUID 공급자 로그인 경로만 허용한다. 외부 URL·콜백·초대·계정 연결 주소를 일반 로그인으로 변환하지 않는다.
- OIDC 취소도 유효한 state를 확인하고 일회 소비한다. 취소 전에 받은 정상 code/state를 이후 제출해 세션을 만들 수 없다. IdP error_description과 token error를 응답에 반영하지 않는다.
- 오류 사전에서 Object 원형 속성 이름을 조회하지 않도록 보완했다.

## 증거

| 검사 | 결과 | 기록 |
|---|---|---|
| 수정 전 재현 | 4/4 실패: 브라우저 JSON·IdP 상세 반사 | [baseline.log](baseline.log) |
| 실제 DB/로컬 IdP + 오류 분기/주소/렌더링 | 3파일 130개 통과, 신규 44개 포함 | [tests.log](tests.log) |
| TypeScript | 종료 코드 0 | [typecheck.log](typecheck.log) |
| 변경 린트 | 오류 0, 기존 AuthPages img 경고 4 | [lint.log](lint.log) |
| QA 스크립트 린트 | 오류/경고 0 | [lint-qa.log](lint-qa.log) |
| production build | 성공 | [build.log](build.log) |
| 실제 HTTP | 15개 통과 | [http.json](http.json), [실행 로그](http.log) |
| 동일 빌드 재시작 후 HTTP | 15개 통과, 공급자 해시/계정 ID 유지 | [http-restart.json](http-restart.json), [실행 로그](http-restart.log) |
| 소스 체크포인트 | 13개 파일 SHA-256 | [source-hashes.json](source-hashes.json) |

PostgreSQL 테스트는 격리된 `catchsecu_test`에서 순차 실행했다. 테스트 로그의 pg 클라이언트 query 병렬 호출 deprecation 경고는 남아 있으며 실패로 보고되지는 않았다.

HTTP는 별도 QA 서버 3160에서 수행했다. PID 23861에서 24314로 재시작했으며 사용자 서버 3100은 변경하지 않았다. 기존 전용 QA fixture를 사용해 회사 로그인 입력 페이지 HTML, 실패 화면 안내, 리디렉션/JSON 구분, SAML 만료, 실제 서명된 SAML 로그인→인증 조회→로그아웃→재전송을 확인했다. 각 실행 후 QA 세션은 0개이며 만든 state만 정리했다. 회사/provider 설정과 계정 연결을 유지했다. DB schema 변경은 없다.

### 재현 명령

지원 Node 24 런타임으로 실행한다. QA 스크립트의 최초 실행은 기존 증거가 있으면 거부하며 무심코 재실행하지 않는다. 비공개 fixture·인증서·키는 `.local/`에서만 읽고 증거에 포함하지 않는다.

```sh
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/sso-recovery.test.ts tests/server/sso.test.ts tests/server/sso-saml.test.ts
node node_modules/typescript/bin/tsc --noEmit -p .local/qa-sso-recovery-20261006-tsconfig.json
ALLOW_LOCAL_MAIL=1 ALLOW_LOCAL_KAKAO=1 CATCHSECU_BUILD_DIR=.local/qa-sso-recovery-20261006-build CATCHSECU_TSCONFIG=.local/qa-sso-recovery-20261006-tsconfig.json node node_modules/next/dist/bin/next build
QA_SSO_BASE=http://127.0.0.1:3160 node --env-file=.env.local --import tsx scripts/qa-sso-recovery.ts
QA_SSO_BASE=http://127.0.0.1:3160 node --env-file=.env.local --import tsx scripts/qa-sso-recovery.ts --verify-restart
```

## 남은 수용과 다음 구현

- HTML/React 정적 렌더링과 HTTP 동작을 확인했다. 브라우저 입력·클릭·키보드·모바일 수용은 이번 라운드에서 수행하지 않았다. 기존 Ego 작업 공간 복구에 대한 사용자 응답 대기는 유지한다.
- 실제 외부 OIDC/SAML IdP 수용과 키/인증서 회전은 미검증이다.
- `/link/oauth2` 계열은 AuthPages의 미연결 안내로 도착하며, 일반 사용자의 연결 계정 조회·해제 화면/API와 초대가입의 SSO 진입을 추가 대조하고 구현해야 한다. 현재 안내는 기존 로그인 뒤 회사에서 받은 연결 주소를 사용하도록 설명한다. 이 안내만으로 계정 연결 UI 수용을 완료로 처리하지 않는다.
- 기존 migration 4건의 체크섬 불일치는 별도 P01-T01/P14-T04 후속으로 남는다. 체크섬을 덮어쓰지 않았다.
