# 작성자 자산 API·감사·DB 계약 연결

이 문서는 A14의 **로컬 구현 계약**과 검증 범위를 기록한다. 원본 서비스의 비공개 API나 저장 구조가 이 계약과 같다고 주장하지 않는다. 원본 정적 근거는 같은 폴더의 `source-review.json`, 승인 범위는 `PLAN.md`, 서버 결정은 `api-design.md`에 있다.

## 변경 범위와 실행 경계

- `scripts/generate-openapi.ts`: 실행 중인 route·Zod 계약을 기준으로 12개 경로 / 13개 operation과 응답 스키마를 등록한다. 기존 응답 FILE/DRAW 업로드 계약은 확장하지 않는다.
- `docs/planning/contracts/domain-policies.json`: `/author-assets` 정책을 추가한다. 공개 게시본과 viewer 경로는 기존 public/viewer 정책을 유지하고 각 operation에 실제 권한 조건을 명시한다.
- `src/server/audit-resources.ts`, `form-audit-events.ts`: 기존 감사 권한 필터를 거친 작성자 자산 이벤트에 폼 연관을 부여한다.
- `src/server/audit-events.ts`: `author_asset.*` 이벤트를 `info` 분류에 추가한다. 감사 DTO 필드는 추가하지 않는다.
- `scripts/verify-schema-contract.ts`: migration 122/123 및 PostgreSQL에서만 표현되는 작성자 자산 무결성 장치를 읽기 전용으로 검사한다.
- `tests/server/author-asset-api-contract.test.ts`: 생성 OpenAPI 10개, 감사 투영 2개의 무DB 시험을 작성했다. 생성기를 import하거나 자체 실행하지 않는다.

이 담당자는 생성기·시험·DB·빌드·브라우저를 실행하지 않았다. 정적 소스 대조와 `git diff --check`만 수행했다. 실행과 결과 로그는 root가 직렬로 기록한다. 이미 다른 담당자가 실행한 시험 결과를 이 12개 시험의 통과로 간주하지 않는다.

## 경로와 실제 응답

모든 경로 앞에 `/api/v1`이 붙는다. 회원 경로는 cookie session, 쓰기는 기존 exact Origin 검사를 사용한다.

| 경로 | 메서드·성공 | 입력과 권한 |
| --- | --- | --- |
| `/author-assets/uploads` | POST 201 | `AuthorAssetUploadInput`, 필수 `Idempotency-Key` 16~128자. 현재 발급 구성원·활성 서비스 `form.write`. 부모 ID 없이 시작 가능. 멱등 replay도 저장된 201 반환 |
| `/author-assets/uploads/{id}` | GET 200, DELETE 204 | 현재 발급 구성원·서비스 `form.write`. DELETE는 필수 양의 정수 `version`; 참조 중이면 409 |
| `/author-assets/uploads/{id}/content` | PUT 200 | 선언한 canonical MIME의 raw bytes. `AuthorAssetUploadInfo` 반환 |
| `/author-assets/uploads/{id}/complete` | POST 200 | 검사·현재 권한/기한 확인 후 `AuthorAssetUploadInfo` 반환 |
| `/author-assets/uploads/{id}/download` | GET 200 | 발급자 임시 다운로드. ready/clean 상태만 |
| `/author-assets/usage` | GET 200 | 필수 `serviceId`; 해당 서비스 `form.write`. `{usedBytes,limitBytes}` |
| `/author-assets` | GET 200 | optional catchall의 실제 루트. 정확한 부모의 `AuthorAssetManifest` |
| `/author-assets/{id}/download` | GET 200 | path의 자산 ID와 query의 부모 ID를 구분. 부모의 실제 참조 키만 |
| `/public/forms/{token}/author-assets` | GET 200 | 43자 게시 token, 빈 query. 활성 게시본의 정확한 버전 |
| `/public/forms/{token}/author-assets/{id}/download` | GET 200 | 같은 게시본 참조. session 불필요; token 권한 재검사. 응답 건수 quota를 읽기 gate로 추가하지 않음 |
| `/viewer/author-assets` | GET 200 | viewer session과 필수 `submissionId`. 현재 grant와 선택 질문만 |
| `/viewer/author-assets/{id}/download` | GET 200 | 동일 viewer/응답/허용 질문의 키만. I/O 후 자연 만료까지 재검사 |

회원 부모 query는 strict 판별 union이다. `form`/`template`에는 `kind,id,version`이 필요하고 `approval`/`submission`에는 `kind,id`만 허용한다. form/template의 최신 version 불일치는 409다. form/template/approval은 `form.read`, submission은 `submission.read`와 현재 부모 서비스 권한을 확인한다. query의 알 수 없는 키·중복 키는 거부한다. HTTP 문자열 version을 수치로 변환한 뒤 Zod 스키마를 적용한다.

