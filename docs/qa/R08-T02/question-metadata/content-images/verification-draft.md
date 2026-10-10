# 문항 이미지 검증 초안

기준: 2026-10-10T09:20:38.200Z. 현재 실행 근거를 읽어 작성한 독립 대조 문서이며 lifecycle·최종 재시작·신규 fixture 봉인은 root 진행 중이다. 이 문서는 문항 이미지 QUESTION_IMAGE 범위를 다룬다. rich HTML 본문/페이지 이미지까지 완료했다고 주장하지 않는다.

## 현재 회귀 범위와 집계

[regression-first.json](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/regression-first.json>)의 **23개 파일, 323/323 통과, 실패·pending·todo 0**을 최종 회귀 기준으로 사용한다. 이번 실행은 2026-10-10T09:03:00.245Z에 시작했으며 마지막 파일 종료는 2026-10-10T09:05:09.411Z다. 개별 초기 실행, 이전 단위의 과거 시험 수치, HTTP·보존·Ego 건수는 합산하지 않는다. 모든 assertion의 원본 JSON pointer·표시 이름·상태는 [test-union.json](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/test-union.json>)에 보존했다.

| 이번 최종 보고서에 포함된 분류 | 파일 | 실행 항목 |
| --- | ---: | ---: |
| 문항 이미지 | 6 | 80 |
| 작성자 자산 재실행 | 11 | 180 |
| 문서·PDF·폼 회귀 재실행 | 6 | 63 |
| 합계 | 23 | 323 |

323은 assertion 실행 항목 수다. 파일+표시 이름만으로 줄이면 316개의 이름 키가 되지만, 이는 중복 실행 합산이 아니다. [author-asset-validation.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-validation.test.ts:100>)의 서로 다른 프레이밍 입력 4개가 같은 표시 이름이고, [DOCX 매개변수 시험](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-validation.test.ts:116>) 중 word/document.xml 입력 5개도 이름이 같다. 보고서 SHA와 assertion JSON pointer로 각 입력 실행을 구분해 323개를 유지했다. HTTP 12개 시나리오와 기존 fixture 19세트는 아래 별도 단위다.

| 시험 파일 | 전체 | 통과 |
| --- | ---: | ---: |
| [author-asset-api-contract.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-api-contract.test.ts>) | 12 | 12 |
| [author-asset-audit.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-audit.test.ts>) | 7 | 7 |
| [author-asset-contract.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-contract.test.ts>) | 15 | 15 |
| [author-asset-database.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-database.test.ts>) | 21 | 21 |
| [author-asset-draft-events.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-draft-events.test.ts>) | 5 | 5 |
| [author-asset-reads.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-reads.test.ts>) | 8 | 8 |
| [author-asset-references.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-references.test.ts>) | 20 | 20 |
| [author-asset-ui-render.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-ui-render.test.ts>) | 11 | 11 |
| [author-asset-upload-events.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-upload-events.test.ts>) | 9 | 9 |
| [author-asset-uploads.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-uploads.test.ts>) | 14 | 14 |
| [author-asset-validation.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-validation.test.ts>) | 58 | 58 |
| [document-pdf.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/document-pdf.test.ts>) | 13 | 13 |
| [form-documents.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/form-documents.test.ts>) | 18 | 18 |
| [form-module-concurrency.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/form-module-concurrency.test.ts>) | 6 | 6 |
| [form-module-flow.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/form-module-flow.test.ts>) | 1 | 1 |
| [form-system-copy.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/form-system-copy.test.ts>) | 6 | 6 |
| [pdf-renderer-v2.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/pdf-renderer-v2.test.ts>) | 19 | 19 |
| [question-image-backend.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/question-image-backend.test.ts>) | 15 | 15 |
| [question-image-contract.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/question-image-contract.test.ts>) | 17 | 17 |
| [question-image-database.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/question-image-database.test.ts>) | 10 | 10 |
| [question-image-events.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/question-image-events.test.ts>) | 19 | 19 |
| [question-image-render.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/question-image-render.test.ts>) | 13 | 13 |
| [question-image-validation.test.ts](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/question-image-validation.test.ts>) | 6 | 6 |

문항 이미지 80개는 16종 질문의 단일 키·누락/명시 null·현재 질문 상속·구형 JSON 유지, 1 MiB JPEG/PNG 및 실제 디코더, 목적/회사/서비스/만료·검사 상태, SQL pin/FK/불변 snapshot, 복제/템플릿 소유권, 공개/응답/정정/viewer, 업로드·삭제 stale 문맥, 기존 값 보존, 조회 범위·16언어 로딩/실패·배치 검증을 포함한다. 실행 항목명 전체는 union JSON에 있으며 원본 서버 동작의 실행 증거로 사용하지 않는다.

