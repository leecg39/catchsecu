# 문항 이미지와 본문 이미지 원본 조사

보존 번들의 정적 조사로 두 기능이 별개임을 확인했다. 문항 이미지는 평문 추가 설명과 독립된 단일 `questionImageKey`이고, 폼·페이지 본문 이미지는 rich HTML의 `img src`다. 문항 이미지 구현으로 본문 이미지까지 완료했다고 평가할 수 없다.

- 원본: `main.183e9d2c.js`
- SHA-256: `3538d47856c6ba1b4207059dc09434066c7ca692a5907ed792dd9e27c7dba78f`
- REA: `ev_87493e79c4f053718022b23e1e5d42acf1af245f8c7838a89cd7ebc3918df152`
- 상세 근거: [source-review.json](source-review.json), 19개 관측과 61개 발췌. 모든 위치는 JavaScript UTF-16 code unit 기준 `[start,endExclusive)`이며 각 원문에 UTF-8 SHA-256을 붙였다.
- 원본 JavaScript 실행, 네트워크 요청, DB·브라우저·시험·빌드 실행은 하지 않았다. 기존 번들·REA·16언어 literal을 재사용했다.

## 계약 비교

| 항목 | 문항 설명 이미지 | 폼·페이지 본문 이미지 |
|---|---|---|
| 쓰기 wire | `questionImageKey: string \| null` | `mainText` / `pageContent` HTML 속 `img src` |
| 평문 추가 설명 | 별도 `additionalExplanation` | 해당 없음 |
| 개수 | 질문당 한 장, badge 0/1 | 조사한 adapter/caller에 개수 상한 미발견; 서버 미관측 |
| 입력 크기 | 1,048,576 bytes 이하 | 14,680,064 bytes 이하 |
| 형식 | JPEG/JPG/PNG MIME, 확장자·선두 4바이트 확인 | JPEG/JPG/PNG MIME; 이 경로에서 확장자·매직 검사는 미발견 |
| 업로드 | `POST /company-operated-service/catch-form/asset/upload` | `POST /company-operated-service/formImage/upload` |
| multipart | `catchformId`, `assetType`, `file`, `replacedS3Key?` | `files`, `catchformId?`, `assetType?` |
| 업로드 응답 사용 | `fileKey`, `fileUrl`, `fileSize`, 사용량 | `imgUrl`, `fileSize`, 사용량 → CKEditor `{default:imgUrl}` |
| asset type | `QUESTION_IMAGE` | `FORM_CONTENT_IMAGE`, `PAGE_CONTENT_IMAGE` |
| 표시·편집 | 가운데/최대696px/반경8px, 확대 없음 | HTML 크기·정렬·대체 텍스트, 드래그 크기 조절 |
| 삭제 bookkeeping | key null + 임시 자산 discard | HTML URL 집합 차이 → `formImage/temp/status` |

완료/마감 편집기도 같은 rich editor를 사용하지만 `END_PAGE_CONTENT_IMAGE` / `PRIVATE_PAGE_CONTENT_IMAGE`로 위치를 구분한다. 본문 후속 설계에서 네 위치를 보존해야 한다.

## 문항 이미지

`HY/WY/qY/GY` `[8195191,8196100)`와 `C_t` `[12625330,12626786)`가 읽기·쓰기 경계를 보여준다. 읽기는 `questionImageUrl`, `imageUrl`, `serviceFormQuestionAssets`의 `QUESTION_IMAGE.url` 순으로 fallback한다. 저장은 단일 key만 쓰며 URL·size·upload token은 보내지 않는다. key의 실제 서버 형식은 미관측이다.

일반 문항 유형은 이미지를 지원한다. `n_t` `[12618669,12621176)`는 IDV와 빈/미정 유형을 제외한다. 일반 유형 사이의 전환은 보존하며 IDV처럼 지원하지 않는 유형으로 전환할 때만 초기화 확인 후 제거한다. 현재 로컬 16개 일반 유형에 이미지를 유지하는 계획과 맞는다. 원본 공개 helper에는 AI_V3 이외 폼에서 문항 이미지 URL을 제거하는 별도 분기가 있다.

업로드 `[12737470,12739744)`는 임시 token을 현재 페이지 목록에서 다시 찾는다. 질문 삭제 또는 기능 off 뒤 완료된 업로드는 연결하지 않고 discard한다. 실패한 교체는 기존 이미지를 남긴다. 기능 off·질문 삭제·단일 이미지 삭제는 각기 정리 경로가 있다. 추가/교체 버튼은 질문 disabled도 검사하지만 원본 단일 삭제 버튼의 disabled는 업로드 중 조건만 확인된다. 로컬에서 모든 읽기 전용 변경을 차단하는 것은 독립 보완이다.

공개 배치 `[8329280,8330500)`와 CSS `[8335075,8335414)`는 **제목 → 이미지 → 참고자료 → 평문 추가 설명 → 답변**이다. 이미지는 가운데 정렬, 위 여백 8px, `max-width:min(696px,100%)`, 원본 비율, 반경 8px이다. `alt=""`, `draggable=false`이며 추적한 경로에 클릭 확대·alt 편집·실패 fallback은 없다. 관리자·응답·미리보기에서도 대응 경로를 확인했다. 보기 이미지 lightbox와 혼동하면 안 된다.

질문 복제는 `QUESTION_IMAGE`의 `originS3Key`를 copy API에 전달한 뒤 새 key/URL/size를 새 질문에 매핑한다. 파일 제외 복제는 이미지와 FILE 자료를 빼고 LINK를 유지한다. 서버의 소유권·실제 bytes 복제·역사 pin은 이 호출만으로 확인되지 않는다.

