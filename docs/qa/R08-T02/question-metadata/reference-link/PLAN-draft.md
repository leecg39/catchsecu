# F3 참고 자료 LINK 구현 초안

원본 관측과 현재 로컬 구조를 기준으로 한 첫 구현 단위다. FILE은 포함하지 않는다. 이 조사에서 제품·DB·브라우저·서버·테스트를 변경하거나 실행하지 않았다. 실제 구현은 주 에이전트의 계획 검토 후 진행한다.

[원본 근거 JSON](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/reference-link/source-review.json)에 SHA·REA ID·정확한 UTF-16 발췌와 로컬 파일 SHA를 보존했다. bundle SHA는 `3538d47856c6ba1b4207059dc09434066c7ca692a5907ed792dd9e27c7dba78f`, REA ID는 `ev_87493e79c4f053718022b23e1e5d42acf1af245f8c7838a89cd7ebc3918df152`다.

## 확정된 원본 계약

- **하나의 혼합 목록:** FILE/LINK는 같은 `materialList`의 항목이며 서로 배타적이지 않다. 파일·링크 합계가 질문당 최대 3개다. 한국어 원문도 “자료는 파일·링크 합쳐 문항당 3개까지 추가할 수 있습니다.”라고 명시한다.
- **0 기반 순서:** `lQ` `[8199026,8199705)`가 기존 sequence로 정렬한 다음 `map((e,t)=>…orderNumber:t)`를 적용한다. `uQ`는 `sequence:t`로 재인덱스한다. 따라서 첫 항목의 orderNumber는 **0**이다.
- **LINK wire:** `{materialType:'LINK', orderNumber, fileKey:null, linkLabel:name||null, linkUrl:url}`. UI의 임시 `id`는 저장 wire에 없다. FILE은 fileKey를 사용하고 linkLabel/linkUrl은 null이다.
- **URL:** `trim()` 결과가 비어 있으면 거절하고, JavaScript `.length` 512 이하 및 `new URL`의 http:/https:만 허용한다. 검증 후 `URL.href`로 정규화하지 않고 **trim한 입력 원문**을 저장한다. 서버 fetch는 관측되지 않는다.
- **표시명:** 선택 입력, textarea가 아닌 단일 입력의 maxLength100. 저장할 이름은 trim(label) 또는 URL이다. 100자를 넘는 fallback은 앞99 UTF-16 단위+‘…’. 실제 원본 서버 길이 강제는 미관측이다.
- **추가/취소/삭제/정렬:** 추가 패널은 label·URL·추가·취소. 취소는 임시 입력만 폐기한다. 기존 목록에는 드래그·삭제가 있으며 제자리 수정 UI는 확인되지 않았다. 개별 삭제는 확인 후 해당 항목만 제거하고 순서를 재인덱스한다.
- **자료 기능 끄기:** 원본 `useQuestionMaterial` 토글은 자료가 있을 때 삭제 확인을 받고 목록을 비운다. 단순 숨김이 아니다. 원문은 다시 켜도 복구되지 않는다고 안내한다. 마지막 개별 항목 삭제 후 빈 활성 패널과 토글 비활성은 원본에서 구별될 수 있다.
- **공개 표시:** 질문 제목/별도 이미지 → 자료 → 설명 → 답변. 이름과 새 탭 열기 anchor를 제공한다. LINK는 `target='_blank'`, `rel='noopener noreferrer'`, URL title, 번역된 새 탭 열기 aria-label이며 download 속성은 없다. 잘못된 URL은 공개 렌더러가 제외한다.
- **복사:** `_Nt`가 LINK를 자산 복제 목록에서 제외한다. LINK만 있는 질문은 자산 API 없이 깊은 복사한다. `LNt`는 링크를 보존하고, 파일을 빼는 `DNt`도 링크는 남긴다. 페이지 복사도 같은 helper를 사용한다.

## 첫 로컬 계약

현재 주 에이전트가 제안한 wire 형태를 사용한다. 실제 서버 규칙을 복원했다는 의미가 아니라 원본 필드에 맞춘 독립 로컬 계약이다.

```ts
type ReferenceLink = {
  materialType: 'LINK';
  orderNumber: number; // 0, 1, 2; 배열 위치와 같음
  fileKey: null;
  linkLabel: string;  // 원본 UI처럼 빈 입력은 URL fallback으로 해결
  linkUrl: string;    // trim한 원문
};
// Question.materialList?: ReferenceLink[]
// DB는 nullable JSON. 없는 자료는 null, DTO에서는 필드 생략.
```

