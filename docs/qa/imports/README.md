# CSV 수집 검증

2026-10-02. P07-T01의 파일 등록 → 컬럼·근거 설정 → 검증 → 반영 → 실패 CSV → 기존 응답 관리 흐름을 구현했다. 정식 Task 상태는 선행 전체 게이트가 남아 있어 planned이며 이 폴더를 부분 증거로 연결한다. 181개 경로 전체 구현 완료를 뜻하지 않는다.

2026-10-03 추가 검증: 가져오기 목록과 상세의 복호화된 헤더·설정 열람을 `import.list_viewed`/`import.viewed`로 감사한다. 권한 검사·조회·감사 기록을 한 DB 트랜잭션에서 수행한다. 실제 PostgreSQL 시험에서 회사·서비스 범위와 타 회사 404 시 이벤트가 없는 것을 확인했다. [감사 검증 기록](../P12-T01/README.md)을 참고한다.

## 결과

- 실제 PostgreSQL·ClamAV를 사용하는 전체 테스트 **149개 통과**. CSV 추가 테스트 18개, 기존 회귀 131개. [전체 실행](tests-final.log), [초기 CSV 17개 실행](tests-extended.log).
- [타입 검사](typecheck-final.log), [프로덕션 빌드](build-final.log) 통과. [린트](lint-final.log)는 오류 0, 기존 경고 21개다. pg 어댑터의 기존 동시 query 사용 경고가 남아 있다.
- migration 18을 [개발 DB](migrate-dev.log)·[분리 테스트 DB](migrate-test.log)에 적용했다. OpenAPI는 [134개 경로](openapi.log)다.
- 원본 R061~R063은 유료 제한 화면이었다. 아래 세 화면은 확인된 메뉴 경로에 독립적인 수집 계약으로 구현했다.

| 경로 | 실제 동작 |
|---|---|
| `/form/info-upload` | 서비스별 목록·검색·페이지, 작업 생성·파일 선택·인코딩·업로드·ClamAV·헤더 확인 |
| `/form/info-upload/agreement` | 목적·필수 항목 매핑·형식·원 수집일·동의 컬럼·근거 설명·보유 종료일 저장 |
| `/form/info-upload/recipient` | 직접/외부 제공자 출처, 행 검증·미리보기·부분 반영·진행·재시도·실패 CSV·취소/보관 |

## 브라우저와 독립 대조

Ego TaskSpace 30의 p1에서 localhost 합성 자료만 사용했다. 수집 목적과 원자료 제공자는 앱 API로 시험 준비했고, 주 시나리오의 파일 선택·업로드·매핑·출처 저장·검증·반영·다운로드·응답 정정·보관은 실제 화면에서 조작했다.

1. [시험 CSV](browser-sample.csv)를 실제 파일 선택기로 업로드했다. [컬럼 설정 화면](browser-mapping.png)에 이름/이메일, 수집일, 동의 컬럼과 근거를 지정했다.
2. [검증 화면](browser-preview.png)은 정상 2, 오류 1, 중복 1을 표시했다. [별도 DB 검사](database-validated.json)는 응답 0개, 암호화 객체의 CSF1 헤더, 원본 바이트 복호화 일치, 암호화 임시 행을 확인했다.
3. 명시적 반영 후 [화면](browser-committed-final.png)과 [DB·파일](database-committed.json) 모두 응답 2개만 확인했다. 원본 객체는 사라졌고 성공 행의 임시 원문은 null, 공개 링크는 0개였다. 수집 목적·제공자 스냅샷과 원 수집일 기준 30일 보유 기한을 확인했다.
4. 실제 다운로드 이벤트로 받은 [실패 CSV](browser-errors.csv)는 오류·중복 두 행을 포함한다. 수식 `=1+1`의 접두 처리, 따옴표 처리, 성공 행 제외를 검사했다.
5. [응답 정정 화면](browser-corrected.png)에서 이름을 변경했다. [DB 검사](database-corrected.json)는 정정 상태·변경 이력 1개·수집 증거 보존을 확인했다.
6. 서버를 다시 시작한 뒤 [상태·4행 유지](browser-restart.json)를 확인했다. 별도 1행 작업의 실제 반영 전환에서 [편집 영역 0·결과 영역 1](browser-transition.json)을 확인했다.
7. [390px 화면](browser-mobile.png)은 [측정](browser-mobile.json)상 페이지 너비 390px, 표 영역 312px, 내부 표 760px였다. 표만 가로 스크롤한다. QA 후 데스크톱 1920px로 복구했다.
8. 화면에서 [작업 보관](browser-archived.png)을 실행했다. [DB 검사](database-archived.json)는 임시 행 원문·digest·헤더·설정·스냅샷 제거와 반영된 응답 2개 보존을 확인했다.

독립 대조 스크립트는 [qa-imports.ts](../../../scripts/qa-imports.ts)다. `validated`, `committed`, `corrected`, `archived` 단계마다 실제 DB/객체 저장소를 단언한다. 이미 보관한 시험 작업은 이전 단계로 되돌릴 수 없다.

## 자동화한 실패·권한·파기 시나리오