## 본문 rich HTML

폼 editor의 `description`은 저장 시 `mainText`이며, 없으면 `<p></p>`다. 페이지는 `pageContent`를 저장하지만 첫 페이지의 title/content는 빈 문자열로 강제되어 폼 mainText가 첫 안내를 맡는다. `mkt` 호출 `[12779400,12782328)`과 `SNt` `[12342997,12344854)`를 근거로 한다.

toolbar에는 이미지 업로드, undo/redo, 정렬, 대체 텍스트가 있다. image config는 px resize와 원본/50/75 옵션을 제공한다. 추가 resize 코드 `[12357580,12358783)`는 컨테이너의 10~100%로 제한한 폭을 `%`로 저장하며 width upcast/downcast가 HTML figure style을 유지한다. 이미지 CSS는 최대 너비 100%, 높이 auto다. 사용자 HTML과 alt는 자동 번역하지 않는다. editor UI는 en이고 content 방향은 RTL 언어면 ar로 설정한다. 모바일/touch 실제 실행은 하지 않았다.

`DOMParser`로 본문 이미지 URL을 수집하고, 다른 본문에 계속 사용되는 URL과 origin 집합을 비교해 아래 요청을 보낸다.

```text
POST /company-operated-service/formImage/temp/status
{ catchformId, saveData?: URL[], deleteData?: URL[] }
```

`O_t/M_t` `[12629197,12631588)`는 초기 폼에서 deleteData를 억제하고 사용량 중복 차감을 피한다. 요청 실패는 무시한다. `kNt`는 data URI를 제외하고 마지막 경로가 UUID.확장자 형태인 URL만 관리 대상으로 계산한다. 이 필터는 전체 HTML 렌더의 허용 정책을 증명하지 않는다.

문항/본문/보기/자료는 같은 사용량을 공유한다. 표시 gauge의 기본 100MiB를 서버 공통 상한으로 확정하면 안 된다. scoped 업로드 pending과 공유 queue가 있고 저장·페이지 복제 진입을 막는 분기가 있다.

### 페이지 복제의 미확인점

`MNt` `[12346308,12347376)`는 페이지 HTML의 관리 대상 URL을 `PAGE_CONTENT_IMAGE` copy 항목으로 수집한다. 그러나 `LNt` `[12347376,12348517)`는 질문 자산만 새 값으로 매핑하고, H/W caller `[12771440,12774721)`는 기존 페이지를 spread하여 questionList만 바꾼다. 조사한 체인에는 pageContent HTML의 새 URL 치환이 없다. 파일 제외 복제도 질문만 비운다.

copy 요청 존재는 확정되지만 새 URL 적용·서버 응답은 미관측이다. 이를 실제 복제 결함으로 단정하지 않는다. 로컬 BI 단계에서는 본문 자산 복제와 HTML/ID remap을 명시적인 독립 계약으로 정해야 한다.

## 다국어·동의·PDF

보존 16언어 literal에서 `aiQuestions.questionImage` 및 `uploadAdapter` 관리자 문구는 ko에만 있었다. 언어 변경 reducer는 주소 유형을 바꾸며 기존 이미지 필드와 작성자 HTML을 자동 번역하지 않는다. 문항 이미지 자체는 빈 alt의 장식 이미지다.

비한국어 동의 편집기도 이미지 업로드가 가능한 mkt를 사용하지만 확인한 호출에는 assetScope가 없다. 동의 HTML은 별도 `Mpt` 처리와 content/agreementContent 반영을 거친다. 문항 이미지나 폼 mainText를 동의 문서로 자동 복사한다는 근거는 없다.

답변 PDF 호출 `[12198805,12199428)`, `[12208640,12209210)`는 customerIds/pageIds/includeConsent 등으로 서버 생성을 요청한다. 이미지 key나 HTML bytes를 직접 보내지 않는다. **서버 PDF에 이미지가 포함되는지, 래스터화·레이아웃·버전·hash를 어떻게 보존하는지는 미관측**이다. 프런트 요청에 이미지가 없다는 이유로 PDF에서도 빠진다고 판단할 수 없다.

## 현재 계획 대조

[PLAN.md](PLAN.md)의 문항/본문 분리, 문항 단일 key·한도·일반 유형 보존·표시 순서·696px·반경8px·확대 없음은 관측과 맞는다. 원본과 충돌하는 실행 차단 사항은 발견하지 않았다. 대조한 계획 SHA는 상세 JSON의 `planComparison`에 고정했다.

다음은 원본 서버에서 확인된 보장이 아니라 로컬 구현 결정이다: UUID key, 누락 시 현재 논리 질문 값 보존, explicit null 삭제, purpose 강제, FK/reference pin, 바이러스·완전한 디코딩 검사, 암호화·소유권·역사 권한, 로딩/실패 fallback, 과거 영수증 bytes 보존. 원본 동등성 설명과 구분해야 한다.

## 남은 미관측 범위

- 서버 DTO·key 소유권·파일 검사·pixel/메모리 한도·quota 원자성·영구 삭제·TTL·읽기 권한.
- 본문 이미지 총 개수/HTML 길이 상한, 실제 paste·drag/drop·외부 URL·data URI 처리.
- 페이지/전체 폼/템플릿 복제의 본문 URL 재발급·치환과 역사 버전 수명.
- PDF 이미지 포함 및 동의 증거의 저장 bytes 불변 정책.
- 브라우저 실제 크기, 모바일/touch, 취소·실패·지연 타이밍.

위 항목은 정적 코드에 없거나 실행하지 않은 범위이며, 원본 서버에 기능이 없다는 뜻이 아니다.
