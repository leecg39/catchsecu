# F3 첫 보완: 행렬의 정확한 선택 수

2026-10-10. 선택 사항 행렬 EXACT를 모델·API·편집·공개 입력·정정에 연결했다. F3 전체와 R08 전체는 계속 진행 중이다.

## 원본 근거와 호환 계약

원본 번들 SHA256 `3538d47856c6ba1b4207059dc09434066c7ca692a5907ed792dd9e27c7dba78f`, REA `ev_87493e79c4f053718022b23e1e5d42acf1af245f8c7838a89cd7ebc3918df152`의 `xG`(8166309)를 대조했다. 선택 사항이면 모든 행의 선택 수가 0일 때 생략하고, 하나라도 응답하면 모든 행을 N과 비교한다. `yG`→공개 `be`→실제 제출/다음 페이지 차단 경로를 확인했다. [정확한 원문 위치](source-observations.json). 이는 클라이언트 정적 코드 관측이며 원본 서버 강제 검증은 미관측이다.

`selectionLimits.mode?: "exact"`를 새 명시적 설정으로 추가했다. mode가 있으면 `min=max>=1`이 필수다. 기존 mode 없는 `{min,max}`를 EXACT로 추론하거나 JSON을 백필하지 않는다. 과거 게시 폼의 행별 빈 값 허용 의미와 승인 지문을 유지한다. 새 편집기의 ‘정확히 지정한 개수’ 선택 시에만 새 계약을 저장한다.

| 선택 사항 EXACT(N=2)의 행별 개수 | 결과 |
|---|---|
| 모두0 | 생략 허용 |
| 2,0 또는 2,1 | 거절 |
| 2,2 | 허용 |
| 2,3 | 거절 |

필수 질문은 전체 미응답도 거절한다. 빈 답변이라고 키/타입 검사를 건너뛰지 않으며, 존재하지 않는 행·문자열 형식의 복수 답변·중복/위조 선택값은 거절한다. 정정은 원래 게시 버전에서 질문 단위 최종 답변을 검사하며 일부 행을 옛 값으로 자동 병합하지 않는다.

공유 `QuestionInput`은 활성 입력에 개수 오류를 연결해 공개 제출과 정정을 검사한다. 일부 행 입력/개수 부족은 native validation으로 차단하고 전체 해제 시 오류를 없앤다. mode 없는 기존 범위 UI는 유지하며 승인/미리보기 요약도 EXACT를 구별한다.

## DB와 실행 결과

112번째 migration은 `valid_question_settings` 함수만 확장한다. 새 컬럼이나 기존 행 수정은 없다. mode가 문자열 exact인지, 양수인 min/max가 모두 존재하고 같은지 DB에서도 검사한다. 앞선 optionId 조건 검증을 보존했다.

- [업그레이드 전](migration-before.json) / [후](migration-after.json): 8개 테이블의 모든 기존 행·컬럼 해시 동일.
- [새 빈 스키마 설치](fresh-schema.json): 112개 적용. 기존 스키마 초기화 없음.
- [개발](schema/catchsecu_dev-contract.json) / [시험](schema/catchsecu_test-contract.json): 예상밖 스키마 차이0. 공용 검사기를 처음 기본 경로로 호출하여 R01의 읽기 전용 정합성 보고서가 갱신됐으며, 이번 결과는 이 폴더에도 보존했다.
- [도입 전](before.json): 신규 계약5실패·legacy 호환1통과. 지원되지 않는 mode를 거절한 결과이며 보안 취약점 재현이라는 의미는 아니다.
- [구현 후](after.json): 관련5파일41개 통과.
- [추가 최종 검사](final-after-space.json): 4파일38개 통과(신규 EXACT7개 포함). 두 실행은 중복이 있으므로 합산하지 않는다.
- [타입](typecheck-final.log), [린트](lint.log), [production build](build.log) 모두 exit0. 이번 변경 lint 오류·경고0.

첫 추가 검사 실행은 디스크 공간 부족으로 JSON 보고서를 쓰지 못했다(`final.log`). 결과 미확인으로 통과 집계에서 제외했다. 중지된 두 빌드의 ignored cache만 약574MB 정리한 뒤 같은 검사를 다시 실행했다. [정리 범위](cache-cleanup.json). 소스·DB·QA 증거·실행 중인 빌드는 제거하지 않았다.

## 실제 HTTP·Ego·재시작

실제 HTTP10개: 준비4·게시 및 잘못된 공개 답변 거부5·불완전 정정 거부1. 결과는 [flow 폴더](flow)의 `*-http.json`이다. 가입 이메일 검증 상태는 로컬 QA 준비로 DB에 지정했으며 외부 메일 수신 증거가 아니다.

Ego에서 범위 설정을 EXACT2로 바꾸고 자동저장했다. 한 행만 채운 제출 차단, 일부 행 개수 부족, 전체 해제 후 오류 해소, 모든 행 정확 응답 제출, 빈 응답 제출을 실제 조작했다. 독립 DB에서 두 답변과 정정 실패 시 version/변경내역 불변을 확인했다. [브라우저 상태](flow/browser-exact.json), [실제 DB 응답](flow/responses.json), [390/768/1440px·키보드](flow/browser-empty-responsive.json), [화면](flow/public-matrix.png).

검증 도구의 준비 실패도 보존한다. 서버가 listen하기 전 첫 연결은 `ECONNREFUSED`였고 사용자/회사/폼이 생성되지 않았음을 검사한 뒤 같은 fixture를 재개했다. 입력 값 대신 `innerText`를 기다린 최초 편집기 대기도 실패했으며 접근성 selector로 화면을 확인했다. 제품 실패나 성공으로 집계하지 않았다.

최종 `.next-rea-exact-selection` 서버 PID34865→38635 재시작 후 폼1·응답2·감사7건의 해시 `885d506547087e8ed00b9ca1d17295255cc519bc2374e8e3440c8f5c6e3e2ec8`가 유지됐다. [freeze](flow/freeze.json), [verify](flow/verify.json), [Ego 재시작 확인](flow/browser-after-restart.json). 기존 F2·F1·SSO6세트도 읽기 전용 검사 통과했다. F1/HTTPS의 명시적으로 기록된 조회 감사 행 추가는 기존 검증 규칙을 그대로 유지했다.

## 재현과 남은 범위

Node24로 `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/question-exact-selection.test.ts tests/server/submission-export.test.ts tests/server/form-module-concurrency.test.ts tests/server/policy-approvals.test.ts --reporter=json`을 실행한다. 시험 DB 변경 실행은 직렬로 한다. 동결된 실사용 흐름은 `node --env-file=.env.local --import tsx scripts/qa-rea-exact-flow.ts verify`만 사용한다.

원본 단문100/장문1000은 실제 UI `maxLength`에서 확인했으며 원본 서버 제한으로 단정하지 않는다. 특수 질문·설명/이미지/참고 첨부·직접입력·안전한 패턴 분류·여러 페이지는 후속이다. 전체107개 작업의 완료0·진행53·계획54를 유지한다.
