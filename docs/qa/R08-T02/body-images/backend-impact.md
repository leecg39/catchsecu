# BI 본문 이미지 백엔드 영향 분석

현재 코드는 질문 이미지 QI까지 지원하며, 본문 rich image를 위한 페이지·종료 화면·참조 모델은 없다. 이 문서는 BI 구현 결정을 위한 **정적 영향 분석**이다. 제품·DB·HTTP·브라우저·시험·빌드·생성기를 실행하거나 수정하지 않았고, frozen 20개 fixture는 열지 않았다. 원본 사실은 기존 REA 번들 보고서, 로컬 사실은 아래 파일 snapshot, 제안은 독립 설계로 구분한다.

분석시각: 2026-10-10T09:35:22.275Z. 전체 파일 SHA-256은 원본 바이트를 대상으로 한다. 범위 해시는 LF로 줄을 나눈 뒤 마지막 합성 빈 항목을 제외하고, 1기반 닫힌 범위를 LF로 연결하며 끝 LF를 추가하지 않는다. 전체 파일 SHA-256과 범위 해시는 [backend-impact.json](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/body-images/backend-impact.json)의 evidence에 저장했다. 현재 DB 버전은 조회하지 않았으며 source에는 migration124가 있다.

## 1. 확정된 범위와 구현 전 충돌

### BI-I01 단일 body만 존재; 다중 페이지/완료/마감은 별도 모델과 흐름 필요

root 본문 하나를 추가해도 BI 전체 또는 F4 페이지 기능 완료가 아니다.

[BI-E03 src/contracts/domains.ts:10](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/domains.ts:10) · [BI-E04 prisma/schema.prisma:1278](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/schema.prisma:1278) · [BI-E39 src/components/forms/PublicForm.tsx:129](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/PublicForm.tsx:129) · [BI-E40 src/components/forms/FormEditor.tsx:32](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/FormEditor.tsx:32) · [BI-E47 src/server/answer-validation.ts:18](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/answer-validation.ts:18)

### BI-I02 질문 전용 parent/slot/FK 및 전체핀 동기화를 그대로 사용할 수 없음

purpose 추가만으로 body ref를 저장할 수 없고, 부분 질문 sync는 body pin을 누락/삭제할 수 있다.

[BI-E12 prisma/migrations/20261025012000_author_assets/migration.sql:2](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261025012000_author_assets/migration.sql:2) · [BI-E14 prisma/migrations/20261025014000_question_images/migration.sql:9](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261025014000_question_images/migration.sql:9) · [BI-E15 src/server/author-asset-references.ts:10](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-references.ts:10) · [BI-E05 src/server/forms.ts:46](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/forms.ts:46)

### BI-I03 14MiB는 계약/DB/transport/storage/scanner/데몬 전체 상한 변경이 필요

한 계층만 올리면 나머지 계층에서 거절된다. 일반 파일10MiB/자료5MiB/질문·보기1MiB는 보존해야 한다.

[BI-E11 src/contracts/author-assets.ts:3](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/author-assets.ts:3) · [BI-E12 prisma/migrations/20261025012000_author_assets/migration.sql:2](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261025012000_author_assets/migration.sql:2) · [BI-E14 prisma/migrations/20261025014000_question_images/migration.sql:9](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261025014000_question_images/migration.sql:9) · [BI-E17 src/server/file-validation.ts:30](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-validation.ts:30) · [BI-E18 src/contracts/files.ts:1](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/files.ts:1) · [BI-E19 src/server/file-storage.ts:11](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-storage.ts:11) · [BI-E20 src/server/s3-storage.ts:32](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/s3-storage.ts:32) · [BI-E21 src/server/file-scanner.ts:8](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-scanner.ts:8) · [BI-E22 scripts/clamav-local.ts:11](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/scripts/clamav-local.ts:11) · [BI-E23 src/server/author-asset-validation.ts:11](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-validation.ts:11)

### BI-I04 기존 sanitizer는 이미지와 편집기 표시 속성을 제거

sanitize-html 엔진은 재사용 가능하나 메시지/공지 정책 자체의 재사용은 이미지·공백·순수이미지본문을 손상시킨다.

[BI-E08 src/server/message-content.ts:5](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/message-content.ts:5) · [BI-E09 src/server/notices.ts:12](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/notices.ts:12) · [BI-E10 package.json:45](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/package.json:45) · [BI-E02 docs/qa/R08-T02/question-metadata/content-images/source-review.md:13](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/source-review.md:13)

### BI-I05 공개 전체핀과 viewer 선택질문 필터는 body/end/private 정책을 표현하지 않음

질문 없는 핀은 viewer에서 제외되거나, 필터를 제거하면 미선택페이지가 노출된다. 마감 화면은 기존 410 gate와 별도 설계가 필요하다.

[BI-E26 src/server/author-asset-reads.ts:18](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-reads.ts:18) · [BI-E27 src/server/public-publication.ts:4](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/public-publication.ts:4) · [BI-E28 src/server/submissions.ts:27](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/submissions.ts:27) · [BI-E30 src/contracts/sharing.ts:23](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/sharing.ts:23) · [BI-E31 src/server/viewer.ts:94](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/viewer.ts:94)

### BI-I06 rich content는 approval fingerprint와 ConsentEvidence.formBody/PDF의 버전 경계

기존 body를 HTML로 재해석·정규화하거나 renderer1/2를 바꾸면 기존 해시/표시계약을 깨뜨린다.

[BI-E05 src/server/forms.ts:46](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/forms.ts:46) · [BI-E07 src/server/approvals.ts:30](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/approvals.ts:30) · [BI-E32 src/contracts/form-documents.ts:6](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/form-documents.ts:6) · [BI-E33 src/server/consent-receipts.ts:20](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/consent-receipts.ts:20) · [BI-E34 src/server/form-documents.ts:12](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/form-documents.ts:12) · [BI-E35 src/server/pdf-renderer.ts:8](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/pdf-renderer.ts:8) · [BI-E36 src/server/pdf-renderer-v2.ts:56](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/pdf-renderer-v2.ts:56) · [BI-E37 src/server/document-pdf.ts:10](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/document-pdf.ts:10) · [BI-E45 prisma/migrations/20261002094000_forms/migration.sql:328](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261002094000_forms/migration.sql:328)