## RED → GREEN 기록

| 보고서 | 전체 | 통과 | 실패 |
| --- | ---: | ---: | ---: |
| [contract-red.json](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/contract-red.json>) | 13 | 5 | 8 |
| [contract-green-first.json](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/contract-green-first.json>) | 16 | 16 | 0 |
| [contract-api-first.json](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/contract-api-first.json>) | 29 | 26 | 3 |
| [contract-api-second.json](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/contract-api-second.json>) | 29 | 29 | 0 |
| [database-red.json](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/database-red.json>) | 10 | 0 | 10 |
| [database-green-first.json](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/database-green-first.json>) | 10 | 9 | 1 |
| [database-green-second.json](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/database-green-second.json>) | 10 | 10 | 0 |
| [backend-first.json](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/backend-first.json>) | 15 | 15 | 0 |
| [validation-first.json](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/validation-first.json>) | 6 | 6 | 0 |
| [ui-first.json](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/ui-first.json>) | 32 | 32 | 0 |

계약 최초 RED는 13개 중 8개 실패다. GREEN 16개와 최종 계약 17개는 후속 정규화 검증 추가를 포함하므로 동일한 13개만 반복한 것으로 쓰지 않는다. API 29개는 최초 3개 실패 후 29개 통과했다. DB는 10개 실패 → 9개 통과/1개 실패 → 10개 통과다. 중간 DB 실패는 template JSON의 기대 예외 문구 불일치이며 축약 보고서에 없는 내부 원인을 추정하지 않았다. 각 단계의 파일·표시 이름은 모두 최종 회귀 범위에 존재한다. 따라서 이 표의 실행 수는 323에 더하지 않는다.

## 정적 검사·빌드

- [변경 파일 lint](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/changed-lint-first.log>): 0 errors, 2 warnings. TemplateGallery.tsx 55:47·58:58의 no-img-element 경고이며 무경고 통과로 쓰지 않는다.
- [명시적 종료 코드가 있는 정적 검사](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/http-helper-static-check.json>): helper ESLint와 tsconfig.rea-question-images.json typecheck exitCode 0. 기록된 config SHA와 현재 파일 SHA가 일치하며 전체 src 및 명시된 시험/QA helper를 포함한다. 해당 기록 시점의 검사이며 이후 lifecycle helper까지 확인한 최종 검사로 확대하지 않는다.
- [첫 tsc 로그](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/typecheck-first.log>)와 [계약/helper lint 로그](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/contracts-helpers-lint.log>)는 0 byte다. 이 파일만으로 종료 코드 성공을 추론하지 않는다.
- [production build 로그](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/build-first.log>): Next.js 16.3.8, 컴파일 27.3초, TypeScript 24.1초 완료, static pages 82/82, page optimization 및 route 목록까지 기록되어 있다. 별도 exit 메타데이터는 이 로그에 없다.
- OpenAPI 최초 [환경값 누락 실패](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/openapi.log>) 후 [환경값 설정 실행](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/openapi-with-env.log>)에서 323 paths를 출력했다. API path 323개는 회귀 assertion 323개와 다른 단위다.
- [읽기 전용 코드 검토](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/review.json>)에서 확정 코드 결함 없음으로 기록했다. 실행 검증은 별도 보고서의 범위에 따른다.

## migration·기존 데이터 보존

[개발 DB](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/migrate-dev.log>) 및 [시험 DB](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/migrate-test.log>) 로그에서 124번째 20261025014000_question_images 적용 성공을 확인했다. [적용 전](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/migration-before.json>)과 [적용 후](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/migration-after.json>)의 12개 테이블은 기존 행 수와 공통 열 SHA가 모두 같다. 새 questionImageKey 열은 구형 해시에서 제외한 뒤 null을 별도 확인한 범위다. 전체 DB의 모든 열/객체 보존을 뜻하지 않는다.

[빈 격리 스키마 설치](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/fresh-schema.json>)는 124개 migration 설치 성공을 기록한다. [catalog 대조](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/schema-drift/catalog-comparison.json>)는 개발/신규 설치 migration checksum 불일치 0, 객체 각 3,146개, DDL 차이 0, catalog SHA 일치를 기록한다. grants·extension runtime·카탈로그 밖 동작은 이 비교의 범위가 아니다.

[기존 fixture 보존](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/legacy-preservation.json>)은 **19/19**, 각 verify exitCode 0이다. 기존 frozen baseline을 수정하지 않은 읽기 검증이며 이번 신규 기능 19개 시험을 뜻하지 않는다. [최초 경로 오류](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/legacy-first.log>)의 ENOENT는 완료로 세지 않았고 [정상 결과](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/legacy-second.log>)를 사용했다. 이 19세트 기록은 신규 fixture의 최종 restart/freeze 증거와 별개다.

