# 폼 언어·국제 연락처·다국어 PDF 검증

2026-10-10. R08-T01/T02, F3/F5의 [실행 계획](PLAN.md) 중 아래 범위를 구현하고 실제 DB/API/Ego/재시작으로 검증했다. 전체 107개 작업이나 16언어 기능의 완료 기록이 아니다.

## 확인한 구현

원본 [분석](source-review.json)에 따라 CONTACT와 폼 언어의 조합으로 국제 연락처를 표시한다. 원본16개 언어, 181개 국가/179개 전화코드를 사용하며 `+국가번호 공백 6~15자리 숫자` 문자열을 저장한다. 선택 질문도 국가/번호 중 일부만 입력하면 거절한다. +1/+7은 공유 국가를 함께 표시하고 특정 국가로 추정하지 않는다. 서버 검증은 원본 서버의 관측 결과가 아니라 별도 구현 계약이다.

nullable FormVersion.formLanguage는 이전 행에서 null로 유지하고 기존 DTO에서는 생략한다. 새 편집기는 한국어를 명시한다. 복제·개정·템플릿·공개 제출·정정은 해당 버전 언어를 사용한다. 외국어의 본인인증/서명 설정은 거절한다. 언어 설정과 질문 유형 선택의 주소 변환은 [리뷰](ui-review.json) 수정 후 [실제 화면](flow/browser-address-type.json)으로 확인했다.

[원본 시스템 문구](system-copy-source.json)는16언어/1,552개 leaf의 출처와 위치를 보존한다. [후속 연결](f5-source-connection.json)에서400개를 추가해 현재1,952개다. 국제 연락처 국가명·입력·검증, 선택 해제, 제출·완료·감사 안내·상한 마감, 해외 주소·선택 검증·필수/선택·처리방침 표시를 연결했다. 원본 번역의 숫자 마크업만 제거하고 사용자 변수는 그 뒤 삽입한다. 기존 법률 문서·문구와 해시는 바꾸지 않는다. [남은 번역 계획](remaining-localization-plan.json)의 미연결 문구를 전체 번역 완료로 표시하지 않는다.

## DB와 시험

- [migration 전](migration-before.json)·[후](migration-after.json)의 기존8개 테이블 공통 컬럼 해시가 같다. 이전 버전 언어는 모두 null이다. dev/test와 [빈 스키마](fresh-schema.json)에117개 migration을 적용했고 schema-contract의 예상 밖 차이는0이다.
- [국제 연락처14개](test-after.log)가 통과했다. [관련 회귀](regression.log)는178개 중177개 통과,1개가 기존9유형 fixture에서 새 CONTACT 답변을 누락해 실패했다. fixture를 전체16유형과 실제 DRAW/FILE 업로드로 확장한 [수정 재시험](regression-repair.log)15개가 통과했다. 중복을 제외한 최신 결과는13파일192개 통과다.
- PDF/번역까지 통합한 마지막 [8파일126개 시험](pdf-integration.json)이 모두 통과했다. 문서 PDF, 동의 영수증, 권한, 청구서, 월마감, 국제 연락처, 번역, PDF v2를 포함한다. 앞의192개와 중복이 있으므로 합산하지 않는다.
- [기존13개 고정 fixture](frozen-fixtures/final/summary.json)는 새 production 재시작 후에도 변경되지 않았다. [호환 지문 규칙](frozen-snapshot-policy.json)은 새 nullable 컬럼이 null인지 확인한 뒤 과거 지문에서 생략한다.
- 최종 [타입 검사](typecheck-pdf.log), [production build](build-pdf.log), [OpenAPI 생성](openapi-final.log)311경로가 통과했다. [린트](lint-final.log)는 오류0/기존 이미지 경고2다. 검증 범위는 [품질 기록](quality-final.json)에 명시한다.

## 실제 Ego 흐름

[언어 선택](flow/browser-language-options.json) → [영어 저장과 주소 변환](flow/browser-editor.json) → [게시·직접 API 거절](flow/publish-http.json) → [브라우저 검증 실패](flow/browser-validation.json) → [제출](flow/browser-submit.json) → [암호화 DB](flow/verify-flow.json)를 확인했다.

