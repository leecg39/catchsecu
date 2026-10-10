# BI-01 — 본문·페이지·완료·마감 rich HTML 원본 조사

보존 번들의 정적 분석을 완료했다. 네 화면은 같은 rich editor를 사용하지만 저장 위치와 자산 관리 범위가 다르다. 문항 이미지(questionImageKey)와는 별도 계약이다. 제품 구현·원본 실행·네트워크·DB·브라우저·시험은 수행하지 않았다.

근거: [main.183e9d2c.js](</Users/user01/Desktop/캐쳐시큐/outputs/catchsecu-reverse-2026-10-09/bundle/main.183e9d2c.js>) · SHA-256 3538d47856c6ba1b4207059dc09434066c7ca692a5907ed792dd9e27c7dba78f · REA ev_87493e79c4f053718022b23e1e5d42acf1af245f8c7838a89cd7ebc3918df152. 모든 위치는 0-based JavaScript UTF-16 code unit이며 끝은 제외한다. [기존 content-images 근거](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/source-review.json>)의 61개 raw/해시를 재확인했고, 이번 [source-review.json](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/body-images/source-review.json>)에는 90개 발췌·18개 관측·16언어 기본 완료 HTML을 보존했다.

## 네 저장 위치

| 화면 | 원본 작성 상태 → write field | 업로드 assetType | 편집 위치 |
| --- | --- | --- | --- |
| FORM | formModelV3.description → mainText | FORM_CONTENT_IMAGE | pageIndex=0 |
| PAGE | formModelV3.pageList[i].pageContent → pageList[i].pageContent | PAGE_CONTENT_IMAGE | i>0 |
| END | settingData.endPageContent / live ref → endPageSetting.endPageContent | END_PAGE_CONTENT_IMAGE | END tab and paid pricing |
| PRIVATE | settingData.privatePageContent → privatePageSetting.privatePageContent + privatePageType | PRIVATE_PAGE_CONTENT_IMAGE | PRIVATE tab + DIRECT mode + paid pricing |

기본 폼은 POST /company-operated-service/v3/catch-form/basic/temp 또는 /basic에 mainText와 pageList를 보낸다. 초기/일반 페이지의 title/content는 배열 첫 항목에서 빈 문자열로 강제되고, 폼 description이 첫 화면 안내를 담당한다. 완료·마감은 GET/POST /company-operated-service/v3/catch-form/managements의 endPageSetting/privatePageSetting이다. 각 업로드 scope에는 catchformId가 있고 pageId를 업로드하지 않는다.

근거: body-v3-write [12625323, 12626800); body-v3-api [7916120, 7916430); body-final-save [12806689, 12807100); management-v3-write [13182980, 13185297); management-v3-read [13194616, 13195740).

## toolbar와 HTML 형태

다음은 설정과 converter에 실제로 존재하는 항목이다. 붙여넣기 가능한 모든 요소나 서버 sanitizer allowlist를 뜻하지 않는다.

| 기능 | 관측 명령·출력 |
| --- | --- |
| 기본 toolbar | heading, bold, italic, link, bulletedList, numberedList, outdent, indent, imageUpload(조건부), blockQuote, mediaEmbed, insertTable, undo, redo |
| 단락·제목 | paragraph → p; heading1/2/3 → h2/h3/h4 |
| 인라인·목록·인용 | bold → strong; italic → i(em도 upcast); ol/ul/li; blockquote |
| 별도 추가 도구 | fontSize 12/14/15/16/20/24/32px, fontColor, RTL/LTR toggle |
| 이미지 | imageStyle:alignLeft/full/alignRight, imageTextAlternative, resizeImage:50 설정 |
| 표 | insertTable; content toolbar tableColumn/tableRow/mergeTableCells; tableCell colspan/rowspan |
| media | previewsInData=true, YouTube Shorts provider, iframe 형식과 figure.media; 별도 정렬/너비 |

근거: editor-config-without-license [12373386, 12375384); converter-heading-defaults [3007880, 3008490); converter-bold [2927656, 2927897); converter-italic [2929255, 2929455); converter-list [3041917, 3042300); converter-blockquote [2932039, 2932282); editor-font-presets [12359032, 12359277); editor-font-converters [12359930, 12361251); editor-extra-toolbar [12367947, 12368285); converter-table-schema [3104431, 3104970); editor-default-table-toolbar [3136020, 3136440).

