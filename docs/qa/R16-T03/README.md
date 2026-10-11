# R16-T03 보존·파기 화면 검증

2026-10-14. `http://localhost:3121`(production 빌드, owner 세션)에서 R16 경로 4개를 실제 브라우저 이동으로 확인했다.

## 경로별 확인

| 경로 | 결과 |
|---|---|
| `/log/retention` | 적용기준 안내(폼 버전→폼 지정→서비스 규칙→회사 기본 순)·서비스/상태 필터·규칙 추가/새로고침·페이지 보정 렌더 |
| `/log/destruction-schedule` | 상태 필터(승인 대기/예약/처리 중/재시도 대기/실패/완료/취소/반려) + 실제 완료 요청 행(응답 e091853c… 파기 완료) |
| `/log/destruction_certificate` | 실제 증명서 행 81ef88e7… · 무결성 "확인" · 증명서 보기 · 범위 안내(백업·복구 로그 물리삭제 제외) |
| `/log/collect-destruction` | 일자별 수집/당일수집/당일파기/잔여 표 + 서비스·폼 필터 + 엑셀 다운로드 버튼, 실제 24건 |

## 누적 브라우저 증거 (기존)

- `/log/retention` CRUD·충돌·반응형·역할 차단 — [route-connection](../R16-T04/route-connection/browser/)
- 파기 일정 승인·취소·보존·증명서 재로그인 열람 — [destruction/browser-*](../destruction/)

## 판정

로컬 화면 검증 완료. 외부 제공사 차원 없음.
