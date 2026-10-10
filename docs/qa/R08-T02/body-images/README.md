# 본문·페이지·완료·마감 이미지

진행 중이다. 원본 조사부터 BI-06 rich 동의 증거·이미지 PDF 영수증 v2와 실제 Ego/PostgreSQL/PDF 수용까지 완료했다. 다음은 BI-07의 4개 표시 영역 전체 수명주기와 반응형·RTL·키보드·실패·재시작 수용이며 본문 이미지 기능 전체 완료로 세지 않는다.

- [세부 실행 계획](PLAN.md): BI-01~07 및 F4 페이지 모델·분기·4슬롯 권한·14 MiB 업로드·영수증 수용 순서.
- [첫 문서 계약](CONTRACT.md): 안전한 JSON 문서, 서식/표/이미지 ID, 상한, 평문 호환 및 복제 의미.
- [원본 조사](source-review.md)와 [90개 발췌](source-review.json): 원본 정적 관측과 미확인 사항.
- [백엔드 영향](backend-impact.md)과 [47파일 근거](backend-impact.json): 기존 모델/권한/검사/PDF와 선행 의존성.
- [root 무결성 대조](source-integrity.json): 번들·90개 raw 발췌·47개 소스 파일/범위 해시 일치.

## BI-02a 계약 검증

`RichDocumentV1`의 strict JSON 구조, UTF-8/UTF-16·노드·깊이·이미지 상한, 표 병합 격자, URL/미디어 경계, 평문 투영, 이미지 탐색과 자산/노드 ID remap을 구현했다. 직접 호출의 순환·거대 입력뿐 아니라 getter·`toJSON`·sparse array·symbol key도 실행하거나 보정하지 않고 거절한다. 구형 `body`의 생략 보존·명시 null 제거 helper는 다음 FormContent 연결을 위한 독립 계약까지만 검증했다.

- Node 24에서 계약 시험 2파일 46개 통과.
- 변경한 계약·시험 4파일 ESLint 오류 0.
- 전체 TypeScript `tsc --noEmit` 오류 0.
- `git diff --check` 오류 0.
- 명령·파일 SHA-256·범위 구분은 [최종 검증 기록](contract-verification-final.json)에 고정했다.

## BI-02b HTML 경계·React 표시 검증

관측된 p/h2~h4·굵게·기울임·링크·목록·인용·표·글자 크기/색·RTL·이미지/미디어 형태를 strict parser에서 typed 문서로 변환한다. 임의 HTML을 저장하지 않으며 이미지의 `src`를 받지 않고 소유 자산 UUID만 남긴다. CKEditor 미디어 iframe은 inert DOM에서 provider URL만 읽고 완전히 버린다. React 표시는 `dangerouslySetInnerHTML` 없이 typed node를 만들며 이미지 bytes는 같은 origin의 상대 경로만 받는다.

첫 실행에서 HTML schema 오류 형식과 DOM 타입 좁히기, 실제 실행 목록에서 빠진 `.tsx` 시험, RTL의 의미 속성 누락을 발견했다. 경계 오류를 `RichHtmlError`로 통일하고 시험 파일을 포함 규칙에 맞춘 뒤 RTL을 `dir`로 출력했다. 최종 결과는 계약·HTML·표시 4파일 55개 통과, 관련 8파일 ESLint 오류0, 전체 typecheck 오류0, diff check 오류0이다. [최종 검증 기록](html-boundary-verification-final.json).

## BI-02c FormContent·DB·API·OpenAPI 검증

`FormContent.bodyRich`를 nullable·optional 계약으로 연결하고 `FormVersion.bodyRich JSONB`를 migration125로 추가했다. 구형 SQL `NULL`은 DTO에서 생략하여 기존 평문 JSON과 승인 지문을 유지한다. 현재 초안에 rich 값이 있을 때 구형 요청이 같은 `body`와 함께 필드를 생략하면 현재 값만 보존하며, `body`를 바꾸면서 생략하면 `RICH_BODY_AMBIGUOUS` 422로 거절한다. 명시적 `null`은 평문 전환이며 이후 저장에서 과거 게시본 값을 복원하지 않는다. 템플릿도 같은 규칙을 적용한다.

