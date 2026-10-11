# R11-T03 공개 경로 별칭 명세 + file-view 변형

2026-10-14. 원본 12개 공개 경로의 별칭 차이와 file-view 네 변형을 명세하고 실측했다.

## 별칭 명세 (클라이언트 디스패치 → 서버 계약)

모든 외부 폼 경로는 `src/components/PublicPages.tsx` → `ExternalForm` → `PublicForm`으로 들어가며, `PublicForm`이 `path.split("/")[2]`를 토큰으로 쓴다.

| 원본 경로 | 토큰 해석 | 실제 API | 비고 |
|---|---|---|---|
| `/project/:outerToken/form` | segment[2] = outerToken | `GET /api/v1/public/forms/{token}` | 정식 별칭 |
| `/projects/:outerToken/form` | 동일 | 동일 | 복수형 별칭 — 동일 토큰 해석 |
| `/test-projects/:outerToken/form` | 동일 | 동일 | 시험용 별칭 — 운영 폼과 동일 계약 |
| `/url/:outerToken` | segment[2] = slug | `GET /api/v1/public/urls/{slug}` | **고정 URL 전용** — slug → 게시본 해석 후 폼 데이터 반환. 토큰이 아니라 slug |
| `/customer-use-case/:outerToken` | segment[2] = outerToken | `GET /api/v1/public/forms/{token}` | 도입 사례 페이지 별칭 — 동일 공개 폼 |
| `/jap_intro` | 토큰 없음 | 없음 (정적) | **유일한 정적 화면** — 원본은 벤더 자사 도입 상담 신청서(일본어). 테넌트 데이터가 아니라 고정 마케팅 페이지 |
| `/file-view/…` | 경로 파생 | `/api/v1/files` 또는 `/api/v1/viewer/files` | 아래 네 변형 |

차이 요약: `/url/`만 **고정 URL slug**를 해석하고 나머지 폼 별칭은 모두 **게시 토큰**을 해석한다. `/jap_intro`는 토큰이 없는 정적 화면이다.

### 실측 (production 서버, 2026-10-14)

- 활성 고정 URL `r09-accept-qa01` → `GET /api/v1/public/urls/r09-accept-qa01` 200, 반환된 `token`으로 `/api/v1/public/forms/{token}` 200 — 동일 폼 데이터.
- `/project|projects|test-projects/{token}/form`, `/customer-use-case/{token}`, `/jap_intro` — 모두 SPA 셸 200 + 클라이언트 디스패치 확인(코드 경로 위와 동일).
- 게시 중단 시 공개 조회 `closed:true` + `closedReason`(기존 R09 수용 재사용).

## file-view 네 변형 (`src/components/forms/FileView.tsx`)

| 원본 경로 | 해석 | API |
|---|---|---|
| `/file-view/:customerId` | submissionId, 목록(페이지 20) | `GET /api/v1/files?submissionId&page&pageSize` |
| `/file-view/:customerId/:questionId/:fileId` | 단건 | `GET /api/v1/files/{fileId}?submissionId&questionId` |
| `/file-view/:customerId/shared` | 공유 목록 | `GET /api/v1/viewer/files?submissionId&page&pageSize` |
| `/file-view/:customerId/:questionId/:fileId/shared` | 공유 단건 | `GET /api/v1/viewer/files/{fileId}?submissionId&questionId` |

- `shared` 꼬리표가 있으면 **공유 열람자(viewer) 계약**으로 전환 — 관리자 세션이 아니라 share-grant 인증 세션 필요. 401이면 각각 `로그인`/`이메일 인증` 링크로 분기.
- 목록 변형은 20건 페이지네이션.
- 실측(같은 날 acceptance 스크립트): 관리자 목록 `GET /files?submissionId` 200·첨부 포함, 단건 `GET /files/{id}?submissionId&questionId` 200, 다운로드 200+SHA-256 일치; 공유 단건 범위 밖 접근 `404`(정보·다운로드 동일), 공유 상세는 grant 범위 문항만 노출, 철회된 응답의 공유 상세 `410`. 증거: `../../R11-T04/acceptance/acceptance.json`.

## 응답 목록·상세·정정·철회·로그

- 목록 `GET /forms/{id}/submissions`, 상세 `GET /submissions/{id}`(암호화 답변 복호화 반환), 정정 `PATCH /submissions/{id}`(사유+암호화 payload+version 낙관잠금), 철회 `POST /submissions/{id}/withdraw`, 메모 `/notes` CRUD, 감사 `submission.*`/`file.*` 이벤트 — R11-T04 acceptance.json에서 실측.
- 첨부 실제다운로드 `GET /files/{id}/download?submissionId&questionId` — 바이트=업로드=DB sha256 삼중 일치 실측.

## /jap_intro 구현

- `src/components/forms/JapIntro.tsx` 신규: 원본 일본어 도입 상담 신청서(회사명·이름·메일·전화 필수 + 상담 내용 선택)를 재현. 클라이언트 필수/메일형식 검증 후 완료 화면 표시.
- 벤더 자사 백엔드가 없는 정적 마케팅 페이지이므로 제출은 로컬 데모 완료 화면이며, 입력 미저장을 화면에 명시(정직 표기). `PublicPages.tsx`의 `ExternalForm`에서 `/jap_intro`를 `PublicForm` 대신 이 컴포넌트로 디스패치.
