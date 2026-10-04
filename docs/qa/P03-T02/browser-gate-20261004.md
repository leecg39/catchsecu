# P03-T02 브라우저 게이트 — 2026-10-04 (Chrome DevTools 실제 브라우저)

환경: `npm run dev`(:3100, NODE_ENV=development) + `catchsecu_dev` PostgreSQL + chrome-devtools MCP 실제 Chrome.

## 구성원 관리 `/set/member` — admin 세션

- 목록 11명 실데이터: owner(소유자, 제외 버튼 없음)·admin(본인 표시, 제외 없음)·역할 7종·제외 상태 구성원·플랫폼 관리자 계정 구분 표시
- 검색·상태 필터(활성/정지/제외)·페이지네이션·서비스 접근 요청 섹션 렌더
- **마지막 소유자 보호(UI 증거)**: owner A 행에 관리 버튼 자체가 없음 — 수용 조건 "마지막 owner 제거 차단"의 화면 측 증거
- 역할 선택지에 `결제 담당자` 없음 → billing 행 수정 버튼 없음과 일치(역할별 관리 가능 범위)

## 초대 — 적대적 결과

- 구성원 초대 다이얼로그: 이메일/역할 7종/서비스 체크박스
- **좌석 한도 차단**: `qa-p03t02-20261004@` 초대 시도 → "현재 구독의 이용 한도에 도달했습니다." 오류 표시, Invitation 행 미생성(DB 대조). 초대의 좌석 예약 검증이 화면에서 실제 작동
- 초대 이력 탭: 수락된 초대 1건(이메일·역할·상태·만료일) + 초대 전용 상태 필터(대기/수락/취소/만료)

## 권한 회수 직후 API 차단 — E2E 적대 검증

세션 분리: admin=브라우저 UI, viewer=독립 curl 세션 쿠키(같은 dev 서버·DB).

| 단계 | 조치 | viewer 세션 결과 |
|---|---|---|
| 기준선 | viewer 로그인 → `GET /api/v1/analytics/collect-destruction` | rows 3, sources 7 |
| 회수 | admin UI: viewer 권한 수정 → 기본 서비스 체크 해제 → 저장("구성원 정보를 저장했습니다." 토스트, 목록 서비스 `-`) | 즉시 재호출 → **rows 0, sources 0** |
| 복원 | admin UI: 기본 서비스 재체크 → 저장 | 재호출 → **rows 3, sources 7** |

→ 기존 세션 토큰을 무효화하지 않아도 요청마다 `documentScope`/`currentServiceScope`가 현재 grant를 재검사해 즉시 차단. 수용 조건 "권한 회수 직후 API 차단"의 브라우저+실세션 증거.

## 전문가 배정 `/admin/expert-assignments` — platformAdmin 세션

- 목록 2건(회수 상태·만료일·다시 배정 버튼)·검색 폼·새 배정 버튼
- 새 배정 다이얼로그: 회사 검색+전체 회사 드롭다운·전문가 이메일·서비스 선택·만료일시·안내문("만료일이 지나거나 회수하면 접근이 차단됩니다")
- 비운영자 접근 제어는 `page.tsx`의 `platformAdmin` 리다이렉트로 구현(코드 레벨 확인)

## 반응형

- `/set/member` 390px: 햄버거 내비·탭 유지·카드형 구성원 목록·필터 줄바꿈 — 사용 가능
- `/log/collect-destruction` 1440px·390px: 테이블/필터/합계/페이지·엑셀 다운로드(네트워크 200) — 상세는 P12-T01 증거 문서

## 남은 한계 (정직한 미충족)

- "원본 배정 상태 화면 대조": 원본 SaaS의 배정된 전문가 화면은 관찰 불가 — 독립 구현 주장으로 유지(README 기존 기록과 동일)
- "다른 이메일 초대수락 거부"는 좌석 한도로 신규 초대를 만들 수 없어 브라우저 재현 불가 — `member-management-gate.test.ts`·`http-current.txt`의 API 증거로 유지
- 전체 경로 브라우저 회귀는 P13-T04 게이트 범위