실제 `catchsecu_test` PostgreSQL에 migration125를 적용해 저장·조회·수정·게시 이력·템플릿 JSON·shape constraint·게시본 불변 트리거를 검증했다. 실제 `/forms` POST/GET/PATCH에서도 생성·조회·생략 보존·모호한 수정 거절·명시 제거를 확인했다. OpenAPI는 재귀 `$defs`가 문서 루트를 잘못 가리키는 문제를 시험에서 발견해 공용 `RichDocumentV1`/`RichBlock` 컴포넌트 참조로 수정했다.

- 최종 rich persistence/HTTP 시험 1파일 6개 통과.
- 폼·템플릿·승인·초안·복제·게시·문항 이미지 회귀 11파일 114개 통과.
- 순수 계약/HTML/React/OpenAPI 시험 5파일 56개 통과.
- OpenAPI 323경로·458작업·45정책 검증, Prisma schema/status, 관련 lint, 전체 typecheck, diff check 통과.
- 명령·해시·범위는 [BI-02c 최종 검증 기록](body-rich-persistence-verification-final.json)에 고정했다.

## BI-03a 14 MiB 업로드·저장·검사 경계

폼 본문·페이지·완료·마감 이미지에 서로 다른 네 용도를 추가하고 각 용도에만 14 MiB를 허용했다. migration126은 공용 blob 상한과 자산 목적/MIME 제약을 확장하되 기존 참고 자료 5 MiB와 문항·보기 이미지 1 MiB를 그대로 강제한다. HTTP stream reader와 ClamAV 호출은 신뢰된 용도별 상한을 받으며, 일반 제출 파일 호출은 기본 10 MiB를 유지한다. 암호화 local/S3 저장은 내부 14 MiB까지 처리하고 S3 GET은 `Content-Length`와 실제 암호문 크기를 모두 확인한다.

14,680,064바이트 PNG를 실제 HTTP 초기화·PUT·AES-256-GCM 저장·ClamAV INSTREAM·ready·다운로드로 왕복했다. 예약/업로드/다운로드 SHA-256 `1a749928a588ed3c3c933b63356976a4542c68fbe12e6471a714025126b444e0`가 일치했다. 같은 시험 파일에서 실제 EICAR 포함 DOCX도 차단했다. 총 12파일 202개 관련 시험, S3 14 MiB 왕복/초과 응답, migration126의 10 CHECK·14함수·15트리거 대조, OpenAPI·계획·lint·typecheck·diff 검증이 통과했다. [BI-03a 최종 검증 기록](body-image-transport-verification-final.json).

이 단계에서는 소유 자산 pin graph가 없어서 본문 이미지 UUID 저장을 `RICH_BODY_IMAGES_UNAVAILABLE` 422로 닫았다. BI-04b에서 소유권·수명주기 검사를 연결해 이 임시 차단을 제거했다.

## BI-03b 이미지 자원 상한·실패 정리

본문 이미지 네 용도는 24 MiPixels·한 변 16,384px, 기존 문항·보기 이미지는 8 MiPixels·8,192px로 분리했다. 모든 이미지는 단일 프레임·최대 4채널이며 두 용도가 공유하는 native decoder 동시 실행은 2개다. PNG/JPEG 헤더 검사와 sharp metadata/raw decode가 같은 용도별 상한을 사용한다. 압축 메타데이터·chunk·3초 decoder timeout 경계도 유지한다.

16,385px PNG가 `AUTHOR_ASSET_COMPLEXITY`로 저장 전에 거절되는 실제 HTTP/DB 흐름을 시험했다. 실패 직후 암호화 bytes와 ref가 없음을 확인하고, 명시 취소와 만료 worker 경로 각각에서 자산·blob tombstone, quota 0을 확인했다. 실제 25,165,824픽셀과 16,384px 이미지는 본문 용도에서 통과했고 같은 파일은 기존 문항 용도에서 거절됐다. 혼합 용도 동시 decode 3개 중 2개만 실행되고 종료 후 슬롯이 재사용됐다. 관련 8파일 157개 시험과 독립 30초 watchdog이 통과했다. [BI-03b 최종 검증 기록](body-image-resource-verification-final.json).

