# SSO 공급자 회사 문맥과 입력 복구

2026-10-10 로컬 수용 체크포인트. 전체 인증 경로/외부 IdP 수용을 의미하지 않는다.

## 수정한 동작

다른 탭에서 회사 A→B로 전환한 상태에서 A의 등록 폼을 저장하면, 화면에 고정된 tenantId를 서버의 현재 회사와 대조해 403 COMPANY_CHANGED로 거절한다. 필수 tenantId 누락은 422다. 잘못된 회사에 공급자/감사/재요청 캐시를 생성하지 않으며 처리 중 회사가 변경돼도 실제 데이터 트랜잭션에서 재검증한다. 수정은 tenantId와 공급자 ID의 회사 소속을 모두 확인한다.

조회 응답도 tenantId를 반환한다. 헤더 회사와 응답 회사가 다르면 다른 회사 목록/편집을 표시하지 않고 회사와 목록을 함께 새로고침하도록 안내한다. 충돌 후 최신값을 불러오기 전에 이름·시크릿·인증서 입력 폐기를 확인한다. 취소하면 입력을 유지하고, 승인하면 버전이 그대로인 잠금 충돌에서도 폼을 실제로 초기화한다. 목록 요청 처리 중 메뉴 이탈에도 처리 결과가 아직 확정되지 않았음을 알린다.

브라우저에서 충돌 입력의 복사를 안내하면서 disabled 필드가 키보드 초점을 거절하는 문제를 추가로 발견했다. 보존할 입력은 readOnly로 전환하고 저장/프로토콜 변경을 막으며, 실제 요청 처리 중에만 fieldset을 비활성화했다.

## 서버 검증

- [수정 전 실패](before.json): 회사 응답/필수 입력/다른 회사 생성/재요청/수정 5개를 실제 PostgreSQL 시험으로 재현했다.
- [최종 회귀](regression.json): 7파일 247개 통과, 실패/보류 0. SSO OIDC·SAML·가상기관·CRUD·권한·계약을 포함한다. 이후 변경은 위 UI readOnly 속성뿐이며 서버 회귀 247개를 중복 합산하지 않는다.
- [실제 production HTTP](http.json): 새 fixture로 23개 통과. 회사 A 공급자12/B 공급자1, A 입력의 B 생성/수정 거절 및 감사 수 보존을 확인했다. 소유자 이메일 확인과 회사 생성은 명시적인 DB 시험 준비다.
- [타입](typecheck-final.log), [린트](lint.log), [QA 린트](lint-qa.log), [생성 계약](openapi-final.log), [초기 production 빌드](build-final.log) 통과. readOnly 후속 빌드/린트/브라우저 결과는 아래 후속 항목에서 별도 기록한다.

## Ego 실제 조작

공간2의 p1/p2를 사용했다. 회사 변경은 p2의 실제 회사 선택 버튼을 사용했으며 p1의 입력을 유지했다.

- [두 탭 회사 전환](browser-company-change.json): 오래된 A 등록을 거절하고 입력/저장 차단을 확인했다. [화면](company-change.png).
- [조회 문맥 불일치](browser-list-context.json): A 헤더에 B 목록을 표시하지 않았다. B 조회는 기존1개로 새 생성이 없었다. [화면](list-context.png).
- [버전 충돌](browser-version-conflict.json): 별도 HTTP 세션이 먼저 version1→2를 수정하고 UI 저장을 거절했다. 최신 불러오기 취소는 입력·시크릿을 유지, 승인은 최신 이름·빈 시크릿·비활성 저장으로 복구했다.
- [동일 버전 잠금 충돌](browser-same-version.json): 새 QA 회사 행에만 실제 DB 잠금을 걸어 요청을 충돌시켰다. 서버 version2가 그대로여도 최신 불러오기가 폼과 dirty 상태를 초기화했다.
- [처리 중 이탈](browser-busy.json): 실제 사전검사 요청을 DB 잠금으로 지연시키고 대시보드 링크를 눌렀다. [확인창](busy-guard.txt)에서 계속 편집을 선택하면 같은 화면을 유지했고 잠금 해제 후 실제 성공했다.
- [검색·정렬·페이지](browser-list-controls.json): 이름순10/2행, 두 번째 페이지, 없는 검색어/빈 결과와 1쪽 복귀를 확인했다.
- [키보드 초점 최초 실패](copy-focus-before.json)는 보존한다. 다른 브라우저 테스트를 이 실패의 해소 근거로 대신하지 않는다.

## 제한 및 보존

원본18개 인증+2개 정책 화면 전수, 모바일/키보드 전체 수용, 표의 긴 URL 줄바꿈/행 높이, SPA history Back/Forward 이탈 보호는 E5에 남는다. 후속 [E3](../https-flow/README.md)에서 실제 HTTPS 브라우저·재시작 검증과 임시 CA 정리를 완료했다.

최초 prepare는 완료됐으므로 재실행하지 않는다. `.local/rea-fullstack/sso/provider-context/fixture.json`의 전용 자격증명은 비공개로 유지한다. freeze 이후 변경 모드는 금지하고 verify/restart만 사용한다. 이전 E1/E2 동결 fixture는 변경하지 않는다.

## 시행 오류

`openapi.log`는 환경 변수 없이 실행한 최초 실패, `build.log`는 Node --env-file의 Next worker 상속 오류다. `typecheck-first.log`의 이전 QA User where 필드 오류를 수정했다. `build-copy.log`는 로컬 메일 허용 플래그 누락으로 정상 운영 가드가 거절한 실행이다. 이 결과를 성공으로 집계하지 않는다. Ego 사전검사의 최초 text 선택자는 표 헤더와 중복돼 요청을 발송하지 않았고, 관측된 button 역할로 좁혀 실제 시나리오를 실행했다.

## readOnly 보완과 재시작 최종 결과

[최종 빌드](build-copy-final.log)·[린트](lint-copy.log) 통과. `.next-rea-sso-context-copy`에서 [실제 키보드 초점/전체 선택](browser-copy-fixed.json)과 [화면](copy-focus-fixed.png)을 확인했다. 입력은 읽기 전용으로 보존되고 타이핑은 값을 바꾸지 않는다. 최신값 불러오기 취소는 입력을 유지하고 승인 시 동일 버전에서도 시크릿을 비우며 저장 버튼이 비활성화된다. 후속 [E5 레이아웃 보완](../provider-layout/README.md)에서 설명의 음수 여백과 긴 URL 행 높이를 수정하고 세 폭에서 확인했다.

[동결](freeze.json) 후 production 서버를 새 프로세스로 재시작했다. [HTTP와 관계행 해시](restart.json), [Ego 새로고침](browser-restart.json)을 통과했다. 공급자13·감사27·세션2의 해시는 `03a81972c780cd428790b2c3b5c5979edc07cff34e57a32ffc329792b9d09997`이다. E1 `cc4e04b8…`/E2 `3965f075…` 이전 동결 해시도 읽기 전용 재검사에서 보존됐다. 마지막 재시작 이후 이 fixture에는 조회만 허용한다.
