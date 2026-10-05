# UX RSI 실험 보고서 — Round 1

- 기간: 2026-10-05 · 브랜치 `main` · Frozen Metric `eval/ux-eval.ts`(eval/meta_eval 불변 유지)
- 베이스라인: **68.45** (error 100 · dom 72 · form 1.82 · visual 100, 2회 측정 동일)
- 최종: **100.00** (error 100 · dom 100 · form 100 · visual 100)
- Outer 점수(meta_eval/outer_score.ts): **62.02** — gain +31.55 / 실험 13 전부 keep / 수렴 7.69 / 실험당 개선 48.54

## 실험 결과 (inner_results.tsv)

| # | 커밋 | 변경 | 총점 | 판정 |
|---|---|---|---|---|
| 0 | dfbb68b | 베이스라인 | 68.45 | baseline |
| 1 | c8dcabf | 전역 토스트(aria-live·자동닫힘·호버 일시정지) | 74.73 | keep |
| 2 | de9c7ff | 모달 포커스 관리(초기포커스·Tab트랩·복귀·스크롤잠금) | 77.00 | keep |
| 3 | 75bbda6 | 접근성 확인창(alertdialog·취소 우선 포커스), native confirm 2곳 + 확인 없던 파괴 작업 7곳 | 79.27 | keep |
| 4 | 033254d | 미저장 이탈 경고(beforeunload + Link onNavigate) | 81.55 | keep |
| 5 | 9353bee | 명령 팔레트 Ctrl/⌘+K — combobox/listbox ARIA, 초성 검색 | 83.82 | keep |
| 6 | 4468a7d | 키보드 단축키 도움말(`?`) + 헤더 트리거 | 86.09 | keep |
| 7 | 948b2da | 클립보드 복사 버튼(절대 URL)+토스트 피드백 | 88.36 | keep |
| 8 | a4762f0 | QR 코드 생성·PNG 다운로드(qrcode@1.5.4) | 90.64 | keep |
| 9 | daba5fb | 공용 DataTable 전 열 정렬 버튼 + aria-sort | 92.45 | keep |
| 10 | 12146e6 | 브레드크럼 nav[aria-label]+aria-current | 94.73 | keep |
| 11 | 1f4fbfa | 본문 건너뛰기 링크 → #main 포커스 | 97.00 | keep |
| 12 | 303966c | 입력 포커스 링 대비(2px #6558ff, ~4.8:1) | 97.50 | keep |
| 13 | 14a7da7 | prefers-reduced-motion 버튼 트랜지션 해제 | 100.00 | keep |

실험 1–10 = GitHub 유사 프로젝트(documenso·fides·formbricks·heyform, `outer/program.md` 근거표)에서 이식한 기능 10개.
실험 11–13 = Outer Loop 분석이 찾은 잔여 프로브·전역 접근성 공백 보강.

## 최종 프로브 상태

palette 1 · shortcuts 1 · modalFocus 1 · confirmDialog 1 · unsavedGuard 1 · toast 1 ·
copy 1 · qr 1 · sort 1 · breadcrumb 1 · skipLink 1 · focusVisible 1 · reducedMotion 1 ·
console errors 0 · native dialogs 0 · 375/390~1440 뷰포트 가로오버플로 없음.

## 검증

- `tsc --noEmit` 무결, `eslint` 변경 파일 경고 0(기존 `<img>` 경고만 잔존)
- `next build` 성공(운영 env 가드: SMTP·카카오 실연결 필요 → 로컬 미리보기 플래그로 우회한 컴파일·SSR 검증)
- 브라우저 평가 14회(베이스라인 2 + 실험 13 — 매 실행 10경로×2뷰포트+프로브 전수)

## 서버·데이터 불변 확인

UX 계층(src/components)만 변경. 서버 권한·원장·라이프사이클 코드 미접촉.
미저장 가드의 이탈 확인은 기존 ConfirmProvider 재사용 — beforeunload는 네이티브 정책상 커스텀 불가로 브라우저 기본창(프로브에서 beforeunload는 허용 목록).
