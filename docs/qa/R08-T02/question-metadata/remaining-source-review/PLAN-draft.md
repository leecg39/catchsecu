# 개인정보 분류·기타 직접입력 도입 계획 초안

기준은 보존 원본 번들의 정적 코드와 현재 로컬 소스다. 이번 작업은 계획·근거 파일만 작성했다. 제품 코드, DB, 브라우저, 서버, 앱 테스트를 실행하거나 변경하지 않았다.

- 원본: `main.183e9d2c.js`
- SHA-256: `3538d47856c6ba1b4207059dc09434066c7ca692a5907ed792dd9e27c7dba78f`
- REA Evidence: `ev_87493e79c4f053718022b23e1e5d42acf1af245f8c7838a89cd7ebc3918df152`
- 모든 위치는 0부터 시작하는 JavaScript UTF-16, 끝 제외다. 정확한 발췌·개별 SHA·로컬 파일 SHA는 [source-review.json](./source-review.json)에 있다.

## 우선순위

첫 단위는 **수동 개인정보 분류의 저장·편집**을 권장한다. 답변 구조를 바꾸지 않으므로 nullable metadata와 복제·개정·템플릿의 보존 계약으로 범위를 좁힐 수 있다. 원본의 NLP 분류, 자동 동의서 생성, 모든 경로의 개인정보 수집 검사까지 완료했다고 표현하면 안 된다.

그 다음은 **기타 보기와 답변 계약 전체**다. 현재 서버는 선택형 객체 답변을 거절하고, 조건 검사는 scalar/array만 읽으며, CSV는 임의 객체를 빈 문자열로 내보낸다. 따라서 기타 UI만 먼저 활성화하는 작은 변경은 성립하지 않는다. 모델·입력·조건·서버 검증·정정·표시·CSV를 한 묶음으로 다뤄야 한다.

| 순서 | 단위 | 종료 기준 | 후속에 남는 범위 |
|---|---|---|---|
| 1 | 수동 분류 nullable 저장/편집/요약 | 5개 분류, 이름 50 UTF-16, 확인 후 저장, 기존 DTO/지문 보존 | 자동 NLP·법적 동의문·경로 정책 |
| 2 | 기타 option 및 구조화 답변 | 3개 선택 유형, 최대 기타 1개, 입력 100, 조건/정정/CSV까지 연결 | 보기 이미지, FILE 참고자료 |
| 3 | 분류와 동의문 변경·경로 검증 | 현재 로컬 문서/승인 체계와 명시적으로 연결 | 원본 비공개 NLP 서비스 동등성 |
| 4 | 이미지·참고 FILE·일반 pattern | 각 별도 계약/권한/검증으로 진행 | 본 조사 밖 |

## 원본에서 확인한 계약

### 개인정보 분류

`catchFormPersonalInformationRequests`는 문항의 배열이며 각 항목은 `nlpFeedbackId`, `personalInformationType`, `detectedPersonalInformation`, `personalInformationSource`다. UI의 `type/name`을 wire 필드로 옮긴다. `isConfirm`과 오류 플래그는 저장 요청에 들어가지 않고, 로더가 저장 항목을 확인됨 상태로 복원한다. 관측한 source는 `NLP`/`USER`; 서버의 전체 enum은 미확인이다.

| 원본 enum | 편집 라벨 | 이름·전환 |
|---|---|---|
| PERSONAL_INFORMATION | 개인정보 | 공백만인 이름 거절 |
| SENSITIVE | 민감정보 | 공백만인 이름 거절 |
| IDENTIFICATION | 고유식별정보 | 공백만인 이름 거절 |
| RESIDENT | 주민등록번호 | 필수=true 및 필수 해제 금지 |
| NON_PERSONAL_INFORMATION | 개인정보 없음 | 이름 input 없음, 전환 시 이름을 비움 |

한국어와 비한국어 입력 모두 이름 `maxLength:50`이다. 이는 기존 광역 보고서의 ‘상한 미확인’을 보완한다. 빈 값 판정에는 trim을 쓰지만 serializer는 원래 name을 전송한다. 50자 서버 강제 여부는 미관측이므로 로컬 서버에서 동일한 UTF-16 상한을 적용하면 독립 보강으로 기록한다.