이미지 model은 src/alt/srcset을 보존하고 figure.image 안에 img를 만든다. caption converter는 figcaption을 사용한다. full은 기본 스타일이며 좌/우는 image-style-align-left/right class다. width는 figure의 style로 upcast/downcast된다. 아래는 converter를 합친 설명용 구조이며 실제 서버 저장 응답 캡처가 아니다. 속성 순서·빈 caption 유무·두 inline attribute 결합 순서는 확정하지 않았다.

```html
<figure class="image image-style-align-left" style="width:50.0%">
  <img src="[upload response imgUrl]" alt="[작성자 대체 텍스트]">
  <figcaption>[선택 caption]</figcaption>
</figure>
<span style="font-size:20px;">[텍스트]</span>
<span style="color:#ab4642;">[텍스트]</span>
<figure class="table"><table>…</table></figure>
```

근거: converter-image-attributes [2945630, 2946640); converter-image-figure [2947588, 2947774); converter-image-caption [3010670, 3011385); converter-image-styles [3015582, 3016106); editor-width-serialization [12351300, 12353520); editor-font-converters [12359930, 12361251); converter-table-figure [3080030, 3080390).

치수 의미를 구별해야 한다. config는 resizeUnit:px이고 resize options 50/75의 값은 문자열 "50"/"75"다. 반면 custom mouse resize는 부모 폭의 10~100%를 clamp해 소수 1자리 %로 model width에 쓴다. 따라서 원본에 50%/75% 버튼이 정상 작동한다고 단정할 수 없다. 조사한 editor module42394 범위에는 resizeImage/ImageResize 문자열이 없고 내장 resize 명령의 실동작은 미확인이다. custom 드래그·width 변환 경로는 코드로 확인했다. img CSS는 max-width:100%, height:auto다.

근거: editor-config-without-license [12373386, 12375384); editor-resize-interaction [12357580, 12358783); editor-responsive-css [12370100, 12371027).

## HTML 정리와 렌더 경계

Ppt는 src가 없거나 공백인 img 태그만 제거한다. mkt는 editor.getData()를 이 함수에 통과시켜 parent에 반영한다. QO는 webpack module53908이며 parseFragment 결과의 요소·속성을 React.createElement에 옮긴다. script를 별도로 처리하는 분기도 있어 sanitizer로 간주할 수 없다. 일반 공개 main/page는 CY 후 QO, 일부 관리자·완료·마감은 QO에 직접 넣는다. CY는 oembed/YouTube와 링크 프로토콜 보완용이며 이미지의 소유 URL 치환 함수가 아니다.

동의 편집기는 별도의 Mpt(script/iframe/on* 속성·일부 위험 스킴 제거)를 호출한다. 해당 동의 경로의 처리를 main/page/end/private에 적용됐다고 일반화할 수 없다. 번들 다른 위치에 DOMPurify는 존재하지만 추적한 본문 mkt/CY/QO call path에서는 호출을 확인하지 못했다. 원본 서버의 sanitize 정책과 실제 브라우저 실행 가능성은 미관측이다. 로컬 보안 allowlist는 독립 계약으로 정해야 한다.

근거: html-image-extraction [11578370, 11579460); editor-change-readonly-complete [12375506, 12377370); html-parser-import [7702940, 7703023); html-parser-module [3293649, 3294314); html-render-transform [8182533, 8183626); consent-cleaner-start [11579532, 11580331); consent-editor-html [13041900, 13042400).

## 계획용 관측 목록

BI01 **네 위치는 서로 다른 저장 위치** (observed-static)

mainText는 formModelV3.description HTML, 일반 페이지는 pageList[].pageContent HTML이다. C_t는 첫 페이지 title/content를 빈 문자열로 강제한다. end/private는 endPageSetting.endPageContent 및 privatePageSetting.privatePageContent/privatePageType의 별도 managements API다. 하나의 image key 필드로 평탄화할 근거는 없다.

근거: body-v3-write [12625323, 12626800); body-v3-api [7916120, 7916430); body-final-save [12806689, 12807100); management-v3-write [13182980, 13185297); management-v3-read [13194616, 13195740); body-form-page-editors [12779400, 12782328); end-private-asset-scope [13190430, 13193100).

BI02 **페이지 식별·순서** (observed-static)