1. `materialList` 전체 배열 최대3을 strict 검증한다. 이 단계는 LINK literal과 fileKey:null만 허용하며 FILE/임의 enum/추가 속성을 명시적으로 거절한다. 이후 FILE은 같은 목록의 discriminator를 확장한다.
2. 클라이언트는 매번 배열 순서에 맞춰 0부터 orderNumber를 재계산한다. 서버는 비정수·음수·중복·구멍·배열 위치 불일치를 거절해 하나의 canonical 표현만 저장하는 것을 권장한다. 이는 원본 프런트의 canonical payload를 로컬 서버 계약으로 명확히 하는 선택이다.
3. URL은 trim 후 원문 보존, UTF-16 length<=512, 절대 http/https URL을 요구한다. label은 trim 후 빈값이면 URL fallback, UTF-16<=100을 적용한다. 설치 Zod 문자열 `.max()`의 codepoint 계산만으로 UTF-16 상한을 만족한다고 가정하지 않는다.
4. 원본의 NUL/잘못된 surrogate 처리는 미관측이다. 로컬 DB에 저장 불가능한 문자는 거절한다. fallback URL 자르기는 surrogate pair를 자르지 않는 범위에서 최대99 UTF-16+‘…’를 권장한다. 원본 `.slice(0,99)`보다 강화된 처리임을 기록한다.
5. credentials·ASCII control·backslash·명시적 `://` 등 추가 제약을 적용할 경우 **독립 강화 규칙**으로 별도 명시한다. 원본 `tQ`에서 확인된 것은 trim/length/new URL/protocol뿐이다. scheme 검사만을 원본 서버 규칙으로 확대 해석하지 않는다.
6. `useQuestionMaterial`의 별도 저장 필드는 이번 nullable materialList 첫 단위에 포함하지 않는다. 추가 패널의 열림은 UI 임시 상태로 다룬다. 전체 자료 끄기를 제공하면 확인 후 명시적 `[]`를 보내 실제 제거한다. 원본의 ‘활성+빈 패널’ 설정 지속성까지 동등하다고 주장하지 않는다.

## 구 DTO·게시본·복제 보존

- 새 nullable JSON 컬럼의 기존 행은 null 그대로 둔다. 없는 자료에는 `[]`, `false` 또는 `useQuestionMaterial`을 DTO에 새로 주입하지 않는다. 기존 승인 contentHash와 JSON 키 순서를 보존한다.
- 기존 질문에서 `materialList` 생략은 **현재 버전의 같은 logical question ID**만 참조해 보존한다. 명시적 `[]`는 제거한다. 제거한 뒤 구클라이언트가 다시 생략해도 이전 게시본/history에서 자료를 되살리지 않는다.
- 새로운 질문 ID에는 다른 질문의 링크를 가져오지 않는다. 명시적 null은 API에서 거절하고 ‘생략/[]’만 허용하면 비어있음 의미를 하나로 유지할 수 있다. DB null은 내부 저장 표현이다.
- `writeQuestions` 저장 및 변경 비교, `contentDto`, 초안 승인 무효화·감사·version 증가를 같은 경계에서 처리한다. 새 컬럼에도 게시 Question 행 불변 trigger가 적용되는지 검증한다.
- `reviseForm`은 해당 게시본의 링크 값·순서를 보존한 새 초안을 만든다. `copyForm`/템플릿 use는 질문 UUID만 기존 정책대로 바꾸며 외부 링크 문자열은 그대로 복제한다. LINK에는 파일 소유권 재발급/API가 필요하지 않다.
- 템플릿 create/update의 strict content 저장·읽기·생략 병합도 연결한다. 원본 템플릿 생성은 formId를 보내므로 원본 서버의 LINK 보존은 **미관측**이다. 로컬의 완결성 요구로서 복제/템플릿 보존을 시험한다.
- 답변 값·조건 그래프·보기 UUID·CSV 응답 셀·동의 법률 본문·영수증/PDF renderer 버전은 바꾸지 않는다. 기존 저장 PDF bytes/hash를 재계산하지 않는다.

주요 변경 지점:

- [질문 계약](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/questions.ts:17) 및 nullable Prisma Question 자료 컬럼. 파일명은 실제 구현 시 확정한다.
- [contentDto/fingerprint](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/forms.ts:41), writeQuestions:152, 같은 현재 ID 병합:228, 개정/복사.
- [템플릿 계약과 저장](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/templates.ts:24), [cloneFormContent](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/form-copy.ts:4).

## 화면 연결

FormEditor에 질문별 참고 링크 추가 패널·등록 목록·순서 변경·선택 삭제를 둔다. 원본과 같은 추가/취소/삭제 확인을 먼저 제공한다. 기존 링크의 제자리 수정 버튼을 추가한다면 원본 미관측 로컬 확장으로 기록한다. FILE 기능이 없는 첫 단계에서 원본의 ‘pdf/docx/ai’ 제목이나 파일 추가 버튼을 노출하지 않는다.

