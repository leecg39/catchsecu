# P06-T04 외부 열람자 브라우저 재검증 (2026-10-04)

개발 서버(localhost:3100, catchsecu_dev)에서 Chrome으로 초대→인증→범위축소→회수 전 주기를 재검증했다.
기존 `docs/qa/sharing/` 증거와 별개의 라이브 확인이며, 남은 완료 조건(외부 SMTP·Ego·정상 원본 대조)은 그대로 미해결이다.

## 픽스처

- 폼 `49ceecf0-e481-4678-a1d3-448db0596d4e` (v1 게시본 `4d96b1c8-fa5f-4a16-a2d5-b1e59213ba6c`)
- 공유 `5fd028c1-e3d2-4b45-8815-61c9ad182156` → external-viewer@catchsecu.local.test
- 검증용 신규 응답 `cae57832-1bd2-4235-b25d-fa04386fff05` (공개 API·Idempotency-Key 제출)
- 철회 응답 `ff705ae3-…`, `5cf9819a-…` (공유 제외 대상)

## 확인된 동작

1. **초대**: 버전 지정·항목 체크(이름/이메일)·종료일(최대 90일)·"철회·파기 요청·보유 기한 종료 응답 제외" 안내.
   목록에 `v1 · 이름, 이메일 · 열람 가능` + 수정/재발송/회수/열람 로그.
2. **잘못된 초대 정보**: `입력 내용을 확인해주세요` 단일 오류 — 조합별 구분 없음.
3. **초대 메일 → 이메일 인증**: 폼코드+인증코드+이메일 입력 → 6자리 코드 메일(10분·일회용·요청 브라우저 바인딩) → 세션 발급.
4. **첫 세션**(f51a46d8, grantVersion 1): 허용 항목·인증 종료(30분)·공유 종료 표시.
   활성 응답 제출 전 철회 2건만 있어 `총 0개` — 제외 규칙 확인.
5. **필드 범위**: 신규 활성 응답 제출 후 이름/이메일 2항목 표시.
6. **API 적대 접근** (열람자 세션 쿠키):
   - 철회 응답 직접 조회 → **410 SHARED_RESPONSE_UNAVAILABLE**
   - 미존재 ID → **404 NOT_FOUND**
   - 활성 응답 → 200, `values`에 허용 questionId만
7. **공유 수정**(항목 이메일 제외): grant `version 1→2`, ShareField 2→1,
   기존 세션 `revokedAt` 기록(동일 트랜잭션), **구 초대코드 로테이션**(구 코드 재사용 시 메일 미발송·동일 응답).
   열람자 화면 폴링이 즉시 `공유 권한이 변경되었거나 인증이 만료되었습니다` + 다시 인증 링크.
   API → **401 VIEWER_SESSION_EXPIRED**.
8. **재인증**(새 코드·새 6자리): 세션 f68276f9 (grantVersion 2) — `허용된 항목: 이름`만, 응답에 이름만 표시(이메일 미노출).
9. **열람 로그 UI**: 인증 요청/완료·응답 목록 열람·공유 변경이 관리자에 그대로 표시.
   AuditEvent도 동일: share.created → challenge_requested → authenticated → responses_viewed×N → response_viewed.
10. **회수**: 확인 모달 "기존 인증은 즉시 해제" → grant `version 3` + revokedAt,
    v2 세션 동일 시각 revokedAt. API **401**(`공유 권한을 사용할 수 없습니다`), UI 폴링으로 동일 안내 표시.
    목록 상태 `회수`, 잔여 액션은 `열람 로그`뿐.

## 코드 확인 (이번 브라우저 검증과 일치)

- `src/server/viewer.ts` `activeGrant`: 매 요청 grant revokedAt/expiresAt/보관/필드 존재 + 발급자 현재 권한(`share.manage`/`submission.read`/`file.read`)·전문가 배정 기한 재검사.
- `withViewer`: 세션 `grantVersion !== grant.version` 시 401 — 범위 변경 시 기존 세션 무효.
- `sharedSubmission`: `submitted|corrected` + `retentionUntil > now`만, `grant.fields` questionId만 복호화.
- `sharedFile`: 공유 응답 재검증 + 파일의 submission/formVersion/question 바인딩·attached·clean·만료 검사 — 임의 fileId 우회 불가.

## 여전히 남은 조건

- 외부 SMTP 실전달·반송/운영 보존, Ego TaskSpace, 정상 원본 픽스처 대조(README의 "남은 완료 조건"과 동일).
- 파일 업로드 항목 공유의 브라우저 수준 첨부 열람/우회는 이번 픽스처(이름·이메일만)에서 검증하지 못함 — 코드 경로 확인으로 대체.