쓰기 pageList의 page/pageTitle/pageContent/pageOffset/questionList에는 pageId/pageIndex/_dragKey가 없다. 초기 page=1, 신규 page=r+2, UI pageIndex와 랜덤 _dragKey가 별도다. A_t는 _dragKey 및 전역 questionNumber를 만든다. 로드 pages는 spread하므로 추가 서버 필드를 보존할 수 있으나 write는 명시 투영한다. 응답 제출은 pageId/pageIndex를 사용한다. 첫 페이지는 드래그 목록에서 제외한다. 일부 add/reorder 경로는 배열 순서/pageIndex만 바꾸므로 모든 경로에서 page 숫자가 항상 재번호화된다고 일반화할 수 없다. 서버 순서/ID canonicalization은 미관측.

근거: body-v3-write [12625323, 12626800); page-initial-shape [6914751, 6915275); page-read-and-numbering [12624715, 12625104); page-create-limit [12758943, 12759666); page-order-drag [12832135, 12833200); page-identity-reducer [6924095, 6924207); page-runtime-response-id [10058517, 10058825).

BI03 **페이지 분기는 rich 본문과 별도지만 구조 의존** (observed-static)

RADIO/SELECTBOX에 usePageOffset, 선택지 pageOffset이 있다. pageOffset=-2는 기본 다음으로 정규화(1), 양수는 상대 이동, 99는 수집·이용 동의로 이동, UB=99999는 참여 대상 제외 PATH_KILL이다. 같은 페이지의 분기 질문 2개 이상은 저장 진행에서 거절한다. 질문 분기 존재 시 페이지 분기 UI를 비활성화하고 -2로 돌린다. 페이지 삭제/복제/이동은 경로 비교와 분기 초기화 확인에 연결된다. pageType literal은 번들 검색에서 0회이며 END/PRIVATE는 pageList enum으로 확인되지 않았다.

근거: page-branch-capability [12618853, 12619430); page-branch-enumeration [12621041, 12621688); page-branch-sentinels [12777721, 12778426); page-path-kill [7824732, 7824740); page-preview-path [12878500, 12879430); page-one-branch-validation [12805413, 12806094); page-order-drag [12832135, 12833200); page-delete-assets [12769308, 12769985); page-copy-pipeline [12771440, 12774721).

BI04 **페이지 개수와 본문 입력 제한의 경계** (observed-static)

신규 페이지 추가 handler는 50개 이상을 막는다. 페이지 제목 input maxLength=200, 폼 제목은 기존 100이다. 추적한 mkt 및 네 본문 call site에는 HTML 전체 길이/이미지 개수 상한이 명시되지 않는다. 이는 서버에서 무제한임을 뜻하지 않는다.

근거: page-create-limit [12758943, 12759666); body-form-page-editors [12779400, 12782328); editor-config-without-license [12373386, 12375384); body-upload-adapter [12342997, 12344854); limits-quota [6912700, 6914080); form-title-limit [12766508, 12766878).

BI05 **rich toolbar와 HTML model** (observed-static)

기본 toolbar는 heading,bold,italic,link,bulletedList,numberedList,outdent,indent,imageUpload(조건부),blockQuote,mediaEmbed,insertTable,undo,redo다. 추가 DOM toolbar는 fontSize(12/14/15/16/20/24/32px), fontColor, RTL/LTR다. converter로 p,h2/h3/h4,strong,i,blockquote,ol/ul/li,figure.table/table 계열과 span의 font-size/color가 확인된다. 이 목록은 관측된 생성/변환 기능이며 안전한 HTML allowlist의 증명이 아니다.

근거: editor-config-without-license [12373386, 12375384); editor-font-presets [12359032, 12359277); editor-font-converters [12359930, 12361251); editor-extra-toolbar [12367947, 12368285); editor-rtl-plugin [12349604, 12350333); converter-paragraph-heading [3006876, 3007182); converter-heading-defaults [3007880, 3008490); converter-bold [2927656, 2927897); converter-italic [2929255, 2929455); converter-blockquote [2932039, 2932282); converter-list [3041917, 3042300); converter-table-schema [3104431, 3104970); converter-table-figure [3080030, 3080390); editor-default-table-toolbar [3136020, 3136440).

BI06 **이미지 HTML·너비·정렬·alt·caption** (observed-static)