- UTF-8/BOM·EUC-KR 실제 업로드, 인용 쉼표·개행·빈 행, 중복 헤더, 구문 오류, 10MB·10,000행·100열·10,000자 셀 상한.
- 필수·이메일·전화번호·숫자·달력 날짜·수집일·동의·만료·열 수 오류, 파일 내 중복, 설정 변경 후 검증 초기화, 오래된 version 거부.
- 근거 개정 후 재검증, 계약 근거에는 동의 기록을 만들지 않음, 비일수형 목적의 명시적 종료일, 서비스가 다른 제공자와 수탁자 참조 거부.
- 두 worker 동시 실행, 101행의 50행 단위 반영, 임대 회수, 같은 생성 요청의 동시 재실행, 동일 job/row 응답 중복 0.
- 원본 삭제 실패 때 응답 0, 삭제 재시도 성공, 반영자 권한 회수 후 중단·권한 복원 후 재개.
- 미인증·다른 회사·viewer·서비스 권한·출처 제한, 실패 CSV 및 미리보기 열람 제한.
- 취소·24시간 만료 정리, 실제 응답 파기 시 ImportEvidence와 연결 중복 행 원문 삭제, 증명서 계수 확인, 파기 후 증거 재삽입 거부.
- CSV 응답 정정에서도 이메일 등 원래 형식 검사 유지.

## 보존과 범위

원본과 임시 행은 최대 24시간 보관한다. 반영 요청 시 원본을 deleting으로 잠그고 실제 삭제 후에만 응답을 만든다. 완료된 응답의 Answer와 ImportEvidence는 기존 보유 기한·보존 조치·파기 흐름을 따른다. 반영 후 설정은 고정되고 실패한 작업은 같은 근거 버전에서 재개한다. 별도 새 작업으로 업로드한 같은 자료는 별도 수집으로 처리한다.

현재 비공개 저장소는 로컬 AES-GCM 구현이다. S3·백업 복구 후 재파기는 별도 전체 Task 범위다. 다운로드한 CSV의 접두 처리는 스프레드시트에서 재저장·재개방하는 모든 조합을 보장하지 않는다. 기본 셀 인용과 수식 시작 문자 방어는 [OWASP 설명](https://community.owasp.org/attacks/CSV_Injection)을 참고했고 반환 바이트를 검사했다. 파싱은 [csv-parse 공식 API](https://csv.js.org/parse/api/sync/)의 버전 7.0.3을 고정해 사용한다.

## 이 작업에서 고친 결함

- Prisma nested 질문 생성의 런타임 인자 거부: 질문을 별도 createMany로 생성하도록 수정했다.
- 편집 영역과 결과 영역의 중복 React key: 서로 다른 키를 부여하고 실제 반영 전환으로 재검증했다.
- 모바일 표가 페이지 폭을 늘리는 현상: grid 최소 폭과 표 스크롤 범위를 고쳐 390px에서 측정했다.

초기 실패 로그도 원인과 수정 과정을 남기기 위해 보관한다. 최종 판정은 위 최종 실행 로그와 실제 대조 결과를 기준으로 한다.

## 2026-10-05 라이브 재검증 (Chrome DevTools + 실제 ClamAV)

이번에는 브라우저에서 전체 흐름을 다시 실행하고 DB를 직접 대조했다.

- **ClamAV 실기동**: quarantine 제거·ad-hoc 재서명 후 `scripts/` 경로로 clamd 기동, 소켓 `PONG` 응답 확인. 업로드 파일 `scanStatus=clean` 기록. 스캐너 부재 시 업로드가 fail-closed로 차단되는 것도 먼저 확인했다.
- **검증 결과 (UI=DB)**: 7행 → 정상 5·오류 1(`not-an-email` 이메일 형식)·중복 1(파일 내 2번 행과 동일). 실패행 CSV는 행 번호·사유·원본 값을 보존.
- **수식 무해화**: `=1+2`, `+SUM(A1:A2)`이 계산되지 않고 Answer에 문자열 그대로 암호화 저장됨을 복호화해 확인.
- **반영**: `committing` → worker 실행 → `partialFailed`, 응답 5건 생성(importRowNo 2,3,5,7,8). 원본 FileObject는 반영 전 `deleted`.
- **재업로드 독립 수집 확인**: 동일 CSV를 새 작업(`e30ac4fd`)으로 업로드 → 파일 내 중복만 재검출되고 5행이 **별도 formVersion의 새 응답 5건**으로 반영됨. 코드 주석상 "Separate imports are independent collections"의 의도된 동작이며 문서에도 명시돼 있다. 중복 행(row 4)은 row 2 응답에 링크만 연결.
- **감사 추적 완전**: `import.created → previewed(3) → configured → validated → commit_requested → completed` + `import.viewed`가 모두 AuditEvent에 기록됨.
- **수집 목적 조건 강제 확인**: "계약 처리"(이메일 선택 항목)는 정보주체 매핑 불가로 거부, "신청 처리"(동의 근거)는 행별 동의 컬럼 필수로 거부 — 목적별 스키마 검증이 서버에서 실제 동작.

남은 게이트: 선행 Task(P06-T01·P05-T01·P01-T04) 전체 완료 후 정식 완료 판정.