한국어 편집은 복수 항목과 플러스/삭제, 확인/편집 버튼을 제공한다. 확인 후 이름과 분류를 잠그며, USER 항목은 삭제할 수 있다. 행렬형 두 유형은 NONE 이외 분류의 확인을 거절한다. RESIDENT에서 다른 분류로 바뀌어도 기존 required=true를 자동으로 해제하지 않는다. NLP 결과의 RESIDENT 처리에서만 TEXTBOX/옵션·행렬 초기화가 확인되므로, 모든 수동 RESIDENT 선택이 질문 유형을 TEXTBOX로 바꾼다고 일반화하지 않는다.

비한국어는 수집 YES/NO UI와 첫 항목 중심 편집이다. NO는 확인된 NONE/USER 한 항목으로 바꾸며, YES 확인은 한 항목 배열로 저장한다. 언어 변경 reducer 자체는 주소 타입만 바꾸고 기존 detectedItems를 보존한다. **한국어 복수 항목이 있는 상태에서 언어를 바꿨다는 이유만으로 로컬 배열을 첫 항목으로 자르면 안 된다.** 로컬에서는 목록을 보존하고, 사용자 편집으로 단일화하려는 순간 명시적으로 설명하거나 언어 공통 복수 편집을 제공하는 차이를 기록해야 한다.

한국어 제목 변경은 NLP 요청 후 확인 상태를 재설정한다. 질문/페이지 복제도 분류·feedback ID를 비우고, 한국어는 재분석을 시도한다. 다음 단계는 항목 없음/미확인/이름 없음 등을 막는다. 경로별 수집 여부 및 기존 동의서 항목 변경도 별도로 검사한다. 이 흐름을 단순 메타데이터의 존재 여부와 동일시하지 않는다.

### 기타 직접입력

편집 보기 객체의 `isCustomValue:true`가 기타다. 별도 질문 유형이 아니다. RADIO/CHECKBOX/SELECTBOX에서 한 개만 허용하며, UI 숨김 외에 다음 단계 검사도 2개 이상을 거절한다. 보기 라벨은 직접 편집하며 250자 input 상한, 공백 라벨은 기타도 거절한다. 빈 새 기타의 ‘기타’ 문구는 placeholder이므로 저장용 실제 라벨과 구분한다.

기타는 마지막에 추가되고 새 일반 보기는 그 앞에 삽입된다. 원본 편집 코드는 삽입 시 value를 0-based로 다시 매기지만 현재 로컬은 stable ID/value를 보존해야 한다. 원본의 숫자 위치값을 기존 로컬 UUID 대용으로 사용하지 않는다. 기타는 non-drag이며 Enter로 새 보기를 만드는 동작은 일반 보기에서만 수행한다. 전체 보기 개수 상한은 조사 범위에서 미확인; 기존 로컬 100개 제한은 유지할 독립 계약이다.

선택 후 직접입력은 100자다. 미선택은 필수 여부에 따라 판단하고, 선택사항이라도 기타를 선택했다면 text.trim()이 비어 있으면 유효하지 않다. 기타는 선택수 계산에서 한 개이며, 선택 배열에 ID가 이미 있는 경우 중복 가산하지 않는다. 기타 해제/일반 보기 선택/드롭다운 변경은 이전 직접입력 텍스트를 비운다.

| 층 | CHECKBOX | RADIO/SELECTBOX |
|---|---|---|
| 원본 응답용 옵션 | customValueYn Y/N, value, name | 동일 |
| AI_V3 UI 상태 | `{optionValue:number[],isCustomValue:boolean,text:string}` | `{optionValue:number,isCustomValue:boolean,text:string}` 또는 null |
| 최종 제출 wire | `{optionValue,customValue,text}` 배열 | 동일 항목 한 개 또는 null |
| 일반 보기 항목 | customValue=false, text=null | 동일 |
| 기타 보기 항목 | customValue=true, text=직접입력 | 동일 |

이전 NEW/AI/AI_V2의 단일/드롭다운은 `value|text`를 사용한다. 이것은 AI_V3 객체 및 현재 로컬 string 답변과 구분할 레거시 형식이다. source 서버의 DTO 변환·길이 강제·모든 정정 화면 실행은 미관측이다. 선택수, disabled/readOnly, XSS-safe 텍스트와 임의 `|`, 쉼표, 개행을 구조체로 보존하는 검증이 필요하다.

## 단위 1의 최소 구현 제안

이 절은 **로컬 설계 제안**이며 원본 서버 스키마를 단정하지 않는다. 구현 전 root가 최종 계약을 확정한다.

