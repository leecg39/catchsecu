# 전문가 배정 충돌·재배정·회사 전환 검증

2026-10-06. 기준 커밋 `0ef3627287b679077824f65cf2a1ec48dd75474c`에 전문가 배정 화면의 충돌 복구를 보완했다. 이 보완의 구현·검증은 끝났다. **P03-T02 전체 완료 판정은 진행 중으로 유지한다.** 외부 SMTP 도달/반송, 독립 브라우저·기기와 원본의 미관찰 배정 화면 대조는 이번 검사에 포함되지 않는다.

## 수정한 동작

다른 운영 세션에서 배정이 변경되면 기존 화면은 409 안내만 표시하고 오래된 버전으로 저장을 계속 허용했다. 직접 DOM을 조회한 `ui-before.json`에서 `saveDisabled=false`, `latestReloadButton=false`를 확인했다.

`src/components/ExpertAssignmentsAdmin.tsx`에서 수정·재배정 충돌 뒤 오래된 저장을 막고 **최신 배정 다시 불러오기**를 제공한다. 불러오기 전에는 미저장 입력을 유지하며, 불러오면 최신 서비스 범위·기한·상태로 편집기를 다시 연다. 회수 충돌도 오래된 확인을 막는다. 최신 배정이 활성일 때 사용자가 다시 회수를 확인해야 처리하며, 이미 회수되거나 만료된 배정이면 확인 창을 닫고 최신 목록을 안내한다. 불러오기 실패 시 창 안에 오류를 표시하고 충돌 상태의 저장·회수 차단을 유지한다. 기존 전송 중 중복 요청·닫기 방지도 유지한다.

서버의 배정·권한 정책과 DB 스키마는 변경하지 않았다.

## 실제 UI·API·DB 결과

Node 24, Next.js 16.3.8 production 빌드 `.local/p03-expert-state-build`, 별도 로컬 PostgreSQL `catchsecu_mock_admin`, `http://127.0.0.1:3189`에서 검사했다. Ego Lite **TaskSpace 3 / p1 하나**에서 운영자와 전문가로 차례로 로그인했다. 충돌을 만드는 별도 운영자 세션은 HTTP 세션이다. 두 독립 브라우저의 동시 사용 증거는 아니다.

| 확인 항목 | 실제 결과와 근거 |
|---|---|
| 수정 충돌 | A 배정 v2를 연 뒤 다른 HTTP 세션으로 v3 변경. 오류·저장 비활성화·최신 조회 버튼을 확인했고 미저장 서비스1 선택은 유지됐다. `ui-conflict-final.json/png` |
| 최신 조회 후 수정 | 서비스2를 불러온 뒤 오류 해제·저장 활성화를 확인. 서비스1로 v4 저장. `ui-reloaded-final.json`, `revoke-concurrent.json` |
| 회수 충돌과 재확인 | v4 회수 창을 연 뒤 v5 변경. 충돌 시 확인 비활성화, 최신 조회 후 명시적 재확인으로 v6 회수. `ui-revoke-conflict.json/png`, `revoked-database.json` |
| 이미 회수된 배정 복구 | v7 회수 창을 연 뒤 다른 세션에서 v8 회수. 충돌 후 최신 조회가 창을 닫고 재배정 목록을 안내했다. 자동 중복 회수 없음. `already-revoked-database.json`, `ui-already-revoked.json` |
| 회수·만료 후 재배정 | A는 같은 배정 ID로 v7·v9 재배정. B는 만료 표시에서 같은 ID로 v2 재배정. `reassigned-database.json`, `ui-expired-reassigned.json` |
| 회사 A/B 전환·새로고침 | 회사 선택·전환 UI를 사용했다. 각 회사 서비스1만 context 반환. 배정 서비스 상세 200, 같은 회사 미배정 서비스 403, 다른 회사 상세 404. B 새로고침 뒤 선택 유지. `ui-company-a-context.json`, `ui-company-b-context.json`, `company-selection-audit.json` |
| 검색·모바일 | 검색 결과 없음과 시작 버튼 비활성화. 390px 회사 선택 화면의 가로 넘침 없음. 만료 상태 390/768/1440px 캡처를 모두 시각 확인. `ui-company-selection.json`, `ui-company-390.png`, `ui-expired-*.png` |
| 만료·회수 후 차단 | B 만료 후 서비스 조회 403·회사 선택 404·context 회사 null, B radio 비활성. A 회수 후 같은 API 차단과 두 회사 radio·시작 버튼 비활성. `ui-expired-access.json`, `ui-revoked-access.json` |
| 운영 화면 접근 거부 | 전문가 직접 접근이 `/access-not-allow?reason=admin`으로 이동하고 운영자 권한 안내를 표시했다. `ui-admin-denied.json` |
| 서버 재시작 | 자체 서버만 종료·재시작. 배정 2개·grant 2개·전문가 세션 1개의 선택 정보 해시 동일. health/ready 200, 기존 로그인·B 회사·배정 서비스 context 유지. `restart-before.json`, `restart-after.json`, `restart-comparison.json`, `ui-after-restart.json` |

