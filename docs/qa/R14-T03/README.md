# R14-T03 개인정보 업로드 화면 검증

2026-10-14. `http://localhost:3121`(production 빌드)에서 업로드 화면을 실제 브라우저로 확인했다.

## `/form/info-upload`

- "CSV 파일의 수집 근거와 보유 기한을 확인하고 응답으로 등록합니다" 안내.
- 인코딩 선택(UTF-8/BOM·EUC-KR/Windows-949), 제한 명시(최대 10MB·10,000행·100열·24시간 보관).
- 상태 필터 11종(파일 업로드/설정 중/검증 완료/반영 중/재시도 대기/처리 중단/반영 완료/일부 반영/취소됨/임시 자료 만료/보관됨)·정렬·검색·페이지.
- 실제 작업 행 "라우트 fixture 가져오기 · 설정 중" 렌더.

## 누적 브라우저 증거

- 파일 등록→헤더 매핑→미리보기→검증오류→정정→확정→보관·390px·재시작: [docs/qa/imports/](../imports/) (browser-mapping/preview/corrected/committed/archived/mobile/restart).
- localStorage 이관 dry-run·중복 보고: qa-imports.ts + imports.test.ts.

## 판정

로컬 화면 검증 완료.
