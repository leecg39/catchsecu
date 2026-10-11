# R25-T01 모든 경로·메뉴 행동·부가 운영화면 연결 검증

`scripts/qa-full-page-gate.ts`가 `src/data/route-manifest.json`의 186개 원본 경로 전부를 실제 Playwright 브라우저로 검증한다.
**최종: `passed_with_skips` — 161/161 검사 경로 통과(0 실패), 25개 fixture 스킵(사유 기록).**
결과 파일: [full-sweep.json](full-sweep.json) · [full-sweep-summary.json](full-sweep-summary.json) · 스크린샷: [screens/](screens/)

## 실행

```bash
QA_ORIGIN=http://localhost:3121 QA_OUT=docs/qa/R25-T01 node --env-file=.env.local --import tsx scripts/qa-full-page-gate.ts
```

## 검증 내용(경로별)

- 직접 URL 진입 → HTTP 상태·최종 URL 기록
- 본문 렌더링 대기(`document.body` 내용 존재)
- 1440/768/390 뷰포트별 페이지 수준 수평 오버플로
- 새로고침 → 200 + 동일 경로 유지
- 대시보드 → 경로 → 뒤로가기 → `/dashboard` 복귀
- 콘솔 오류 5건까지 기록
- 일시적 5xx/429는 1회 재시도 후에도 실패해야만 결함으로 기록(부하 스파이크와 실제 결함 구분)

## 경로별 정상 거동 주석

실제 브라우저로 확인한 의도된 거동만 등록(`qa-full-page-gate.ts`의 `expectations`):

| 경로 | 기대 | 확인된 거동 |
|---|---|---|
| `/*`, `/security/*` | 404 | 와일드카드 보안 fallback — 404가 정답 |
| `/loading` | → `/dashboard` | 로딩 완료 후 대시보드 이동 |
| `/pay/billing-policy`, `/pay/method` | → `/pay/license-service` | 과금 개체 부재 시 라이선스 화면 이동 |
| `/oauth2/signup` | 콘솔 410 | 가입 intent 만료 → "가입 인증이 없거나 만료되었습니다" 안내 |
| `/oauth2/invite/signup` | 콘솔 422 | 초대 토큰 부재 → 초대 수락 안내 화면 |
| `/shared-privacy/view` | 콘솔 401 | 열람자 세션 부재 → 이메일 인증 게이트 |

## 스킵 경로

`:token`·결제ID·본인확인 등 실제 fixture를 임의로 채울 수 없는 동적 경로는 사유와 함께 스킵 목록으로 기록한다(임의 토큰 주입 금지 — P13-T04 교정 결정 유지). 각 경로의 기능 동등면은 도메인 수용(R11~R24)에서 실제 fixture로 검증됨.

## 발견·조정 이력

- 초기 스윕은 `#root` 대기 조건(App Router 미존재)으로 전 경로 타임아웃 → `document.body` 비어있지 않음 조건으로 수정.
- 부하 스파이크 시 `member:` rate limit(300/min) 한계에 의한 SSR 429→500이 관측되어 재시도 1회 + 경로 간격 150ms를 추가. 수동 검증으로 실제 결함이 아님을 확인(로그: RATE_LIMITED·digest).
- `/security/*` 와일드카드는 보안 설계상 등록 경로만 허용하고 나머지는 404 — 게이트에 기대 상태로 명시.

## 한계

- `checked` 수와 스킵 목록은 summary를 참조. 메뉴·버튼 단위 동작은 도메인별 T03 화면 검증과 CloneApp 상호작용 검증에서 별도 확인.
- 원본 화면과의 시각 대조는 R25-T05에서 수행한다.
