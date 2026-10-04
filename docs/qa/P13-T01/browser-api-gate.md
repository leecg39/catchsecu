# P13-T01 공지·문의 라이브 게이트 (2026-10-04 보강)

기존 통합 시험 증거(notices·guides·support-tickets) 위에 **실제 브라우저 + 라이브 API**로 수용 조건을 재검증했다.
dev 앱 :3100, 회사 A owner·viewer·platformAdmin(운영자) 세 계정 사용. 산출물은 전부 정리했다.

## 권한 경계

| 시나리오 | 결과 |
|---|---|
| viewer로 공지 생성 | 403 `FORBIDDEN` "운영자 권한이 필요합니다" |
| 회사 owner(비운영자)로 공지 생성 | 403 — 플랫폼 운영자만 공통자료 수정 |
| 무인증 공지 목록 | 401 |
| 보관(archived) 공지 상세 | 404 — 비공개 상태 비노출 |
| 초안(draft) 공지 일반 조회 | 404 |

## HTML 정제 (운영자 계정 라이브)

입력: `<p>정상</p><script>alert(1)</script><a href="javascript:alert(2)">x</a><img src=x onerror=alert(3)>`
저장: `<p>정상</p><a>x</a>` — **script·javascript: URL·onerror 전부 제거**, 정상 요소만 보존.

## 공지 생명주기

draft 생성(일반 404) → published 전환(일반 200) → `If-Match` 삭제 204 → 상세 404·검색 결과 제외(0건).
목록 화면 `/notice`는 게시 10건이 DB와 정확히 일치, 상세 `/notice/59` 본문 렌더 정상.

## 문의 티켓

owner 문의 생성(submitted) → 타인(viewer) 상세 404(본인 범위) → 운영자 `?scope=admin` 답변(answered·본인 화면에 답변 표시) → archive 204 → 404.

## 남은 조건

- 가이드 PDF 다운로드는 기존 guides 증거(실제 PDF 바이트 대조)로 커버 — 미재검.
- 첨부파일 업로드 UI·전체 역할×브라우저 E2E·원본 대조는 P13-T04 전체 화면 게이트에 속함.