image model에 src/alt/srcset, figure.image 안 img, 선택 caption의 figcaption이 있다. 스타일 full 기본, alignLeft/alignRight는 image-style-align-left/right class로 변환한다. tkt는 image/media width를 figure style width로 upcast/downcast한다. mouse 드래그는 부모 폭의 10~100%를 1자리 소수 %로 저장한다. config resizeUnit:px와 50/75/original options도 있으나 모듈42394 내 resizeImage/ImageResize 문자열은 없어 해당 기본 command의 실동작은 확인되지 않았다. 실제 캡처가 아닌 정적 변환 근거다.

근거: converter-image-attributes [2945630, 2946640); converter-image-figure [2947588, 2947774); converter-image-caption [3010670, 3011385); converter-image-styles [3015582, 3016106); editor-config-without-license [12373386, 12375384); editor-custom-model-width [12351178, 12353520); editor-width-serialization [12351300, 12353520); editor-resize-interaction [12357580, 12358783); editor-responsive-css [12370100, 12371027).

BI07 **media·링크 변환은 이미지 소유 URL 치환과 다름** (observed-static)

mediaEmbed previewsInData=true, YouTube Shorts provider가 iframe HTML을 생성한다. figure.media에 width 및 media-align-left/center/right가 사용된다. CY는 oembed/YouTube를 변환하고 무스킴 a.href에 https://와 target/rel을 보완한다. 이는 img src를 새로운 소유 자산 URL로 바꾸는 함수가 아니다.

근거: editor-config-without-license [12373386, 12375384); converter-media-figure [3056210, 3056490); html-render-transform [8182533, 8183626); editor-width-serialization [12351300, 12353520); editor-align-interaction [12356709, 12356900).

BI08 **sanitize 경계** (observed-static)

mkt의 Ppt는 src가 없거나 공백인 img 태그만 제거한다. 일반 본문 저장에는 이 Ppt와 editor.getData가 연결된다. QO module53908은 parseFragment 결과를 React element로 만들고 script에 dangerouslySetInnerHTML을 지정하는 분기도 있다. 공개 main/page는 CY 후 QO, 일부 admin/end/private는 QO 직행이다. 동의용 Mpt의 script/iframe/on*/위험 스킴 제거는 별도 call path다. 본문 경로의 완전한 sanitizer/서버 무해화는 입증되지 않았으며 이 정적 사실만으로 브라우저 실행 가능 취약점을 확정하지 않는다.

근거: html-image-extraction [11578370, 11579460); editor-change-readonly-complete [12375506, 12377370); html-parser-import [7702940, 7703023); html-parser-module [3293649, 3294314); body-public-html-render [8518700, 8520710); body-admin-preview-raw-html [8457040, 8458400); body-admin-reply-raw-html [8484140, 8485000); end-screen-render [7906731, 7908277); private-screen-render [7909963, 7911040); consent-cleaner-start [11579532, 11580331); consent-editor-html [13041900, 13042400).

BI09 **14 MiB 업로드 계약** (observed-static)

SNt는 file.size>14,680,064를 거절하고 MIME image/jpeg,image/jpg,image/png만 받는다. multipart POST /company-operated-service/formImage/upload의 file field는 files다. 유효 catchformId가 있는 scope에만 catchformId와 assetType을 추가한다. 반환 data.imgUrl/fileSize/usedBytes/limitBytes를 읽고 CKEditor에 {default:imgUrl}를 준다. question 업로드와 달리 이 handler에는 확장자·magic·0 bytes·pixel 완전 decode 확인이 없다. 서버 검사는 미관측이며 오류 메시지 매핑만 보인다.

근거: limits-quota [6912700, 6914080); body-upload-adapter [12342997, 12344854); body-upload-scope [12342645, 12343077); body-form-page-editors [12779400, 12782328); end-private-asset-scope [13190430, 13193100).

BI10 **네 assetType 및 구버전/동의 무scope 경로** (observed-static)

V3 main/page/end/private의 scope는 각각 FORM_CONTENT_IMAGE/PAGE_CONTENT_IMAGE/END_PAGE_CONTENT_IMAGE/PRIVATE_PAGE_CONTENT_IMAGE다. 인접 v2 end/private 및 비한국어 동의 편집기도 같은 imageUpload=true mkt를 쓰지만 해당 call site에는 assetScope가 없다. 따라서 전체 rich editor 업로드가 항상 form 소유/quota/temp 관리로 연결된다고 단정하면 안 된다.

근거: body-form-page-editors [12779400, 12782328); end-private-asset-scope [13190430, 13193100); management-v2-editor [13171033, 13173190); consent-editor-upload [13045000, 13046155); body-upload-adapter [12342997, 12344854).

