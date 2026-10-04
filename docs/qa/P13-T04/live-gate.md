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
