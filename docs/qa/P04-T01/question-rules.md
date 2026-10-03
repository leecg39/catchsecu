# P04-T01 조건부 질문·행렬·선택 수 제한

2026-10-03. 폼·템플릿 CRUD에 9개 질문 유형과 구조화한 행렬 답변을 연결했다. 아래는 독립 백엔드에서 정한 조건부 질문 계약이다. 원본의 페이지 분기 방식과 공용 템플릿 25개의 실제 질문 내용은 아직 대조하지 못했다. Task는 진행 중이다.

## 구현한 계약

- 질문 조건은 앞선 객관식/드롭다운의 `equals`, 체크박스의 `includes`에 연결한다. 상위 질문이 숨겨지면 하위 질문도 숨긴다. 자기 참조·앞으로 향하는 참조·잘못된 선택지·조건부 정보주체/마케팅 연락처를 저장·게시 시 거부한다.
- 행렬형 단일 선택은 행 ID별 문자열, 복수 선택은 행 ID별 선택 배열을 사용한다. 행 이름·순서·ID를 정의와 함께 저장하고 허용 선택지·행마다 필수·중복·최소/최대 선택 수를 검사한다. 체크박스도 선택 수 제한을 지원한다.
- 숨겨진 질문의 비어 있지 않은 답변은 422다. 정정에서는 기존 답변과 변경값을 합쳐 조건을 재검사한다. 새로 표시된 필수 질문은 답변이 필요하며 숨겨진 현재 답변은 비운다. 자동으로 비운 값도 암호화된 변경 이력에 포함한다.
- 폼·템플릿 복제는 질문과 행 ID를 새로 만들고 조건의 질문 참조를 바꾼다. 공개 질문·응답·정정 이력·공유 열람은 문자열 변환 없이 구조화한 값을 유지한다. 화면 표시에는 행 이름과 정의 순서를 사용한다.
- 편집 화면은 조건·행·선택 수 설정을 제공한다. 공개 응답과 정정 화면은 표시 조건을 계산하고 숨긴 값·대기 파일을 제거한다. 템플릿·승인 미리보기와 응답/공유 화면에 질문 규칙·행 이름을 표시한다.
- 조건부 파일도 실제 ClamAV 검사와 기존 파일 바인딩 규칙을 적용한다. 숨겨진 질문에 파일을 연결할 수 없다. 정정으로 숨겨지면 현재 답변을 비우고 과거의 암호화된 첨부 증거를 보존한다.
- Migration 55는 설정 JSON·9개 유형·행/선택 수·게시 조건 제약을 추가한다. Migration 56은 조건 연산자의 NULL/비문자열 우회를 차단한다. 적용한 migration의 내용을 덮어쓰지 않았다. 초안의 raw DB 조건 참조는 게시 트리거에서 검증하고 API는 초안 저장부터 검증한다.

## 실제 검증

- `questions-before.txt`: 최초 신규 6개 시험 중 5개 실패를 기록했다. `questions-after.txt`: 구현 후 해당 6개 시험 통과.
- `tests/server/question-rules.test.ts`의 10개 시험은 실제 PostgreSQL에 정의 저장·게시·응답·정정·복제·템플릿·중첩 조건·DB 위조 차단·공유 인증·실제 파일 검사/연결을 확인한다.
- `questions-related-tests.txt`: 질문 규칙·폼·승인·파일·공유·CSV 가져오기의 관련 6개 파일·123개 시험 통과. 공유 시험의 인증 코드는 암호화된 로컬 작업에서 읽어 실제 인증 API로 검증했다. 외부 메일 전달 시험으로 집계하지 않는다.
- `questions-full-test.txt`, `questions-full-test.json`: Node.js 24.19.0에서 전체 PostgreSQL 회귀 35개 파일·498개 시험 통과·실패 0·대기 0. 소요 277.04초. 파일 수는 JSON의 describe 묶음 수와 구분했다.
- `questions-typecheck.txt`, `questions-lint.txt`, `questions-http-lint.txt`: 타입과 변경 파일·스크립트 린트 오류 0. 기존 TemplateGallery의 Next 이미지 경고 2개는 남아 있다.
- `questions-migrate.txt`, `questions-migration-rehearsal.txt`: 개발/시험 DB 적용과 shadow DB의 56개 빈 설치·55→56 업그레이드·실패 복구·seed·복합 FK 검증 통과.
- `questions-openapi.txt`: OpenAPI 248개 경로·362개 작업을 생성했다. 질문 유형·조건·행·선택 수·구조화한 답변 계약을 반영했다.
- `questions-build.txt`: Node.js 24.19.0 / Next.js 16.3.8 production 빌드 통과. 로컬 메일 허용으로 빌드했으며 외부 SMTP는 미검증이다.
- `questions-http-prepare.json`: production HTTP 25개 통과. 폼 생성/게시·정의 조회·숨긴 원문/잘못된 행/타입/선택 수/필수값 거부·실제 응답·조건 변경 정정·독립 복제·템플릿 생성/사용/삭제를 확인했다. 화면 HTTP 200은 브라우저 조작 증거로 사용하지 않는다.
- `questions-restart.json`, `questions-http-finish.json`: PID 28858→29754의 실제 재시작 후 HTTP 6개 통과. 이번에 만든 폼 3개·응답 3개·답변 18개·독립 질문 ID 18개를 별도 DB 연결로 대조했다. 정정 값·비운 숨겨진 값·행 이름/순서 표시와 삭제한 템플릿에서 복제한 폼이 유지됐다. 이전 시험 자료를 포함한 회사 전체 건수와 구분했다.
- `questions-plan-check.txt`, `questions-contract-check.txt`: 181개 경로·72개 Task·의존성 순환 0과 OpenAPI 정책 매핑·완료 체크박스 일치를 검사한다. `questions-verification.json`은 이번 소스 해시와 통과 범위·미검증 범위를 기록한다.

HTTP는 기존 합성 구성원 계정으로 앞선 CRUD 시험 회사에서 실행했다. 이번 시험용 세션은 종료했고 사용자의 관리자 계정과 브라우저 세션은 유지했다. 비밀·원문·공개 token은 검증 결과에 기록하지 않는다.

## 남은 검증

- Ego 기존 작업 창 제어 재개 응답 후 실제 생성/편집/게시/응답/정정/공유와 모바일 조작.
- 원본의 페이지 분기 흐름·공용 템플릿 25개 질문 내용과의 대조.
- 즉시 응답 CSV의 구조화한 행렬 계약·권한·감사는 [P06-T02](../P06-T02/README.md)에 구현·검증했다. 원본 다운로드 흐름·실제 브라우저와 대량 비동기 내보내기는 남아 있다. 이전 `questions-verification.json`은 CSV 구현 전 시점의 소스/검증 snapshot이다.

재현은 분리된 시험 DB에서 Node.js 24로 `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/question-rules.test.ts`를 실행한다. Production HTTP는 개발 DB에서 `scripts/qa-question-rules.ts prepare` → 서버 재시작 → `scripts/qa-question-rules.ts finish` 순서다. 이 스크립트는 앞선 P03/P04 합성 fixture를 사용한다.
