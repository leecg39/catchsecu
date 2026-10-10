# 기타 보기·직접입력 전체 계약 초안

상태: **설계 제안, 미구현·미실행**. 읽기 전용 조사와 이 폴더의 문서 작성만 수행했다. 제품·DB·마이그레이션·테스트·브라우저·빌드는 실행하거나 변경하지 않았다. 일반 보기의 기존 API 500 유지, 새 편집 UI 250, 새 기타 보기의 서버 250 UTF-16 상한은 root와 확인한 권장안이다. 나머지 신규 wire·오류명·CSV 표현은 구현 전 확정할 초안이다.

## 1. 근거와 관찰 경계

- 원본 보존 번들: `outputs/catchsecu-reverse-2026-10-09/bundle/main.183e9d2c.js`.
- 원본 SHA-256: `3538d47856c6ba1b4207059dc09434066c7ca692a5907ed792dd9e27c7dba78f`.
- REA Evidence: `ev_87493e79c4f053718022b23e1e5d42acf1af245f8c7838a89cd7ebc3918df152`.
- 기존 조사: [원본 발췌](../question-metadata/remaining-source-review/source-review.json), [이전 계획](../question-metadata/remaining-source-review/PLAN-draft.md).
- 이번 [backend-impact.json](./backend-impact.json)은 원본 발췌의 UTF-16 범위·SHA 검증과 **분류 migration120 반영 후 현재** 로컬 파일 SHA, 줄 번호, 전파 지점을 담는다. 이전 조사의 localSnapshots와 현재 SHA를 혼용하지 않는다.
- 원본 내용은 정적 관찰이다. 원본 서버의 실제 제출·정정 성공, enum/길이 강제, DB 모델, CSV/PDF 표현은 관측하지 않았다. 여기의 새 discriminator, 안정 UUID 결합, 서버 검증, CSV 구조는 독립 계약이다.

## 2. 원본에서 확인한 동작

| 대상 | 정적 관찰 | 발췌 ID / UTF-16 범위(0 기반, 끝 제외) |
|---|---|---|
| 보기 정의 | `isCustomValue:true`가 기타이며 별도 질문 유형이 아니다. RADIO/CHECKBOX/SELECTBOX에 한 개만 허용한다. | `other_add` 12676950–12678710, `other_next_count` 12802900–12804040 |
| 편집·순서 | 기타는 마지막, 새 일반 보기는 기타 앞. 기타는 non-drag. 보기 이름 input은 250, trim-empty는 다음 단계 거절. ‘기타’는 빈 이름의 placeholder다. | `other_editor` 12682500–12684690, `other_next_labels` 12800470–12801715 |
| 직접입력 | 선택한 기타 입력은 100. 선택사항이라도 기타를 선택했다면 trim-empty를 거절한다. 해제·다른 보기 선택 시 입력을 비운다. | `other_checkbox_input`, `other_radio_input`, `other_dropdown_input`, `other_codecs` |
| 선택 수 | 기타를 1개로 계산하고 이미 배열에 포함된 경우 두 번 세지 않는다. | `other_selection_count` 8165438–8165955 |
| AI_V3 UI 상태 | 체크박스 `{optionValue:number[],isCustomValue:boolean,text:string}`. 단일/드롭다운은 해당 단일 값 객체 또는 null. 체크박스 codec의 숫자 배열은 기타를 별도 boolean으로 표현할 수 있다. | `other_codecs` 8221674–8223900 |
| 최종 원본 wire | 체크박스는 `{optionValue:number,customValue:boolean,text:string|null}[]`, 단일/드롭다운은 한 항목 또는 null. 일반 항목 text=null, 기타 항목 text=입력값. | `other_submit` 10057077–10058066 |
| 과거 세대 | NEW/AI/AI_V2 단일/드롭다운은 `value|text`. 이 형식을 AI_V3 또는 로컬 기존 답변 형식으로 간주하지 않는다. | `other_legacy_codecs` 8220410–8221674 |

