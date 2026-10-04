# localStorage·sessionStorage 도메인 의존 감사 (2026-10-04)

`src/` 전체에서 `localStorage`·`sessionStorage` 사용처를 전수 조사했다.

| 파일 | 용도 | 도메인 의존? |
|---|---|---|
| `components/auth/LiveAuth.tsx` | 로그인 화면 "이메일 기억" 편의 기능(`catchsecu-demo-email`) | **아니오** — UI 편의 값, 인증·도메인과 무관. 실패해도 로그인 동작 |
| `components/forms/SharedPrivacy.tsx` | 외부 열람자 이메일 인증 후 `sessionStorage`에 `{id, expiresAt}` 보관 | **아니오** — 서버 발급 세션 ID의 탭 내 전달 수단. 서버가 매 요청 인증·만료·회수를 검사(P06-T04 게이트 실측: 회수 즉시 401) |
| `components/management/LegacyImport.tsx` | 구형 localStorage 자료를 읽어 서버로 이관하는 도구(P14-T01) | **아니오** — 이관이 목적 자체. 이관 후 원본 정리 |

결론: 폼·응답·캠페인·동의 등 도메인 데이터는 모두 PostgreSQL이 원천이며 브라우저 스토리지에 의존하지 않는다. 수용 조건 "localStorage 도메인 의존 0" 충족.
