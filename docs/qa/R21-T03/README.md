# R21-T03 결제 전체 화면·모달 연결 검증

2026-10-11 현재 소스, 로컬 PostgreSQL `catchsecu_dev`, production 빌드와 Ego Lite TaskSpace 2에서 검증했다. 시험 자료는 별도 QA 계정·회사에만 만들었고 인증 정보는 Git 비추적 `.local/qa-r21-ui.json`에 0600 권한으로 보관한다.

## 구현 결과

- `/pay/history`의 결제·문자·본인인증 세 탭을 각각 청구 이력과 복식 원장 API에 연결했다. 탭, 월·일 기간, 페이지, 페이지 크기를 URL에 보존하고 잘못된 값·역전 기간·범위 밖 페이지를 안전하게 처리한다.
- 문자와 본인인증 내역은 서버의 `category` 조건으로 분리한다. 화면 DTO에서 내부 `sourceId`를 제거해 원장 원천 식별자를 노출하지 않는다.
- `/pay/cancel`은 일반 결제 실패 화면 대신 환불 가능한 결제 완료 주문과 남은 금액, 청구서·환불 상세 진입점을 표시한다.
- 성공 URL은 result·credit·plus의 정의된 변형만 주문 상태를 조회하고, 추가 경로 조각이 붙은 주소는 거래를 읽지 않는다. 성공 문구는 URL 값이 아니라 저장된 `paid` 상태에서만 표시한다.
- 좁은 화면에서 결제 취소 제목과 이력 페이지 제어가 줄바꿈되도록 보완했다.

## 실제 브라우저 수용

- [Ego Lite 보고서](current/browser-report.json): 결제 도메인 17개 경로를 각각 새로고침하고 1440·768·390px에서 확인했다. 총 51개 폭 조합의 문서 가로 넘침과 브라우저 오류는 모두 0건이다.
- 결제수단·구독·취소·결제 이력·사용 이력·성공/실패 결과·청구서·환불 화면이 전용 QA 주문과 원장을 표시했다. 리다이렉트 경로 `/pay/method`, `/pay/billing-policy`도 최종 관리 화면으로 이동했다.
- 문자와 본인인증 탭은 각 2개의 실제 원장 행을 표시했다. `tab=message&pageSize=20` 직접 진입과 새로고침, 본인인증 탭 이동, 뒤로/앞으로 복원, 역전 기간 오류, 검색→초기화 버튼 키보드 포커스 순서를 통과했다.
- 대표 화면은 [스크린샷 폴더](current/screens/)에 1440·390px로 보존했다.

## 품질 게이트

- [결제 회귀](current/regression.log): 15파일 197시험 통과. 권한 회수, 회사 격리, 승인·실패·환불 경합, 감사 롤백, 구독 만료와 새 UI 경로 검사를 포함한다.
- [production 빌드](current/build.log): 로컬 QA 공급자임을 명시한 `ALLOW_LOCAL_MAIL/KAKAO/PAYMENT=1`에서 83개 정적 페이지와 전체 동적 API 경로 생성 통과.
- 전체 TypeScript, 변경 파일 ESLint, OpenAPI 333경로·474작업·정책 474행, 활성 계획 107작업·원본 186경로·추가 21경로 검사가 통과했다.
- 실제 PG 계정의 승인·환불 수신 증거와 서버 재시작 전후 DB 지문은 후속 R21-T04에서 로컬 수용과 외부 상태를 분리해 판정한다.

## 재현

1. `node --env-file=.env.local --import tsx scripts/qa-r21-ui-fixture.ts`
2. production 서버를 `APP_PORT=3180`, `BETTER_AUTH_URL=http://127.0.0.1:3180`과 로컬 공급자 허용값으로 실행
3. `ego-browser nodejs < scripts/qa-r21-ui-browser.mjs`
4. `vitest`로 `regression.log`에 기록된 15개 결제 파일 실행
