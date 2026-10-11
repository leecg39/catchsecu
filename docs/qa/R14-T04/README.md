# R14-T04 개인정보 업로드·이관 라이브 수용

2026-10-14. `scripts/qa-import-lifecycle.ts`(QA_ORIGIN=http://localhost:3121, production 빌드) 3단계 재실행 — QA_ORIGIN/QA_OUT override로 P07 증거 보존.

## prepare — 28 케이스 ([http-prepare.json](lifecycle/http-prepare.json))

- 독립 회사·서비스 생성 → import init(목적·제공자 증빙 핀)
- 수식 주입 방어 검증: errors.csv가 `'=1+1` 이스케이프 + `private,no-store`
- validate→commit(202 비동기)→runOneImport 실제 실행 → 50행 반영·원본 파일 deleted
- 스테이징 rows/생성 멱등 캐시 410·대조군 지문 보존

## finish — 9 케이스 ([http-restart.json](lifecycle/http-restart.json))

- 진행 상태 유지 → runOneImport 재실행으로 잔여 5행 처리 → **partialFailed 55/57**(invalid1·skipped1)
- `runOneImport` 재호출 false(중복 없음)·duplicate commit 409·errors.csv 유지
- DELETE archive → headers/mapping 스테이징 제거·rows/errors.csv 410

## database — 독립 대조 (서버 재기동 후, [database.json](lifecycle/database.json))

- job archived·importedRows 55·submissions 55·evidence 55·fileStatus deleted·leaseGeneration2
- 전체 109 회사·172 사용자 원본 지문 동일·합성 세션 0

## 누적 보완

- imports.test.ts 29건: UTF-8/EUC-KR·한글·대용량·잘못된 증빙·타 회사 파일·중복·재시도 임대.
- [docs/qa/imports/](../imports/) 브라우저 전정.

## 판정

로컬 수용 완료(실제 DB·파일·worker·재시작 대조). 외부 제공사 차원 없음.
