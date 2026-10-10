# BI-02a 순수 문서 계약

이 계약은 원본 HTML의 안전한 로컬 표현이다. 현재 단계는 DB/FormContent/API/UI에 연결하지 않는 독립 모델과 단위 시험이다. 폼 본문 지원 완료로 표시하지 않는다.

## 구조

`src/contracts/rich-content.ts`에 다음 이름을 export한다. 모든 객체는 strict이며 알 수 없는 필드, NaN/Infinity, 잘못된 UTF-16, 실행 HTML/URL 필드를 거절한다. 텍스트의 `<...>`는 문자 그대로 허용하며 렌더는 React text node만 사용한다.

```ts
type RichText = { type: "text"; text: string; bold?: true; italic?: true;
  fontSize?: 12 | 14 | 15 | 16 | 20 | 24 | 32; fontColor?: string }; // #rrggbb
type RichBreak = { type: "break" };
type RichLink = { type: "link"; href: string; children: (RichText | RichBreak)[] };
type RichInline = RichText | RichBreak | RichLink;
type RichLayout = { alignment?: "left" | "center" | "right" | "justify";
  direction?: "ltr" | "rtl"; indent?: number }; // 0..8
type RichParagraph = RichLayout & { type: "paragraph"; children: RichInline[] };
type RichHeading = RichLayout & { type: "heading"; level: 2 | 3 | 4; children: RichInline[] };
type RichQuote = { type: "quote"; children: RichBlock[] };
type RichList = { type: "list"; ordered: boolean; items: RichBlock[][] };
type RichCell = { header?: true; colSpan?: number; rowSpan?: number; children: RichBlock[] };
type RichTable = { type: "table"; rows: RichCell[][] };
type RichWidth = { unit: "percent" | "px"; value: number };
type RichImage = { type: "image"; nodeId: string; assetId: string; alt: string;
  alignment?: "left" | "center" | "right"; width?: RichWidth; caption?: RichInline[] };
type RichMedia = { type: "media"; provider: "youtube" | "vimeo"; mediaId: string;
  alignment?: "left" | "center" | "right"; width?: RichWidth };
type RichBlock = RichParagraph | RichHeading | RichQuote | RichList | RichTable | RichImage | RichMedia;
type RichDocumentV1 = { schemaVersion: 1; blocks: RichBlock[] };
```

UUID는 image nodeId/assetId만 갖는다. nodeId는 문서 내 유일하며 같은 assetId를 여러 위치에 사용하는 것은 허용한다. 본문 위치와 부모 식별자는 다음 통합 단계에서 별도 소유 모델이 담당한다. paragraph·heading에는 block/image를 중첩하지 않는다. link에는 link를 중첩하지 않는다. table cell에는 table을 중첩하지 않는다.

링크는 길이 2,048 이하의 절대 http/https URL이다. 사용자정보·제어문자·공백·역슬래시·스킴 상대/상대 주소를 거절한다. 임의 문자열을 네트워크에서 가져오지 않는다. Youtube는 11자리 `[A-Za-z0-9_-]`, Vimeo는 1~15자리 숫자 ID다. 두 provider 지원은 로컬 제한이며 원본 전체 provider 목록을 재현했다고 주장하지 않는다.

width percent는 10~100(소수점 한 자리), px는 1~4,096 정수다. 값 생략은 자연 크기다. 출력에서는 부모 폭 100%를 넘지 않으며 높이 자동이다. 이는 원본 resize command의 실행을 입증하는 것이 아니다. alt는 UTF-16 1,000 이하이며 caption은 일반 inline 노드다. 글자색은 소문자 6자리 hex만 저장한다. HTML 경계에서 CSS 색상을 정규화한다.

## 상한 및 표

문서당 JSON 262,144 UTF-8 bytes, 전체 텍스트·href·alt·caption·미디어 식별자 문자열 합계 20,000 UTF-16, 노드 2,000, block/inline 의미 깊이 12, 이미지 32개다. 문서 root와 목록 item 배열/표 row/cell wrapper는 노드 개수에 넣지 않고 실제 type을 가진 노드를 센다. 최상위 block 깊이는 1이고 실제 type 자식마다 1씩 더한다. link의 text 자식도 깊이에 포함한다. 배열 wrapper를 이용한 거대 입력도 사전 JSON 크기/구조 상한으로 막는다.

