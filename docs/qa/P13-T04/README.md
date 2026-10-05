# P13-T04 전 페이지 화면 게이트 — 미완료

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

181경로 매핑·공통 디스패처 기반. 이번 소스 조사만으로 테스트 실행·브라우저·외부 연동 통과를 주장하지 않는다.

- [src/server/context.ts](../../../src/server/context.ts) — activeMembershipWhere, requireActor, requireContext, requireService
- [tests/server/auth-navigation.test.ts](../../../tests/server/auth-navigation.test.ts)

## 남은 구현·수용

전 경로 동적 fixture·1440/768/390·뒤로가기 증거.

원래 범위: 181개 라우트와 추가 관리화면의 직접URL/새로고침/브라우저뒤로/모바일을 검증한다.

수용 조건: 모든 동적fixture 경로 1개 이상 정상/오류; 1440/768/390 주요화면 및 전페이지 레이아웃; 캡처/증거목록

선행: P13-T03, P12-T04. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.

## 2026-10-05 — 전수 스윕 실측 결과

`scripts/qa-full-page-gate.ts`가 181경로 매니페스트 중 동적 fixture 제외 169경로를 실제 Playwright 브라우저로 직접URL→새로고침→뒤로가기 검증하고 1440/768/390 뷰포트 수평 오버플로를 측정했다. 결과는 [full-sweep.json](full-sweep.json)에 경로별 HTTP 상태·최종 URL·뷰포트별 오버플로·새로고침·뒤로가기·콘솔 오류를 기록한다.

- 최종 실행: 169/169 HTTP 200, 오버플로 0, 새로고침·뒤로가기 실패 0, anomaly 0.
- status 캡처 개선: `page.goto`가 응답을 반환하지 않는 SPA 경로는 `page.reload` 응답으로 폴백 기록한다(직전 실행의 status 누락 22건 해소).
- 실버그 수정: `/kakao-playground`가 390px에서 가로 오버플로(고정 380px 그리드) — `minmax(0,380px)`로 수정하고 전 뷰포트 통과를 확인했다.
- 동적 `:token`·결제·본인확인 경로는 fixture 대체 불가로 스킵 명단에 있다(12경로).
- 스크린샷 증거: `screens/`에 대표 경로의 3개 뷰포트 캡처.

미충족: 동적 경로 fixture 전수·원본 화면 대조·Ego 인증 세션의 화면. 체크박스는 유지한다.

### 스킵 동적 경로 보조 스윕 (2026-10-05, `scripts/qa-sweep-dynamic.ts`)

주 스윕에서 제외한 `:token`·결제·외부 콜백 12경로 + 실제 게시 폼을 실제/플러시블 fixture로 방문했다. [dynamic-skipped-sweep.json](dynamic-skipped-sweep.json)에 경로별 상태·오버플로·본문 미리보기를 기록한다.

- 13/13 HTTP 200·오버플로 0. 잘못된 문서 토큰은 "문서를 열 수 없습니다" 오류 페이지, 정보주체 경로는 이메일 인증 요구 화면, 결제 결과 경로는 앱 셸 안에서 정상 렌더링된다.
- `/identification/:result`·`/saeol/fail/:org`는 외부 인증 콜백이라 공급자 미연결 안내/로그인 실패 안내로 종결된다.
- 실제 게시 폼(`/projects/{token}/form`)은 본인인증 섹션·동의·문서 바인딩을 포함해 렌더된다.