### BI-I07 copy/remap/system template는 현재 질문 자산만 처리

본문 키/페이지 및 node identity remap까지 원자적으로 확장해야 복사본의 소유권·quota·삭제 독립성을 보장한다.

[BI-E06 src/server/templates.ts:24](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/templates.ts:24) · [BI-E15 src/server/author-asset-references.ts:10](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-references.ts:10) · [BI-E38 src/contracts/form-copy.ts:4](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/form-copy.ts:4) · [BI-E46 src/server/author-asset-system-import.ts:11](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-system-import.ts:11) · [BI-E24 src/server/file-quota.ts:6](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-quota.ts:6)

### BI-I08 14MiB 한장 허용과 PDF16MiB/JSON1MB·누적이미지 예산은 서로 다른 경계

dataURI로 JSON에 넣지 말고 bytes는 별도 업로드; 총픽셀/레이아웃/출력한도 정책과 preflight 필요.

[BI-E25 src/server/http.ts:14](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/http.ts:14) · [BI-E23 src/server/author-asset-validation.ts:11](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-validation.ts:11) · [BI-E35 src/server/pdf-renderer.ts:8](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/pdf-renderer.ts:8) · [BI-E36 src/server/pdf-renderer-v2.ts:56](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/pdf-renderer-v2.ts:56)

## 2. 원본 계약과 로컬 신규 계약을 구분

- 원본 폼 description → mainText, 페이지 → pageContent이며 HTML 안에 img src URL이 있다. 첫 페이지 title/content는 비워서 mainText가 첫 안내를 맡는다. END_PAGE_CONTENT_IMAGE / PRIVATE_PAGE_CONTENT_IMAGE도 별도 편집 위치다. PRIVATE_PAGE는 이 조사에서 마감 안내 위치이며 관리자 비밀 문서와 동의어가 아니다.
- 원본 업로드 adapter의 관측 상한은 JPEG/JPG/PNG 14,680,064 bytes. 총 이미지 개수/HTML 길이·서버 MIME/scan·상한·권한은 미관측이다. 업로드 응답 URL을 CKEditor가 HTML에 넣고, URL 집합 차이로 temp/status를 보내는 정적 경로까지만 확인됐다. 원본 페이지 복제에 copy 요청은 있으나 반환 URL 적용과 서버 bytes 복제는 미관측이다.
- 로컬은 UUID AuthorAsset ID와 private storage가 이미 분리되어 있다. rich HTML에 실제 storageKey, raw S3 URL, 공개 영구 URL을 저장하지 않는 것은 **독립 보완**이다. raw 원본 URL과 로컬 owned UUID는 같은 계약이라고 표현하지 않는다.
- 현재 strict FormContent에 mainText/pageContent/end/private를 보내면 거절된다. body 문자열 안에 img 태그를 넣어도 React 평문이며 이미지 기능이 아니다.

[BI-E02 docs/qa/R08-T02/question-metadata/content-images/source-review.md:13](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/source-review.md:13) · [BI-E03 src/contracts/domains.ts:10](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/domains.ts:10) · [BI-E39 src/components/forms/PublicForm.tsx:129](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/PublicForm.tsx:129)

## 3. rich 저장·sanitizer 설계 대안

### 권장 논의안: canonical typed document + HTML adapter

기존 body의 의미·값·키 순서·해시는 그대로 두고 새 nullable 버전 필드를 추가한다. 예시는 최종 wire가 아니라 설계 비교다:

```ts
// 최종 이름과 node enum은 root 결정. 원본 wire가 아닌 로컬 versioned 계약의 예시.
richContent?: {
  schemaVersion: 1;
  main: RichDocument;
  pages: { id: UUID; title: string; questionIds: UUID[]; content: RichDocument }[];
  end: RichDocument | null;
  private: RichDocument | null;
};
// image node: stable nodeId + owned assetId + bounded alt/alignment/width metadata
```

최종 wire를 HTML 문자열로 유지해야 한다면 서버 parser가 HTML→canonical nodes로 변환하고, 허용된 serializer로 HTML을 재생성한다. canonical nodes가 저장/핀 projection/화면의 유일한 의미 원천이어야 한다. HTML+image manifest를 이중 원천으로 저장하면서 JS에서만 일치한다고 주장하면 direct SQL에 의해 분리될 수 있다. regex img 추출은 HTML 엔티티/중복속성/잘못된 중첩·parser 차이를 처리하는 보안 경계로 쓰지 않는다. JSON만 DB에 저장하는 대안도 가능하지만 그 경우 page/node 존재성·유일성·자산 projection을 DB 함수가 검증해야 한다.

기존 sanitize-html 2.18.0 dependency를 활용할 수 있다. sanitizeMessageHtml을 호출하는 방식은 부적합하다: img·style을 제거하고 {{...}} 속성을 메시지 변수로 거부하며 normalizeMessageContent는 이미지뿐인 문서를 EMPTY_HTML로 거부한다. notices.cleanBody는 제한 태그만 남기고 trim한다. 두 정책을 변경해 다른 업무에 영향을 주지 말고 BI 전용 allowlist/parser를 둔다.

allowlist는 원본 toolbar 조사 후 확정한다. img의 src는 검증한 owned ID 표현만 허용하고 출력 직전에 현재 scope 인가 URL로 바꾼다. remote/data/blob/file/상대우회URL, srcset, 이벤트 속성, svg/math/iframe/object, 임의 CSS url/position/overflow는 허용하지 않는 경계를 제안한다. 이미지 figure의 폭·정렬·alt는 원본 관측 필드와 round trip을 보존하되 수치와 enum만 허용한다. 작성한 HTML/alt의 자동 번역 및 자동 EXIF 제거·다운샘플은 원본 근거가 없으므로 별도 정책으로 정한다.

호환 규칙은 먼저 확정해야 한다: 새 nullable DB 값은 DTO에 생략, legacy body는 sanitize/HTML 해석/백필 금지; 새 rich field 생략은 **현재** 값 보존, 명시 clear만 제거, 과거버전에서 되살리지 않기. 구클라이언트가 rich를 모르고 body만 수정하는 경우 rich의 평문 projection을 덮을지 409/422로 거절할지는 open decision이다. 둘을 조용히 불일치시키지 않는다.