표는 최대100행·20열·400개 명시 cell, colspan 1~20·rowspan 1~100이다. 합쳐진 셀의 실제 점유 격자를 계산하여 겹침·범위 초과·빈 틈·불균일 너비를 거절한다. rowspan으로 전부 채워지는 행만 빈 cell 배열이 가능하다. 빈 표·빈 목록 item은 거절한다. 단일 빈 단락과 빈 문서, 이미지뿐인 문서는 허용한다.

서버 JSON 입력은 재귀 schema 파싱 전에 iterative preflight로 크기·구조·깊이를 제한한다. 직접 함수 호출의 순환 객체도 정상 validation 실패로 처리한다. 초과 입력이 RangeError나 긴 동기 작업을 유발해서는 안 된다.

## 함수

- `richDocumentSchema`: 위 strict 계약을 검증하는 Zod schema. 파싱 과정에서 텍스트 공백을 trim하거나 HTML로 해석하지 않는다.
- `richDocumentText(document)`: 단락/제목 텍스트, break의 줄바꿈, 링크 표시 텍스트, 목록 항목·인용·블록의 줄바꿈, 표 cell 사이 탭·row 사이 줄바꿈을 순서대로 만든다. 이미지는 caption만 텍스트에 포함하며 alt는 별도 메타데이터로 유지한다. 미디어는 정규화된 canonical HTTPS 링크를 한 줄로 표시한다. 빈 문서 결과는 빈 문자열이며 끝 줄바꿈을 임의 추가/제거하지 않는다.
- `plainTextRichDocument(text)`: 기존 문자열을 한 paragraph 안의 text/break로 보존한다. `richDocumentText(plainTextRichDocument(s)) === s`를 UTF-16 유효 범위에서 보장한다. 빈 문자열은 빈 문서다. `<img>` 문자열을 태그로 읽지 않는다.
- `richDocumentImages(document)`: 문서 순서대로 모든 image 노드를 반환한다. 결과 변경이 원본을 바꾸지 않도록 복사한다.
- `remapRichDocument(document, {assetIds, nodeId?})`: `assetIds: ReadonlyMap<string,string>`로 모든 이미지 자산을 치환한 새 문서를 반환한다. 누락 매핑은 실패한다. `nodeId?: (image: Readonly<RichImage>, index: number) => string` callback이 있으면 각 occurrence별 새 UUID를 배정하며 중복/잘못된 UUID는 실패한다. callback에는 별도 deep copy를 전달하여 callback이 원본/결과 메타데이터를 수정하지 못하게 한다. 없으면 nodeId를 보존한다. 원문은 변경하지 않는다.
- `richMediaUrl(media)`: 유효한 provider/id에서 YouTube는 `https://www.youtube.com/watch?v=<id>`, Vimeo는 `https://vimeo.com/<id>`를 계산한다. iframe HTML이나 업로드 URL을 반환하지 않는다.

표 텍스트는 명시 cell만 탭으로 구분하고 span의 빈 점유칸을 보충하거나 내용을 반복하지 않는다. 다른 행의 rowspan으로 전부 채워진 빈 row는 빈 문자열이다. 이 규칙은 화면의 셀 병합 레이아웃과 별개다.

## 시험 경계

`tests/server/rich-content-contract.test.ts`에서 서식·caption·표병합·RTL·이미지반복·정확한 평문왕복·완전한 copy/remap과 거절 사례를 검증한다. URL/remote image/이벤트/임의CSS/unknown node·중첩링크·중첩표·표공백/겹침·잘못된 UUID/duplicate node·JSON/깊이/노드/문자/이미지 경계·순환/거대 중첩을 포함한다. 단순 구현 mirror 대신 저장될 의미와 공격 입력 경계를 확인한다. DB·브라우저·fixture·빌드 실행은 이 시험에 포함하지 않는다.