원본의 위치 숫자를 로컬 stable option ID/value로 바꾸거나 기존 UUID를 재번호화하지 않는다. 원본의 이미지·참고 FILE, 자동 NLP, 직접입력 내용에 대한 분기 비교는 이 단위에 포함하지 않는다.

## 3. 보기 metadata 계약

기존 `OptionDefinition {id,label,value}`에 **`isCustomValue?: boolean`**을 추가하고 `QuestionOption.isCustomValue Boolean?`를 신설한다. 기존 행 백필은 하지 않는다. wire의 true는 기타, false는 명시 해제, 생략은 현재 동일 logical option의 설정 보존이다. 저장·조회에서는 true만 내보내고 false/없는 값은 SQL null 및 DTO 필드 생략으로 정규화한다. wire의 null은 거절한다.

1. `객관식 답변`·`체크박스`·`드롭다운`에만 true를 허용한다. 행렬 두 유형 및 모든 비선택형은 거절한다. 질문당 최대 1개, 기존 전체 보기 최대 100개에 기타도 포함한다.
2. 신규 UI는 기타를 마지막에 추가하고 일반 보기를 앞에 삽입하며 기타 이동을 막는다. 서버도 기타가 마지막인 최종 목록을 검사하는 안을 권장한다. 이는 잘못된 외부 요청을 막는 독립 보강이며 기존 일반 보기 정렬은 유지한다.
3. `options:string[]`는 계속 `optionDefinitions.map(o=>o.value)`와 완전히 같은 순서다. label 편집·일반/기타 전환은 id/value를 바꾸지 않는다. 새 옵션은 새 ID/value, 재정렬은 기존 ID/value 유지다.
4. 현재 logical question ID + option ID 또는 legacy 문자열의 정확한 value 대응에서만 플래그를 보존한다. 다른 질문의 ID, 기존 ID의 value 변경, 삭제된 조건 대상은 기존 검사대로 거절한다.
5. **이력은 ID/value 소유권 확인에만 사용한다. 플래그의 생략 병합은 잠근 현재 버전만 사용한다.** 현재 코드 `checkedQuestionOptions(...history)`에 플래그 병합을 그대로 맡기면 과거 true가 되살아날 수 있다. `identityHistory`와 `currentQuestions`를 별도 인자로 다루거나 병합 단계를 명확히 분리한다. 명시 false를 해석하기 전에 삭제하지 않는다.
6. 같은 세 선택 유형 간 전환은 기타를 보존한다. 행렬/비선택형 전환은 UI에서 명시 제거·확인 후 보내며, 서버의 생략 병합 결과에 기타가 남으면 422다. 과거 게시 버전의 기타는 바꾸지 않는다.
7. revise는 logical ID와 플래그 보존, copy/template use는 플래그를 보존하면서 question/option/condition ID를 새로 배정한다. 템플릿 JSON을 읽을 때 default false를 삽입하거나 저장하지 않는다.

### 이름 상한의 호환성

- 일반 보기 API의 기존 `trim().min(1).max(500)`와 DB `char_length` 500은 유지한다. 설치된 Zod `.max(500)`는 Unicode code point 기준이다(`node_modules/zod/v4/core/checks.cjs:297`). 이를 모든 기존 값에 대해 500 UTF-16으로 바꾸지 않는다.
- 새 편집 UI는 원본과 같이 250 UTF-16을 적용한다. 기존 251~500 code point 보기의 초기값을 자르거나 저장만으로 거절하지 않는다. 수정 후 250 초과면 UI에서 안내하고 자동 절단하지 않는다. 필요하면 기존 긴 보기를 보존하는 별도 표시/편집 정책을 둔다.
- **새 `isCustomValue:true` 보기 label은 서버에서도 250 UTF-16 이하**로 검사한다. 일반 251~500을 같은 ID의 기타로 바꾸려면 label을 줄여야 한다. 일반으로 되돌릴 때도 id/value는 유지한다.
- custom label 검사는 명시적 `value.length`를 사용한다. 기존 label의 trim 동작은 유지한다. 신규 custom label과 직접입력의 잘못된 surrogate/NUL 거절은 독립 보강이다.
- 신뢰할 source ID가 없는 `createTemplate(content)`·`createForm(content)`에 대해서는 일반 251~500 값을 과거 복제와 새 생성 중 어느 쪽인지 판별할 수 없다. 이번 안은 서버 500을 의도적으로 유지한다. ‘모든 신규 일반 보기 서버 250’까지 원본과 같다고 주장하지 않는다.