1. `Question`에 선택적인 nullable 분류 배열을 추가하고 원본 wire 필드명과 enum을 재사용한다. 첫 구현은 USER 수동 입력만 만들고 원본 `nlpFeedbackId`를 위조하지 않는다. 새 항목은 null feedback ID를 사용한다.
2. 기존 logical question ID에 대한 PATCH/전체 콘텐츠 저장은 필드 생략 시 보존, `[]`은 명시 제거로 다룬다. 신규/구버전 null은 DTO에서 필드 자체를 생략한다. None 분류와 ‘아직 설정하지 않음/제거’는 서로 다르다.
3. 편집 모달 내 임시 목록과 저장한 확정 목록을 구분한다. 확인·적용 때 enum/이름50/행렬 NONE/RESIDENT required를 검사한다. 기존 원본 `isConfirm`를 서버 요청에 억지로 추가하지 않는다. 취소/다른 질문 이동/저장 중 이벤트가 다른 question ID에 적용되지 않게 한다.
4. 한국어 복수 항목을 지원한다. 분류 항목 개수 상한은 원본에서 확인하지 못했으므로 별도 로컬 상한(초안 후보: 문항당 20개)을 이름 붙여 결정한다. NONE과 다른 분류의 혼합·중복 항목은 원본 UI가 만들 수 있어 자동 제거를 원본 동등성이라고 주장하지 않는다. 명시 금지 정책을 택하면 독립 제약으로 문서화한다.
5. 제목 변경/복제에서는 무조건 NLP 호출을 흉내 내지 않는다. 변경 후 재확인 요구 여부 및 복제 때 clear와 보존 중 어떤 경계를 채택할지 정한다. 추천: 원본처럼 새 복제는 분류 재검토 상태로 만들되, 기존 개정의 명시적 생략 저장은 보존한다. 저장 wire와 다른 편집 검토 상태가 필요하다면 별도 로컬 상태로 명명한다.
6. `subjectRole` 이름/이메일 지정과 일반 분류를 연결해 덮어쓰지 않는다. 기존 동의문 내용·PDF·영수증을 이 metadata 도입만으로 바꾸지 않는다. 편집 화면과 요약에 수동 분류를 보여 주되 ‘자동 분석 완료’ 표현을 쓰지 않는다.
7. `contentDto`, `writeQuestions`, 개정/복제/템플릿 schema·명시적 projection까지 연결한다. 기존 null DTO/승인 fingerprint/저장된 PDF byte/hash가 유지되고 신규 분류 변경만 해당 초안 fingerprint에 반영되는지 확인한다.

정확한 코드 접점은 `src/contracts/questions.ts:18`, `prisma/schema.prisma:1314`, `src/server/forms.ts:42,153`, `src/components/forms/FormEditor.tsx:120`, `src/contracts/form-copy.ts:4`, `src/server/templates.ts:94`다. 현재 로컬 SHA는 JSON의 localSnapshots를 기준으로 한다.

## 단위 2의 최소 구현 제안

1. `OptionDefinition`/QuestionOption의 optional custom 플래그와 3개 질문 유형 제한, 질문당 최대1개를 정의한다. false/default를 모든 구버전 DTO에 새로 삽입하여 fingerprint를 바꾸지 않는다. 구버전 일반보기 label500와 새 source-fidelity label250의 호환 규칙을 분리한다.
2. 안정 ID/value를 보존하는 custom 답변 union과 codec를 먼저 정의한다. 예시는 `{kind:'custom-choice', selectedValues:string[], custom:{optionId:string,text:string}|null}`처럼 명시 discriminator를 가진 로컬 구조다. 이 예시는 원본 wire가 아니며 최종 계약은 root가 선택한다. 일반만 선택한 기존 답변은 string/string[]을 계속 허용하여 과거 응답을 변환하지 않는다.
3. custom option ID는 현재 question 소유여야 하고 실제 선택 목록과 연결되어야 한다. 일반 옵션에 custom text, 미선택 custom text, 타 문항/삭제된 ID, 중복 기타, 행렬 custom을 거절한다. 입력 100 UTF-16과 trim-empty를 서버에서도 검사한다. 원문 문자열을 자동 pipe 결합하거나 trim하여 정보 손실시키지 않는다.
4. `visibleQuestionIds`, `isEmptyAnswer`, `emptyAnswer`, `formatAnswer`, answer schema/server validator, `QuestionInput`에 동일 codec를 사용한다. 분기 조건은 기타의 option ID/value 선택 여부를 비교하며 임의 입력 텍스트와 비교하는 새 정책은 이번에 추가하지 않는다.
5. 편집에서는 ‘기타 항목 추가’, 이름 편집, 제거, 일반 추가·재정렬에서 ID 보존, 유형 전환을 연결한다. 기존 조건에 연결된 기타를 제거하려면 연결을 먼저 해제하는 현재 보호를 유지한다. 다른 선택 유형으로 전환할 때 custom 플래그는 보존하며 행렬/비선택형 전환은 명시 처리한다.
6. 공개 제출뿐 아니라 기존 응답 정정/취소/비우기/재입력, 읽기 전용, 목록·공유·업무화면, 동기/비동기 CSV까지 구조화 답변을 표시한다. 현재 `export-renderer.ts:51`은 object를 빈값으로 만들므로 반드시 같은 단위에서 수정한다.
7. 기타 이미지 금지 경계를 유지한다. 표시 텍스트는 React text로만 렌더하고 외부 요청/HTML로 처리하지 않는다. DTO와 template/copy의 새 플래그 전파 및 기존 저장 PDF 불변을 확인한다.

