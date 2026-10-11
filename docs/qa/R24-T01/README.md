# R24-T01 — 공지·가이드·문의 모델/규칙 감사

- local_status: `verified`
- external_status: `not_applicable` (외부 제공사 없음)
- source_fidelity_status: `source-based` — 공지/도움말/문의는 원본 관측, 관리자 authoring 경로는 원본 미관측 → 독립운영 부가화면으로 등록

## 데이터 모델

| 모델 | 핵심 필드 | 규칙 |
|---|---|---|
| `Notice` | `status(draft/published/archived)`, `sortOrder`, `version`, `bodyHtml`, `publishedAt` | `bodyHtml`은 저장 시 sanitize(`cleanBody`, `<script>` 제거 확인). 낙관적 동시성 `version`. |
| `NoticeAttachment` | `status(active/deleting)`, `fileName/mime/fileSize/fileSha256`, `storageKey` | 공지당 최대 10개. mime 화이트리스트(pdf/png/jpeg/txt/csv). SHA-256 선언값 검증 + ClamAV 스캔. 다운로드는 `FOR SHARE` 잠금 + 무결성 재검증. |
| `Guide` | `category/categoryOrder/sortOrder` 정렬 키, `file*`, `version` | 게시 전제 `FILE_REQUIRED`(PDF 필수, 10MB). `assetKey/storageKey` 유니크. |
| `SupportTicket` | `tenantId`(회사) + `authorId` 소유자, `kind(inquiry/suggestion)`, `status(submitted/answered/closed/archived)`, `*Cipher` 암호화 본문, `answeredBy/answeredAt/closedAt` | 제목·본문·답변은 암호화 저장(`replyCipher` 등). `mine` 스코프 = `tenantId + authorId`. |

## 상태 전이

- 공지: `draft → published → archived` (archived 는 회원 목록/조회에서 404)
- 가이드: `draft → published → archived` (PDF 없으면 게시 409 `FILE_REQUIRED`)
- 문의: `submitted → answered → closed → reopened(submitted)`; `reopen`은 운영자만, `close`는 작성자·운영자

## 관리자 authoring 부가화면 등록

원본 경로 inventory에 없는 관리자 화면은 독립운영 부가화면으로 명시: `/admin/notices[/new|/:id/edit]`, `/admin/guides[/new|/:id/edit]`, `/admin/support[/:id]`, `/my-page/support[/new|/:id]` — `page.tsx`의 `systemNotices/systemGuides/systemSupport/memberSupport` 정규식으로 개별 등록.
