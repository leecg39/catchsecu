# R13-T02 정보주체·동의이력·본인인증 API 계약 대조

2026-10-14. subjects·verification 계약을 운영 매트릭스와 누적 검증으로 대조했다.

## 운영 계약

- `POST /subjects/access-requests` → `POST /subjects/sessions` → `GET /subjects/me` → `POST /subjects/logout`.
- `GET /subjects/me/consents|events` — 페이지 보정·strict 쿼리(중복/미지원 422).
- `POST /subjects/me/withdrawals` → `GET /subjects/me/withdrawals/{id}` → `confirm`/`cancel` — 멱등·version 검사.
- `GET/POST/PATCH/DELETE /services/{id}/verification` — 서비스별 본인인증 설정 CRUD + revision 이력.
- `POST /public/verify/local` — 로컬 sandbox 본인확인 시도 → 영수증 발급(공식 아님 표시).

## 누적 검증

| 항목 | 근거 |
|---|---|
| access→session→consents/events→withdrawal 전수 | [subjects.test.ts](../../tests/server/subjects.test.ts) 17건 |
| 접근 게이트·세션 무효화 | subject-access-gate.test.ts |
| 인증 flow·provider callback | verification-flow.test.ts 6건·verification-configuration.test.ts 15건 |
| 라이브 수용 60+11케이스 | [R13-T04 access](../R13-T04/access/) |

## 판정

계약=구현=검증 일치. 실 기관 연동은 external_pending.
