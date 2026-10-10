# 기타 보기·직접입력 검증

2026-10-10. R08의 기타 직접입력 범위를 구현하고 검증했다. 전체 107개 작업 완료를 뜻하지 않는다. [확정 계획](PLAN.md), [원본·영향 분석](backend-impact.json), [원본 15개 발췌 무결성](source-integrity.json), [독립 계획 검토](plan-review.json)를 근거로 한다.

## 구현

- 객관식·체크박스·드롭다운의 마지막 보기 하나에 `isCustomValue:true`를 저장한다. nullable 컬럼이며 기존 행은 null이다. 생략 시 현재 설정만 보존하고 명시 false로 해제한다. 과거 게시본의 true가 부활하지 않는다.
- 일반 답변 string/string[]는 유지한다. 기타를 선택한 답변만 strict `kind/selectedValues/custom:{optionId,text}` 객체로 저장한다. 직접입력 100 UTF-16, 공백만·NUL·잘못된 Unicode·보기 소유권을 검증한다. 숨겨진 답변과 정확 선택 수를 검사하며 기타는 한 개로 센다.
- 새 UI의 보기 이름은 250 UTF-16이다. 기존 일반 이름 500 code point는 읽기·저장·복제에서 유지하며 별도 수정창에서만 새 한도를 적용한다. 편집 중 기타 선택을 켰다 꺼도 기존 배열 순서를 유지하고, 서버는 custom 객체 저장 시에만 정규화한다.
- textarea로 LF를 유지하며 CR/CRLF의 수정되지 않은 구간도 보존한다. 자동저장 상태가 바뀐 확인창은 적용하지 않는다. 형식·정보주체 항목 전환 모두 제거 확인을 거친다.
- 게시본·복제·템플릿·승인·공개 제출·정정·공유·CSV에 연결했다. CSV의 새 기타 답변만 선택 ID/value/게시 당시 label과 직접입력을 JSON 한 셀로 내보낸다. 이전 동의 영수증을 재생성하지 않는다.

## DB·시험·빌드

[마이그레이션 전](migration-before.json)·[후](migration-after.json) 기존 8개 테이블의 공통 컬럼 지문이 일치한다. dev/test/[빈 설치](fresh-schema.json)에 migration121을 적용했고 [스키마 차이](schema/catchsecu_dev-contract.json)는 0이다. DB는 true/null, 질문당 한 개, UTF-16 이름 길이, 부모 유형을 양방향으로 검사한다. 마지막 위치는 API의 최종 목록 규칙이다. READ COMMITTED의 두 쓰기 순서를 시험했으며 고정 스냅샷의 관련 쓰기는 명시적으로 거절한다.

- [최초 RED](before.json): 25개 중 21실패·4통과. 없는 모듈의 import 실패가 아닌 기존 계약·서버에 도달한 실패다.
- [백엔드 GREEN](after.json): 27/27. 기존 25개 기대를 유지하고 고정 스냅샷 두 경우를 추가했다.
- [화면·입력 이벤트](ui-after.json): 3파일 14/14. 일반 배열 순서, 해제·재선택 초기화, 줄바꿈 편집, 16언어 안내를 포함한다.
- [최종 관련 회귀](regression.json): **15파일 182/182**. 위 27·14를 포함하므로 별도 합산하지 않는다. 폼/템플릿/현재 권한/감사 실패/공유/subject/CSV와 이전 부가 필드도 포함한다.
- [최종 타입](typecheck-final.log), [변경 22파일 린트](lint-final.log), [범위](lint-scope.json), [production 빌드](build.log), [OpenAPI 311경로](openapi.log) 통과.

## 실제 Ego·HTTP·다운로드

기존 TaskSpace2의 p1을 사용했다. 시험 전용 회사·계정·폼이며 외부 사람에게 메일을 보내지 않았다.