신뢰된 시스템 템플릿 ingest는 HTTP endpoint가 없다. `ownerKind`, `tenantId`, blob/storage 식별자를 클라이언트 입력 계약에 추가하지 않았다.

## 파일·질문 데이터 계약

`AuthorAssetInfo`는 `id,purpose,name,mime,size,sha256,status,version,expiresAt`만 포함한다. 업로드 응답에는 `usage`가 추가되며 manifest는 `{items: AuthorAssetInfo[]}`이다. 이름은 원본 표시 문자열, 최대 255 UTF-16이며 잘못된 유니코드·경로 문자·제어 문자를 거부한다. 자료는 1~5,242,880 bytes의 PDF/DOCX/AI, 이미지는 1~1,048,576 bytes의 JPEG/PNG다. PDF를 포함한 AI도 canonical MIME은 `application/postscript`다. Zod refine가 JSON Schema에 모두 직렬화되지는 않으므로 purpose별 byte limit을 명시적 `x-purpose-byte-limits`와 설명에 함께 기록한다.

`materialList`는 FILE/LINK 혼합 전체 최대 3개다. 모든 항목은 `materialType,orderNumber,fileKey,linkLabel,linkUrl`의 strict 5필드이며 순서는 0부터 연속이다. FILE은 발급된 자산 UUID와 null 링크 필드, LINK는 null fileKey와 기존 링크 문자열 계약을 사용한다. 전체 필드 생략의 현재 논리 질문 보존과 명시 `[]` 제거는 기존 정규화 계약을 유지한다.

`optionImageKey`는 optional nullable UUID다. 생략은 현재 논리 보기의 키 보존, 명시 null은 제거를 뜻한다. 일반 객관식/체크박스에만 문항당 최대 20개를 허용하며 기타 직접입력/드롭다운/행렬에는 허용하지 않는다. 응답 보기 값·질문/보기 ID·과거 문서 bytes는 자산 메타데이터를 이유로 변경하지 않는다. 공유 질문의 OpenAPI 투영에도 실제 `grantQuestions`가 반환하는 `materialList`와 이미지 포함 `optionDefinitions`를 반영했다.

