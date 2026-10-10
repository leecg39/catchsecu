# R03-T04 회사·서비스·초기 설정 전체 수용검증

2026-10-11 현재 소스와 실제 PostgreSQL, production 서버, main worker, 두 브라우저 세션으로 회사·서비스·접근요청의 재시작 수용 조건을 확인했다.

## 결과

- 회사·서비스 흐름은 fresh login 뒤 HTTP 23개를 통과했다. 타회사 ID 주입, 조회자 쓰기, stale version, 잘못된 입력, 중복 이름, 사용 중 서비스 보관을 각각 401/403/404/409/422로 거부했다.
- 독립 PostgreSQL 조회에서 회사 version 8, 서비스 version 5, 삭제 처리된 사업자 파일 2개, 감사 14개와 PDF 1,426바이트 왕복을 확인했다.
- 접근요청 흐름은 HTTP 19개를 통과했다. 요청 4개의 승인·거절·취소 상태, grant 1개, 조회자 version 2, 감사 8개를 DB에서 대조했다.
- production 서버 재시작 전후 두 흐름의 상태 해시가 각각 일치했다. 합성 계정 재로그인 사이에는 localhost Better Auth 로그인 버킷 하나만 fixture 준비로 초기화했고 업무/API rate limit은 변경하지 않았다.
- Ego Lite의 기존 세션은 서버 재시작 뒤에도 `/set/service`에서 회사와 25개 서비스를 유지했다. 별도 Codex 인앱 브라우저에서 새로 로그인해 같은 회사, `R03 서비스 01`·`02`, 서비스명 오름차순, 총 25개를 확인했다.
- 격리된 test DB에서 main worker를 1회 기동했고 정상 종료했다. 관련 회귀 21 suite 264개, TypeScript, 대상 ESLint, production build 82페이지가 통과했다.

## 증거

- [수용 요약](acceptance-summary.json)
- [서버 재시작 지문](runtime-restart.json)
- [별도 브라우저 재로그인](browser-relogin.json)
- [worker 준비 상태](worker-readiness.json)
- [264개 회귀](regression.json)
- [품질 게이트](quality-gates.json)
- [검증 요약](verification-summary.json)
- [회사·서비스 원시 흐름](../management-flow/README.md)
- [접근요청 원시 흐름](../access-flow/README.md)

이 작업에는 실제 외부 공급자 호출이 없다. 로컬 mail/payment/Kakao 허용 플래그는 production build 검증용이며 외부 연동 성공으로 집계하지 않았다. 원본에서 직접 관찰한 화면 범위가 일부이므로 원본 충실도는 `partial_observed`다.