## BI-04a 페이지·완료·마감 버전 모델

버전 소유 `FormSection`에 DB 행 ID와 안정적 page ID, 순서, 제목, 평문/rich 본문, 기본 목적지와 뒤로 이동 정책을 분리해 저장한다. 질문은 같은 `FormVersion`의 실제 section 행을 복합 FK로 참조한다. 기존 폼은 `sectionSchemaVersion=0`과 새 필드 `NULL`을 유지하며 DTO에 페이지 필드를 내보내지 않는다. 새 모델은 최대 50페이지, 첫 페이지 빈 제목/본문, 모든 질문의 정확한 배치, 같은 버전 목적지와 끝나는 기본 경로를 계약과 지연 DB 트리거에서 함께 검사한다.

완료·마감 안내는 `default/custom` 모드와 평문/rich 투영을 FormVersion에 저장한다. 구형 편집 요청의 생략은 잠긴 현재 초안만 보존하고 명시적 null은 제거한다. 개정은 같은 page ID를 유지하고 독립 폼·템플릿 사용은 질문/목적지와 함께 새 ID로 치환한다. 게시본 section과 버전 설정은 DB 트리거로 변경할 수 없다.

격리 DB의 빈 설치 128개 migration, 126→128 업그레이드와 기존 행 불변, 10 CHECK·3 FK·3함수·4트리거·21열, 스키마 차이0을 확인했다. 페이지 저장·공개 읽기·구형 요청·명시 제거·개정·복사·템플릿·SQL 우회·게시본 불변성 관련 12파일85시험과 집중 3파일14시험, OpenAPI323/458/45, production build·typecheck·lint·plan/diff 검증이 통과했다. [BI-04a 최종 검증 기록](form-sections-verification-final.json), [설치/업그레이드](form-sections/migration-install-final.json), [DB guard](form-sections/schema-guards-final.json).

## BI-04b 전체 콘텐츠 소유 자산 pin graph

폼 본문, 페이지 본문, 완료 안내, 마감 안내와 질문 자료·보기·이미지를 하나의 `FormContent` 그래프로 수집한다. 저장 시 전체 그래프의 자산을 한 번 잠그고 기존 pin 제거, 폼 버전 변경, 새 pin 추가를 같은 트랜잭션에서 처리한다. 본문 참조는 nullable `questionKey`와 `slot + documentKey + nodeKey`로 식별하므로 질문이 없는 문서에 가짜 질문 UUID를 넣지 않는다. 같은 자산을 여러 노드에서 써도 노드별 pin은 보존하고 소유 용량은 한 번만 계산한다.

migration129는 `AuthorAssetReference`의 네 문서 슬롯, 부모·용도·tenant·service·검사 상태·물리 자산 일치, 게시본 불변성과 FormSection 일관성을 DB 제약·projection·함수·지연 트리거로 강제한다. 폼 복제와 템플릿 사용은 논리 자산을 한 번 복사한 뒤 모든 문서 노드 ID를 새 자산 ID로 치환한다. 승인 스냅샷, 게시·개정 이력, GC fence, SQL 우회, 감사 실패 rollback, attach 대 GC 경쟁도 실제 PostgreSQL에서 검증했다. 폼 전체 rich 문서는 512 KiB와 이미지 노드 100개 상한을 적용한다.

