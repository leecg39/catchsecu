# P12-T03 PDF/CSV 출력 작업·만료 파일 검증

2026-10-04. 같은 Task를 순차 구현했다. **P12-T03 전체는 아직 진행 중**이며 공식 완료15·진행42·계획15를 유지한다.

## 구현 범위

- `ComplianceExportJob`은 회사/불변 월마감/요청 구성원을 복합 FK로 고정한다. PDF 또는 CSV, 원천 해시, 요청 키 해시, 상태/version, 임대/시도 번호, 최대24시간 기한, 암호화 결과와 파일 해시를 저장한다. 전체 모델120·migration76.
- 같은 요청 키는 같은 작업을 반환하고 다른 마감/형식은409다. 진행 중인 작업은 구성원별5개, 파일은16MB, 서비스4,998개, PDF250페이지까지다.
- 생성/목록/상세/취소/삭제/다운로드는 현재 회사·구성원·세션·정책·서비스 범위와 최종 기한을 검사한다. 결과는 요청자만 받는다. 회사 전체는 직접 owner/admin이다.
- worker는 요청 당시 브라우저 세션과 독립적으로 현재 발급자·역할·서비스·MFA·전문가 배정을 검사한다. 생성 전과 파일 게시 직전에 다시 검사하며 오래된 임대/version 결과는 버린다. 다운로드에는 현재 세션·IP·비밀번호 등 일반 권한 검사가 다시 적용된다.
- PDF/CSV는 동일한 저장 마감을 사용한다. 한글 PDF에는 기간·저장 시각·고정 합계·서비스명·원천 해시와 미판정을 표시한다. 과거 월말을 복원한 수치나 법적 준수 통과로 표현하지 않는다.
- worker의 일시 오류는 재시도하며 최대5회 이후 종료한다. 취소/삭제/24시간 만료 정리는 암호문과 파일 해시를 제거한다. 원천 마감은 DB UPDATE/DELETE 금지다.
- 화면에 출력 요청, 상태 조회, 실제 다운로드, 취소/삭제, 페이지를 연결했다. `scripts/export-worker.ts`가 응답 CSV와 월마감 출력을 모두 처리한다. 이 검증에서는 전체 worker를 돌리지 않고 지정한 합성 작업 ID만 실행했다.

## 자동 검증

- 4파일 **64개 통과**: 신규 출력31개, 기존 마감 권한27개·마감1개·집계5개. [로그](tests-final.log).
- 기존 응답 비동기 출력 **14개 회귀 통과**. [로그](regression.log).
- 실제 PDF 바이트·한글 텍스트·미판정·원천 해시·활성 콘텐츠 없음·여러 페이지와 모든 서비스 포함 확인.
- 요청 키 동시 중복, 0/1/11/100건 페이지, 현재 권한 회수, 렌더 도중 권한 회수, MFA 변경, 세션 종료, 감사 실패/기한 경과 롤백, 취소와 stale worker, 임대 인계, 5회 실패 한계, 만료 정리, DB FK/범위/기한 변경 거부를 시험했다.
- 최초49개 중3개 실패는 테스트 기대값 문제였다. Prisma의 DB 제약 오류 코드가 예상 P2004가 아닌 P2039였고, 정책 없는 테스트 세션은24시간 후에도 유효해 만료 다운로드는401이 아닌410이었다. 수정 후 위 최종 검증을 통과했다. [최초 로그](tests-attempt1.log).
- 최종 production v21 빌드/타입/변경 린트 통과. [빌드](build-final.log). OpenAPI289경로/418작업/38정책, 계획181경로/72Task 검증 통과.

## 데이터 이행·보존

[shadow migration](../export-migrations/db-rehearsal.json)에서 빈76개 설치,75→76 업그레이드와 기존 합성 월마감 보존, 마감 UPDATE/DELETE SQLSTATE23514, 실패 migration 롤백/재실행을 확인했다. dev 적용 전후 기존75개 migration 체크섬과 Company/Service/Subprocessor/SubprocessorNotice/ServiceConsentDisplay/AuditEvent/ComplianceClose 7테이블의 건수·해시가 동일하다. [적용 전](../export-schema-before.json), [적용 후](../export-schema-after.json).

## 실제 Ego·파일·DB

- QA viewer가 서비스 A의2026-09 마감을 선택하고 PDF/CSV를 각각 요청했다. 각 작업은 1회 처리로 ready/version3이 됐다. 요청자만 내려받을 수 있으며 같은 회사 owner라도 viewer 작업 URL은404다.
- 실제 버튼으로 받은 [PDF](service-a.pdf)는41,821바이트/1페이지다. [렌더 이미지](service-a-preview.png)를 직접 확인했다. [CSV](service-a.csv)는191바이트이며 이전 동기 월마감 CSV와 완전히 같다.
- 실제 UI에서 추가 작업을 취소하고 삭제했다. 별도 네 번째 합성 작업을 ready로 만든 뒤 그 ID에 한해 만료 직후 시각을 주입해 cleanup을 실행했다. 암호문 제거·expired 상태·실제 HTTP410을 확인했다. **실제24시간을 기다린 검증은 아니다.**
- 첫 모바일 검증에서785px 가로 넘침을 재현했다. `.public-statistics`의 그리드 열을 `minmax(0,1fr)`로 수정한 v21에서 innerWidth/scrollWidth 모두390, 표 내부308/747px 가로 스크롤을 확인했다. [최종 모바일](ready-mobile-final.png), [데스크톱](ready-desktop-final.png).
- 새 production 프로세스3122/PID40954에서도 4개 작업의 DB 해시 `153e825a2513566f8e3b332543b2fc5ed29478e70dc46156d110c685427b9cc5`가 유지됐다. [새 프로세스 PDF](restart-service-a.pdf)와 [CSV](restart-service-a.csv)는 기존 다운로드와 바이트 동일하다. [해시](actual-files.json), [HTTP 검증](browser-checks.json).
- 작업4개 상태는 ready2(PDF/CSV)·deleted1·expired1이다. 원래 월마감2개는 보존됐다. 사용자 서버3100은 유지했고 이전 자체 QA3120/3121은 종료했다.

## 남은 Task 범위

증거가 있는 점검 항목과 월마감 연결, 원본 화면 대조 및 선행 P12-T01/P12-T02/P07-T03을 포함한 원래 수용 조건이 남아 있다. PDF·파일 구현을 근거로 법적 준수 판정이나 P12-T03 전체 완료를 주장하지 않는다. 다음 작업도 P12-T03에 집중한다.

후속 완료 판정(2026-10-04): 위 내용은 실행 당시 기록이다. 최종80개·v25빌드/타입/lint·실제 HTTP/새 프로세스와 원래 요구별 대조 후 P12-T03을 완료로 갱신했다. [최종 수용](../../completion.md)