[취소·입력 버리기](flow/browser-cancel.json)는 변경 전 번호와 빈 선택값을 복원했다. [실제 정정과 이력](flow/browser-correction.json), [DB 정정](flow/verify-correction.json), [다운로드한 CSV](flow/csv.json)가 일치했다. 빈 구조화 주소는 기존 export 정책에 따라 빈 CSV 셀로 내보내며, 이를 JSON으로 읽으려던 검증 helper를 수정했다. 국제전화 앞의 작은따옴표는 CSV 수식 방지 처리다.

정정 잠금의 첫 관측은 `.disabled` 속성만 확인해 실패했다. [후속 관측](flow/browser-correction-pending.json)은 `:disabled`로 fieldset 상속까지 포함한14개 제어의 잠금, NO_CHANGES 서버 거절 후 입력값 보존과 잠금 해제를 확인했다. 실제 정정은1건이며 재제출로 이력을 늘리지 않았다.

[영어 화면](flow/browser-responsive-en.json)과 [아랍어 화면](flow/browser-responsive-ar.json)의390/768/1440px DOM 경계에서 가로 넘침이 없었다. 아랍어 양식은RTL, 전화번호 입력은LTR이다. 전체 화면 스크린샷 검증을 대신한 것으로 주장하지 않는다. [캡처 한계](flow/visual-capture-limit.json)는 별도로 남겼다.

[아랍어 발행](flow/prepare-arabic-http.json) → [실제 입력·제출 잠금·완료](flow/browser-submit-ar.json) → [원문 제목·암호화 응답](flow/verify-arabic.json)을 대조했다. [영문 해외 주소](flow/browser-translated-address.json)는 표시 문구·국가 선택·입력을 확인한 뒤 제출하지 않고 새로고침으로 비웠다. 기존 countryName 저장 계약은 그대로다.

최종 프로세스84141→85598 재시작 후 [영어/아랍어 화면](flow/browser-after-restart.json)과 [DB 지문](flow/verify.json)이 유지됐다. 폼2·응답2·정정1·감사25건, SHA-256 `779fa58463567b42c3c33caa398c52823942eec7a2dafbf31b97ff09a2fd8946`이다. 이 fixture는 이제 읽기 전용으로 검증하며 과거 기준을 덮어쓰지 않는다.

## 다국어 PDF 수정과 검증 한계

아랍어 제목/본문을 가진 실제 폼은 처음 [PDF_UNSUPPORTED_CHARACTER](flow/arabic-publish-failed.json)로 발행이 거절됐다. [글꼴·bidi 분석](pdf-language-gap.json) 후 v2 renderer를 추가했고 같은 원문으로 발행이 통과했다. 기존 v1 지원 문자는 기존 경로를 사용한다. 같은 Node24에서 수정 전 소스와 현재 v1의 바이트가 일치하며, 이미 저장된 PDF/영수증은 다시 생성하지 않는다.

[PDF 실행 보고](pdf-v2-execution.json)·[독립 코드 검토](pdf-v2-review.json)·[실제 렌더 이미지 검토](pdf-v2-visual-review.json)를 보존했다. Arabic/Thai/Turkish 및 혼합 문자, 여러 페이지와 머리말/꼬리말을 검사했다. 확인한 페이지와 원본 PDF 해시는 visual-reviewed 폴더에 고정했다. 19개 무DB 시험과 이를 포함한 마지막126개 회귀가 통과했다. 새 언어3종의 문서/양식/암호화 영수증 실제 DB 시험6개도 포함한다.

50만 자 아랍어는 약3.18초에222페이지로 생성하고 전체 원문 해시를 보존했다. 같은 크기의 계산량이 큰 태국어·제로폭 입력은 문서 전체 작업량 제한으로422 PDF_TOO_COMPLEX를 반환한다. 최대 길이 이하라도 복잡성 제한을 받을 수 있다.

PDF의 ActualText에는 논리 순서의 원문을 보존한다. PDF.js6.3.289의 복합 아랍어 결합문자·괄호·숫자 추출 순서는 아직 원문과 다르므로 모든 뷰어의 복사/검색 정확성을 통과로 주장하지 않는다. bidi-js는Unicode13, 분절은Node24/ICU78.3 기준이다. 전체 화면 시각 일치·추가 번역·본인인증 서명·질문 메타데이터·여러 페이지 등 F3/F5·R08과 승인된107개 작업은 계속 진행한다.