- 집중 시험 4파일 51개, 관련 회귀 14파일 153개 통과.
- 소유 자산 참조 전체 시험 27개에 복제·템플릿·승인·게시 이력·직접 SQL·rollback·GC 경쟁 포함.
- 빈 DB migration129 설치와 128→129 업그레이드 통과, 기존 자산 참조 행 불변.
- DB 계약 10 CHECK·1 인덱스·15 함수·18 트리거, schema drift 0.
- production build 82페이지, 전체 typecheck, 관련 lint, OpenAPI 323경로·458작업·45정책, 계획 검증 통과.
- [BI-04b 최종 검증 기록](rich-assets/verification-final.json), [설치/업그레이드](rich-assets/migration-install-final.json), [현재 DB 계약](rich-assets/schema-current/catchsecu_test-contract.json).

페이지 전용 편집 화면과 실제 공개 화면의 앞뒤 이동·분기 변경은 BI-05b/F4c에서 구현·검증했다.

## BI-04c/F4b 보기별 분기·제출 방문 경로

페이지형 폼은 한 페이지에 항상 표시되는 객관식 또는 드롭다운 분기 질문 하나를 둘 수 있다. 선택한 보기의 목적지가 기본 목적지보다 우선한다. 사용자 직접 입력 보기와 체크박스에는 분기를 허용하지 않는다. 모든 기본·보기 간선은 같은 버전의 도달 가능한 페이지 또는 `consent|submit|ineligible` 종료점을 가리켜야 하며, 전체 그래프의 순환을 계약과 PostgreSQL 지연 트리거에서 거절한다.

제출 서버는 답변을 신뢰하지 않고 방문 페이지와 활성 질문을 다시 계산한다. 미방문 질문의 값은 거절하고 정규화 과정에서도 비우며, 방문한 필수 질문만 검사한다. `ineligible` 경로는 응답을 만들지 않는다. 정상 제출은 `pagePathVersion=1`, 방문 page ID 배열과 종료 종류를 저장한다. 정정으로 분기가 바뀌면 새로 방문한 필수 답변을 요구하고 경로에서 빠진 답변을 같은 트랜잭션에서 제거한다.

migration130~137은 보기 목적지 FK·검사·부분 인덱스와 Submission 방문 경로 검사·DB 우회 방지를 추가했다. 빈 DB 137개 설치와 129→137 업그레이드에서 기존 보기 값과 기존 Submission의 `pagePathVersion=0`을 보존했다. 자산·보기 트리거가 관련 메타데이터 변경에만 실행되도록 범위를 좁혀 5,000보기 회귀를 3.61초에 통과시켰다.

- 집중 시험 3파일 13개, 관련 회귀 8파일 92개를 직렬 실행해 통과했다.
- 기존 페이지·제출 경로 4파일 40개와 5,000보기 회귀를 통과했다.
- production build 82페이지, 전체 typecheck, 관련 lint, OpenAPI 323경로·458작업·45정책, 계획 107작업·186원본 경로·21부가 경로 검증이 통과했다.
- 현재 DB 계약은 작성자 자산 CHECK 10개·인덱스 1개·함수 15개·트리거 23개이며 예상하지 않은 차이는 0이다.
- [BI-04c 최종 검증 기록](page-branches/verification-final.json), [설치/업그레이드](page-branches/migration-install-final.json), [현재 DB 계약](page-branches/schema-current/catchsecu_test-contract.json).

## BI-05a 폼 본문 rich 편집기

폼 본문을 `RichDocumentV1` controlled editor로 연결했다. 문단·제목·인용, 굵게·기울임, 글자 크기·색, 목록·들여쓰기, 정렬·방향, 링크·미디어·표, 실행 취소·다시 실행을 제공한다. 브라우저 HTML은 canonical serializer/parser 경계를 거쳐 typed 문서로 되돌리고, 원격 이미지 URL·iframe·임의 HTML은 저장하지 않는다. 붙여넣기는 평문으로 제한한다.

`FORM_CONTENT_IMAGE` 업로드를 편집기에 연결해 업로드·교체·삭제, 대체 텍스트·caption·정렬·폭, undo/redo를 지원한다. 문서에 남은 이미지만 현재 FormVersion의 `form_content/form/nodeKey` 참조로 고정한다. 업로드 도중 자동저장과 이탈을 막고, 늦게 도착한 업로드는 현재 편집 상태에 연결하지 않는다. 응답 유실 재시도와 409 충돌에서는 typed 문서와 자산 ID를 그대로 보존한다.

