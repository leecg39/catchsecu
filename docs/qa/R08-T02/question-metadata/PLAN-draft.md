# F3 질문 메타데이터 구현 초안

읽기 전용 원본 대조 결과에 근거한 단계별 초안이다. 이번 조사에서 제품 코드·테스트·DB·브라우저를 변경하거나 실행하지 않았다. 원본 서버의 비공개 값과 검증 규칙은 추정하지 않는다.

근거: [source-review.json](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/source-review.json). 원본 main.183e9d2c.js SHA-256 `3538d47856c6ba1b4207059dc09434066c7ca692a5907ed792dd9e27c7dba78f`, REA `ev_87493e79c4f053718022b23e1e5d42acf1af245f8c7838a89cd7ebc3918df152`. JSON의 발췌 오프셋은 0부터 시작하는 UTF-16이며 끝은 제외한다.

## 우선 결정

첫 구현은 **질문 설명만** 권장한다. 원본 V3 내부 `description`은 저장 payload에서 `additionalExplanation`이 되고, 선택 textarea의 최대길이는 3,000자다. 공개 화면은 `<pre>{additionalExplanation}</pre>`로 출력한다. 따라서 평문과 줄바꿈을 보존하는 문자열 계약이 관측과 맞는다. 이미지·링크는 별도 자산/자료 필드이므로 설명을 rich HTML로 확장할 근거가 없다.

개인정보 분류는 `detectedItems[]`에서 `catchFormPersonalInformationRequests[]`로 변환되는 별도 배열이다. 분류·이름·출처·확인, 언어, 분기 검사 및 동의 항목 집계까지 연결되므로 설명과 한 변경으로 묶지 않는다.

## 원본 대조

| 항목 | 확인된 원본 | 현재 로컬 차이 | 경계 |
|---|---|---|---|
| 설명 | `description` ↔ `additionalExplanation`, 선택 평문, V3 3000자, 공개 pre | Question strict 계약/DB/DTO/편집·공개 UI에 없음 | 원본 서버 상한 미관측 |
| pattern | 응답의 `infoPatternId`, `patternRegex`를 렌더러가 소비 | 전용 CONTACT/EMAIL/BIRTH 검증은 있으나 일반 pattern metadata 없음 | regex 실제 값·편집/저장 API 미관측. 범용 편집 버튼 누락으로 단정하지 않음 |
| 보기 이미지 | RADIO/CHECKBOX, 기타 제외, JPEG/PNG 1MiB, 질문당 20개, key 저장 | 보기 id/label/value만 저장·표시 | 서버 quota·검사·권한 미관측 |
| 참고 자료 | FILE/LINK 합계 3개, 순서, 링크 512/표시명100, 파일 pdf/docx/ai 5MiB | 질문 자료 없음; 기존 응답 파일은 별도 10MiB 계약 | 작성자 자산과 응답 파일을 구분 |
| 기타 직접입력 | RADIO/CHECKBOX/SELECTBOX 최대 1개, text100, 선택하면 text 필수 | 일반 string/string[]만, custom UI/답변 union 없음 | V3 구조체와 구형 value\|text 형식을 구분 |
| 개인정보 분류 | 개인정보/민감/고유식별/주민번호/없음, USER/NLP, 확인·언어·집계 | `subjectRole` name/email만 존재하며 동등하지 않음 | NLP·서버 이름상한·강제 규칙 미관측 |

## M1 — 설명 한 단계 완결

1. 로컬 독립 이름 `description?: string`을 선택 입력 0~3000 UTF-16으로 정의한다. 원문 공백/개행은 유지하고 HTML로 해석하지 않는다. 없는 필드와 빈 설명은 과거 DTO/hash에 새 키를 주입하지 않도록 정규화 정책을 명시한다.
2. [questionSchema](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/questions.ts:16), [Question 모델](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/schema.prisma:1314), [writeQuestions](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/forms.ts:150), [contentDto](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/forms.ts:40)를 함께 연결한다. 변경 비교에서도 설명만 바뀐 요청을 놓치지 않는다.
3. FormEditor 질문 제목 아래 선택 textarea와 길이 표시를 둔다. 공개·템플릿 미리보기·정정 입력 문맥에서 같은 설명을 읽을 수 있도록 표시한다. `white-space: pre-wrap` 등으로 개행/긴 단어/모바일 폭을 보존하고 설명 ID를 입력의 `aria-describedby`에 연결한다. 이는 로컬 접근성 구현 제안이다.
4. `reviseForm`, `copyForm`, `cloneFormContent`, 템플릿 저장·사용에서 설명을 보존한다. 응답 값·질문 UUID·보기 UUID·조건 그래프는 바꾸지 않는다. 설명은 CSV 답변 셀로 삽입하지 않는다.
5. 기존 승인의 [fingerprint](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/forms.ts:77)와 저장 PDF 바이트를 보존한다. 새 설명 수정은 해당 초안 지문을 바꾸어야 하지만 과거 저장 PDF를 재생성할 이유는 없다.

검증 시나리오:

- 0/1/3000/3001 경계와 astral emoji의 UTF-16 길이, 개행·선행 공백·태그 모양 텍스트·긴 URL을 API와 UI에서 확인한다. 태그는 실행되지 않고 원문으로 보인다.
- 새 폼 저장→재조회→설명만 수정→개정→복사→템플릿 생성/사용의 정확 문자열 보존. 설명 제거 후 재조회와 다른 질문 metadata 보존.
- description 없는 legacy row의 기존 승인 지문, 게시 버전, 이전 제출 내역, 저장 PDF SHA 불변. 새 초안 설명 변경 뒤 기존 승인 재사용 차단.
- 409 충돌 시 입력 보존과 저장 중 잠금, tenant/service 권한 재검사. 공개 질문이 숨겨질 때 설명도 함께 숨김.
- 공개·미리보기·정정의 한국어/영어/Arabic 개행과 방향·모바일 배치. 사용자 작성 설명 자동번역 없음.

## 이후 순서와 완료 경계

| 순서 | 독립 단위 | 선행 결정 및 완료 조건 |
|---|---|---|
| M2 | 참고 LINK만 | 자료 합계3/순서/http(s)/URL512/label100. 링크 새 탭 및 안전한 rel, 서버에서 URL fetch하지 않음. 저장·미리보기·copy/revise/template 포함 |
| M3 | 수동 개인정보 분류 스냅샷 | 원본 enum/배열을 반영하되 이름/개수 상한은 독립 로컬 계약으로 명시. 동의 문서 자동 연결과 NLP는 별도 |
| M4 | 기타 직접입력 | stable UUID/value 불변, explicit custom option/answer 구조, 기존 string/array 답변 호환. 조건·개수·정정·조회·CSV를 함께 완료 |
| M5a | 작성자 자산 기반과 보기 이미지 | 소유권/검사/임시수명/공개 접근/복사/게시불변을 먼저 정의. RADIO/CHECKBOX, custom 제외, 1MiB/20개 |
| M5b | 참고 FILE | M2 자료 목록과 M5a 자산 재사용. pdf/docx/ai 5MiB/전체3개를 별도 검증 |
| M6 | 범용 pattern | 원본 실제 regex/설정 근거 확보 또는 독립 명명 규칙 설계 전까지 보류. raw regex를 추측해 노출하지 않음 |

M3을 메타데이터 저장만으로 제공한다면 UI에서도 수동 분류라는 경계를 표시해야 한다. 원본처럼 자동 동의 항목 반영까지 완료했다고 표시하지 않는다. 현재 정보주체 조회 역할 `subjectRole`과 분류를 합치지 않는다.

## 단계별 후속 검증

- **참고 링크:** javascript/data/file·상대 URL 거절, http/https 및 trim·길이 경계, 빈 label URL fallback, 3개와 reorder/delete/copy. 다른 언어에도 저장값은 그대로이며 버튼 system copy만 분리한다.
- **개인정보 분류:** NONE에 해당하는 `NON_PERSONAL_INFORMATION`의 이름 없음, 다른 enum의 trim 필수, 여러 항목·확인 취소·유형 변경, matrix 제한, RESIDENT required 처리의 로컬 정책 확정. NLP 성공을 가짜로 생성하지 않는다. 기존 동의 문서/approval snapshot 불변을 먼저 검증한다.
- **기타 답변:** optional 미선택/선택 후 빈값/공백/100/101, 일반+기타 복수선택과 exact/min/max, deselect 후 text 처리, 조건 만족/숨김/재표시, readOnly 및 정정·취소. 보기 label/reorder/copy 후 custom 연결이 유지된다. 일반 응답과 custom 응답의 CSV 표시를 검증한다.
- **자산:** 질문/보기 삭제·재정렬·유형변경·기능 해제 중 늦게 도착한 upload 성공, 교체 실패/재시도, quota 경계, 악성·잘못된 MIME·확장자·크기, tenant/form/version 간 임의 key 재사용 차단, 공개 다운로드 범위. 게시 버전이 쓰는 파일은 초안 삭제로 제거되지 않아야 한다.
- **pattern:** 자료 확보 전 placeholder나 이름만 보고 regex를 역추정하지 않는다. 독립 규칙을 선택하면 타입별 적용/선택 빈값/Unicode/길이/서버와 클라이언트 일치 및 실행 비용 한도를 해당 계약의 테스트로 정의한다.

## 검토 범위 밖과 미확인

원본 서버의 최대길이·권한·NLP 결과·정규식·파일 검사·quota는 실행으로 확인하지 않았다. 본 계획은 저장 번들의 프런트 관측 및 현재 로컬 소스에 근거한다. 질문 이미지 자체, 전체 자동 동의서 생성, 전체 NLP 복원, 외부 자산 서비스 도입은 이번 첫 구현에 포함하지 않는다.

제품 파일이 다른 작업자에 의해 변경될 수 있으므로 JSON의 로컬 파일 SHA와 조사 시각을 기준으로 비교한다. 이번 산출물은 두 문서만 작성하며 테스트는 후속 구현 담당자가 실행한다.

[결과물 폴더](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata)