## 4. 정확한 로컬 답변 wire 제안

일반 보기만 선택한 경우는 현재 string/string[] 그대로다. **기타가 실제 선택된 경우만** 아래 strict 객체를 사용한다.

```ts
type CustomChoiceAnswer = {
  kind: "custom-choice";
  selectedValues: string[];
  custom: { optionId: string; text: string };
};
```

예: 일반 값이 `standard`, 기타 값이 `other-stable-value`, 기타 ID가 `22222222-2222-4222-8222-222222222222`인 체크박스:

```json
{
  "kind": "custom-choice",
  "selectedValues": ["standard", "other-stable-value"],
  "custom": {
    "optionId": "22222222-2222-4222-8222-222222222222",
    "text": "  직접 쓴 값 | 쉼표, 줄바꿈\n유지  "
  }
}
```

객관식/드롭다운은 `selectedValues`가 기타 value 한 개여야 한다. 체크박스는 1~100개의 중복 없는 유효한 value이며, 기타 value를 **정확히 한 번 포함**한다. `custom.optionId`는 그 질문의 현재 게시 버전에서 true인 단 하나의 logical option ID와 같아야 한다. boolean·label·숫자 인덱스를 클라이언트로부터 추가로 받아 신뢰하지 않는다.

- `kind`, `selectedValues`, `custom` 세 키, 중첩 `optionId`, `text` 두 키 외에는 거절한다. 주소·DRAW·행렬 객체와 구분한다.
- 일반 옵션에 custom text, 다른 문항/다른 tenant/삭제된 ID, 맞는 ID와 다른 value, 미선택 기타 text, 두 기타, custom 없는 질문에 객체 주입, 단일 질문의 복수 value를 거절한다.
- text는 1~100 **UTF-16**이며 `text.trim()` 비어 있으면 거절한다. 검사는 trim으로 하되 저장은 원문이다. pipe·쉼표·따옴표·개행·BOM·결합 문자·아랍어·이모지를 보존한다. NUL/잘못된 Unicode는 명시 거절한다. HTML은 평문으로만 보여 준다.
- 서버는 새 객체의 키를 위 순서로 생성하고 selectedValues를 **해당 게시 버전의 option 순서**로 정렬한다. 중복 입력을 제거하여 수용하지 말고 먼저 거절한다. 일반 string[]의 기존 순서는 변경하지 않는다.
- 새 객체에 custom=null 또는 custom 누락을 허용하지 않는다. 미선택/해제는 기존 단일 `""`, 체크박스 `[]`로 보낸다. 일반 선택으로 바꾸면 기존 scalar/array로 돌아간다. visible non-DRAW의 null 거절을 유지한다.
- UI 편집 중의 빈 기타 text는 임시 상태일 뿐 유효한 저장 wire가 아니다. 선택은 된 상태이므로 필수 답변/선택 수의 ‘비어 있음’으로 취급하지 않는다. 유효 저장 객체는 항상 nonempty다.

### 문자열 fallback 정책

