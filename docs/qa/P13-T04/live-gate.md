# P13-T04 정적 경로 전수 스윕 (2026-10-04)

dev 앱 :3100에서 03-route-matrix.csv의 파라미터 없는 **141개 정적 경로**를 익명/owner 직접URL로 전수 조회했다. 결과 원본: [static-sweep.json](static-sweep.json).

| 집계 | 결과 |
|---|---|
| 5xx/연결오류 | **0건** (익명·인증 모두) |
| 익명 200 | 39개 — 전부 인증 흐름(login·signup·2FA·비밀번호 재설정·OTP·GPKI·SAML·OAuth2·link)과 공개 흐름(infoOwner·shared-privacy)·시스템 페이지(jap_intro·not-allow-ip·logout)로 적합 |
| 익명 리다이렉트 | 102개 — **전부 `/login`으로 수렴**(루프 없음, P13-T02 게이트에서 체인 종단 검증) |
| owner 인증 200 | **141/141 전부 렌더** — 리다이렉트·차단 0 |

## 미수용

- 40개 동적 경로(실제 fixture ID 필요)·새로고침·뒤로가기·1440/768/390 레이아웃·캡처 목록은 미실행 — 개별 게이트에서 일부만 검증됨.
- viewer·다른 역할의 전수 스윕 없음(owner 기준).

## viewer 전수 스윕 (결과: [viewer-sweep.json](viewer-sweep.json))

- 132/141 → **200**(역할이 허용하는 화면의 셸 렌더), **5xx 0**.
- 차단 9개는 전부 `/log/*` 계열 → `/access-not-allow?reason=role`(audit.read 없음) — 서버 측 역할 경계가 페이지 수준에서도 집행됨.
- `/security/*`·`/set/*`은 셸 200이지만 데이터 API는 403(P11-T02 게이트 실측) — 셸/데이터 분리 설계.

## 동적 경로 40개 (결과: [dynamic-invalid-sweep.json](dynamic-invalid-sweep.json))

- 무효 파라미터 전수: **40/40 셸 200·5xx 0** — SPA 셸이 렌더되고 클라이언트가 오류 상태(`role=alert`)를 표시하는 구조.
- 실제 fixture 대조(페이지+데이터 API):

| 경로 | 페이지 | 데이터 API |
|---|---|---|
| `/dashboard/{serviceA}` | 200 | `analytics/dashboard` 200 |
| `/form/manage/applicant/{실제폼}` | 200 | `forms/{id}/submissions` 200 |
| `/notice/{게시공지}` | 200 | `notices/{id}` 200 |
| `/services/{serviceA}/catchforms` | 200 | `forms?serviceId=` 200 |
| `/file-view/{실제응답}` | 200 | `files?submissionId=` 200(첨부0), 없는 id → 404 |

## 미수용 (갱신)

- 토큰 경로(`/projects/:token`·`/url/:token`·`/document/*`·`/infoOwner/*`)의 실제 토큰 fixture 렌더는 개별 게이트(P04/P05/P06) 브라우저 실측으로 대체 검증됨 — 이번 스윕은 셸+API 경계만.
- 새로고침·뒤로가기·1440/768/390 전수·캡처 목록은 여전히 미수행.

## 토큰 경로 실제 fixture (2026-10-04 추가)

- `/url/:token`: API로 고정 URL 생성(`qa-gate-url`, 201) → 공개 `resolve` 200(익명 동일)·페이지 200 → 회수 204 후 resolve **410**. 테스트 후 회수 정리 완료.

- `/document/P|C|OC/:token`: tokenCipher 복호 실토큰 3건 — 세 페이지 모두 200, 공개 API는 실제 스냅샷·렌더텍스트·contentHash 반환 + `X-Robots-Tag:noindex`·`Referrer-Policy:no-referrer`(scripts/qa-document-tokens.ts).

- `/infoOwner/*` 정보주체 API 경계(scripts/qa-subject-boundary.ts): 무효 토큰 422, 세션 없음·위조 세션 ID 404(존재 추측 불가), 토큰별 레이트리밋 10/600s.

## 동적 경로 실제 fixture 스윝 (2026-10-04 추가)

`scripts/qa-dynamic-real.ts` → [dynamic-real-sweep.json](dynamic-real-sweep.json). 실제 serviceId·formId·noticeId로 14개 동적 경로 조회:

- `/dashboard/:serviceId`·`/privacy-detail`·`/marketing-detail` → 200
- `/services/:serviceId/catchforms*` 7경로(목록·수신자·해외·agree/Y) → 200
- `/form/manage/applicant/:formId`·`:serviceId/:formId`·`log/:formId` → 200
- `/notice/59`(실제 공지) → 200

무효값 스윝(통제 오류)·실fixture 스윝(정상) 양방향 커버. `/pay/*`·`/bill/:id`·`/alimtalk/templates/:id`·`/infoOwner/*`·`/saeol/*`·`/identification/*`는 로컬 fixture 부재 또는 외부 의존 — 무효값 스윝만 적용.
