# R24-T02 — API/워크플로: 콘텐츠 CRUD·파일·문의 상태 + 권한

- local_status: `verified`
- external_status: `not_applicable`
- verification_status.database: `verified` (fixture+restart)
- verification_status.api: `verified` (5개 케이스 전부 통과)

## API 표면

| API | 권한 | 계약 |
|---|---|---|
| `GET/POST/PATCH/DELETE /api/v1/notices[/:id]` | 목록/조회=로그인 회원(published만), 쓰기=`platformAdmin` | `noticeCreate/noticePatch`, `if-match` 버전 낙관잠금 |
| `PUT/GET/DELETE /api/v1/notices/:id/attachments/:aid` | 쓰기=admin 라우트 선검증, 다운로드=발행 공지 회원 | `x-file-size/x-file-sha256/x-file-name`, `if-match`=공지 버전 |
| `GET/POST/PATCH/DELETE /api/v1/guides[/:id]` | 목록/조회/다운로드=회원(published), 쓰기=admin | `guideCreate/guidePatch`, `PUT /:id/file` PDF 전용 |
| `GET/POST /api/v1/support-tickets`, `PATCH/DELETE /:id`, `POST /:id/reply|close|reopen` | `scope=mine`=회사 컨텍스트+작성자, `scope=admin`=platformAdmin | `reopen` admin 전용, 멱등키 지원 |

## 검증 근거 (`scripts/qa-r24-acceptance.ts`, `docs/qa/R24-T04/acceptance/`)

- 공지: 초안(회원 404) → 게시(회원 목록/조회 200) → 구버전 PATCH 409 → 보관(회원 404). `bodyHtml`의 `<script>` 제거 확인.
- 첨부: 업로드(sha256 검증+스캔) → 회원 다운로드 해시 일치 → 회원 업로드 403 → 삭제 204.
- 회원 권한 거부: 공지 생성 403, `scope=admin` 목록 403.
- 가이드: PDF 없이 게시 409 `FILE_REQUIRED` → PDF 등록 → 게시 → 회원 다운로드 바이트 일치.
- 문의: 회원 생성 → 운영자 답변 → 회원 종결 → 회원 재개 403 → 운영자 재개 200 → 테넌트B 조회 404·목록 미노출.
- 공개/로그인 경계: `/notice`·`/help-center`는 로그인 회원 공개, 미로그인은 `/login` 리다이렉트, authoring 경로는 비운영자 `/access-not-allow?reason=admin`.

외부 제공사 의존 없음(파일 저장은 로컬 private storage).
