# 작성자 자산 API·읽기 문맥 결정

이 문서는 원본 서버가 아닌 로컬 구현 계약이다. PLAN의 A06/A13/A15–18에서 공유한다. 기존 응답 업로드 endpoint와 별도 namespace를 사용한다. 모든 쓰기는 기존 same-origin route guard를 통과한다.

| 경로 | 입력/결과 | 권한·상태 |
| --- | --- | --- |
| POST `/api/v1/author-assets/uploads` | authorAssetUploadInput, Idempotency-Key → AuthorAssetUploadInfo | 선택 service의 form.write. parent ID 없는 새 폼/템플릿도 예약 가능. 발급 member를 기록 |
| GET `/api/v1/author-assets/uploads/:id` | 현재 upload info | 발급 member와 현재 같은 service의 form.write; 만료/삭제 거절 |
| PUT `/api/v1/author-assets/uploads/:id/content` | 선언 MIME의 raw bytes | 현재 발급자·scope, 정확한 크기/hash, 실제 형식 검증 후 uploaded. 동일 bytes 재요청 지원 |
| POST `/api/v1/author-assets/uploads/:id/complete` | 업로드 info | ClamAV 실제 scan, 완료 시 현재 권한/기한 다시 검사. ready는 기존 scan 증거 반환 |
| DELETE `/api/v1/author-assets/uploads/:id?version=N` | discard 결과 | 현재 발급자·form.write. 미참조만 제거 가능; 참조 있으면 409. 물리 삭제는 durable worker |
| GET `/api/v1/author-assets/uploads/:id/download` | 안전한 바이트 응답 | 발급자 임시 preview, ready/clean만. 임의 blob/path 입력 없음 |
| GET `/api/v1/author-assets/usage?serviceId=UUID` | usedBytes/limitBytes | 해당 service form.write; 공통 회사 논리용량 |
| GET `/api/v1/author-assets?kind=...&id=...&version=...` | AuthorAssetManifest | form/template/approval/submission exact parent의 현재 읽기 권한 |
| GET `/api/v1/author-assets/:id/download?kind=...&id=...&version=...` | 바이트 | 같은 부모의 실제 참조를 다시 검증. 현재 form/template version 불일치409 |
| GET `/api/v1/public/forms/:token/author-assets` | 현재 게시본 manifest | lockPublicPublication, 현재 활성 버전. 응답 업로드 quota와 다르게 read에 response-count gate를 추가하지 않음 |
| GET `/api/v1/public/forms/:token/author-assets/:id/download` | 바이트 | token의 바로 그 게시본에 있는 키만. 종료/만료/교체 token 거절 |
| GET `/api/v1/viewer/author-assets?submissionId=UUID` | 허용 질문 manifest | withViewer + 해당 공유 버전의 아직 읽을 수 있는 응답 + grant.fields |
| GET `/api/v1/viewer/author-assets/:id/download?submissionId=UUID` | 바이트 | viewer cookie 경로를 유지. 현재 session/grant/issuer/응답 기한과 선택 필드에 실제 참조된 키만 |

private read scope는 `kind:form|template|approval|submission` 판별 union이다. form/template에는 부모 version을 요구한다. HTTP query 숫자는 명시적으로 coercion 뒤 strict scope parse한다. 다른 context 필드 혼합, 알 수 없는 query, storageKey/blobId/외부 URL은 받지 않는다. 이후에 승인·응답의 원래 버전은 부모에서 구하며 사용자 입력 version으로 바꾸지 않는다.

manifest는 공개용 이름·MIME·크기·logical key만 포함하는 `AuthorAssetInfo` 목록이며 blob ID, storageKey, createdBy/다른 회사 메타데이터를 내보내지 않는다. 질문/폼 JSON에는 URL·이름을 저장하지 않는다. 모든 다운로드 URL은 화면의 명시적 읽기 문맥과 logical key로 앱이 조립한다. manifest 조회는 키마다 N+1 요청하지 않고 부모별 한 번에 수집·중복 제거한다. 외부 열람은 공유 질문의 집합으로 제한한다.

새 업로드 응답은 편집기 안의 임시 metadata map에 저장한다. 부모가 저장되면 해당 parent manifest로 읽는다. 현재 service와 질문/보기 stable ID, 업로드 요청 토큰, 편집/저장 snapshot이 모두 같은 경우에만 지연 결과를 붙인다. 다른 결과는 best-effort discard하고 TTL 정리를 남긴다. 기존 이미지는 새 파일 ready 및 실제 부모 변경까지 유지한다. 파일이 붙었거나 업로드 중인 새 폼의 service 변경은 먼저 자료를 제거하도록 UI에 설명하고 막아 scope가 섞이지 않게 한다.

공통 응답은 no-store/nosniff/no-referrer를 적용한다. 문서는 attachment, 검사된 raster 이미지는 inline이다. Content-Disposition은 원본 이름을 안전한 ASCII fallback 및 RFC5987로 표현한다. 읽기 I/O/hash/감사 뒤에도 권한의 자연 만료를 검사한다. 브라우저에 받은 과거 바이트 자체를 원격 회수할 수 있다고 주장하지 않는다.

업로드/복사/정리 및 다운로드의 감사에는 logical asset/parent 연관과 상태만 남긴다. blob·저장키·파일 내용·인증 토큰·원시 이름은 기록하지 않는다. form audit는 제거 후에도 과거 parent association을 유지한다. 용량은 검사/정리 대기 중인 논리 자산도 포함하며, 원본 파일의 역사 pin이 남으면 교체 때문에 먼저 공제하지 않는다.

trusted system asset ingest/public template publisher는 HTTP payload의 ownerKind/tenantId=null로 만들지 않는다. 같은 validator/scanner와 durable blob·system asset을 사용하는 서버/seed 전용 함수로 두고 실제 공개 템플릿을 두 회사에서 사용하는 시험으로 확인한다.
