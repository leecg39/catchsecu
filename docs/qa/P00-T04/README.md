# P00-T04 시험 데이터·검증 목록

2026-10-03T03:16:58.179Z. 회사 A/B, 역할 10개, 공개 토큰, 181개 경로의 실제 주소와 검증 등급을 고정했다. 이 결과는 181개 업무 CRUD가 끝났다는 뜻이 아니다.

## 확인한 사실

- 고아 경로 0, 고아 Task 0. 페이지가 없는 Task 31개는 foundation, enforcement, embedded, gate, release로 분류했다.
- 등급은 internal 169, staging 12, mock 0이다. staging 12개 경로는 구매·청구·카카오 템플릿·본인인증·새올 모델이 없어 데이터베이스 ID가 아니다.
- owner 세션으로 181개 구체 주소가 HTTP 200이었다. 없는 주소는 서버가 404로 거절한다.
- 공개 폼, 고정 URL, 문서 토큰 3개의 API가 200이었다.
- 회사 B와 제한 서비스의 폼은 0건이다. 첨부 fixture 바이트는 비공개 저장소와 일치한다.
- 외부 시나리오 8개는 adapter 또는 staging이며, skip·mock·차단 상태를 통과로 집계하지 않는다.
- R162–R164의 P/C/OC는 내부 문서 유형의 별칭으로 쓰지 않는다. 경로의 토큰은 각각 독립된 게시 문서를 연다.
- `/identification/:result` fixture 값은 `pending`이다. 주소 방문만으로 본인인증 성공을 만들지 않는다.

실행: `npm run db:seed` 후 로컬 서버에서 `npm run verify:fixtures`. 결과: `fixture-check.json`, `route-catalog.json`.

로컬 production 미리보기는 `ALLOW_LOCAL_MAIL=1`이 있어야 기동한다. 이 검증은 그 설정으로 `next start --port 3100`에 대해 수행했다.
