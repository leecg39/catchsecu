# R12-T02 외부 공유·열람자 인증 API 계약 대조

2026-10-14. 공유 관리·열람자 인증 API를 운영 계약과 누적 검증으로 대조했다.

## 운영 계약 (operation-policy-matrix)

- `GET/POST /share-grants`, `GET/PATCH/DELETE /share-grants/{id}` — share.manage + 현재 서비스 grant, Idempotency-Key·version·If-Match.
- `GET /share-grants/options` · `POST /share-grants/{id}/resend` · `GET /share-grants/{id}/events`.
- `POST /viewer/challenges` · `POST /viewer/challenges/{id}/verify` · `GET /viewer/session` · `POST /viewer/logout`.
- `GET /viewer/submissions[/{id}]` · `GET /viewer/files[/{id}][/download]` · `GET /viewer/author-assets[/{id}/download]` — 매 요청 허용필드·범위 적용.

## 누적 검증 근거

| 항목 | 근거 |
|---|---|
| 필드 범위·버전핀·세션무효화·OTP 단일소비·시도제한·스로틀 | [sharing.test.ts](../../tests/server/sharing.test.ts) 20건 |
| 초대 재발송·수신자 변경 무효화·만료/회수·권한회수 차단 | sharing.test.ts |
| 사용자 filter로 범위 확장 불가·비밀 비노출 | sharing.test.ts·R12 수용 |
| 실제 HTTP 수용 9케이스 | [R12-T04 acceptance](../R12-T04/acceptance/acceptance.json) |

## 대조 결과

계약=구현=검증 일치. 외부 제공사 차원 없음.
