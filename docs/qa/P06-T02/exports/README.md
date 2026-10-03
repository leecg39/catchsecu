# P06-T02 비동기 응답 내보내기 — 진행 중

2026-10-04. [시작 계획](PLAN.md)의 ExportJob·API·worker·응답 화면을 구현했다. 신규 PostgreSQL **14개**, 기존 즉시 CSV 10개를 합친 **2파일·24개**, 최종 전체 **47파일·628개**가 통과했다. Production API **58개(45+13)**와 실제 재시작에서 CSV/작업 해시·기존 응답 보존을 확인했다. 최신 화면 빌드 후 기존 자료 조회 13개와 전용 처리기의 자동 실행 API 12개도 통과했다. P06-T01·원본/브라우저·운영 보존 검증이 남아 P06-T02와 전체 사이트는 미완료이며 공식 완료는 15/72다.

## 모델·API·처리기

- ExportJob은 회사/서비스/폼·요청자·요청 키/본문 HMAC·암호화 조건/layout, 상태/version·진행/바이트·기한·lease/실패를 저장한다. ExportChunk는 100건 단위의 AES-GCM CSV 조각, ExportSource는 원천 응답 ID/순서·HMAC을 연결한다. 원문 CSV 파일을 서버 디스크에 저장하지 않는다.
- `POST /exports`는 같은 키/본문을 같은 작업으로 반환하며 다른 조건은 409다. 입력/조회는 현재 세션·계정·회사/서비스 grant와 요청자 본인을 검사한다. 목록/상세는 안전 DTO와 현재 작업 버튼만 제공한다. `POST /exports/{id}/cancel`, `DELETE /exports/{id}`는 version을 검사해 원문/조건/해시를 지우고 키 tombstone을 남긴다.
- `GET /exports/{id}/download`는 현재 권한·file.read·원천 상태/HMAC·기한과 CSV SHA-256을 다시 대조한다. 응답 잠금→작업 잠금 순서를 유지한다. 처리 중은 409, 종료된 결과는 410, 범위 밖 ID는 404다. 성공만 원문 없는 불변 다운로드 감사를 기록한다.
- worker는 SKIP LOCKED claim과 60초 lease·version으로 오래된 결과를 차단한다. 100건을 처리하고 진행을 DB에 저장한다. 최대 100,000건·1,000열·20MB·진행 중 5개·연속 실패 5번을 제한한다. 최대 24시간 또는 포함된 응답의 더 빠른 보유 기한에 결과가 만료된다. 만료 정리는 암호화 조각과 조건·해시를 제거한다.
- 즉시/비동기 CSV는 같은 렌더러다. 한국어·BOM/CRLF·수식 방어·행렬 행/복수 배열·게시 버전 열·파일 이름 권한·보존 조치·원문 만료 처리가 같다. 1,000건씩 잠금/조회해 큰 작업의 PostgreSQL 매개변수 한도를 피한다.
- 응답/답변/파일 변경과 계정/구성원/grant/배정/서비스/정책 변경에는 DB trigger로 연관 작업을 무효화하고 암호화 조각을 같은 transaction에서 제거한다. 정정 이력과 원천 응답은 내보내기 취소/삭제로 삭제하지 않는다. 실제 파기는 원천과 결과 복사본을 모두 제거한다. 전문가 소속은 DB에서 viewer 역할로 제한돼 응답 내보내기 grant가 더 있어도 권한이 생기지 않는다.
- 응답 화면은 적용한 검색 조건으로 생성·현재 목록/진행·페이지·다운로드·취소/삭제·오류/만료를 연결한다. 생성 응답 유실 때 요청 키를 유지하고 확정 거부 후 새 요청을 허용한다. 보이는 화면은 진행 중 3초·그 외 15초와 창 재진입 때 상태를 갱신한다. 새로고침 시 DB에서 읽으며 도메인 원장을 브라우저 저장소에 두지 않는다.

## 실제 검증

같은 키 동시 생성, 현재 DTO와 즉시 CSV 바이트 일치, 실제 정정 API의 이전 원문 회수/새 값, 실제 ClamAV 파일과 파일 권한·grant 회수, 취소/삭제 version·lease 회수/옛 worker, 5,001건/100건 배치, 100,001건과 실제 21MB 암호화 값 차단, 실제 기한 경과·정리, 회사/역할/미인증·잘못된 필터/Origin·진행 중 한도, 잠금 대기 중 기한 변경, 실제 파기 요청→승인→시험 worker·원문 제거와 전문가 여분 grant 거부가 통과했다.