## 실제 HTTP·Ego 근거

[HTTP 12개 시나리오](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/http-boundaries/run-1295af08-388c-4127-84a0-564c6632a3ea.json>)는 로컬 production HTTP에서 12/12 passed, failures 없음, 보호 DB fingerprint 전후 동일, probe cleanup 완료를 기록한다. 하위 status 확인 호출 수를 별도 시험으로 더하지 않았다.

1. anonymous member request is 401
2. stale form scope is 409
3. mixed and repeated scope queries are 422
4. QUESTION_IMAGE oversize and non-image MIME init are 422 before reservation
5. non-UUID question image key is rejected without changing published or draft rows
6. pinned historical question image cannot be discarded
7. raw wrong MIME, hash mismatch and forged PNG body remain pending
8. real PNG init replay PUT and ClamAV complete give inline own-preview with exact hash
9. ready unbound question image is absent from public and member parent scopes
10. QUESTION_IMAGE cannot be attached as FILE and leaves the entire protected graph unchanged
11. QUESTION_IMAGE cannot be attached as an option image and rolls back
12. OPTION_IMAGE cannot be attached as question image and rolls back

[편집 동작](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/ego-editor-actions.json>)은 잘못된 파일 교체 실패의 기존 이미지 보존, 삭제/off 확인 취소, 일반 유형 전환 보존, autosave 중 stale 삭제 거부와 안정화 후 재시도, off 재활성화 시 이전 이미지 부활 없음이 기록되어 있다.

[공개 화면 레이아웃](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/ego-public-layout.json>)은 390/768/1440px에서 자연 비율·가운데 정렬·8px radius·빈 alt·비드래그·비클릭·viewport 안 배치를 확인한다. 공개 화면에서 관측된 최대 가로 크기는 컨테이너에 제한된 672px다. [편집 화면 레이아웃](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/ego-editor-layout.json>)은 같은 3개 너비와 1440px 화면의 696px 이미지 상한을 기록한다. 캡처는 [public 390](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/public-390.png>), [public 768](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/public-768.png>), [public 1440](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/public-1440.png>), [editor 390](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/editor-390.png>)에 있다. 본 문서 작성자가 이미지를 직접 시각 검사한 것은 아니며 수치는 보고서의 관측값이다.

[최초 과거 응답 표시](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/ego-history-initial.json>)와 [정정 후 화면](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/ego-correction.json>)에는 과거 이미지 1200×450·600×800 유지, 실제 텍스트 변경·정정 표시가 기록되어 있다. [정정 캡처](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/historical-correction.png>) 및 [정정 후 history 확인](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/flow/assert-history-09638108-7ac1-4cfc-bd53-16f84cd99a6e.json>)에서 영수증 SHA 09e455e4179807aef4aeb458e81edfedaa60fd4fe13a3ea7bf05496e2827b5bb를 보존한다.

[포트 충돌 기록](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/runtime-port-change.json>)에는 3100의 IPv4/IPv6 다른 앱 충돌, 첫 정정 요청의 비 JSON 실패, 동일 빌드를 3108로 옮긴 조치가 남아 있다. 실패한 첫 요청을 성공으로 세지 않고 3108의 정정·history 후속 보고서를 근거로 사용했다. 이 운영상 재기동만으로 아래 최종 재시작 수용을 완료 처리하지 않는다.

## 아직 완료로 세지 않은 범위

- root가 진행 중인 전용 lifecycle 수용: 실제 승인·복제·템플릿·공유·삭제와 참조 수명. 관련 단위/DB 회귀 통과와 구별한다.
- 최종 재시작 전후 신규 fixture·영수증·이미지 bytes 일치, 후속 helper를 포함한 최종 typecheck.
- 신규 fixture freeze, 최종 코드·보고서 checkpoint 봉인. 현재 [상태 보고서](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/flow/state-d3eb3340-215c-4c56-a606-775a24f62f3b.json>)도 frozen:false다.
- rich HTML 본문/페이지·완료·마감 이미지, 14 MiB 전용 처리, PDF 본문 이미지 연결은 [PLAN.md](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/PLAN.md>)의 별도 BI 후속이다.

산출물은 [검증 union](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images/test-union.json>)과 이 초안이다. 근거 파일들의 SHA-256은 union artifacts에 고정했고 이 작성 작업에서는 제품 코드·DB·HTTP·브라우저·시험·빌드 실행을 하지 않았다. 결과 폴더: [content-images](</Users/user01/Desktop/캐쳐시큐/catchsecu-clone/docs/qa/R08-T02/question-metadata/content-images>).
