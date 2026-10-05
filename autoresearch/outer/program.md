# UX RSI 연구 디렉티브 (Outer Loop만 수정)

## 목표
GitHub 유사 프로젝트에서 실제 소스로 확인한 UX 기능 10개를 Catchsecu 클론에 하나씩 이식하고,
Frozen Metric(`eval/ux-eval.ts`)의 총점이 오르는 변경만 유지한다.

## 근거 (실제 저장소 소스 경로)
| # | 기능 | 근거 |
|---|---|---|
| 1 | 전역 토스트 알림 (aria-live, 자동 닫힘) | documenso `packages/ui/primitives/toaster.tsx`, heyform `packages/webapp/src/components/Toast.tsx` |
| 2 | 명령 팔레트 (Ctrl/⌘+K 메뉴 검색·이동) | documenso `apps/remix/app/components/general/app-command-menu.tsx` |
| 3 | 키보드 단축키 도움말 (`?`) | fides `admin-ui/.../HotkeysHelperModal.tsx` |
| 4 | 미저장 변경 이탈 경고 (beforeunload + 앱 내 링크 차단) | formbricks `apps/web/modules/ui/hooks/use-before-unload-prompt.ts`, documenso `use-envelope-autosave.ts` |
| 5 | 파괴적 작업 확인 대화상자 (native confirm 대체) | fides `fidesui/.../ConfirmationModal.tsx`, documenso `envelopes-bulk-delete-dialog.tsx` |
| 6 | 모달 포커스 관리 (진입·트랩·복귀·스크롤 잠금) | documenso `packages/ui/primitives/dialog.tsx`·`alert-dialog.tsx` (Radix) |
| 7 | 클립보드 복사 버튼 + 피드백 | documenso `packages/lib/client-only/hooks/use-copy-to-clipboard.ts` |
| 8 | QR 코드 생성·PNG 다운로드 | heyform `pages/form/Share/QRCodeModal.tsx`, formbricks `summary/lib/get-qr-code-options.ts` |
| 9 | 테이블 열 정렬 (aria-sort) | fides `features/common/hooks/useSorting.ts`, formbricks `data-table/components/data-table-header.tsx` |
| 10 | 이동 경로(브레드크럼) | documenso `settings-scope-breadcrumb.tsx`, fides `NextBreadcrumb.tsx`, formbricks `organization-breadcrumb.tsx` |

## 규칙
- `meta_eval/`은 어떤 루프도, `eval/`은 Inner Loop가 수정하지 않는다.
- 실험 하나 = 가설 하나. `git commit -m "experiment: ..."` 후 평가한다.
- 총점이 직전 유지 점수보다 오르면 keep, 같거나 낮으면 `git revert --no-edit HEAD`로 되돌린다(이력 보존).
- 모든 실험을 `inner_results.tsv`에 기록한다(실패 포함).
- 기존 디자인 토큰(#6558ff, Noto Sans KR)과 한국어 문구를 유지하고, Next.js 16 규약(`Link onNavigate`)을 따른다.
- 서버 권한·데이터 동작은 바꾸지 않는다. UX 계층만 변경한다.

## 실험 순서 (현재 전략)
1 → 6 → 5 → 4 → 2 → 3 → 7 → 8 → 9 → 10. 기반(토스트·포커스·확인창)을 먼저 깔고 그 위에 기능을 올린다.
