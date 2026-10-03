# P06-T02 응답 조회·CSV 내보내기 — 진행 중

2026-10-04 최신: [비동기 내보내기 구현·검증](exports/README.md)에 ExportJob/조각/원천 모델, API·전용 처리기·화면, 정정/권한 회수/파기 시 원문 회수와 만료를 기록했다. 신규14개·관련24개·전체47파일628개, API58개·자동 처리12개·최신 기존 자료13개, migration59개 리허설이 통과했다. 아래는 2026-10-03 즉시 CSV 구현 시점의 증거다. 원본/브라우저·선행 게이트가 남아 공식15/72와 진행 중 상태를 유지한다.

2026-10-03. 기존 응답 조회·정정·철회·메모에 기간·상태·응답 ID 필터와 실제 CSV 다운로드를 연결했다. P06-T01의 전체 게이트와 원본/브라우저 대조가 남아 완료로 집계하지 않는다.

## 구현한 계약

- 목록 `GET /forms/{id}/submissions`와 다운로드 `GET /forms/{id}/submissions/export`는 같은 `status`, `search`, `from`, `to`를 사용한다. 검색 대상은 응답 ID다. 시작 시각은 포함하고 종료 시각은 제외한다. 화면 날짜는 Asia/Seoul로 해석하고 선택한 종료일까지 포함한다. 목록의 빈 마지막 페이지는 유효한 페이지로 보정한다.
- 현재 회사·서비스·폼 범위와 활성 사용자·인증·세션·구성원·전문가 배정·역할/서비스 grant를 transaction 안에서 재검사한다. 같은 순서로 응답 행을 잠근 뒤 현재 상태와 답변을 읽는다. 보관 자료의 조회는 허용한다.
- CSV는 UTF-8 BOM·CRLF·따옴표 escaping을 사용한다. 게시 버전 번호와 질문 순서를 열 제목에 넣고 행렬은 행마다 열을 만든다. 같은 질문 ID의 새 버전에도 별도 열을 사용한다. 복수 선택은 JSON 배열로 보존한다. 수식·탭/개행 시작 값은 CSV 수식 방어를 적용한다.
- 응답 ID·게시 버전·제출/보유 시각·상태·보존 조치·원문 열람 상태를 제공한다. 보유 기한이 끝났거나 파기 중/완료된 응답의 현재 원문은 비운다. 유효한 보존 조치 자료는 기존 보존 정책에 따라 조회한다. 조건부 질문에서 비운 현재 값도 빈 칸으로 남는다.
- 첨부파일은 현재 `file.read` 권한이 있을 때 안전한 파일 이름을 제공한다. 그 권한이 없으면 “첨부파일”만 표시한다. 파일 ID·저장소 키·다운로드 링크·정정 과거 원문·담당자 메모는 CSV에 포함하지 않는다.
- 내보내기는 최대 5,000건·1,000열·20MB다. 초과하면 413과 필터를 좁히는 안내를 반환한다. 응답은 100건씩 읽어 처리한다. 성공 시 `submission.exported` 불변 감사에 처리자·회사/서비스/폼·요청 ID·건수·열/바이트 수·필터 사용 여부를 기록한다. 응답 원문과 검색어는 감사에 저장하지 않는다.
- 파일 응답은 `attachment`, `private, no-store`, `nosniff`와 행 수 헤더를 제공한다. 서버에 별도 CSV 파일을 저장하지 않는다. 상한/권한/유효성 실패는 부분 파일과 성공 감사를 남기지 않는다.
- 응답 화면에 날짜·상태·응답 ID 검색·초기화·CSV 다운로드·준비 중·오류 안내를 연결했다. 다운로드는 같은 필터의 전체 결과를 사용한다.

## 검증 증거