BI11 **quota·진행 중 저장** (observed-static)

유효 scope의 업로드는 pending Set에 들어가며 공통 Promise queue를 통한다. bNt=true이면 기본 저장/설정 저장/페이지 복제 진입을 막는다. assetUsage는 질문·보기·참고파일과 본문이 공유한다. quotaApplied=false 또는 limitBytes<=0이면 프런트 사전검사를 통과한다. createAt 2026-09-22 06:30:00 경계도 클라이언트 quotaApplied에 사용한다. gauge 100 MiB fallback은 서버 보편 한도가 아니다. 명시 abort adapter는 해당 SNt 반환 객체에서 확인되지 않는다.

근거: limits-quota [6912700, 6914080); upload-queue-errors [12341014, 12342900); body-upload-scope [12342645, 12343077); body-upload-pending-save [12789934, 12790300); management-v3-write [13182980, 13185297); body-asset-gauge [12815200, 12817640); body-origin-load-usage [12889340, 12890200).

BI12 **편집 상태의 저장·blur·실시간 변경** (observed-static)

일반 본문은 focus/blur에서 parent 변경, 이미지 URL 집합 변경 때 onContentImageChange가 발생한다. end/private는 immediate=true와 onLiveChangeEditor refs도 연결한다. page title/content는 300ms debounce 및 flush registry에 연결된다. disabled는 CKEditor readOnlyMode를 적용한다. source에는 custom overlay와 adapter 취소/모든 교체 race의 포괄 보장은 확인되지 않는다.

근거: editor-change-readonly-complete [12375506, 12377370); body-form-page-editors [12779400, 12782328); management-v3-binding-gates [13181000, 13183377); end-private-asset-scope [13190430, 13193100).

BI13 **HTML URL 추출·삭제/복구 bookkeeping** (observed-static)

DOMParser로 img src를 추출한다. kNt는 data:를 제외하고 query/hash를 뗀 마지막 경로가 UUID.확장자인 URL만 자산 관리 대상으로 취급한다. 호스트 allowlist 검사가 아니므로 원본 호스트 소유를 증명하지 않는다. O_t는 catchformId/saveData[]/deleteData[] URL 목록을 formImage/temp/status에 보내며 초기 폼은 deleteData를 억제한다. 다른 본문에 남은 URL과 origin/삭제 집합을 대조해 중복 차감 및 undo 재증가를 처리한다. 실패는 catch에서 무시한다. 서버의 영구 삭제/복구/게시본 보존은 미관측.

근거: html-image-extraction [11578370, 11579460); body-owned-url-filter [12344814, 12345246); content-url-set-helpers [12348517, 12349707); body-status-delete [12629197, 12631588); body-origin-load-usage [12889340, 12890200); body-origin-reducer [6926830, 6927470); page-delete-assets [12769308, 12769985); management-v3-binding-gates [13181000, 13183377).

BI14 **END/PRIVATE와 기본 편집기의 다른 URL 비교 범위** (observed-static-with-gap)

FNt는 description+pageList만 수집한다. main/page handler는 FNt 기반이고 END/PRIVATE handler는 BNt로 description+pageList+반대 설정 본문까지 비교한다. 전체 네 위치의 관리가 대칭이라고 주장하지 않는다. 특히 main/page 화면이 이전 end/private HTML을 같은 집합으로 받는 근거는 추적 경로에서 미확인.

근거: content-url-set-helpers [12348517, 12349707); body-form-page-editors [12779400, 12782328); management-v3-binding-gates [13181000, 13183377); end-private-asset-scope [13190430, 13193100).

BI15 **페이지 복제의 URL remap·quota 갭** (observed-static-with-gap)

MNt는 질문 자산과 PAGE_CONTENT_IMAGE URL을 중복 제거해 {assetType,originS3Key,targetAssetType} 배열로 /catch-form/asset/copy에 보낸다. originS3Key 값이 본문에서는 URL 전체임을 확인했다. 반환 assets의 originKey/newKey/fileUrl/fileSize는 LNt로 질문 자산에만 매핑한다. 추적된 page clone의 {...u,questionList:...}는 pageContent 치환을 하지 않는다. totalBytes는 질문 자산 합계, contentImageBytes는 별도인데 복제 사전 quota는 totalBytes만 검사한다. 파일 제외 복제도 DNt로 질문만 비우며 본문 HTML을 남긴다. 서버의 동작/최종 URL 교체 결과는 미관측; 로컬 계획에서 이 갭을 복제하지 않아야 한다.

