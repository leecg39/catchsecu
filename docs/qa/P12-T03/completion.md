# P12-T03 완료 수용 기록

2026-10-04. TASKS.md와 tasks.json의 원래 범위·수용 조건 및 공통 완료 조건을 대조했다. 해당 Task를 완료로 판정한다. 전체 목표와 다른 Task의 상태는 별도로 추적한다.

## 원래 요구와 증거

| 요구 | 현재 구현·검증 증거 |
|---|---|
| 증거가 있는 준수 점검 | 목적·유효 처리방침 게시·기한 경과/보존 응답·구성원 인증·회사 MFA의 5개 기술적 점검. 같은 트랜잭션에서 범위·시각·버전·해시를 저장. [원천·SQL·UI·파일](revalidation/evidence/README.md), compliance-evidence 시험13개 |
| 월별 마감 snapshot | 회사/서비스·월 단위 unique, 한국 월 경계와 시작 전 월 거절, 생성 당시 집계 고정, DB UPDATE/DELETE 거절. [현재 권한·원자성](revalidation/README.md), [migration 설치/업그레이드/복구](revalidation/export-migrations/db-rehearsal.json) |
| 필터 적용 export·PDF/CSV 작업 | 저장 월·서비스 범위의 같은 snapshot을 동기 CSV와 비동기 PDF/CSV에 사용. 파일 원천 해시와 바이트 검증. [실제 PDF/CSV](revalidation/evidence/files.json), [작업 검증](revalidation/exports/README.md) |
| 만료 파일 | 요청 후 최대24시간, 접근 시 만료 처리와 worker 정리, 암호문·결과 해시 제거, 만료 다운로드410. targeted future-clock 시험 및 실제 HTTP로 확인. 실제24시간 경과를 기다린 실행은 아니다. [출력 검증](revalidation/exports/README.md) |
| 근거 없는 준수 통과 금지 | 저장 verdict=not_assessed 고정, 실제 UI/PDF/CSV에 미판정. 없는 근거는 미점검/대상 없음, 빈 근거를 합격이나 점수로 변환하지 않는다. [최종 화면](revalidation/lifecycle/final-v25.png), [PDF](revalidation/evidence/service-a.pdf), [CSV](revalidation/evidence/service-a.csv) |
| 같은 필터 동일 합계 | 서비스/회사 SQL·dashboard/close/파일 대조. 정정·철회·보존·파기 후 현재 합계 변화와 기존 마감 불변. 중복 월/서비스/마감/페이지 query422. [통합 흐름](revalidation/lifecycle/README.md), [최종 HTTP7개](revalidation/lifecycle/browser-query-final.json) |
| 다운로드 제한·CSV 수식 무해화 | 현재 세션/회사/서비스/역할 재검사와 본인 출력만 다운로드, 취소/삭제/만료 및 파일 무결성 검증. 요청키 중복·진행5개·행수/파일 크기 제한. CSV의 '=합계' 서비스명 무해화·BOM 확인. compliance-close와 compliance-exports 시험 |
| 모델 migration·FK/unique·인덱스 | ComplianceExportJob 복합 회사/마감/구성원 FK, 요청키 unique, lease/기한/상태 제약, 마감 불변 trigger. shadow 빈76개 설치·75→76와 기존 dev 체크섬/업무 보존 검증. [출력 migration](revalidation/export-migrations/db-rehearsal.json), [적용 전](revalidation/export-schema-before.json), [적용 후](revalidation/export-schema-after.json) |
| 성공/실패/타회사/다른 역할/중복·경합 | 저장 후 grant/서비스/회사/MFA 변경, 세션 삭제/만료, 감사 실패 원자적 롤백, 병렬 마감/출력 요청/worker claim, stale lease·취소·재처리, 손상 근거/파일 거부. 최종 관련6파일80개 통과. [최종 로그](revalidation/lifecycle/tests-final.log) |
| 실제 UI 쓰기·독립 DB·재로그인/재시작 | viewer 서비스 마감과 owner 회사 마감·출력 요청/취소/삭제/다운로드, 별도 합성 응답 접수/파기. 새 프로세스에서 CSV 동일·DB 상태 해시 동일. [근거 실행](revalidation/evidence/README.md), [최신 독립 DB](revalidation/lifecycle/database-new-process.json), [기존 DB](revalidation/lifecycle/database-final.json) |
| 변경 통합/E2E·타입·lint·production build | 80개 통합 시험, Ego45/p1 실제 조작, 최종 v25 빌드·타입·lint 종료코드0. 이전 UI1440/768/390과 offline 복구도 검사했다. [빌드](revalidation/lifecycle/build-final.log), [타입](revalidation/lifecycle/typecheck-final.log), [lint](revalidation/lifecycle/lint-final.log) |
| 증거·명령·fixture·수행일 | 이 폴더의 실행 기록, 고정 source SHA-256과 파일 SHA-256. Node24, 격리 catchsecu_test, 개발은 별도 합성 회사/작업 ID만 사용. [최종 manifest](completion.json) |

## 선행 인터페이스 대조

P12-T01의 월마감 조회/생성/다운로드·출력 요청/완료/다운로드/취소/삭제 감사는 해당 업무와 같은 트랜잭션에 있다. 감사 실패와 최종 기한 경과 시 롤백을 시험했다. P12-T02의 서비스·응답·폼·동의서·방침·접수/파기 집계는 RepeatableRead 안에서 저장하며 SQL과 필터 일치를 검사했다. P07-T03의 보존/파기 상태와 증명서는 실제 접수→파기→집계→마감 흐름으로 확인했다.

앞선 중간 기록은 선행 Task 전체 완료 증거와 모든 업무의 FLOW-12를 이 Task의 미완료 사유로 함께 적었다. 원래 Task별 수용 대조를 마친 결과, 보고서가 사용하는 위 인터페이스의 요구는 충족됐다. 전체 감사 생산 경로(P12-T01), 라이선스/원장 통계(P12-T02), 운영 저장소·백업 복구(P07-T03), 전 경로/성능(P12-T04), 최종 출시(P14)는 각 원래 Task에서 계속 검증한다. 이를 삭제하거나 완료로 바꾸지 않는다.

보고서는 마감 저장 시점의 현황이다. 과거 월말 상태 복원, 외부 게시 검증, 법적 준수 판정 및 백업/WAL/외부 사본 삭제를 제공한다는 주장은 없다. 해당 Task에는 외부 메일/PG/본인인증 공급자 호출이 없어 외부 성공 receipt를 만들지 않았다.

## 마지막 보완

월마감 조회와 출력 목록이 중복 query를 마지막 값으로 덮어쓰는 결손을 실제 시험2개로 재현했다. 공용 requestQuery로 바꾸어 DUPLICATE_QUERY422를 반환한다. [수정 전 실패2개](revalidation/lifecycle/query-baseline.log), [수정 후80개](revalidation/lifecycle/tests-final.log), [새 production HTTP](revalidation/lifecycle/browser-query-final.json). 정상 월마감 조회와 기존 CSV 바이트는 유지된다.

자체 QA 서버3126/v25에서 재로그인·조회·다운로드했으며 새 DB 해시는 기존 최종 DB 해시와 일치했다. 사용자 서버3100과 기존 업무 자료는 보존했다. 다음에는 P12-T01 감사 이벤트 수집·조회의 잔여 구현·수용을 한 Task씩 진행한다.