1. [보기 추가·일반 앞삽입·삭제·순서 보호](flow/browser-editor-add.json), [기존 긴 이름 보존·수정/취소·키보드250 경계](flow/browser-legacy-label.json), [유형/정보주체 전환 취소·확인](flow/browser-type-transitions.json).
2. [자동저장 중 확인창 stale 거절](flow/browser-stale-confirm.json), [분기 연결 보기 삭제·유형 변경 보호와 새로고침](flow/browser-branch-protection.json).
3. [공개 입력](flow/browser-public-input.json): 빈 값·공백, 키보드100 UTF-16, 기타 해제·재선택 초기화, 숨긴 분기 삭제, 기타 한 개를 포함한 EXACT2, 스크립트 문자열 미실행. 390/768/1440px DOM/textarea 가로 넘침 0.
4. [HTTP 8개 거절](flow/reject-invalid-http.json): 형식 5개 `VALIDATION_ERROR`422, 다른 보기 ID `INVALID_CUSTOM_CHOICE`422, 숨긴 답변 `HIDDEN_ANSWER`422, 수 제한 `SELECTION_COUNT`422. 실패 후 응답 수 불변.
5. 실제 제출 1건을 [독립 DB](flow/verify-submission.json)와 대조했다. 보기명을 바꾸고 체크박스 기타를 제거한 v2 게시 후에도 [정정 UI](flow/browser-correction.json)와 [독립 DB](flow/verify-correction.json)는 v1 보기·원문을 유지했다. 체크박스 기타→일반 배열 정정도 확인했다.
6. 실제 [CSV](flow/responses.csv)·[PDF](flow/receipt.pdf)를 다운로드해 [대조](flow/download-verification.json)했다. CSV는 원문·v1 label 유지, PDF 41,876 bytes SHA-256 `1f175e06cd6541c2b6e53180cd28d7ddc8f963de4aebb14387fea01e5daad24a`로 정정 전과 일치한다. 비동기 CSV는 실제 DB worker 통합시험에서 동기 결과와 일치함을 검증했다.
7. [공유 열람](flow/browser-shared.json)은 로컬 시험 메일의 challenge를 사용한 실제 브라우저 인증이다. 선택한 첫 질문만 표시했고 다른 질문은 비노출, [회수 후 차단](flow/browser-share-revoked.json)을 확인했다. 실제 외부 SMTP 수용 증거는 아니다.

## 재시작·한계

[동일 빌드 재시작](restart.json) PID72385→80126 후 [공개 새로고침](flow/browser-after-restart.json), [DB 지문](flow/verify.json)이 일치한다. 폼1/게시 버전2/응답1/정정1/감사36, 회수된 공유1과 challenge/session도 해시에 포함했다. SHA-256 `8dd08778edc8dff741098ae7389b77e47c2572667c09ec2020f858f7f5043d35`. [이전 17개 고정 자료](frozen-fixtures-after-restart/summary.json)도 보존했다.

검증 도구 보완: 초기 OpenAPI 환경 누락과 서버의 로컬 메일 허용 플래그 누락을 수정했다. 첫 서버의 가입 요청은 env 가드에서 500으로 거절됐고 계정 중복 없이 다시 준비했다. 자동저장 후 수동 저장은 ‘저장된 내용과 같습니다’일 수 있어 대기 조건을 보완했다. 공유 준비 시 DB 행 ID 대신 계약의 logical ID를 사용하도록 수정했다. QA helper 타입 추론은 명시 타입으로 보완했다. 제품 오류를 성공으로 덮지 않았으며 관련 로그·기대는 유지했다.

전체 화면 이미지·스크린리더·원본과의 시각 일치는 미검증이다. 독립 [화면 코드 검토](frontend-review.json)의 세 지적은 해결했다. FILE 작성자 자산·NLP/자동동의·페이지 이동·나머지 R08 및 전 페이지 수용은 계속 진행한다. [품질 요약](quality-final.json)과 [소스 지문](source-fingerprints.json)은 이번 범위의 근거다.
