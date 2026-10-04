# P13-T03 내비게이션·모달·캐시 일관성 — 진행 중

> 2026-10-07. 전체 완료 아님 — 아래는 이번에 실측·수정한 범위.

## 발견·수정된 결함

사이드바 footer의 **홈페이지 / 개인정보 처리방침 / 서비스 이용약관** 버튼이 실제 목적지 없이 placeholder 모달("연결된 화면을 확인해주세요.")만 열었다 — "모든 visible action이 실제 API/이동에 연결" 조건 위반.

- `src/components/AppShell.tsx`: 세 버튼을 실제 링크로 교체 — 홈페이지 → `https://catchsecu.com`(새 탭, noopener), 처리방침 → `/legal/privacy`, 이용약관 → `/legal/terms`
- `src/components/LegalPages.tsx`: 플랫폼 처리방침·이용약관 실제 정적 문서 (Panel/cs-gate 스타일, 돌아가기·로그인 링크)
- `src/app/[[...slug]]/page.tsx`: `/legal/(privacy|terms)`를 known 시스템 경로로 추가
- `src/lib/public-paths.ts`: `/legal` 접두사 공개(미로그인 열람 가능 — 법적 문서의 통상 정책)
- `src/components/CloneApp.tsx`: `/legal/*` → LegalPages (셸 없는 공개 문서)
- `src/components/auth/LiveAuth.tsx`: 회원가입 동의 체크박스 문구를 실제 약관·방침 문서 링크로 연결(새 탭)

## 실브라우저 검증 (chrome-devtools → :3100 dev)

| 항목 | 실측 |
|---|---|
| 익명 `/legal/terms`·`/legal/privacy` | 200, 실제 조항 렌더링(로그인 리디렉션 없음 — 공개 문서) |
| `/legal`·`/legal/unknown` | 404 |
| 로그인 상태 footer | 세 링크 href 실제 값 확인; `개인정보 처리방침` 클릭 → `/legal/privacy` 이동 |
| `/signup` SSR | 약관·방침 링크가 서버 렌더 HTML에 존재 |

검증: tsc 0 오류, eslint 0 오류(img 경고 1, 기존), auth-navigation·auth-session-gate·context-audit **38/38 통과**, verify-plan 181 경로 유지(manifest 미변경 — /legal은 원본 외 로컬 시스템 경로).

## 남은 범위

- 모든 메뉴·헤더·모달 action의 전수 클릭 감사와 서버 cache invalidation 일관성(새로고침/뒤로가기 후 stale 데이터), loading/empty/validation/conflict/forbidden/retry/disabled 상태별 화면 증거
- 181개 경로 전체 화면 게이트는 P13-T04에서 처리
