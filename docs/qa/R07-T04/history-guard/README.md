# 브라우저 뒤로·앞으로 이동의 미저장 입력 보호

2026-10-10 E5 부분 수용. 실제 Ego 공간2/p1에서 공급자 등록 이름을 입력하고 브라우저 기록의 이전 페이지로 이동했을 때 확인 없이 폼이 사라지는 문제를 [수정 전](before.json)에 재현했다.

공통 NavigationGuard에 같은 문서 내 history 이동을 연결했다. 이동 전에 기존 확인창을 열고 취소하면 URL·입력·편집창을 유지한다. 승인하면 원래 목적지의 history 항목으로 한 번 이동한다. 새 이동, 컴포넌트 해제, 사라진 history 항목 뒤에 도착한 예전 승인은 실행하지 않는다. Next.js가 관리하는 history.state를 덮어쓰거나 더미 항목을 추가하지 않는다.

- [단위 10개](tests.json): 뒤/앞 취소, 단일 승인과 다음 이동 재확인, 일반 이동 제외, 오래된 승인·해제·항목 삭제·브라우저 탈출·이동 실패를 검사했다.
- [실제 Ego](browser.json): 뒤로 확인/Escape/초점 복구/승인, 변경 없는 앞으로 이동, 입력 중 앞으로 취소/승인을 확인했다. 두 버튼 사이 Tab 순환과 실제 history 길이/위치도 기록했다. [화면](back-confirm.png).
- [390px 확인창](mobile.json): 문구·두 버튼이 화면 안에 있고 취소 후 이름과 초점이 유지됐다. [화면](mobile-confirm.png). 두 스크린샷을 직접 확인했다.
- [새 production 빌드](build.log) 및 [변경 린트](lint.log) 통과. `.next-rea-history-guard`를 새 서버 프로세스로 실행했다. 서버/DB 업무 변경은 없다. [E4 독립 DB 해시](../provider-context/verify.json)는 공급자13·감사27·세션2 및 `03a81972…`를 유지했다.

## 범위와 시행 오류

Navigation API를 제공하는 현재 Ego Chromium152에서 같은 문서의 취소 가능한 history 이동을 검증했다. API가 없는 이전 브라우저의 SPA history 보호는 이 변경의 지원 범위가 아니다. 다른 문서/새로고침에는 기존 beforeunload 코드가 남아 있다. [새로고침 관측](reload-observation.json)에서는 도구에 native dialog가 노출되지 않아 네이티브 취소 동작을 통과로 집계하지 않는다. 브라우저가 취소 불가로 지정한 반복 탈출을 강제로 막지 않는다. 공식 [HTML Standard](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-navigate-event)와 설치된 Next Link/useRouter 문서를 참고했다.

최초 증거 저장은 Ego Node의 상대경로가 다른 디렉터리를 가리켜 실패했다. 같은 결과 화면을 다시 관측해 절대경로로 저장했고 재현을 반복하지 않았다. 최초 확인창 대기는 이름 없는 role 선택자가 거절됐으며 이미 열린 확인창을 관측한 뒤 계속했다. 브라우저 보고서의 body 초점은 자식 스크립트 전체 텍스트를 제거해 `document body (descendant text omitted)`로 요약했다.

원본 인증20경로의 전체 상태·오류/409의 모든 폭·초대/MFA 전수 수용은 별도 잔여다. 전체 E5/R07/107작업 완료로 표시하지 않는다.
