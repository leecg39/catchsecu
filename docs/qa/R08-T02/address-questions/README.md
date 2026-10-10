# F3 주소·해외 주소 검증

2026-10-10. 승인된 R08의 부분 체크포인트다. 국내 주소 문자열과 해외 주소 7필드를 모델·서버·입력·정정·표시·CSV에 연결했다. 전체 페이지/질문 유형 구현 완료는 아니다. [실행 계획](PLAN.md).

## 원본과 구현 계약

- [원본 분석](source-address-review.json): retained bundle SHA `3538d47856c6ba1b4207059dc09434066c7ca692a5907ed792dd9e27c7dba78f`, 12관찰/31발췌. UTF16 범위와 REA 근거를 보존한다.
- [국가 목록 추출](country-catalog.json): 원본 AST에서 코드 실행 없이 181개 국가·16언어 이름을 추출했다. 현재 UI/국가명 정규화는 한국어다. 다른 언어 자동 전환은 F5 범위다.
- 국내: `(우편번호) 기본주소 상세주소` 문자열. 신규 입력은 실제 카카오 검색과 최대100자 상세주소다. 기존 저장 문자열은 원본에도 상세주소 역분리 근거가 없어 전체주소 입력으로 보존한다. 신규 입력 중 재검색은 상세주소를 유지하며 기존 저장값에서 새 주소 검색은 전체값을 교체한다.
- 해외: `country,countryName,streetAddress,addressDetail,city,state,postalCode` 7문자열. 국가 ISO와 텍스트5필드의 255/255/100/100/20자 제한, 필수 국가·도로명·도시, 선택 질문의 핵심3필드 모두 비움/모두 입력 규칙을 연결했다. 선택 질문의 상세·지역·우편번호만 입력하는 원본 동작도 허용한다.
- 국내5자리 형식/1000자 상한, ISO 허용 목록, trim·고정 키 순서·한국어 국가명 정규화는 독립 서버 계약이다. 원본 서버의 정규식/DB 규칙을 관측했다고 주장하지 않는다.
- 공개/정정 API는 타입 교차 주입·알 수 없는 필드·국가·부분 핵심값을 거절한다. 해외 CSV는 비어 있으면 빈 셀, 값이 있으면 고정7키 JSON 셀이다. 기존 scalar/choice/matrix 내보내기는 유지한다.

## DB·서버 검사

[업그레이드 전 시험](test-before-migration.log)은 1통과/14실패로 기존 `Question_type_check` 거절을 재현했다. [migration115](../../../../prisma/migrations/20261025005000_address_questions/migration.sql)는 타입 CHECK만 확장한다. [전](migration-before.json)/[후](migration-after.json) 기존8테이블 전체 행·컬럼 해시가 일치하며, [새 전용 빈 스키마](fresh-schema.json)에115개 migration 설치가 통과했다.

[개발 DB 계약](schema-dev-contract.json)과 [시험 DB 계약](schema-contract/catchsecu_test-contract.json)의 예상 밖 차이는0이다. raw Prisma diff가 표시하는 회사 폐쇄요청 FK1개는 기존 SQL 전용 제약이며 정의/검증 여부를 별도 확인했다. 제거하거나 무시한 미확인 차이가 아니다.

[주소15개](test-after-migration.log)와 [회귀6파일70개](regression.log), 고유7파일85개가 통과했다. 실제 암호화 저장, 원자적 실패, 숨김 주입/정정, key-order·공백·국가명만 변경한 NO_CHANGES, 복제/템플릿/개정·이전 게시/답변 불변, 동기/worker CSV, 외부 공유 challenge/verify 후 제한된 값 열람을 포함한다. 이전 전체1834개 기록과 합산하지 않는다. [백엔드 검토](impact-review.json).

## 실제 HTTP·Ego

새 전용 소유자/회사/폼만 사용했다. [준비HTTP4](flow/prepare-http.json), [게시·거절HTTP6](flow/publish-http.json)을 실행했고 [Ego 편집](flow/browser-editor.json)에서 주소4질문의 유형을 직접 바꾸고 저장했다. 초기 사용자·이메일 인증 설정은 로컬 시험 준비이며 외부 이메일 전달 증거가 아니다.