전체 목록을 바꾸는 동작은 질문 stable ID에 묶어 적용하고 저장 중·권한 상실·409 상태의 기존 입력 보존 정책을 따른다. 링크 패널의 미적용 입력은 추가 전 임시 데이터이므로 취소가 기존 자료를 지우지 않아야 한다. 질문을 옮겨도 입력 대상이 다른 질문으로 바뀌면 안 된다.

공통 자료 렌더러를 PublicForm visible fieldset 내부와 설명 앞, QuestionSummary(일반/템플릿/승인 미리보기), SubmissionDetail 정정/조회에 연결한다. 정정/조회는 제출에 연결된 저장 버전의 자료를 읽고 최신 초안 자료로 바꾸지 않는다. 공개·정정의 숨겨진 질문과 자료는 함께 숨긴다. 관리 요약의 모든 질문 나열은 기존 정책과 구별한다.

링크 이름은 React text로 표시하고 href는 동일 검증을 통과한 값만 사용한다. 클릭은 새 탭 열기만 수행한다. 서버 fetch·URL preview·프록시 다운로드를 추가하지 않는다. 모바일 긴 라벨/URL, Arabic 방향과 URL의 LTR 읽기, 키보드 접근, 링크별 이름+‘새 탭에서 열기’ 안내를 확인한다. 원본의 icon-only aria-label보다 항목 이름을 포함시키는 것은 로컬 접근성 보완으로 기록한다.

공개 버튼은 원본16개언어 `translate.infoOwnerForm.questionMaterial.openInNewTab`을 추출해 사용할 수 있다. 한국어 관리 UI에는 `aiQuestions.questionMaterial`의 링크 label·URL·추가/취소/삭제·오류 키가 있다. 기존 copy JSON 전체를 재작성하지 말고 필요한 leaf만 추가한다. 원본 문구/출처는 source-review.json의 localeCopies에 보존했다.

## 구현 전 실패 시험과 수용 계획

1. **경계/정규화:** 0/1/3/4개, LINK 외 enum/FILE/fileKey 위조/추가키, orderNumber0·1·2와 음수/중복/불일치. URL trim 원문 보존, label 빈값 fallback, URL512/513와 label100/101, astral Unicode UTF-16, fallback surrogate 경계.
2. **URL:** http/https 정상, javascript/data/file/mailto/상대 URL 거절. localhost·port·fragment·query·IDN 등은 선택한 로컬 정책에 맞춰 시험한다. credentials/control/backslash/://의 추가 거절은 원본 동등성 시험과 독립 강화 시험으로 분리한다.
3. **CRUD/구 클라이언트:** 생성→읽기→순서변경→한 항목 제거→모두 제거. `[]` 제거와 생략 보존을 구별. 제거 뒤 재생략/개정 시 과거 자료 부활 없음. 다른 질문 ID나 회사의 자료를 가져오지 않음.
4. **버전/권한/동시성:** 자료만 바꿔도 버전/감사/승인 무효화; stale409와 권한 오류에서 원래 목록 보존·DB rollback. 게시본 직접 수정 차단. 회사/서비스 전환·동시 저장 경계.
5. **복제/템플릿:** 질문/폼/개정/템플릿 생성·수정·사용의 URL·라벨·순서 정확 보존. 새 질문 ID와 기존 보기/조건 재매핑 유지. 자산 업로드·복제 호출 없음.
6. **과거 불변:** 추가설명 sealed checkpoint의 공통 컬럼/기존 DTO·승인·게시 hash·영수증/PDF bytes 보존. 새 컬럼은 기존행 null. 기존 baseline 갱신으로 차이를 숨기지 않음. fresh schema 및 누적 migration 수는 실제 목록에서 산출한다.
7. **UI 실행:** 추가 취소, 개별 삭제 취소/확인, 전체 끄기 취소/확인, 순서변경, 4번째 차단, 새로고침·재개. 태그처럼 보이는 이름 평문 표시, 링크 href/target/rel, 숨김조건, 제출 후 정정에서 게시버전 링크 유지. 외부 링크 내용 자체는 검증 범위에 넣지 않는다.
8. **표시/접근성:** 390/768/1440px·한국어/영어/Arabic, 길고 동일한 라벨, 키보드 포커스·새탭 알림, required 답변과 링크 클릭의 독립성, 여러 질문에서 임시 추가 입력 대상 유지.

## 남은 미확인

원본 서버의 자료 배열/길이 강제, URL 세부 허용 정책, 템플릿 복제, partial update/concurrency, 실제 링크 대상은 미관측이다. FILE 업로드·스캔·자산 소유권·quota·임시파일 수명주기는 후속 공유 목록 확장이다. 이 첫 단계는 원본 참고자료 전체 동등 구현을 주장하지 않는다.

[결과물 폴더](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/reference-link)
