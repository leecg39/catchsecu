# P04-T01 폼 버전·불변 라이브 게이트 (2026-10-04)

dev 앱 :3100 + catchsecu_dev 실측.

| 수용 조건 | 실측 |
|---|---|
| 게시 버전 직접수정 거부 | 게시 폼 `PATCH` → 200이지만 **게시 v1은 title·status 불변**, 수정분은 신규 **draft v2**로만 생성 — 게시 증거 불변 구조 실증 |
| 버전 독립 | 신규 draft는 number 2로 독립 버전(복제 ID 독립 설계와 동일 원칙) |
| 실제 토큰 경로 | tokenCipher 복호 실토큰: `/projects/{token}/form`·`/project/{token}/form`(구형 별칭)·`/test-projects/{token}/form`·공개 API 전부 **200 동일 계약**(scripts/qa-token-routes.ts) |
| 고정 URL 생명주기 | `qa-gate-url` 생성→공개 resolve·페이지 200→회수 204→resolve 410(P13-T04 게이트) |
| 로그인 레이트리밋 | 다회 로그인 시 **429 RATE_LIMITED**·`Retry-After:60` 부수 확인 |

## 미수용

- 분기·행렬형 전 질문 유형 UI 실렌더·공용 템플릿 원본 대조는 기존 증거 범위 유지.