[BI-E08 src/server/message-content.ts:5](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/message-content.ts:5) · [BI-E09 src/server/notices.ts:12](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/notices.ts:12) · [BI-E10 package.json:45](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/package.json:45) · [BI-E05 src/server/forms.ts:46](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/forms.ts:46) · [BI-E25 src/server/http.ts:14](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/http.ts:14)

## 4. 다중 페이지와 root/page/end/private 참조

현재 FormVersion은 body 하나와 flat Question[]다. PublicForm은 한 form에서 모든 visibleQuestionIds를 출력하며 완료/마감은 고정 문구다. page를 의미하는 DB entity, question.page 소속, 페이지 이동/분기, pageContent DTO가 이 경계에 없다. **root rich body 첫 단계를 수직 구현하는 것은 가능하지만 전체 페이지 구현으로 완료 처리할 수 없다.**

최소 F4 결합 모델은 physical FormSection ID + version 내 stableKey/order와 page의 질문 소속을 포함한다. 기존 flat question 배열을 유지하면서 page가 questionIds를 참조하는 호환 방식은 가능하다. 모든 질문의 소속 유일성·정렬·이동·삭제 시 처리·페이지 분기/숨김의 답변검증·정정까지 필요하다. first page mainText 의미는 원본에 맞게 따로 다룬다. 새page/block에 부모FK만 붙이면 게시 자식 불변이 자동으로 생기지 않으므로 INSERT/UPDATE/DELETE guard와 승인 JSON projection도 추가한다.

**참조 권장안:** 기존 AuthorAssetReference를 확장해 parent는 version/template/approval 중 정확히 하나를 유지한다. 질문 slot은 기존 questionKey/물리 questionId를 유지하고 body slot은 questionKey/questionId가 null이며 blockKind(root/page/end/private)+pageKey(페이지일 때)+nodeKey(각 image occurrence)로 위치를 식별한다. 정규화 content block을 선택하면 같은 parent/version에 속한 정확한 physical FK를 둔다. JSON 모델을 선택하면 DB projection으로 page/node 존재와 연결을 검사한다. 같은 asset을 여러 위치에서 써도 quota는 logical Asset마다 한 번이고 occurrence마다 pin은 별도다. NULL을 둔 일반 unique index는 중복을 막지 못하므로 slot별 partial unique 또는 명시 coalesce identity가 필요하다.

새 slot은 현재 SQL의 parent_check(버전이면 questionId 필수), key_check(questionKey NOT NULL UUID), parent_slot_unique, slot→purpose, version SQL projection과 충돌한다. 기존 material/option/question 제약은 유지하고 새 슬롯만 분기한다. service sync + DEFERRABLE exact consistency라는 기존 단일 방식을 유지한다. FormVersion rich 필드를 바꾸는 BEFORE trigger에서도 old/new image ID를 잠가야 한다. 현재 lock_author_asset_content는 Question/QuestionOption/Template/Approval만 다룬다. 사후 deferred SELECT만 추가해서는 GC와 attach의 write-skew를 막지 못한다.

[BI-E04 prisma/schema.prisma:1278](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/schema.prisma:1278) · [BI-E12 prisma/migrations/20261025012000_author_assets/migration.sql:2](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261025012000_author_assets/migration.sql:2) · [BI-E14 prisma/migrations/20261025014000_question_images/migration.sql:9](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261025014000_question_images/migration.sql:9) · [BI-E15 src/server/author-asset-references.ts:10](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-references.ts:10) · [BI-E45 prisma/migrations/20261002094000_forms/migration.sql:328](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261002094000_forms/migration.sql:328) · [BI-E47 src/server/answer-validation.ts:18](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/answer-validation.ts:18)

### 전체 FormContent 단위 동기화가 필요한 이유

withAuthorAssetReferences의 현재 desired는 questions에서만 생성되지만 existing은 **부모 전체핀**이다. 별도 body writer가 pin을 만들더라도 다음 writeQuestions가 body pin을 obsolete로 계산할 수 있다. authorAssetSlots/with/assert/copy를 FormContent 또는 명시적으로 완전한 graph 입력으로 전환하고 createVersion/updateFormDraft/purge/template/approval 모든 call site를 함께 바꿔야 한다. FormVersion settings 변경과 questions/pages/blocks 쓰기를 하나의 parent lock·트랜잭션에 넣고, 제거 ref→기존 물리 row 제거→새 row→새 ref 순서를 유지한다. 승인/publish도 전체 graph를 검증해야 한다.

잠금은 quota가 필요하면 Company UPDATE를 actor SHARE 전에, 그 후 parent→정렬된 모든 Asset→정렬된 Blob을 유지한다. 기존 RC 전용 mutation/RR 명시 거절·1시간 expiry timestamp(3)·기존 quarantine pin 유지/신규 attach 금지·published/approval pin 불변을 보존한다. 새로운 content-field direct SQL의 양방향 경합을 실제 row-lock 시험으로 검증해야 한다.

[BI-E05 src/server/forms.ts:46](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/forms.ts:46) · [BI-E07 src/server/approvals.ts:30](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/approvals.ts:30) · [BI-E12 prisma/migrations/20261025012000_author_assets/migration.sql:2](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261025012000_author_assets/migration.sql:2) · [BI-E13 prisma/migrations/20261025013000_author_assets_expiry_precision/migration.sql:1](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261025013000_author_assets_expiry_precision/migration.sql:1) · [BI-E15 src/server/author-asset-references.ts:10](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-references.ts:10) · [BI-E24 src/server/file-quota.ts:6](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-quota.ts:6)

## 5. 14MiB 업로드부터 읽기까지