- [검증 실패](flow/browser-validation.json): 해외 국가만 입력하면 native 검증이 막고 도로명에 초점을 준다. 다른 필수 입력을 채운 뒤 국내 주소 누락은 composite 검증이 제출을 막고 검색 버튼에 초점을 준다. 두 경우 제출 요청0. 선택 해외 주소 상세/지역/우편번호만 입력 가능.
- [실제 카카오 검색](flow/browser-provider.json): 서울시청 도로명 검색→선택으로 `04524`, `서울 중구 세종대로 110`을 받았다. [SDK 요청 차단](flow/browser-sdk-failure.json) 후 다시 시도해 실제 검색으로 복구했다. 공식 주소 검색을 사용했으며 본인확인으로 취급하지 않는다.
- [공개 입력](flow/browser-public.json): 상세주소를 입력한 뒤 재검색해도 유지된다. 390/768/1440px DOM 가로넘침0, 국가→도로명 Tab 이동을 확인했다.
- [실제 제출](flow/browser-submit.json): 3초 네트워크 지연 중 disabled와 iframe 제거를 확인했다. 가상 성공 응답을 주입하지 않았다. [DB 대조](flow/verify-flow.json): 응답1, 국내 문자열/해외 객체/선택 상세만 입력/선택 국내 빈값이 모두 일치한다.
- [취소·정정](flow/browser-correction.json): 입력 버리기 후 원래 전체주소/도시를 복원했다. 390/768/1440px 정정 dialog의 가로넘침0. [정정 DB](flow/verify-correction.json): 버전2·정정1, 국내101호→202호와 해외 도시만 변경, encrypted before/after와 나머지 응답 보존을 확인했다.
- [브라우저 CSV 다운로드](flow/csv.json): 내려받은 실제 파일의 국내 문자열·해외7필드 JSON·선택 값이 정정 DB와 일치한다. 원문 다운로드는 ignored `.local`에 보관한다.

[독립 UI 검토](ui-review.json)에서 제출 중 늦은 SDK 결과로 화면과 전송값이 달라질 수 있는 P2 경로를 찾아 수정했다. busy/pending 상태를 전달해 검색 컴포넌트를 제거하고 콜백에서도 변경 전에 잠금을 확인한다. 공개 제출 지연 시험은 통과했으며 정정 중 지연 조합은 정적 검토 범위다.

## 재시작·품질과 제한

[빌드](build.log)·[최종 타입](typecheck-final.log)·[변경 린트](lint-final.log)·[OpenAPI311경로 생성](openapi-generation.log)이 통과했다. `.next-rea-address-questions` production 서버를 실제 재시작하고 [Ego 전](flow/browser-before-restart.json)/[후](flow/browser-after-restart.json) 질문4유형을 대조했다. [동결](flow/freeze.json)/[재검증](flow/verify.json)은 폼1·응답1·정정1·감사12건, SHA `57379b35bc4970f31f70dd2344800a7a9da61fd0d569fdd0bdc82cdc77dc85ac`로 일치한다. [기존11세트](frozen-fixtures/summary.json)도 이전 해시를 유지했다.

[이미지 제한](flow/screenshot-limitation.json): 이전 표준 캡처 시간초과 후 이번 별도 캡처도 제어 페이지 DOM과 다른 픽셀을 반환했다. 해당 이미지를 폐기했으며 시각적 원본 일치를 통과로 집계하지 않았다. SDK 닫기 중 늦은 로드, 정정 중 제공사 지연의 모든 조합, 주소의 PDF 전용 표현은 별도 수용이 남아 있다.

DRAW/서명·국제 연락처·개인정보 분류/설명/이미지/첨부·다중페이지·언어/게시 설정·전체 페이지 상태 수용을 계속한다. 작업 상태는107개 중0완료·53진행·54계획이다. 이 주소 fixture는 동결 후 `scripts/qa-rea-address-flow.ts verify`만 실행한다. 비밀 계정·쿠키·토큰은0700/0600의 ignored `.local`에만 저장한다.