Production은 P04 합성 회사/두 계정에서 아홉 유형·실제 첨부가 있는 보관 원본 CSV와 즉시 CSV를 같은 바이트로 확인했다. 독립 폼의 새 응답→CSV→실제 정정→이전 결과 410/조각 제거→새 CSV→취소/삭제/tombstone→보관을 검증했다. PID **55262→69023** 재시작 후 기존/정정 CSV 해시, 선택한 작업 5개의 상태/version·암호화 조각/원천 해시와 기존 응답/영수증/첨부 해시는 같았다. 실패 준비의 자료는 별도 기록이며 이 5개를 회사 전체 작업 개수로 해석하지 않는다. 소유자 외 역할 403·미인증 401, 보관 후 허용 다운로드를 확인했다.

최초 Production 준비는 위 합성 회사의 명시한 내보내기 ID 3개만 처리했다. 이후 `npm run worker:exports`에 연결한 전용 처리기를 실행하고 최신 서버 PID **89103**에서 실제 HTTP 생성→대기/처리/완료→CSV 다운로드→삭제/410의 **12개**를 확인했다. 처리 함수를 검증 스크립트에서 직접 호출하지 않았으며 1,864ms 뒤 원본 CSV와 같은 SHA-256이 나왔다. 이 작업의 결과 조각·조건·원천 해시는 삭제됐고 기존 응답/영수증/파일은 같았다. 기존 5개 작업/원본 해시도 최신 빌드의 별도 **13개** 조회에서 유지됐다. 전용 처리기는 내보내기와 결과 만료만 처리한다. 전역 worker·파기·외부 발송과 사용자 관리자 계정 변경은 하지 않았다. 시험 세션은 종료했으며 비공개 checkpoint는 `.local`에만 저장했다.

처음 생성 500은 잠금 함수의 PostgreSQL void 반환형을 Prisma가 읽지 못하는 제품 문제였다. 반환을 정수로 바꿔 같은 키/동시 요청을 통과했다. 다음 실패 4개는 bulk의 publication FK 누락·마지막 소유자 회수·승인 없이 destroying을 지정한 시험 자료였다. DB 보호 조건에 맞춰 자료를 보완했고 잠금 경합은 기한 변경으로, 실제 파기는 별도 요청/승인/worker로 검증했다. 전문가를 privacy로 만든 fixture도 기존 viewer 제한으로 거부됐으며 유효한 viewer/여분 grant 검증으로 바꿨다. 이 실패들은 통과 건수에 포함하지 않는다.

API 준비는 `consentPurpose` 누락과 폼 보관의 If-Match 누락으로 각각 중단됐다. 실패 로그를 보존하고 해당 합성 폼/내보내기 자료만 API로 정리한 다음 준비 45개·재시작 후 13개가 통과했다.

- [신규/기존 24개](gate-final.txt), [초기 500](gate-first.txt), [시험 자료 보완 전](gate-after.txt), [신규 13개 단계](gate-fixture-after.txt), [전문가 fixture](expert-before.txt)
- [전체 회귀](full.txt), [구조화 결과](full.json), [628개 요약](full-summary.json), [전문가 검증 추가 전 627개](full-before-expert-role.txt)
- [실제 API 준비](http-prepare.json), [재시작 API](http-finish.json), [재시작/해시](restart.json), [첫 fixture](http-fixture-before.txt), [보관 fixture](http-archive-fixture-before.txt)
- [전용 처리기 자동 실행 12개](http-automatic.json), [최신 빌드의 기존 자료 13개](http-verify.json)
- [아홉 유형 CSV](nine-type-source.csv), [정정 뒤 CSV](corrected-response.csv)
- [타입](types-current.txt), [제품 린트](lint-final.txt), [스크립트/시험 린트](lint-verified.txt), [처리기/화면 린트](lint-worker-ui.txt), [최신 빌드](build-current.txt), [dev migration](dev-migration.txt), [59개 migration 설치/복구](migration-rehearsal.json), [계약](contracts-current.txt), [계획](plan-current.txt)

전체 회귀 소요는 597.64초이며 실패/대기 0이다. 최신 타입/린트와 production 빌드가 통과했다. OpenAPI 256경로·372작업·32정책, 구현320/계획52와 입력/권한/매핑 누락0을 확인했다. Migration59개의 빈 설치·58→59 업그레이드·실패 복구와 회사/이메일 제약도 통과했다. [검증 범위·파일 해시](verification.json)에 실행 증거를 연결한다.

## 남은 게이트

Ego TaskSpace 34의 명시적 제어 재개 응답을 기다린다. [ego-browser/SKILL.md:74](/Users/user01/.agents/skills/ego-browser/SKILL.md:74)의 “stop and ask the user” 지침에 따라 종료된 제어를 다른 창/브라우저로 우회하지 않는다. 실제 생성/목록·페이지/취소·다운로드·오류·390px·저장소 초기화와 정상 원본 내보내기 필드/흐름 대조, 선행 P06-T01·문서/공유 등의 전체 수용 조건은 미검증이다. 장시간 운영 부하·worker 운영 배포/보존·외부 저장소 검증도 별도다. 위 백엔드/API 증거로 이 수용 조건을 대신하지 않는다.
