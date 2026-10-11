# R24-T03 — UI/경로: 공개·authoring·공통 경로 + 와일드카드 규칙

- local_status: `verified`
- external_status: `not_applicable`
- verification_status.ui: `verified` (Chrome 브라우저 스윕, 세션=회원→운영자 전환)

## 경로 검증 (http://localhost:3121)

| 경로 | 결과 |
|---|---|
| `/` | 대시보드("캐치시큐가 처음이신가요?") 렌더 — manifest id 1 |
| `/IE` | redirect-target: 대시보드 화면 렌더 — manifest id 172 |
| `/notice` | 게시 공지 목록, 실제 10행(제목·구분·작성일·작성자) |
| `/notice/59` | 공지 상세 본문 렌더(개인정보 처리방침 전문) |
| `/help-center` | 헬프센터 목록 + 다운로드 링크(실제 published 가이드) |
| `/my-page/support` | "내 문의·개선 제안" — R24 문의 행 상태(답변 완료/종료/접수) |
| `/admin/notices` | 운영자만 접근: 목록에 초안/보관 포함 + 수정·삭제 액션 |
| `/admin/notices/new` | 작성 폼(구분/제목/정렬/본문HTML/첨부파일 최대 10개) |
| `/admin/guides` | 카테고리별 가이드 + 게시/수정/삭제 |
| `/admin/support` | 전사 문의 목록(회사·작성자·상태) |
| `/loading` | 로딩 전환 후 `/dashboard`로 해소 |
| `/access-not-allow?reason=admin` | "시스템 운영자 권한이 필요한 화면" 사유별 문구 |
| `/security` | 회사 보안 현황(실시간 점검 수치) |
| `/security/bogus-path` | 404 — 와일드카드 미등록 |
| `/bogus-route-xyz` | 404 |

## 와일드카드 규칙 (T03 핵심)

`src/lib/registered-page.ts`는 `*`를 포함한 manifest 경로를 **allowlist에서 명시적으로 제외** — `/security/*`를 임의 매치로 허용하지 않고 등록된 정적 경로(`/security`, `/security/compliance`, `/security/sso[/setting]`, `/security/ip[/setting]`, `/security/two-factor[/setting]`)만 인가. 미등록 `/security/x` → `notFound()`.

## 상호작용 검증

- 새로고침: `/notice/59` reload 후 동일 본문 유지
- 뒤로/앞으로: 목록→상세→back(목록 10행 복원)→forward(상세 복원)
- 키보드: `본문으로 건너뛰기` 스킵링크 최우선 + nav 포커스 순서 정상
- 모바일(375px): 문서 수평 오버플로 없음(scrollWidth=375). 공지 테이블은 `overflow-x:auto` 래퍼 내부 스크롤 — 올바른 반응형 패턴
- 권한 리다이렉트: 회원 세션으로 `/admin/notices` 접근 → `/access-not-allow?reason=admin` (서버 렌더 단계 차단)