| 계층 | 현재 경계 | 필요한 변경/보존 |
|---|---|---|
| 계약 | 모든 asset input ≤5MiB, 이미지 purpose ≤1MiB | 새 네 body purpose만14MiB; 기존 5/1MiB 유지 |
| DB | Blob 5MiB, Asset 5MiB·QI/option1MiB | Blob capacity와 purpose별 asset CHECK 동시 확장; material MIME·image MIME 강제 |
| PUT body | readFileBody 공통10MiB | 예약된 서버 purpose에서 계산한 한도 전달; Content-Length/무길이·실제stream 차단 유지 |
| 암호화 storage | write10MiB, decrypt10MiB+32 | trusted purpose 옵션/전용 wrapper; CSF1/AAD/기존 암호문 보존, oversized 저장객체 읽기도 bounded |
| S3 | write10MiB + 공통decrypt | 같은옵션 전파; GET 전체 arrayBuffer 전환 시 max ciphertext size 조기차단 고려 |
| scan code | scanFile10MiB | 서버결정 한도(default10MiB) 옵션; 임의request max 허용 금지 |
| daemon 생성설정 | StreamMaxLength11M, MaxFileSize11M, MaxScanSize20M | 설정상한도 body14MiB를 실제 검사하도록 변경·재시작검증; 실제runtime은 이번 미조회 |
| image decode | 8192변/8M픽셀/4채널/3초/동시2 | byte한도와독립; 큰정상PNG/JPEG와 compressed bomb·누적비용을 실측 |
| JSON | 1,000,000 bytes | 이미지 bytes/dataURI를 넣지않고 ID만; rich 총길이·노드수는 별도설계 |

전역 MAX_FILE_BYTES만14MiB로 바꾸면 기존 응답파일/다른파일 계약이 불필요하게 넓어진다. 공통 primitives에는 기본10MiB를 보존하고 body목적만 검증된 상수를 전달하는 안을 권한다. 이미지원본bytes/hash는 유지하고, PDF용 변환이 필요하면 원본과 derived출력을 명확히 분리한다. 14MiB * 이미지수 * 암복호화/concat/rawdecode는 여러버퍼를 만들므로 총요청/문서/worker메모리와 동시처리예산을 따로 정한다.

[BI-E11 src/contracts/author-assets.ts:3](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/author-assets.ts:3) · [BI-E12 prisma/migrations/20261025012000_author_assets/migration.sql:2](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261025012000_author_assets/migration.sql:2) · [BI-E14 prisma/migrations/20261025014000_question_images/migration.sql:9](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261025014000_question_images/migration.sql:9) · [BI-E16 src/server/author-asset-uploads.ts:28](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-uploads.ts:28) · [BI-E17 src/server/file-validation.ts:30](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-validation.ts:30) · [BI-E18 src/contracts/files.ts:1](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/files.ts:1) · [BI-E19 src/server/file-storage.ts:11](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-storage.ts:11) · [BI-E20 src/server/s3-storage.ts:32](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/s3-storage.ts:32) · [BI-E21 src/server/file-scanner.ts:8](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-scanner.ts:8) · [BI-E22 scripts/clamav-local.ts:11](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/scripts/clamav-local.ts:11) · [BI-E23 src/server/author-asset-validation.ts:11](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-validation.ts:11) · [BI-E25 src/server/http.ts:14](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/http.ts:14)

## 6. 복제·템플릿·권한·역사 경로

- createTemplate: 검증한 같은서비스 owner를 독립 template pin에 연결한다. template 수정/삭제는 원본·사용폼의 핀/bytes에 영향 없어야 한다.
- copyForm/useTemplate: 같은서비스도 새 owned Asset ID + 공유 immutable Blob이며 각각 quota를 부과한다. 현재 copyAuthorAssets는 questions 내3개필드만 remap한다. 전체rich image nodes와 page/block/node ID를 함께 remap하고 같은 원본 asset 여러occurrence는 한복사owner로 dedup한다. 다른서비스와 system public template 권한 경로도 유지한다. public template을 임의 company asset키로 작성하면 DB에서 거절해야 한다.
- revise/new published: 같은자산+새version핀을 유지한다. 기존게시본/승인snapshot은 draft HTML이나 layout 수정으로 바뀌면 안된다.
- 시스템 import도 새purpose/14MiB검증/저장/scan을 통과해야 한다. body 외부 URL을 자동 fetch하여 내재화하는 경로는 만들지 않는다.
- GC/lifetime은 같은 ref table이면 재사용할 수 있으나 모든새slot이 projection에 포함되어야 한다. 마지막pin 이후1시간grace, 다른tenant clone owner생존 시 물리blob보존, pinned/quarantined 읽기차단을 유지한다. 별도ref table 안을 택하면 기존 count/reference/GC/삭제guard 전부 새테이블도 봐야 하므로 최소변경이 아니다.

[BI-E05 src/server/forms.ts:46](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/forms.ts:46) · [BI-E06 src/server/templates.ts:24](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/templates.ts:24) · [BI-E15 src/server/author-asset-references.ts:10](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-references.ts:10) · [BI-E16 src/server/author-asset-uploads.ts:28](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-uploads.ts:28) · [BI-E24 src/server/file-quota.ts:6](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-quota.ts:6) · [BI-E38 src/contracts/form-copy.ts:4](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/form-copy.ts:4) · [BI-E46 src/server/author-asset-system-import.ts:11](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-system-import.ts:11)

멤버 form/template/approval/submission scope는 재사용 가능하지만 submission DTO에는 현재 body 자체가 없으므로 과거 rich context를 보이려면 고정 FormVersion의 별도 DTO를 추가해야 한다. 답변정정은 최신폼이 아니라 이버전을 사용한다. 공개 manifest는 현재 active version 전체핀을 내준다. body/end/private를 무조건 여기에 더하면 제출 전 end/private까지 얻을 수 있다. 반면 viewer의 questionKey 필터는 질문없는핀이 모두 빠지게한다. 필터를 통째로 없애면 미선택질문/페이지자료 노출이다.

**권한 open decision:** root본문은 viewer에 줄지, 선택질문이속한페이지의 본문만줄지, end/private를제외할지 명시한다. 완료내용이 단순공개표현인지 제출receipt에묶인내용인지도 구분한다. 후자면 별도완료capability가필요하다. pause/expiry/revoked는 현재publicationgate에서410이므로 마감페이지용은 현재link와회사/service상태를확인하면서 마감slot만주는 별도읽기경계가필요하다. 권한검사자체를 완화하여 일반폼/과거링크까지 열면 안된다.

