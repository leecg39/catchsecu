# R04-T03 구성원·초대·권한·전문가 화면 완료 검증

2026-10-11 현재 production build와 Ego Lite 로그인 세션에서 `/set/member`, `/set/authority`, `/oauth2/invite/signup`, `/expert/select-company` 및 부가 `/admin/expert-assignments`를 다시 대조했다.

## 결과

- 네 원본 경로와 운영자 부가 경로가 각 전용 컴포넌트에 연결되고 구성원·초대·접근요청·전문가 API를 사용한다.
- 정상·빈 목록·로딩·검증 오류·권한 거부·만료·409 충돌·실패 재시도·새로고침 상태를 현재 소스 계약과 기존 실제 브라우저 흐름으로 확인했다.
- 구성원·초대 목록은 탭, 검색어, 상태, 페이지, 페이지 크기를 URL에 저장한다. 직접 링크와 새로고침에서 복원하고, 서버가 과도한 페이지를 보정하면 URL도 현재 페이지로 바뀐다.
- 전문가 선택과 운영자 배정 목록도 검색·페이지를 URL에 보존한다. 일반 소유자의 운영자 페이지 접근은 `/access-not-allow?reason=admin`으로 차단된다.
- Ego Lite에서 임시 구성원 21명을 더해 총 23명·10개 보기·3페이지를 만들고 2페이지 이동과 새로고침 복원을 확인했다. 임시 데이터를 삭제한 뒤 총 2명·1페이지로 보정되고 URL의 `page=2`가 제거됐으며 임시 사용자는 모두 삭제했다.
- 기존 브라우저 증거의 초대 생성/재발송/수락/취소, 서비스 범위 회수, 정지·제외·재초대, 소유권 왕복, 전문가 배정·만료·재배정·회수, 409 입력 보존과 390/768/1440 폭·모달 키보드 포커스를 다시 연결했다.
- UI/API 계약 회귀 3 suite 13개, TypeScript, 변경 파일 ESLint, 전체 ESLint 오류 0, production build 82페이지가 통과했다. 최종 Ego Lite 콘솔 오류는 0건이다.

## 증거

- [현재 브라우저 URL·페이지 검증](browser-url-state.json)
- [경로 상태 매트릭스](route-state-matrix.json)
- [UI/API 계약 13개](ui-contract-regression.json)
- [품질 게이트](quality-gates.json)
- [기존 전체 브라우저 흐름](../members-flow/README.md)

초대 SSO 선택 화면의 내부 오류·재시도 상태는 연결되어 있지만 Google·Microsoft·기관 SSO의 공식 왕복은 R07 외부 검증 범위다. 이 UI 작업은 외부 공급자 성공을 주장하지 않는다.
