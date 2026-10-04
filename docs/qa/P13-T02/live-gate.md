# P13-T02 시스템 경로 라이브 게이트 (2026-10-04 보강)

dev 앱 :3100에서 owner·viewer 세션으로 시스템 경로를 실제 요청했다.

| 경로·시나리오 | 결과 |
|---|---|
| `GET /logout` | 200 — 로그아웃 실행 버튼만 표시, **세션 파기 없음**(직후 `/api/v1/me` 200) |
| 비로그인 `/` | 307 → `/login?returnTo=/` |
| 로그인 `/` | 200 직접 응답 — **리디렉션 루프 0**(max-redirs 10 추적) |
| viewer → `/admin/expert-assignments` | 307 → `/access-not-allow?reason=admin` |
| `/access-not-allow?reason=admin` | "시스템 운영자 권한이 필요한 화면" + 권한 재확인·대시보드 링크 |
| `?reason=role` | "현재 역할로 사용할 수 없는 기능" |
| `?reason=expert` | "전문가 배정 범위에 없는 서비스" |
| `?reason=ip` | "접근 권한이 없는 메뉴…권한을 요청" — **사유별 문구 구분 렌더** |
| `/loading` | "서비스를 불러오는 중…권한을 확인하고 있습니다" — 실제 context 로딩 상태 |
| `/IE` | 온보딩 — 템플릿 둘러보기·폼 직접 생성 CTA |
| `/service/none` | 권한 확인 로딩 상태 렌더(클라이언트가 context 조회 후 분기) |
| `/expert/select-company` | 전문가 회사 선택 UI + "배정된 회사를 불러오는 중" |
| `/company-info` | 200 |

## 남은 조건

- `/service/none`의 요청 UI는 서비스 없는 계정으로의 브라우저 단 — 요청→승인→권한 반영 전 사이클은 기존 PostgreSQL 시험·HTTP 기록([README](README.md), http.txt, qa-access-requests.ts)으로 커버.
- 전문가 회수 즉시 이동·모바일·뒤로가기는 P13-T04 전체 화면 게이트에 속함.
