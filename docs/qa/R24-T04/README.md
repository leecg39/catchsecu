# R24-T04 — 종합 수용: 생명주기·권한·격리·공통경로·재시작

- local_status: `verified`
- external_status: `not_applicable`
- verification_status.database: `verified`
- verification_status.api: `verified`
- verification_status.ui: `verified`

## 실행

```bash
QA_ORIGIN=http://localhost:3121 node --env-file=.env.local --import tsx scripts/qa-r24-acceptance.ts run
QA_ORIGIN=http://localhost:3121 node --env-file=.env.local --import tsx scripts/qa-r24-acceptance.ts restart
```

증거: `acceptance/fixture.json`, `acceptance/http-run.json`, `acceptance/restart.json`.

## 수용 케이스 (5/5 통과)

1. **notice-lifecycle** — 운영자 초안 생성(201, `bodyHtml` sanitize로 `<script>` 제거) → 회원 404 → 게시 → 회원 목록·조회 200 → 구버전 PATCH 409 → `noticeId a9dc3e37`
2. **notice-attachment** — sha256 선언 검증 업로드 → 회원 다운로드 해시 일치(`6c8d3529…`) → 회원 업로드 403 → 삭제 204 (`if-match`=공지 버전, 낙관잠금)
3. **notice-denial-archive** — 회원 생성 403, `scope=admin` 403, 보관 후 회원 조회 404
4. **guide-lifecycle** — 등록 → PDF 없이 게시 409 `FILE_REQUIRED` → PDF 등록 → 게시 → 회원 다운로드 바이트 일치 → `guideId 10d6c98a`
5. **ticket-lifecycle** — 회원 생성 → 운영자 답변 → 회원 종결 → 회원 재개 403 → 운영자 재개 → 테넌트B 단건 404 + 목록 미노출 → `ticketId 1d43a650`

## 재시작 영속

프로덕션 서버(APP_PORT=3121, BETTER_AUTH_URL 일치) 재시작 후: `notice.status=archived`, `guide.status=published`, `ticket.replyCipher+answeredAt` 유지 — 암호화 본문·상태·버전 영속 확인.

## 브라우저 경로 (T03 스윕과 동일 근거)

공지 목록/상세, 헬프센터, 내 문의, 운영자 공지/가이드/문의 화면, `/`·`/IE`·`/loading`·`/access-not-allow`, `/security` 렌더 + `/security/*`·미등록 경로 404, 새로고침/뒤로가기/키보드/모바일 — 전부 통과.

## 비적용 범위

외부 제공사 없음: 파일은 로컬 private storage, 콘텐츠·문의는 자체 DB. `source_fidelity_status`는 공개 화면 `source-based`, 관리자 authoring은 원본 미관측 부가화면으로 기록.