근거: page-copy-collect [12346308, 12347376); asset-copy-api [7918976, 7919081); copy-response-question-map [12347376, 12348517); page-copy-pipeline [12771440, 12774721); page-read-and-numbering [12624715, 12625104).

BI16 **END/PRIVATE UI·gate·mode** (observed-static)

END와 PRIVATE 탭, PRIVATE BASIC/DIRECT 라디오가 있다. servicePricingType가 없거나 F/None이면 rich 편집은 숨김/disabled이다. 일부 parent 반영·mode/reset handler는 저장 중 T에서 alert하지만 editor.disabled는 pricing V이고 live ref 콜백에는 T 검사가 없으므로 전체 조작 잠금을 보장한다고 볼 수 없다. DIRECT 최초 선택은 <p>언어별 상태 메시지</p>로 초기화하며 BASIC 전환은 custom HTML 삭제를 수행하지 않는다. end reset은 aUt(language) 16언어 HTML literal을 넣는다. private API는 content||기본p를 전송하고 type으로 표시를 결정한다. PRIVATE는 단순 시간 마감만이 아니라 activeYn=N 및 비활성 사유 경로에 연결된다.

근거: management-v3-binding-gates [13181000, 13183377); management-v3-write [13182980, 13185297); management-v3-read [13194616, 13195740); management-v3-mode [13191933, 13193191); end-private-asset-scope [13190430, 13193100); end-default-literals [13175308, 13180700); management-default-helper [13180701, 13180772); private-screen-status [10008405, 10008749); private-screen-render [7909963, 7911040).

BI17 **다국어와 RTL은 작성자 HTML 자동 번역이 아님** (observed-static)

main/page/end는 language prop, private v3 call site는 language prop 없음으로 mkt의 en fallback이다. 편집기 UI는 en, content는 ar/he/fa/ur/ps/ku/sd/yi이면 ar 아니면 en이다. RTL 토글은 editing view root dir만 변경하며 HTML model의 dir 저장 converter는 이 plugin에서 보이지 않는다. 기존 작성자 HTML은 언어 변경으로 번역하지 않으며 기본 완료 HTML만 언어별 literal로 복원한다. 비한국어는 설정 wizard 단계가 3, ko는 4인 branch도 있다.

근거: language-change-preserves-fields [6925225, 6925689); editor-config-without-license [12373386, 12375384); editor-rtl-plugin [12349604, 12350333); editor-extra-toolbar [12367947, 12368285); end-default-literals [13175308, 13180700); management-default-helper [13180701, 13180772); management-step-language [13195742, 13196000); end-private-asset-scope [13190430, 13193100).

BI18 **출력·PDF·수명 주기의 경계** (observed-static-with-gap)

main/page/end/private는 ck-content HTML 렌더이며 렌더 전에 LF를 제거하는 call site가 있다. PDF 요청은 customerIds/pageIds/includeConsent 등의 서버 생성 인자이므로 본문 이미지 포함/레이아웃/bytes/receipt hash를 입증하지 않는다. 활성/응답 존재시 수정 불가 오류와 temp cleanup API는 보이지만 immutable 버전/pin/승인/공유/영구삭제 수명은 원본 서버 미관측.

근거: body-public-html-render [8518700, 8520710); body-preview-html-render [12881180, 12882104); body-admin-preview-raw-html [8457040, 8458400); body-admin-reply-raw-html [8484140, 8485000); end-screen-render [7906731, 7908277); private-screen-render [7909963, 7911040); pdf-async-request [12198805, 12199428); pdf-direct-request [12208640, 12209210); edit-rejection-temp-cleanup [12893358, 12894220).

## 기존 평문과 rich 문서의 호환

원본 기본 완료 문구는 실제 HTML literal이다. nUt의 16개 언어를 정적 AST로 읽었으며 원문·UTF-16 위치·raw SHA를 JSON defaultEndHtml에 저장했다. 예를 들어 한국어 기본값은 다음과 같다.

```html
<h4>응답 작성에 감사드립니다.</h4><p>&nbsp;</p><p>수집된 모든 정보는<br>개인정보보호 솔루션 캐치시큐를 통해 안전하게 처리됩니다.</p>
```

근거: end-default-literals [13175308, 13180700); management-default-helper [13180701, 13180772).