재시작 대조 해시는 `53cefc516f0afac189d07969a8b5fd020e3a386b606444f3d3113aa0c6ab620c`이다. 이후 만료·회수 시험과 정리로 상태가 바뀌므로 최종 정리 파일의 해시와 구분한다. 뒤로가기와 날짜 위젯 키보드 접근성은 이번에 검사하지 않았다.

## 자동 검사

- `tests.log`: 관련 서버 검사 3파일 **44개 통과**, 실패·건너뜀 0. `expert-assignments.test.ts`, `member-current-authority.test.ts`, `member-management-gate.test.ts`를 시험 DB `catchsecu_test`에서 실행했다.
- `build.log`: production 빌드·타입 검사 성공, 종료 코드 0.
- `typecheck.log`: 재현 스크립트 추가 뒤 전용 설정으로 전체 소스·scripts·tests 타입 검사 성공, 종료 코드 0.
- `lint.log`, `lint-qa-script.log`: 변경 화면과 재현 스크립트 오류·경고 0. 빈 로그는 진단이 없음을 뜻한다.
- 이번 범위 밖의 전체 회귀를 다시 실행했다고 주장하지 않는다.

## 합성 데이터·실패 기록·정리

무작위 암호의 합성 계정 2개를 가입 API로 생성하고 가입 메일 작업 2개만 NULL tenant·정확한 jobId로 처리했다. 로컬 시험 메일함의 실제 서명 링크를 호출해 이메일 인증을 확인했다. **외부 SMTP 발송은 하지 않았다.** 합성 운영자 권한, 회사 A/B·회사별 서비스 2개는 DB fixture로 생성했다. 회사 등록 UI·결제·좌석 구독의 수용 증거로 집계하지 않는다. 최초 전문가 배정은 실제 API로 생성했다. `fixture.json`을 참조한다.

만료 시험은 해당 합성 배정의 `expiresAt`만 과거로 바꿨다. 실제 시간 대기나 만료 worker 실행 증거가 아니다. 날짜 위젯의 CLI 입력이 React 값에 반영되지 않아 과거 기한 오류를 표시했다. 관찰된 `datetime-local` 입력의 native value setter와 input/change 이벤트로 기한을 변경한 후 실제 저장 버튼을 눌렀다. 날짜 키보드 접근성 통과로 집계하지 않는다.

수정 전 캡처는 timeout으로 저장되지 않았으므로 `ui-before.json`의 직접 DOM 결과만 근거로 삼는다. 기존 TaskSpace의 **Open Space**를 열어 최종 캡처를 저장·시각 확인했다. 새 공간으로 timeout을 우회하지 않았다. 목록 갱신 전 assertion, 회사가 한 개라 없는 회사 선택 버튼을 기다린 검사, 운영 화면의 인라인 오류를 예상했으나 권한 안내 화면으로 이동한 대기는 실패했다. 각각 실제 화면을 다시 관찰하고 정상 결과의 UI·API·DB 증거를 기록했다. `build-launch-attempt1.log`는 존재하지 않는 실행 보조 파일을 지정한 최초 호출 실패이며 성공한 `build.log`와 구분한다.

검증 종료 후 합성 배정 2개를 회수하고 전문가 grant 0개·세션 0개를 DB로 확인했다. 자체 운영자·전문가 QA 세션은 로그아웃했다. `cleanup-database.json`이 최종 정리 근거다. 합성 계정·회사·감사는 보존하며 비밀번호·쿠키·인증 링크는 Git에서 제외한 `.local/`에만 보관한다. 자체 3189 서버는 종료했고 Ego TaskSpace 3의 `finish({ keep: [] })` 완료를 확인했다.

## 재현

`scripts/qa-expert-state-recovery.ts`는 localhost의 `catchsecu_mock_admin` DB와 로컬 메일 모드만 허용한다. `prepare`는 기존 비공개 fixture 덮어쓰기를 거부한다. 후속 명령은 fixture 회사명·배정 회사·전문가를 대조한 뒤 자기 데이터만 변경한다. 이번 fixture의 관리자 세션은 로그아웃했으므로 변경 API를 재실행하려면 별도 QA 회차의 새 fixture·로그인 세션이 필요하다.

```sh
# 별도 production 서버·로컬 QA 환경·새 fixture 회차를 먼저 준비한다.
node --env-file=.local/mock-admin.env --import tsx scripts/qa-expert-state-recovery.ts prepare
node --env-file=.local/mock-admin.env --import tsx scripts/qa-expert-state-recovery.ts read
# UI에서 해당 배정의 수정/회수 창을 연 뒤 별도 HTTP 세션으로 충돌을 만든다.
node --env-file=.local/mock-admin.env --import tsx scripts/qa-expert-state-recovery.ts update 0
node --env-file=.local/mock-admin.env --import tsx scripts/qa-expert-state-recovery.ts revoke 0
node --env-file=.local/mock-admin.env --import tsx scripts/qa-expert-state-recovery.ts expire 1
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/expert-assignments.test.ts tests/server/member-current-authority.test.ts tests/server/member-management-gate.test.ts --maxWorkers=1
```

최신 소스와 증거의 해시는 `manifest.json`에 기록했다. 전체 Task의 다른 완료 조건은 상위 P03-T02 문서에서 계속 추적한다.