## 실행 시 필요한 검증 계획 — 이번 조사에서는 미실행

| 묶음 | 구체 시나리오와 기대값 |
|---|---|
| 분류 계약 | 5 enum/잘못된 enum, 49·50·51 UTF-16, 이모지 포함, 공백만 이름, NONE의 빈 이름, NLP source/가짜 feedback ID를 첫 수동 API가 받지 않음 |
| 분류 표시·편집 | 추가·삭제·확인·수정·취소·dirty 이탈, 질문A에서 연 모달의 결과가 재정렬 뒤에도 A에만 적용, busy 중 입력/모달 완료 차단 |
| 분류 제약 | 행렬 NONE 성공/다른 분류 실패, RESIDENT 필수 강제 및 해제 거절, 일반 분류로 바꾼 뒤 required 자동 해제 없음 |
| 언어 | 한국어 복수 항목→영어→한국어에서 묵시적 항목 유실 없음, NONE/YES 변경의 명시적 삭제, 제목만 수정할 때 재확인 정책 적용 |
| 분류 버전 | null 구버전 DTO/hash 동일, 기존 logical ID 생략 보존/[] 제거, 새 ID에는 이전 분류 잘못 상속하지 않음, 승인 중 변경 충돌, 복제/개정/템플릿 정책 일치 |
| 기타 편집 | 세 타입만 허용, 기타1개/2개거절, 이름250/251 및 기존500문자 보존, 일반100개 한도와 기타 포함 계산, 유형 전환/재정렬/조건 연결 ID 유지 |
| 기타 입력 | 필수·선택사항 각각 미선택/일반/기타공백/기타100/101, 해제·다른 선택·다시 선택 때 텍스트 상태, checkbox exact/max에 기타가 정확히1개 |
| 기타 공격/오류 | 타문항 ID/삭제 ID/custom flag 위조/일반 옵션에 text/선택 안 한 기타 text/두 custom/행렬 object, 텍스트에 pipe·쉼표·개행·HTML·아랍어·이모지 보존 |
| 정정·조건 | 새 기타 응답을 불러와 수정/취소/빈값/일반전환, 숨겨진 조건 답변 거절·정리, 일반↔기타 조건 전환, 제출 잠금 중 잔여 이벤트 불변 |
| 하위 표면 | 공개·미리보기·응답상세·Workflow·SharedPrivacy·CSV에서 label/text 유실 없음, 권한별 원문 가림 유지, CSV formula escaping 유지 |
| 과거 데이터 | legacy string/array 파싱 및 표시 동일, 새 답변 union이 행렬/주소/DRAW와 충돌하지 않음, 구버전 승인/영수증/PDF 재해시·재생성 없음 |

## 미확인과 완료 주장 경계

원본 서버의 이름/보기 개수 상한, 분류 모델 전체, NLP 판단, 템플릿 서버 내부 복제, 모든 관리자 정정 세대의 DTO는 확인하지 못했다. 서버 오류 처리 코드가 있다는 사실과 실제 서버 실행을 구분한다. 이번 결과는 원본 정적 분석과 로컬 차이·계획이며 기능 구현/시험 통과나 원본과의 전체 동등성을 뜻하지 않는다.