다운로드는 원본 해시 검증 bytes를 반환한다. 자료는 attachment, 이미지는 inline이다. 응답 헤더는 `private, no-store`, `nosniff`, `no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, `Content-Security-Policy: sandbox; default-src 'none'`이다. 이름은 안전한 Content-Disposition으로 표현한다. storageKey/blobId/암호문/발급자/타회사 정보는 DTO에 없다.

## 감사 연관과 권한

기존 `auditActor`/`auditWhere`가 현재 회사·역할·서비스와 기한을 먼저 검사한다. 회사 전체 감사 역할이 아니면 추가 부모 조회를 수행하지 않으며 기존 제한 DTO 마스킹을 유지한다. 부모 없는 업로드도 이벤트의 서비스 권한을 통과해야 한다. 추가 resolver는 이미 선택된 event ID 배열과 tenant를 SQL parameter로 묶는다.

`authorAssetAuditFormId`는 명시적 이벤트 문맥을 우선한다. `formId`, parent `form/version/submission/approval`, `publicationId`를 실제 같은 tenant의 부모와 대조하고, 최종 Form과 자산의 tenant/service가 이벤트와 모두 일치해야 한다. submission ID는 같은 form의 FormVersion에 실제로 속할 때만 노출한다. 명시 template 문맥은 폼으로 임의 치환하지 않는다.

부모 문맥이 없는 업로드/복사/검사 이벤트는 현재 참조와 과거 `attached/detached`의 formId 중 같은 tenant/service의 실제 Form이 정확히 하나일 때만 연관한다. 둘 이상이면 null이다. 복사의 `sourceKind/sourceId`를 대상 회사 감사의 폼으로 사용하지 않는다. 삭제 후에도 살아 있는 자산 행과 과거 detach 연관을 사용하지만, 삭제된 부모 자체나 모호한 여러 부모를 되살려 노출하지 않는다.

폼 감사 목록·CSV에도 같은 SQL을 사용하여 필터/건수/페이지가 동일한 집합을 대상으로 한다. raw detail, 파일명 원문, blob 정보는 반환하지 않는다. viewer 자산 다운로드는 기존 `share.*` 감사 방식이며 이 변경에서 별도 자산 감사로 재분류하지 않았다.

새 무DB 시험의 감사 범위는 제한 역할에서 조회가 없는지, 허용 event ID와 서비스가 같은 결과만 안전 두 필드로 투영하는지까지다. 추가 승인된 `tests/server/author-asset-audit.test.ts`에는 실제 PostgreSQL 회귀 7개를 작성했다. 단일 pin의 global/form JSON·CSV, detach 후 명시/과거 연관, 복수 폼의 모호성, 타회사/다른 서비스의 잘못된 감사 참조, submission의 원래 버전과 불일치 응답 ID 마스킹, template/source ID 미사용, 제한 역할과 service grant 회수를 다룬다. DB graph fixture는 실제 파일·스캐너 검사 성공을 의미하지 않는다. 이 시험의 실행은 root가 담당한다.

## 스키마 검증

독립 수집 자료 `schema-catalog.json`은 migration 123 적용 DB에서 얻은 CHECK 10개와 expression unique index 1개다. 검증기는 이 정의를 소스에 고정하고 현재 검증 DB에서 기대값을 다시 생성하지 않는다.

1. migration `20261025012000_author_assets`, `20261025013000_author_assets_expiry_precision`의 완료·비롤백 상태와 저장 checksum을 디스크 SHA-256과 비교한다.
2. CHECK 10개는 `pg_get_constraintdef` 및 validated를, unique index 1개는 `pg_get_indexdef` 및 unique/valid/ready를 확인한다.
3. migration 119의 기존 LINK 검증기와 UTF-16 길이 함수, migration 122/123 최종 함수 12개를 합쳐 총 14개 함수의 body·signature·return·language·security/volatility/strict/parallel 속성을 비교한다. 123의 동일 함수는 최신 정의가 우선한다.
4. 사용자 트리거 15개의 대상 테이블·함수·행/시간/이벤트 bit·enabled·deferred 속성을 확인한다.
5. `QuestionOption.optionImageKey`가 nullable text이고 기본값이 없는지 확인한다.
6. 기존 Prisma diff 허용 규칙과 checkpoint를 그대로 유지한다. 검증기는 생성된 diff를 적용하지 않는다.

## root 실행 순서

1. 기존 환경을 사용해 `scripts/generate-openapi.ts`를 실행하고 생성된 `openapi.json`을 보존한다.
2. `tests/server/author-asset-api-contract.test.ts`의 무DB 12개 시험을 직렬 실행한다.
3. 타입 검사와 migration 123 적용 개발/시험 DB 각각에 `scripts/verify-schema-contract.ts`를 실행한다. 예상 결과는 함수 14개·트리거 15개를 포함한 guard 보고서다.
4. `tests/server/author-asset-audit.test.ts`의 격리 DB 7개 회귀와 API audit가 통과하면 통합 빌드/브라우저 QA를 진행한다. 실패한 expectation을 맞추기 위해 과거 checkpoint나 DB를 변경하지 않는다.

현재 상태: **파일 작성 완료, 신규 실행 결과 미확인**. 소스 지문은 아래 부록에 기록한다.

## 작성 시점 지문

| 파일 | SHA-256 |
| --- | --- |
| `scripts/generate-openapi.ts` | `da9345882dc0972c19fd3f8b1471db7b763f8965fd374d26d1c40e96fcbdf4d9` |
| `scripts/verify-schema-contract.ts` | `9b0e2193578d25de877f6c9d7348bee81c341cea3320f7cda2440adb569a9e7a` |
| `src/server/audit-resources.ts` | `13d90aa37d1591a222e23b4661f1e4a4f225ae00a254eaa9680dfabe58cdb920` |
| `src/server/form-audit-events.ts` | `fd2af4524fbf880aa773ca644b8f48d253d08efb432953955b34694c378f8a3b` |
| `src/server/audit-events.ts` | `a82416f2081de217c6c3495409c5f41aa280d0ba0e3912cc97e8b5934c20f25c` |
| `docs/planning/contracts/domain-policies.json` | `5af5cb335fb9b59be4b47247da8c9a56aeb495d6c87ebaa00f388613407e91ef` |
| `tests/server/author-asset-api-contract.test.ts` | `7c7a07c48f3bf2c2525c97f9c76ff23ff8a52b1caad02f081059b69cafb05eae` |
| `docs/qa/R08-T02/question-metadata/author-assets/schema-catalog.json` | `923fc0603c8cecd7987a92bf937330660bc0eaf6f836e43cfd2beefdec4453f6` |

추가 DB 시험 작성 시점 SHA-256: `11c0a05e7b58e7f348605b4c0f198004afbf585b38dc71b21d2131aa264814ef` (`tests/server/author-asset-audit.test.ts`). 이 담당자는 실행하지 않았다.