| 요청 또는 저장값 | 처리 |
|---|---|
| 기존 ordinary value 문자열 / 문자열 배열 | 그대로 허용·저장·표시. label이 바뀌어도 value 매칭 유지 |
| custom 설정 질문에서 ordinary 값만 선택 | 기존 string/string[] 허용 |
| custom option의 value만 문자열/배열로 전송 | 직접입력이 없으므로 422; label을 text로 대체하지 않음 |
| `value|text`, `a,b`, `기타: 내용` | 분리하거나 추측하지 않음. **문자열 전체가 실제 ordinary value인 경우에만** 기존 선택으로 허용 |
| 원본 AI_V3 `{optionValue,customValue,text}` | 이 로컬 API에서 거절. 별도 변환 어댑터가 필요하면 버전/ID 매핑을 확인하는 별도 과제로 둠 |
| custom 구조체의 일반 선택만/빈 선택 | 거절. 일반 wire로 보내도록 함; 동일 의미의 다중 표현을 줄임 |

이 정책은 원본 세대의 pipe codec 호환을 제공한다는 뜻이 아니다. 기존 로컬 저장 답변은 변환하지 않는다.

## 5. 공용 helper와 검증 순서

새 `contracts/custom-choice.ts`(이름 제안)에 `CustomChoiceAnswer`, strict `customChoiceAnswerSchema`, 안전한 `isCustomChoiceAnswer`, `selectedChoiceValues`, `normalizeCustomChoiceAnswer`, `formatCustomChoiceAnswer`, 상수 3개(직접입력100, 기타 이름250, 기타 개수1)를 둔다. helper는 파일 I/O·네트워크를 하지 않는다. generic `answersSchema` union에 추가하되 catch-all object를 넓히지 않는다. OpenAPI 변환 가능한 refine/meta/타입 보존 정규화를 사용한다.

검증 순서 제안:

1. 문항 정의: strict flag/type/count/order/상한, options projection, ID/value 소유권, 조건 참조 검사. API parser만 믿지 말고 typed server caller도 검증한다.
2. 정의 저장: actor/policy → 기존 Form 잠금 → version 검사 → **현재 metadata 병합 후 다시 전체 검사** → 옵션 저장/승인 무효화/감사를 한 트랜잭션에 유지한다.
3. 답변: 질문별 타입·구조체를 식별하고 strict shape/ID-value-custom 관계 검사 후 canonical 선택 projection을 만든다. `QuestionRule.options`를 현재의 `{value}`에서 id/stableKey/label/optional flag를 읽을 수 있게 확장한다. legacy 값만인 시험 fixture도 기본 ordinary로 해석한다.
4. 조건: `visibleQuestionIds`는 문자열·배열·custom 객체의 선택 value를 공용 helper로 읽는다. 비교 대상은 선택 value이며 text가 아니다. source가 숨김이면 하위도 숨김. 직접입력 text 변경만으로 분기하지 않는다.
5. 숨긴 답변: 실제 선택·텍스트가 있는 custom 객체는 `HIDDEN_ANSWER`. 입력 누락/기존 empty 값은 기존처럼 타입별 empty로 정리한다. 잘못된 custom 객체를 빈 행렬/빈 답변으로 착각하여 수용하지 않는다.
6. required/선택수: 기타도 한 번 센다. optional 체크박스 전체 미선택은 기존 허용, 기타 선택+공백은 거절, exact/min/max는 ordinary와 기타를 합한 중복 없는 개수로 검사한다. 행렬 EXACT 규칙은 그대로 둔다.
7. 정정: 해당 Submission의 고정 FormVersion으로 검증한다. 구조체 키 순서·선택 순서만 바뀐 요청은 canonical 결과가 같아 `NO_CHANGES`; 새 답변 전환은 changedAnswers와 before/after 암호문에 정확히 기록한다. unrelated scalar 정정이 기존 문자열/배열/cipher를 재작성하지 않도록 한다.

