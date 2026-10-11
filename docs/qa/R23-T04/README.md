# R23-T04 통계·준수 재시작 수용검증

2026-10-11 현재 격리 test PostgreSQL, production 서버, 실제 출력 worker와 Ego Lite TaskSpace 2에서 R23의 로컬 수용을 완료했다. 이 도메인의 PDF/CSV 생성과 DB 집계에는 별도 외부 공급자가 없어 외부 검증은 `not_applicable`이다.

- 수집 3건→동의 철회 1건→파기 1건의 실제 DB 상태전이를 만들고 서비스 A/B·타회사·역할·미인증 격리를 확인했다.
- 대시보드·개인정보·마케팅·준수·마감·출력·다운로드와 중복 query·지원하지 않는 메서드를 HTTP 23개로 검증했다.
- 실제 `scripts/export-worker.ts --once`가 대기 PDF를 처리해 54,762바이트·2페이지·ready 상태와 완료 감사 1건을 만들었다.
- 서버 재시작 전후 DB 지문 `7a5d2494e4e209b9bebd84516051e568241b0d845bb157c55f5ce0dc08c50a07`이 같다.
- Ego Lite에서 기간/검색/페이지 URL의 새로고침·뒤로가기, 전용 분석 API 호출, 저장 세션과 새 로그인을 확인했다. 재시작 전 기능 8개·반응형 8개, 재시작 후 기능 11개·반응형 8개가 통과했다.
- 관련 회귀 9파일 146개, TypeScript, 변경 파일 ESLint 오류 0건, production build 83페이지가 통과했다.

## 증거

- [fixture 생성](current/fixture.log)
- [worker 준비](current/worker-prepare.log)
- [실제 worker 실행](current/worker-run.log)
- [worker 결과](current/worker-verify.log)
- [재시작 전 HTTP·DB](current/api-before-restart.json)
- [재시작 후 동일 지문](current/api-after-restart.json)
- [재시작 전 Ego](current/browser-before-restart.json)
- [재시작 후 Ego](current/browser-after-restart.json)
- [1440px 전](current/browser-before-1440.png) / [390px 전](current/browser-before-390.png)
- [1440px 후](current/browser-after-1440.png) / [390px 후](current/browser-after-390.png)