[BI-E26 src/server/author-asset-reads.ts:18](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-reads.ts:18) · [BI-E27 src/server/public-publication.ts:4](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/public-publication.ts:4) · [BI-E28 src/server/submissions.ts:27](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/submissions.ts:27) · [BI-E29 src/server/submission-management.ts:39](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/submission-management.ts:39) · [BI-E30 src/contracts/sharing.ts:23](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/sharing.ts:23) · [BI-E31 src/server/viewer.ts:94](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/viewer.ts:94)

## 7. 영수증·PDF·CSV의 독립 경계

현재 ConsentEvidence는 schemaVersion1이고 formBody=version.body다. renderConsentEvidence는 문자열을조합하고 renderPdf는 text만받는다. renderer2는다국어layout지원이며 rich/image renderer가 아니다. 이미지포함은 별도rich renderer/source 타입·버전을도입해야 한다. 원래 v1/v2 text dispatch, fontHash,저장DocumentPdf/ConsentReceipt bytes는변경하지 않는다. ConsentReceipt는 pdfCipher/pdfHash와 evidenceCipher/documentHash를저장하지만 DocumentPdf와같은rendererVersion/fontHash 컬럼은없다; 신규rich evidence에provenance를명시하거나 additive metadata를선택한다.

신규증거버전은 정규화된main/pages context와image의ownerID·immutable blob SHA/size/MIME·layout순서를snapshot으로보존해야한다. 실제embed는인가된privatebytes를검증해읽고 네트워크URL을PDF엔진에넘기지않는다. end/private는동의전표시되지않을수있으므로 법률동의본문으로자동추가하지않는다. 전체작성페이지와실제방문페이지중무엇을증명할지F4분기정책과함께결정한다. 원본PDF서버의image포함은미관측이므로텍스트projection만으로원본동등성완료라하지않는다.

14MiB이미지한장과현재PDF16MiB·250page·500k문자상한은독립이다. 여러이미지·PNG raw확장·PDF재인코딩에서미리누적예산을검사해야한다. pub/approval preflight와submit의같은renderer계약을유지하고실패시응답/receipt/pin/audit부분저장이없어야한다. writeFormConsent의강제evidenceVersion1,preflight/create/read의version1분기,SubmissionDetail의pdfAvailable===1도같이확장한다. 구receipt다운로드는항상저장bytes를검증해반환하고재렌더하지않는다.

현재CSV export는질문·답변만출력하며본문이미지열은없다. 본문추가를이유로CSV값이나답변hash를변경하지않고불변회귀로확인한다. import로생성된기존flat폼에페이지/rich필드를임의백필하지않는다. 별도답변PDF전체기능의완료여부는이문서에서주장하지않는다.

[BI-E32 src/contracts/form-documents.ts:6](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/form-documents.ts:6) · [BI-E33 src/server/consent-receipts.ts:20](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/consent-receipts.ts:20) · [BI-E34 src/server/form-documents.ts:12](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/form-documents.ts:12) · [BI-E35 src/server/pdf-renderer.ts:8](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/pdf-renderer.ts:8) · [BI-E36 src/server/pdf-renderer-v2.ts:56](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/pdf-renderer-v2.ts:56) · [BI-E37 src/server/document-pdf.ts:10](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/document-pdf.ts:10) · [BI-E29 src/server/submission-management.ts:39](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/submission-management.ts:39) · [BI-E44 src/server/export-renderer.ts:15](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/export-renderer.ts:15)

## 8. 최소 실행 순서와 RED 계획

- **S0** (선행 없음): 원본 BI-01와 D01/D02/D05/D06 확정; 상한/serializer/페이지 개념을 계약 문서로 고정. 수용 범위: 계획만.
- **S1** (선행 S0): 현재 코드 API/DB를 이용한 RED, nullable versioned contract와 sanitizer/AST adapter 및 omission 정책. 수용 범위: rich 계약.
- **S2** (선행 S1): 14MiB purpose별 상한+storage/scan/daemon+DB additive migration+신규 slot/FK/deferred projection/GC fence. 수용 범위: 저장 및 참조 기반.
- **S3** (선행 S2): full FormContent atomic sync, root body editor+읽기·copy/template/approval 한 경로 수직검증. 수용 범위: root 본문만 partial; BI 전체 완료 아님.
- **S4** (선행 S2, S3): F4 page identity/order/question mapping/분기와 page/end/private 상태·권한·copy/delete·역사 경로 구현. 수용 범위: 네 위치의 실제 동작.
- **S5** (선행 S4): evidence2/rich PDF preflight/submit 저장과 기존0/1/rawbytes 불변, retention 및 export 영향 검증. 수용 범위: 증거/출력.
- **S6** (선행 S3, S4, S5): root 단독 DB/HTTP/Ego/재시작/새freeze; 20개 기존fixture는 승인된root보존 절차만 사용. 수용 범위: 통과한 BI 하위범위만 checkpoint.

최초 RED는 없는 helper import로 수집실패시키지 않는다. 기존 formContentSchema·실제 create/update/public/copy/template/approval API와 직접SQL 경계에서 새필드/purpose/parent모델 누락을 재현한다. 제품구현과시험실행은 root 별도승인단계다.