`visibleQuestionIds`는 UI의 불완전 상태도 읽으므로 서버 검증 성공과 동일시하지 않는다. 서버는 선택 projection만 믿고 forged object를 통과시키지 말고 본문 검증을 별도로 끝내야 한다.

## 6. DB·쓰기 구현 접점

| 위치 | 필요한 변경 / 유지할 계약 |
|---|---|
| `prisma/schema.prisma:1339` | nullable flag 추가. 기존 행의 label/value/ID/order 및 Answer 암호문 백필 없음 |
| 신규 additive migration | nullable Boolean; true만 저장하는 CHECK; `questionId WHERE isCustomValue=true` 부분 unique로 기타1개 동시쓰기 보호; true이면 stableKey/label 필수와 이름 UTF16 250 CHECK |
| 같은 migration의 질문/옵션 guard | custom의 parent type 3종 제약을 Option INSERT/UPDATE와 Question type UPDATE 양쪽에서 검사. 일반 CHECK만으로 교차 행 제약을 보장한다고 주장하지 않음. 현재 `guard_option_identity`·게시 검증과 병행; 기존 published immutable trigger 유지 |
| `server/question-options.ts:5` | storedOptionDefinitions에 true만 투영. null/false default로 기존 DTO/hash 바꾸지 않음 |
| `contracts/option-identities.ts:6` | identityHistory와 현재 플래그 병합 분리. legacy exact value fallback에서 true 보존, false 명시 제거, 제거 후 재생성에서 history true 부활 방지 |
| `server/forms.ts:156` | createMany, changedOptions 비교, `jsonb_to_recordset` UPDATE 모두 새 flag 반영. **true A→true B 교체는 A 해제 후 B 설정**으로 부분 unique의 행 처리 순서 충돌 방지. 전체 트랜잭션 rollback 유지 |
| `server/forms.ts:230` | 병합/버전409/권한/감사 흐름 그대로. published implicit revise·explicit revise·copy의 보존 검사 |
| `server/templates.ts:26,90,101,126` | JSON 읽기 기본값 삽입 금지, create/update 검증과 생략 병합, 복제 ID 재배정 보존 |

트리거에서 새 Question→Form 잠금 순서를 무심코 추가하지 않는다. 정상 API는 이미 Form을 먼저 잠근다. 교차 행 보호를 SQL에 추가할 때 Form 단위 직렬화 후 최신 부모 type을 재조회하며, 직접 SQL writer가 부모 type 변경/옵션 추가를 경합하는 경우까지 설계·시험한다. 잠금 대기/교착 중단 시 전체 rollback은 허용하되 잘못된 상태의 commit은 허용하지 않는다. 기타 last-order를 DB에 강제할 경우 multirow 재정렬의 중간 상태를 막지 않도록 최종 상태 검증 방식이 필요하다.

## 7. 응답·공유·내보내기·역사 전파