현재 로컬의 기존 body 평문을 원본 HTML과 같다고 해석할 근거는 없다. PLAN의 versioned RichDocument와 nullable bodyRich, 구형 body 무백필·생략/null 구분은 로컬 호환 설계다. 문자열에 <,>,&, 줄바꿈이 있다고 HTML로 자동 해석하면 기존 표시 의미와 증거가 달라질 수 있다. 명시 전환 시 텍스트 이스케이프·개행 표현을 정하고 구형 JSON/승인/영수증 bytes/hash는 그대로 두어야 한다. 이 판단은 구현 제안이며 원본 서버의 migration 관측이 아니다.

## PLAN 대조: 계약 고정 전에 보완할 관측

대상: [PLAN.md](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/body-images/PLAN.md>). 읽은 SHA 0bfe7a296d5a917f11b3c839f2930314e3414621343f3c0d54bebec374a9248f. 원본과 로컬 결정의 분리에 blocker는 없다.

- P1: 50/75 options는 resizeUnit:px와 value 문자열이다. custom drag는 10~100%로 저장한다. 원본 50/75% 프리셋으로 단정하지 말고 로컬 width 단위/정규화 정책을 명시한다. 근거 editor-config-without-license [12373386, 12375384); editor-resize-interaction [12357580, 12358783).
- P2: fontSize/fontColor/RTL, caption, table colspan/rowspan을 계약에 보존하거나 명시 후속으로 구분한다. 관측된 converter를 완전한 paste allowlist로 취급하지 않는다. 근거 editor-font-presets [12359032, 12359277); editor-font-converters [12359930, 12361251); editor-extra-toolbar [12367947, 12368285); converter-image-caption [3010670, 3011385); converter-table-schema [3104431, 3104970).
- P3: 99999 PATH_KILL은 참여 대상 제외이며 정상 동의/제출 endpoint와 구별한다. 근거 page-path-kill [7824732, 7824740); page-preview-path [12878500, 12879430).

이미지 개수·문서 크기·깊이·픽셀·resource concurrency 한도, owned ID, 버전 pin 및 증거 v2는 PLAN에 표시된 독립 로컬 결정이다. 원본에서 관측한 상한으로 적지 않는 구분이 맞다. 본문 URL 복제·quota 갭은 원본 동등 기능으로 재현할 요구가 없다.

## 미확인 범위

- 서버 HTML schema/sanitizer·URL 소유권·업로드 decode/백신/14 MiB 서버 한도: 프런트 handler 및 오류 문자열만 관측. 안전한 allowlist 또는 보안 보장을 역으로 확정하지 않음. (unobserved-server)
- 페이지의 서버 ID/type/order 모델: 쓰기 page 및 응답 pageId는 확인. 모든 페이지 수정/재정렬의 서버 canonicalization과 DB key 타입은 미관측. (partial)
- 기본 resizeImage:50/75/original command 실제 작동: config에 있음. module42394 resizeImage/ImageResize 문자열 0회; custom mouse resize는 별도 코드로 확인. (unobserved-runtime)
- 모바일 touch/키보드 resize, 업로드 cancel/선택교체 race, 모든 readOnly custom control: 실행하지 않았으며 mouse handler와 readOnly mode 코드만 확인. (unobserved-runtime)
- 페이지 복제 후 본문 URL remap, 파일 제외 복제의 본문 정리, quota 서버 보정: 프런트 요청/응답 적용 경로에는 위 갭 존재. 실제 서버 응답 및 최종 저장 결과는 미관측. (static-gap)
- 폼 전체 복제·템플릿의 body URL 재소유: 이번 조사는 페이지 복제 및 본문 관리 helper까지 추적. 원본 서버 전체 폼/템플릿 내부 동작을 추정하지 않음. (unobserved)
- 원본 게시본·승인·정정·공유·PDF·영수증 장기 불변과 GC: catchformId/temp 관리만으로 immutable version/pin을 입증할 수 없음. (unobserved-server)

추가 원본 탐색을 이 범위에서 중단한다. 페이지/분기의 서버 동작, 본문 이미지 역사·승인·공유 수명, PDF/영수증 불변은 정적 프런트 코드만으로 확정할 수 없다. 로컬 BI-02a 계약부터 독립적으로 검증할 수 있도록 관측과 제안을 분리했다.

결과: [정확 발췌·JSON](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/body-images/source-review.json>) · [결과 폴더](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/body-images>).