| ID | 층 | 검증 시나리오 |
|---|---|---|
| R01 | contract | 기존 plain body에 literal <img>/공백/BOM·Unicode가 있어도 old DTO/JSON/fingerprint/PDF bytes 동일; nullable 신규키 생략 |
| R02 | contract/server | rich omission은 현재 동일 version/block 보존, explicit clear만삭제; 과거버전 부활·새page/node 잘못상속금지; legacy client body변경충돌 정책 |
| R03 | sanitize | script/onerror/svg/math/iframe/srcdoc/srcset/CSSurl/data/blob/remoteurl/userinfo/entity 인코딩 거절·제거; 허용정렬/폭/alt/링크·순수이미지문단 roundtrip·idempotence |
| R04 | contract/DB | 네 purpose/slot 일치, root/page/end/private physical parent FK·node uniqueness·page 소속; typedserver와 directSQL 양쪽 경계 |
| R05 | DB concurrency | JSON/AST→pins 정확일치, 추가/삭제 양쓰기순서, FormVersion directSQL root변경↔GC row-lock 경합 및 RR거절; query시간 추정으로 대체하지 않음 |
| R06 | file pipeline | 원본에맞는 정상PNG/JPEG14MiB경계/초과/손상/hash/MIME/content-length/chunked; PUT→encrypt→read→ClamAV→complete→download hash; system import/S3도 같은 경계 |
| R07 | negative compatibility | 일반FILE10MiB·material5MiB·QI/option1MiB 그대로; BI MIME를문서purpose·QI슬롯으로주입거절 |
| R08 | resource | 8M픽셀/8192변/메타데이터·동시decode·전체form이미지예산·500k텍스트/250page/16MiB PDF 충돌; watchdog자식프로세스로유한실행검증 |
| R09 | forms | 질문만수정/제목만수정이root/page/end/private pin을지우지않음; body만수정이질문핀을지우지않음; stale409/audit실패전체rollback |
| R10 | pages | 최소2페이지에중복이미지, 질문이동·재정렬·삭제/취소·분기·숨긴필수/이전응답정정; 첫페이지mainText와둘째pageContent구분 |
| R11 | copy/template | 같은/다른서비스 및 system공용template use 새owner+같은blob+각소유quota; 명시copy page/node/HTMLkey remap; pure revise만기존owner유지 |
| R12 | lifecycle | template 수정/삭제, 페이지단독삭제, 임시업로드TTL, 마지막핀후grace, 다른owner생존, 격리된기존pin유지/신규attach거절, GC/copy 경쟁 |
| R13 | approval | 네 위치각수정→승인무효, 이전snapshot 핀/bytes불변, 새로운승인후게시; 게시page/block directSQL 변경거절 |
| R14 | public gates | 활성/정원종료/일시중지/만료/회수/회사폐쇄의root/page/end/private JSON·manifest·직접bytes 각각범위; 토큰재사용·역사URL 정책 |
| R15 | viewer | 선택page/질문경계와root/end/private 정책검증; 미선택404·revoke401·응답기한410, 공유발급자권한회수 및 deadline끝재검사 |
| R16 | receipt/PDF | 신규rich컨텍스트+16언어+14MiB image 누적preflight, 실제consent제출 pdfCipher복호화/hash/시각/재읽기 동일; 구0/1원문/renderer1·2 독립golden 동일 |
| R17 | UI/API | 서버확정schema없이UI키생성금지; upload완료전 save barrier, 삭제/페이지변경/서비스변경/undo 후늦은결과 revive금지; 모바일·RTL·폭/alt·깨진이미지 fallback |
| R18 | migration/restart | 기존20fixture 원문불변은root전용절차; 새컬럼null+공통열hash·적용파일checksum·빈스키마·drift; freeze후HTTP/DB UI읽기금지 |
| R19 | export/import | CSV답변열/body없음 유지 및기존다운로드hash; import폼에 rich/page를 임의생성하지않음; 원본답변PDF 기능은기존textPDF와구분 |

기존 의미시험 재사용 후보: tests/server/question-image-{contract,database,backend,validation}.test.ts, author-asset-{database,references,uploads,reads,validation}.test.ts, form-module-concurrency.test.ts, form-system-copy.test.ts, form-documents.test.ts, consent-display-authority.test.ts, document-pdf.test.ts, pdf-renderer-v2.test.ts, message-content.test.ts. 기존시험을완화해신규상한/slot을맞추지말고일반계약보존과신규계약을함께확인한다. 이번에는어느시험도실행하지않았다.

## 9. root PLAN 재대조

최종 대조 대상: [PLAN.md](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/body-images/PLAN.md), SHA-256 `7bb51baa9eae66001e2c8c9bdc1e7c8cb23cb2153d10b7dfcfba2b36c4a2a5ed`. 이 계획은 위 분석의 주요 선행 결정을 반영했다. 버전 문서는 bodyRich, 페이지 모델은 기존 목록 타입과 구별한 FormSection, 완료 화면은 성공 증명에 묶인 읽기, 마감 안내는 별도 공개 경계로 정리됐다. rich evidence v2는 root와 실제 방문 페이지를 담고 완료/마감은 제외한다. 위의 대안들은 조사 단계의 비교이며, 구현은 이 확정 계획을 따른다. **BI-02a 순수 계약 시작을 막는 구조적 충돌은 없다.**

실제 통합 전 보완할 항목은 두 가지다.

1. **전체 요청 예산:** PLAN:60의 폼 전체 rich JSON 1 MiB는 1,048,576 bytes이며, [body()](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/http.ts:14)는 전체 JSON 요청을 1,000,000 bytes로 제한한다. version/title/questions/동의 등 나머지 필드도 포함되므로 계약 경계에서 허용한 입력이 HTTP 413이 될 수 있다. BI-02a/02c에서 UTF-8 JSON 바이트와 전체 envelope를 함께 정하고, 일반 1,000,000 기본값을 보존한 폼/템플릿 전용 bounded override 또는 더 작은 rich 상한을 선택해야 한다. 순수 schema 경계와 HTTP 경계를 따로 시험한다.
2. **Task 의존성:** PLAN:83의 BI-05a 업로드/교체 수용에는 BI-03a/03b가, PLAN:81의 BI-04b 참조 통합에는 신규 purpose/DB 상한 도입이 선행되어야 한다. 코드 병행은 가능하지만 현재 purpose3종/DB5MiB/저장·scan10MiB 상태에서 새 body 이미지의 실제 수용을 완료할 수 없다. 이미지 PDF의 실제 수용도 이 업로드·검사 기반 위에서 진행한다. 이 보완은 BI-02a 시작을 막지 않는다.

계획의 24M pixels·16,384px는 새 body purpose용 안전 계약으로 적용하고, 기존 QI/option의 8M pixels·8192px 경계는 유지해야 한다. 현재 공통 validator 상수를 전역 교체하지 않는다. R08 표의 8M/8192는 기존 호환 경계를 뜻하며 새 body 한도의 성능 검증과 구분한다.

EOF 범위 해시 교정: BI-E11은 54–67, BI-E34는 82–95가 실제 마지막 줄까지의 범위다. 모든 47개 파일의 전체 SHA는 최초 수집값과 동일함을 다시 확인했다. JSON hashConvention에 이전 범위와 교정 범위를 기록했다. 제품 실행이나 fixture 접근은 하지 않았다.