- [신규 통합 테스트](../../../tests/server/submission-export.test.ts) 10개가 실제 PostgreSQL에서 통과했다. 한글/개행/따옴표/수식·행렬 행/복수 배열·버전 독립·동일 필터·범위/권한/세션 회수·만료/보존·실제 파일 검사·건수/열/바이트 상한을 확인했다.
- `export-tests.txt`: 동시 보유 기한 변경은 `pg_stat_activity`에서 내보내기가 응답 잠금을 기다리는 것을 확인한 후 writer를 커밋하고 원문 제외를 대조했다. 큰 내보내기 상한은 시험 DB의 합성 bulk 자료로 검증했다.
- `export-first.txt`: 최초 7개 중 6개 통과, 1개 실패는 시험 fixture의 Prisma 중첩 grant 입력이었다. 구성원·grant를 각각 실제 생성하도록 수정하고 권한 회수 시험을 통과했다.
- `export-typecheck.txt`, `export-lint.txt`, `export-script-lint.txt`: 타입과 변경 파일/검증 스크립트 린트 결과.
- `export-full-test.txt`, `export-full-test.json`: Node.js 24.19.0에서 전체 PostgreSQL 회귀 36개 파일·508개 통과, 실패/대기 0. 소요 322.34초.
- `export-build.txt`: production 빌드 통과와 실제 CSV Route Handler 생성. 최초 시도의 Next worker env-file 플래그 충돌과 검증 스크립트 타입 오류는 각각 `export-build-env-flag.txt`, `export-build-script-type.txt`에 보존했다. Next의 .env.local 자동 로딩과 명시한 Response 타입을 적용한 뒤 타입 검사와 빌드를 통과했다. 로컬 메일 허용으로 빌드했으며 외부 SMTP는 미검증이다.
- `export-http-prepare.json`: production HTTP 13개 통과. 실제 2개 응답·14개 열의 CSV 바이트/행렬 값과 목록/필터를 대조했다. 잘못된 상태·회사 필드·변경 메서드·미인증 접근도 차단했다. 이번 성공 다운로드 감사는 4개다.
- `export-restart.json`, `export-http-finish.json`: PID 55903→57070의 실제 재시작 후 새 로그인·회사 선택·질문/응답 조회·CSV HTTP 5개 통과. 다운로드 SHA-256·바이트 수가 재시작 전과 일치하고 별도 DB 연결의 정정 값·구조화한 행렬·다운로드 감사 1개와 대조했다. 이번 시험용 HTTP 세션은 로그아웃했다.
- `export-plan-check.txt`, `export-contract-check.txt`: 181개 경로·72개 Task·의존성 순환 0·공식 완료 15개의 일치와 OpenAPI 249개 경로·363개 작업·31개 정책 누락 0을 확인했다. `export-verification.json`에 이번 소스 해시와 검증 범위를 남긴다.
- OpenAPI와 정책 표에 응답 목록/내보내기 전용 범위·필터·CSV·상한·안전 DTO·감사를 반영했다. 이번 기능은 기존 모델을 사용해 migration 추가가 필요하지 않았다.

## 남은 작업

- [비동기 내보내기 계획](exports/PLAN.md)의 모델/API/worker/화면은 구현했고 [실행 증거](exports/README.md)를 남겼다. 전체 수용 조건의 브라우저·원본·운영 게이트는 남아 있다.
- 기존 Ego 작업 창 제어 재개 응답 후 검색·빈 페이지·다운로드·오류·모바일의 실제 조작.
- 원본 응답 내보내기 필드·다운로드 흐름과 대조. 위 형식은 독립 백엔드에서 정의한 계약이다.
- 선행 공개 제출·문서·공유 등의 전체 게이트와 P06-T02의 응답 관리 수용 조건.
- 대량 내보내기 `POST /exports`의 5,001건 배치는 시험 DB에서, 기한·재다운로드는 시험 DB와 실제 API에서 검증했다. 운영 규모 장시간 부하와 결과 보존 배포 검증은 남아 있다.

재현: 분리된 시험 DB에서 Node.js 24로 `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/submission-export.test.ts`. Production HTTP 검증 스크립트는 P03/P04 합성 fixture를 사용하며 `scripts/qa-submission-export.ts prepare` → 실제 서버 재시작 → `finish` 순서다. 원본 사이트 데이터와 사용자 관리자 계정은 변경하지 않는다.