| 경로 | 현재 근거와 계획 |
|---|---|
| 공개·고정URL | `submissions.ts:38`의 contentDto가 flag를 노출해야 입력 UI가 동작한다. 관리자 전용 개인정보 분류 제거와 혼동하여 flag까지 제거하지 않는다. fixed URL은 같은 publicForm 경로 |
| 제출 | `submissions.ts:84–111`의 published 질문/options 기반 validateAnswers → 암호화 저장을 유지. 단위 실패 시 responseCount/Answer/verification/receipt/marketing 모두 rollback. body에 답변과 metadata를 혼합하지 않음 |
| 목록·상세 | `submissions.ts:130–140`, `submission-management.ts:39–68`의 optionDefinitions와 Answers로 전달. generic formatAnswer에 custom 분기를 matrix fallback보다 먼저 추가 |
| 정정·이력 | `submission-management.ts:72–105`는 원래 FormVersion과 암호화 baseline을 사용한다. 새 초안의 기타 label/flag 변경으로 과거 응답을 재해석하지 않음. version409·tenant·write 권한·audit rollback 그대로 |
| 외부 공유 | `sharing.ts:17–22`, `viewer.ts:136–159`: 선택한 질문과 고정 게시 버전만 반환. 새 text는 해당 질문의 원문 권한을 상속. file.read와 혼동하여 가리거나 파일로 취급하지 않음. 만료/철회/파기 경계 유지 |
| 읽기 UI | PublicForm/QuestionInput, SubmissionDetail/Workflow/SharedPrivacy가 같은 구조체를 읽음. `displayOptions`가 현재 label/value만 반환하므로 ID/flag 타입도 연결. React text로 `기타 label: text`를 표시; HTML 삽입 금지 |
| CSV | `export-renderer.ts:51`의 object→빈 셀 경로 전에 명시 custom 분기 필요. `submission-export.ts`와 `exports.ts`가 같은 renderer를 쓰므로 양쪽 검증. 과거 scalar/array/matrix/address/DRAW 셀은 byte 동일 |
| CSV 신규 표현(제안) | custom 답변만 `{"kind":"custom-choice","selected":[{"optionId":"…","value":"…","label":"게시 당시 이름"}],"custom":{"optionId":"…","text":"원문"}}` 고정 순서 JSON을 한 셀에 넣음. selected는 게시 옵션 순서. ordinary 선택까지 포함하고 label/value/입력내용을 잃지 않음. 기존 `safeCsvCell` 인용·formula 보호를 거침. 기존 CSV가 동일 형식으로 재수입 가능하다는 약속은 없음 |
| Export snapshot | 비동기 layoutCipher의 옵션 정의에 flag를 포함. 기존 저장 layout에는 없음=ordinary. 기존 exportSourceHash의 cipher 기반 무결성 및 이전 artifact bytes 보존 |
| subject·marketing | 선택형은 subjectRole와 마케팅 이름/연락처 후보에 원래 포함되지 않음. 기타 text를 `String(object)`로 신원/이메일/전화로 연결하지 않음. 이 제한을 서버 및 DB 회귀로 확인 |
| CSV import | `import-worker.ts:78`은 단문/장문/날짜 질문과 문자열 답변을 만든다. pipe/JSON처럼 보이는 셀을 custom으로 추측해 파싱하지 않음. 기존 import 정정 유지 |
| 동의/PDF | `consent-receipts.ts:20–50`은 동의문·문서 증거만 포함하며 질문 답변을 넣지 않는다. 이 기능 때문에 custom text를 새 법률 증거 필드에 추가하거나 영수증을 재생성하지 않음. 저장 evidenceCipher/pdfCipher/pdfHash/renderer 결과와 read bytes 그대로 |
| 보유·파기 | 새로운 별도 평문 저장소/검색 인덱스 없음. Answer 및 CorrectionPayload에만 기존 암호화 저장; 기존 만료·파기·share cache/export 철회 경계를 재검증 |

## 8. 실행 순서와 수용 시험 제안

실행 주체는 root이며 이번 조사에서는 한 건도 실행하지 않았다.

1. 기존 migrations/구 게시본/템플릿 JSON/승인 fingerprint/답변 cipher/영수증 evidence·PDF bytes를 고정. nullable 컬럼 추가 후 ORM snapshot 비교는 새 null 키만 제외하고 DB null을 별도로 확인한다.
2. 새 `question-custom-choice.test.ts`에서 현재 계약·서버·DB를 통한 RED를 먼저 보존한다. 미구현 helper import로 테스트 수집만 실패시키지 않는다.
3. 계약·옵션 identity/current 병합·migration·검증·표시/CSV를 한 수용 단위로 구현한다. 기존 이력 보존과 API 문서를 통과한 뒤 root가 migration/generate/시험을 직렬 실행한다.
4. Ego 실제 편집·제출·정정·공유·CSV, production 빌드/재시작을 별도 증거로 남긴다. source 정적 근거, DB fixture, 실제 UI 수행을 구분한다.