## 10. 증거 색인

각 행은 현재 source snapshot이다. 파일이 나중에 변경되면 아래 SHA와 다를 수 있다. 원본 REA 기록과 로컬 소스 증거를 혼동하지 않는다.

| ID | 파일·줄 / 함수 | SHA-256 |
|---|---|---|
| BI-E01 | [docs/qa/R08-T02/question-metadata/content-images/PLAN.md:50](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/PLAN.md:50) · BI-01..07 | 9a1316bba6819b89e9bbaa1eb37ef5cf1f71442eeacad245be3901deaab44db9 |
| BI-E02 | [docs/qa/R08-T02/question-metadata/content-images/source-review.md:13](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/source-review.md:13) · 원본 정적 관측 | aab39af92cc41508f793ac20047202afcf260ab8ccb90c17aff63e51b726ccd8 |
| BI-E03 | [src/contracts/domains.ts:10](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/domains.ts:10) · formContentSchema/validateFormForPublish | c1a51de6cf042c32fbe7ed888ccac4584b2ef93fbeb1b7ab1c570bcbac389a9b |
| BI-E04 | [prisma/schema.prisma:1278](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/schema.prisma:1278) · FormVersion/Question/AuthorAssetReference | 681d92b1a4bcfa5a5dc59db0b9ce8111801a9041a2e90ac394d114e8be377006 |
| BI-E05 | [src/server/forms.ts:46](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/forms.ts:46) · contentDto/fingerprint/createVersion/writeQuestions/updateFormDraft/publish/copy/purge | fa1f4d1988ad3f88a22b2c8a08dff9396dfd44ff2945482f874c24c371b5789c |
| BI-E06 | [src/server/templates.ts:24](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/templates.ts:24) · dto/createTemplate/updateTemplate/deleteTemplate/useTemplate | d19e613ed66d87ce473d206afcdad90f4ed994453fa5dbb596f59cfbbb684946 |
| BI-E07 | [src/server/approvals.ts:30](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/approvals.ts:30) · requestApproval/decideApproval | d550157b8b187054e9bd84f1b44c8dc66be487d32fbb0a2716fa1fbcb671681a |
| BI-E08 | [src/server/message-content.ts:5](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/message-content.ts:5) · sanitizeMessageHtml/normalizeMessageContent | d9bc962cab3a45de379cf83c4f0ca4690a8e75cdaba09176ae97b56179d15f4c |
| BI-E09 | [src/server/notices.ts:12](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/notices.ts:12) · cleanBody | bc146cd4945cbaff1e53c21594ac513e19009910e675d06b9f6a2649aa5f8683 |
| BI-E10 | [package.json:45](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/package.json:45) · sanitize-html dependency | 72e6da47b4cdba56ba9713a5d60b8a5cab6c7b2a6c602bc7176ddb8012e0f2f9 |
| BI-E11 | [src/contracts/author-assets.ts:3](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/author-assets.ts:3) · purposes/byteLimit/uploadInput/readScope | 960f4889d4f30e9622ff0eee0ac98d442ffc68fcf5ac147c6cf272ffdaef6c37 |
| BI-E12 | [prisma/migrations/20261025012000_author_assets/migration.sql:2](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261025012000_author_assets/migration.sql:2) · blob bound/ref constraints/locks/graph | 059e740f4de7e93da25ab997610d041c6ce581e1860af456197fcf6aff5e005e |
| BI-E13 | [prisma/migrations/20261025013000_author_assets_expiry_precision/migration.sql:1](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261025013000_author_assets_expiry_precision/migration.sql:1) · expiry precision | af90851ed0a690711627d2b4d05fd9479d6a13b85b3e59ece1fe3590b8ef4269 |
| BI-E14 | [prisma/migrations/20261025014000_question_images/migration.sql:9](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261025014000_question_images/migration.sql:9) · check_author_asset/author_asset_expected/version_content/parent/lock | 11e867719285a0124a40517d159ce23942aea249c41876ff6735f170507bce49 |
| BI-E15 | [src/server/author-asset-references.ts:10](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-references.ts:10) · authorAssetSlots/withAuthorAssetReferences/assertAuthorAssetReferences/copyAuthorAssets | db29e009b48e9323cb39bd73454df2fdf8b36d80161a7148916297f8e15e3286 |
| BI-E16 | [src/server/author-asset-uploads.ts:28](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-uploads.ts:28) · init/PUT/complete/read/response/GC | e5e2d4279fa2d7972c480c8dd19b1eb09c4d77ba1b75c32acff2f501005e8208 |
| BI-E17 | [src/server/file-validation.ts:30](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-validation.ts:30) · readFileBody | 98738853c605eb95fc53acea63ac72ef8d13a790e0a9d00b0ab08a01fa402b9c |
| BI-E18 | [src/contracts/files.ts:1](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/files.ts:1) · MAX_FILE_BYTES | fed0f280c4b41468f8e9eafa4a6792568d9da55b99e1965254201234c937c0cd |
| BI-E19 | [src/server/file-storage.ts:11](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-storage.ts:11) · PrivateFileStorage/encryptStoredObject/decryptStoredObject/localFiles | c170df25a5ef48b73cea4470895768185244ec6d690461f955baed5f102c3da7 |
| BI-E20 | [src/server/s3-storage.ts:32](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/s3-storage.ts:32) · createS3FileStorage | 315cc789bb1ae00c272bf6e83909eef046662f8138698ab3243fc27c26374663 |
| BI-E21 | [src/server/file-scanner.ts:8](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-scanner.ts:8) · scanFile | 2d09f1f2f7be3c3fce7dce442b0ddcc6791a6324978269a709dd390795b4431e |
| BI-E22 | [scripts/clamav-local.ts:11](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/scripts/clamav-local.ts:11) · configure | b0ba2a8f76d499df306ae7c4478283f857c50f96658c074e8bc83fcf2c9e0250 |
| BI-E23 | [src/server/author-asset-validation.ts:11](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-validation.ts:11) · AUTHOR_ASSET_VALIDATION_LIMITS/validateImage/validateAuthorAssetBytes | 1d9c3e8a6bd8083e22fad512333cc5ff4267ed8255d0f087a7bee06eb1976965 |
| BI-E24 | [src/server/file-quota.ts:6](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-quota.ts:6) · lockFileQuota/fileQuotaUsage/reserveQuota | 48b8aba7fdf6db82e34b48d70621f4f7b22677a17140aca9268d9e53375bc423 |
| BI-E25 | [src/server/http.ts:14](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/http.ts:14) · body | 90a64265bf3c6651a7678435fa5b8cc1ea886094ab36cb216d8062270e3de1a6 |
| BI-E26 | [src/server/author-asset-reads.ts:18](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-reads.ts:18) · readPinnedAuthorAssets/lockMemberParent/memberAuthorAssets/publicAuthorAssets | eb8f37c0e7bf4d54ae932c4316d359485f358c4bf4dedd165e676e225d0dd03e |
| BI-E27 | [src/server/public-publication.ts:4](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/public-publication.ts:4) · lockPublicPublication | 599a4b65169b0af465c572bbf00a779768eb57ddbbcb6ef110139eaeac4f034c |
| BI-E28 | [src/server/submissions.ts:27](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/submissions.ts:27) · publicForm/submitForm | e199495671ee028ee30e85bc1e81ed9f7534de6920d5cf329671681fa87ee02a |
| BI-E29 | [src/server/submission-management.ts:39](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/submission-management.ts:39) · getSubmission/correctSubmission | bc2239963ee6bdf368dcf5495133223497daed2047d8d011e5f3905b1d9aa788 |
| BI-E30 | [src/contracts/sharing.ts:23](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/sharing.ts:23) · ViewerInfo/SharedQuestion | 0471a52d5b628bfc274af445e25ccf61aca383299c32bf9c28191091658b0d0e |
| BI-E31 | [src/server/viewer.ts:94](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/viewer.ts:94) · viewerInfo/sharedAuthorAssets | ee6e63a7d97a7c952df1af20036e125113f8d17d323cfdaa813c451d5a98b59e |
| BI-E32 | [src/contracts/form-documents.ts:6](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/form-documents.ts:6) · ConsentEvidence | 0e9e5ce72c7a8539ccf358096f1a2274fc3f2b0b4fb057150686b25893161af6 |
| BI-E33 | [src/server/consent-receipts.ts:20](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/consent-receipts.ts:20) · evidenceFor/renderConsentEvidence/evidencePdf/preflight/create/read | 8fd52962540ba0c9d10b4fc5e5d373512a14dfc2dc8cf82486f2bc5616741a00 |
| BI-E34 | [src/server/form-documents.ts:12](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/form-documents.ts:12) · consentVersionInclude/writeFormConsent | 796e7008423cc20d44bf29c027c998e20b3067f74875836687c5d5a3145caf88 |
| BI-E35 | [src/server/pdf-renderer.ts:8](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/pdf-renderer.ts:8) · PdfSource/renderPdf | 64769537b279db6a46e6709699a57ca2bceb0029226fac8c3a8e574254dc21e5 |
| BI-E36 | [src/server/pdf-renderer-v2.ts:56](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/pdf-renderer-v2.ts:56) · renderPdfV2 | 23d96f6477c31c70cfbfd53621194c3b6a19f4c42679960493f2d7bba1642045 |
| BI-E37 | [src/server/document-pdf.ts:10](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/document-pdf.ts:10) · storedPdf | 85cb22811131d253662fb30923ecd0110c4d4d0ed3bc4b923a2aff9a95ce77d6 |
| BI-E38 | [src/contracts/form-copy.ts:4](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/form-copy.ts:4) · cloneFormContent | f7116f6021716937822e1eb5074d8ec1b21323e7d24fe558829ea99c7074f260 |
| BI-E39 | [src/components/forms/PublicForm.tsx:129](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/PublicForm.tsx:129) · public/receipt/closed branches | e8e297ab3e9d06010546ec1d15400d29ce3920bba60df849d0e4496dca02d642 |
| BI-E40 | [src/components/forms/FormEditor.tsx:32](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/FormEditor.tsx:32) · emptyContent/body editor | 1806e7d68652a33ff1b02e262e549be1e68a60646a1154f5a7dcca0afc12669d |
| BI-E41 | [src/components/forms/Approvals.tsx:69](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/Approvals.tsx:69) · approval snapshot | 820dda90a1d9373a55146dac3d5fd8bf96f7bc0f64f9b6434bc3c6aab784d3aa |
| BI-E42 | [src/lib/author-assets.ts:19](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/lib/author-assets.ts:19) · uploadAuthorAsset/hasAuthorAssets | 264ef93a1ca9c8352bd73ea180db75c3510a5fea1afc9de6f8f65c88bb21ecd4 |
| BI-E43 | [src/lib/use-form-draft.ts:10](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/lib/use-form-draft.ts:10) · validate/persist | 430b6028ac7839417419cb69a6728d94b8f20c5f184b0d14a5ff6ec9164f2238 |
| BI-E44 | [src/server/export-renderer.ts:15](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/export-renderer.ts:15) · exportLayout/renderExportRow/exportSourceHash | d17362c1baa2315a065b103d4164c4ad4413eff2b362ff9bcfb5de72d6091eef |
| BI-E45 | [prisma/migrations/20261002094000_forms/migration.sql:328](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261002094000_forms/migration.sql:328) · protect_published_version/question | df2545e63def70b8c0ee8c3fd334368253ce5c3c77fea6c976a722ec76ca9025 |
| BI-E46 | [src/server/author-asset-system-import.ts:11](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-system-import.ts:11) · importSystemAuthorAsset | 0bd09bc9162c614bc1f510b6d9a84e465de413e72604e60b3844c0fa4755f1c4 |
| BI-E47 | [src/server/answer-validation.ts:18](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/answer-validation.ts:18) · validateAnswers | e33a8041ea09af970705937c8f467aa1f8796470eefd853cf5a187a11258b462 |

조사 당시 대안과 남은 결정은 JSON의 decisions/unknowns, 최신 root 계획과의 대조는 planComparison에 명시했다. 본문이미지총개수·HTML상한·실제운영ClamAV/S3·원본서버보장은이번정적분석으로확정하지않는다. 기존20fixture보존시험도아직실행하지않았으며, root의별도보존절차결과를기다려야한다.
