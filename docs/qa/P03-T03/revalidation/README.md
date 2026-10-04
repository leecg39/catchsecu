# P03-T03 재검증 — 프로필 권한·충돌 복구

2026-10-04. **부분 구현·검증이며 P03-T03 전체 완료가 아니다.** 공식 완료 수는 15/72로 유지한다.

## 구현

- `/me` 조회·수정은 트랜잭션에서 현재 계정, 이메일 인증과 세션을 다시 확인하고 읽기 잠금으로 동시 회수를 직렬화한다. 수정은 사용자 배타 잠금을 먼저 잡아 두 프로필 저장이 공유 잠금에서 교착되지 않게 한다.
- 저장·감사 후 세션 기한이 끝나면 프로필과 감사를 함께 롤백한다. 공통 audit의 tenantId 타입에 null을 허용해 회사와 무관한 본인 프로필 감사를 동일 함수로 기록한다. 기존 감사 데이터 형식은 유지한다.
- 프로필 편집 충돌은 저장을 잠그고 “최신 프로필 다시 불러오기”를 제공한다. 최신 정보로 입력을 교체한 뒤 최신 version으로 다시 저장한다.

## 검사

- 수정 전 실제 PostgreSQL 7개 중 6개 실패/1개 통과 (`profile-authority-before.json/log`). 요청 인증 직후 세션 삭제·만료·이메일 인증 해제 시 GET/PATCH가 성공하는 것을 재현했다.
- 신규 8개와 기존 계정 폐쇄·구성원·전문가·초대 권한 검사: **관련 5파일 62개 통과, 실패 0** (`profile-related.json/log`). 전체 저장소 회귀로 집계하지 않는다.
- 신규 시험은 실제 인증 직후에 DB 상태를 바꿔 요청 사이 경계를 검사한다. 최종 만료 시험은 실제 감사 저장 뒤 가상시계를 전진시켜 PostgreSQL 롤백을 확인한다. 두 동일 버전 저장은 하나만 성공/다른 하나 409를 검사한다.
- 변경 파일 lint 오류 0 (`lint.log`), Next production 빌드/내장 TypeScript 검사 통과 (`build.log`), diff whitespace 검사 통과. 별도 tsc 재실행으로 표시하지 않는다.

## 실제 화면·독립 DB·재시작

Ego TaskSpace 45/p1, 합성 member 계정, production 3105 `.local/recovery-production-v4`.

1. 편집 화면 version 2를 유지한 채 별도 HTTP 로그인 세션에서 version 3으로 부서·직책을 변경했다 (`profile-second-session.json`). HTTP 시험 세션은 로그아웃했다.
2. 기존 화면 저장은 409로 거부됐다. 저장 disabled를 DOM에서 확인하고 최신 정보 조회 후 새 부서/직책을 불러왔다 (`browser-profile-conflict.txt/png`).
3. 화면에서 부서 “품질 검증팀”·직책 “검증 책임자”를 저장해 version 4가 됐다 (`browser-profile-saved.txt/png`, `profile-before-restart.json`). 독립 DB의 프로필과 관련 감사 3개를 대조했다.
4. 서버 PID 80545→83607 재시작 전후 프로필·감사의 SHA-256이 같았다 (`profile-after-restart.json`). 재로그인 후 화면에도 그대로 표시됐다 (`browser-profile-after-restart-login.txt`).
5. 390×844에서 가로 scrollWidth=390이고 직책이 표시됐다 (`browser-profile-mobile.png`). 저장/모바일 캡처를 시각 확인했다.

첫 HTTP 변경 시 필수 name을 누락해 422였고, 뒤의 브라우저 저장은 충돌 없이 성공했다. 그 실행을 충돌 성공으로 집계하지 않는다. 계약을 확인한 다음 version 2→3의 다른 세션 변경을 확정하고 위 충돌 시나리오를 다시 수행했다. 읽기 완료 전 로딩 상태도 완료 캡처에서 제외했다.

## 계정·기기·활동 후속 보완

[최신 계정 검증](account-README.md): 현재 세션·최종 기한과 기기 회수/본인 활동을 보완하고 관련 36개·빌드/타입·린트를 통과했다. 실제 탈퇴/기기 회수/필터 CSV와 독립 DB·재시작을 확인했다. 아래 남은 조건 중 계정 폐쇄·본인 활동의 해당 범위는 이 후속 증거를 따른다.

## 남은 작업

- 계정 폐쇄·본인 활동/기기 관리의 현재 권한·최종 기한 및 실제 UI 전체 흐름.
- “개인정보 활동 검토 이력”은 아직 빈 표 구현이다. 사용자에게 독립 검토 요청/확인·반려/알림 흐름으로 구현할지 확인 질문을 보냈다. 원본 동작과의 동일성은 주장하지 않는다.
- SSO만 있는 계정의 폐쇄 재인증은 실제 IdP 연결과 함께 검증해야 한다.
- 선행 Task·추가 회사/권한·독립 브라우저·공통 게이트를 충족하기 전까지 전체 완료를 선언하지 않는다.

## 재현

```sh
qa_node=/Users/user01/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$qa_node" --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/profile-current-authority.test.ts tests/server/account-closure.test.ts tests/server/member-current-authority.test.ts tests/server/expert-current-authority.test.ts tests/server/invitation-current-authority.test.ts
"$qa_node" node_modules/eslint/bin/eslint.js src/app/api/v1/me/route.ts src/server/audit.ts src/components/management/live.tsx tests/server/profile-current-authority.test.ts
ALLOW_LOCAL_MAIL=1 CATCHSECU_BUILD_DIR=.local/recovery-production-v4 CATCHSECU_TSCONFIG=.local/recovery-production-v4-tsconfig.json "$qa_node" node_modules/next/dist/bin/next build
```

실행 중 서버의 build 디렉터리를 덮어쓰지 않는다. 후속 검증용 production 3105 PID 83607 / exec session 73915를 유지했다. 이전 QA 3104는 종료했다. 기존 사용자 서버 3100은 변경하지 않았다. 브라우저는 합성 member의 프로필 화면(390px)이다. 다음 작업 전 프로세스·TaskSpace를 재확인한다. fixture의 암호/쿠키는 `.local` 비공개 파일에서만 읽고 보고서에 출력하지 않는다.