| 시험 묶음 | 의미 있는 수용 케이스 |
|---|---|
| 정의 | 3타입 정상, 행렬/비선택형 거절, custom2개/보기101개/중간 custom 거절, false/null/생략 구분, ordinary 500 유지·501 거절(기존 code point), custom250/251 UTF16·이모지125/126, 공백·Unicode/NUL |
| 안정성 | 제목만 저장/재정렬/label 변경의 물리·논리 ID/value 유지; custom A→B 원자 전환; current false 해제 뒤 오래된 history true 미부활; legacy options[] 생략 metadata 보존; 다른 question/tenant ID 거절 |
| 버전·복제 | 직접/암묵 revise, copy/template use 새 ID+조건 remap, 템플릿 read 무변이, 일반251~500 복제 성공, null DTO/구 승인 지문 byte 동일, 새 flag 변경은 승인 superseded |
| 답변 | single/checkbox/select, optional 빈/required 빈, custom 빈/Unicode공백/100/101 UTF16/이모지50/51, ordinary 문자열fallback, raw custom value 및 원본/pipe wire 거절, 실제 pipe ordinary value 성공 |
| 주입 | 추가키/중첩추가키/타입/null/중복/다른문항ID/맞는ID-틀린value/일반text/미선택text/선택두개단일/주소·DRAW·행렬 상호주입 거절 |
| 개수·분기 | optional exact 전체미선택 허용, custom만1개·ordinary+custom2개, max/min/exact 경계, custom 선택 조건·중첩·hidden source, hidden text주입 거절, 전환 시 숨겨진 값 정리 |
| 정정 | 원래 버전으로 custom↔ordinary↔empty, text 변경·취소·관련없는 scalar 변경, object key/selected order만 바뀌면 NO_CHANGES, 변경후 before/after암호문 정확, 기존 답변 불변 |
| 권한·원자성 | stale ctx 권한회수, 다른tenant, 같은 version200/409 실제잠금, custom 전환 경합, 감사실패 rollback, 공개 idempotency replay·잘못된 proof에서 카운터/답변/영수증 미생성 |
| DB | 신규 nullable/no backfill, 직접SQL custom2개/type상충/250초과 거절, Question.type만 변경하는 우회 거절, 부모type·option쓰기 경합, published option flag 변경/삭제 거절 |
| 공유·표시 | 허용 질문의 text/게시label만 노출, 제외 질문/다른버전/tenant/철회/만료/파기 차단, file.read 없는 사용자도 권한 있는 text 조회, readonly/busy/no-submit 접근성/native validation |
| CSV·역사 | 동기/비동기 custom JSON 동일; pipe/comma/quote/newline/formula 유실 없음, old scalar/array/matrix/address/DRAW byte 동일, old queued layout 호환, 구PDF/evidence/원문cipher 그대로, subject/marketing 선택형 거절 및 import 회귀 |

기존 의미 시험 재사용 후보: `question-identities.test.ts:44,73,109,123,154,183,235,266`, `question-rules.test.ts:82,112,127,149`, `question-exact-selection.test.ts:71,77`, `form-module-flow.test.ts:47`, `form-module-concurrency.test.ts:165,201,217`. 전체 16질문 흐름을 9질문으로 축소하지 않는다.

## 9. 완료 주장과 남은 결정

현재 완료는 **계획·영향 분석**이다. 기타 보기 기능이 동작하거나 원본 서버와 동등하다는 결론은 아니다. 이 초안의 discriminator 구조체, text/NUL 검증, canonical 선택 순서, nullable true-only 저장, 신규 CSV JSON은 독립 설계다. 구현 전 root가 helper 시그니처·오류코드·last-order 서버/DB 강제 범위·CSV 키 이름을 확정한다. 원본 custom option 개수 외 전체 상한/서버 정정 세대/CSV 형식/답변 PDF 정책은 계속 미관측이다.