- rich 계약·HTML·표시·편집 상태 4파일 48개, 자산/폼 통합 5파일 54개, 초안 상태 1파일 14개가 통과했다.
- 전체 typecheck, 관련 lint, 로컬 공급자 허용 플래그를 명시한 production build 82페이지가 통과했다.
- Ego에서 H2/bold, 표 undo/redo, 이미지 업로드·교체·삭제와 undo/redo, alt/right/75%, 자동저장·새로고침·서버 재시작 복원을 확인했다.
- `catchsecu_test`에서 `bodyRich` 평문 투영, ready/clean 자산, 현재 버전 pin 1개를 대조했다. 재시작 뒤 이미지 다운로드 SHA-256은 원본과 같은 `3cd6eb44f53252547fab736b48b005ab97860891434e22e31f9ce053b2b137fe`다.
- 390/768/1440px에서 문서·toolbar·편집 surface의 가로 넘침은 0이었다. [최종 검증 기록](rich-editor/verification-final.json), [390px 최종 화면](rich-editor/editor-390-final.png), [브라우저·DB 대조](rich-editor/browser-db.json).

## BI-05b/F4c 페이지 편집·공개 분기 제출

첫 페이지를 고정한 상태에서 페이지 추가·복제·정렬·삭제, 제목과 rich 본문, 질문 배치, 기본 목적지, 뒤로 이동 허용, 객관식·드롭다운 보기별 목적지를 편집한다. 복제는 페이지·질문·보기·행 ID와 내부 조건을 새 ID로 치환한다. 질문이 있는 페이지 삭제는 막고, 빈 페이지 삭제는 들어오는 기본·보기 간선을 삭제 페이지의 다음 목적지로 다시 연결한다. 편집기와 공개 화면은 같은 `formPageDestination`을 사용해 보기 우선 분기 의미를 공유한다.

공개 화면은 방문한 페이지의 질문만 표시하고 뒤로 이동 후 분기가 바뀌면 더 이상 방문하지 않는 질문 답변·파일·업로드 캐시를 즉시 제거한다. 마지막 제출에는 서버가 다시 계산한 방문 경로의 질문만 포함한다. `ineligible`은 제출 버튼을 만들지 않는다. 마지막 페이지에서 동의 단계로 바뀌는 같은 click이 React의 재사용된 submit 버튼 기본 동작까지 실행하던 결함을 실제 브라우저에서 발견했고, 다음 버튼의 기본 동작을 취소한 뒤 명시적으로 이동하도록 수정했다.

- 페이지 상태·초안 상태 2파일 19개와 실제 PostgreSQL 분기 1파일 5개 시험이 통과했다.
- Ego에서 3페이지 저장·새로고침, 3페이지 장기 경로와 2페이지 단축 경로, 뒤로 분기 변경, 미방문 상세 답변 제거, 참여 제외 제출 차단을 확인했다.
- 두 탭의 같은 version 저장에서 409를 재현했다. 늦은 탭의 제목 입력과 수정본 내려받기를 유지하고 자동 저장을 멈췄다.
- 서버 재시작 후 게시본과 두 Submission의 방문 경로를 다시 읽었다. 장기 3페이지, 단축 2페이지, 종료 `consent`, 참여 제외 응답 0건이었다.
- 편집기와 공개 화면 모두 390/768/1440px에서 문서 가로 넘침이 0이었다. [최종 검증 기록](page-ui/verification-final.json), [390px 공개 화면](page-ui/public-390.png), [409 충돌 화면](page-ui/editor-conflict.png), [브라우저·DB 대조](page-ui/browser-db.json).

## BI-05c 완료·마감 편집과 읽기 권한

완료·마감 안내의 기본/직접 작성 모드와 rich text·소유 이미지를 편집기에 연결했다. 정상 제출 영수증은 정확한 게시본의 완료 안내와 짧은 암호화 읽기 증명을 받는다. active/completion/closed/viewer 자산 manifest와 byte 읽기를 서로 분리했으며, 선택 공유 viewer의 폼 본문은 새 `shareFormBody` 정책을 명시한 경우에만 노출한다.

관련 9파일 83시험과 typecheck/lint/OpenAPI/plan/diff, 로컬 provider를 명시한 production 82페이지 build가 통과했다. Ego에서 직접 작성·이미지 업로드·게시·제출 후 완료 화면·일시중지 후 마감 화면을 확인했다. `catchsecu_test`에서 게시본과 응답 1건, 서로 다른 완료/마감 자산과 pin을 대조했고 production HTTP의 마감 PNG 4,787바이트 SHA-256도 manifest와 일치했다. [최종 검증 기록](notice-access/verification-final.json), [상세 기록](notice-access/README.md).

## BI-06 rich 동의 증거와 PDF 영수증 v2

기존 `ConsentEvidenceV1`과 저장된 v1 PDF bytes를 유지하면서 rich 폼에는 v2 증거를 사용한다. v2는 루트 본문과 실제 방문한 페이지만 고정하고, 게시 버전의 검사 완료 이미지를 제한된 PNG로 변환해 PDF에 넣는다. 완료·마감 안내는 동의 시점의 본문이 아니므로 증거와 PDF에서 제외한다. 제출 때 완성된 PDF를 암호화 저장하며 다운로드는 현재 초안을 다시 읽거나 PDF를 재생성하지 않는다.

관련 7파일 68시험, 전체 typecheck, 관련 lint, Prisma validate, OpenAPI 323경로·458작업·45정책, 계획 107작업·186원본 경로, production 82페이지 build가 통과했다. migration139의 빈 설치와 138→139 업그레이드에서 v1 암호문·PDF bytes 불변, 완전한 v2 허용, 불완전한 v2 거절을 확인했다. Ego Lite에서 ClamAV 검사를 통과한 이미지 2개가 있는 2페이지 폼을 제출한 뒤 관리자 상세의 v2 증거와 PDF 다운로드를 확인했다. PostgreSQL의 저장 PDF와 권한 경계를 거친 다운로드 bytes가 일치했고 PDF.js가 2페이지와 이미지 연산자 2개를 읽었다. [최종 검증 기록](receipt-v2/verification-final.json), [상세 기록](receipt-v2/README.md).

원본 서버의 sanitizer/소유권/검사/보존 정책과 rich PDF 생성 방식은 미관측이다. 신규 typed 문서·owned asset ID·버전 보존은 명시적인 로컬 설계이며 원본 wire와 동일하다고 주장하지 않는다.

## BI-07 전체 수용

신규 격리 폼에서 루트·페이지·완료·마감 이미지 4개를 실제 업로드·게시하고, 공개 2페이지 제출·증거 v2/PDF·개정 삭제·과거 버전 불변·복제 2개·템플릿 CRUD를 확인했다. 390/768/1440px 가로 넘침 0, RTL, 키보드 순서, active/completion/closed 표시가 통과했다. 장애 회귀 22개와 production 82페이지 build, 재시작 고정 해시, 기존 frozen fixture 20/20도 통과했다. [전체 수용 기록](full-acceptance/README.md).

기존 문항 이미지 [검증 결과](../question-metadata/content-images/README.md)와 frozen 20개 QA 세트는 유지한다. BI-03a/03b/04a/04b/04c는 backend 체크포인트라 해당 단계에서 Ego·재시작 시험을 실행하지 않았고 frozen fixture도 열지 않았다. BI-05a와 BI-05b/F4c는 별도 합성 폼과 localhost3112에서, BI-05c는 새 합성 폼과 localhost3113에서, BI-06은 새 합성 폼과 localhost3114에서, BI-07은 localhost3115에서 실제 브라우저·PostgreSQL·PDF를 검증했다. 본문 이미지 모듈은 완료했으며 전체 목표는 active이고 공식 완료0/진행53/계획54를 유지한다.
