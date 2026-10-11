# R08 템플릿 목록 상태 복원

이 목록 상태 복원 하위 범위는 검증 완료했다. R08 전체 화면 수용은 진행 중이다. Ego Lite의 서비스 템플릿 탭에서 검색한 뒤 새로고침하면 기본 공용 탭으로 돌아가고 검색어가 사라지는 결함을 [수정 전 관측](template-list-before.json)으로 확인했다.

탭 scope·보관 status·검색 q·page·pageSize를 URL에서 읽고 변경 시 반영하도록 수정했다. 뒤로/앞으로 이동은 검색 입력도 동기화한다. 잘못된 페이지/크기를 정규화하고 서버가 반환한 보정 페이지를 URL에 반영한다. 공용 탭의 검색 결과가0개여도 검색 입력을 유지한다.

[시험 데이터](template-list-fixture.json)는 별도 QA 회사의 API 생성13개(사용12·보관1)이며, 원래 템플릿을 수정하지 않는다. 실제 빌드/브라우저/DB 결과는 아래 기록을 따른다. 기존 폼으로 생성된 데이터의 독립성과 대표 이미지 pin·409·권한 검증은 이전 template-catalog/template-archive/template-final-internal-acceptance 폴더에 보존한다.

일반 캐치폼 목록에서도 검색어 유실을 [실제 재현](form-list-before.json)했다. q·기간·공개상태·즐겨찾기·정렬·순서·페이지·크기·상세 검색 펼침을 URL로 연결했다. [템플릿 화면/폼 URL 회귀8개](ui-tests.json)가 통과했다. 실제 새 빌드의 브라우저 검증을 통과했다.

실제 배포 모드에서 [템플릿 복원](template-list-after.json), [일반 폼 필터/이력/초기화](form-list-after.json), [삭제 취소·2건 확정과 마지막 페이지 보정](template-delete-browser.json)을 확인했다. DB는 [삭제 전13개](list-before-database.json)에서 [삭제 후11개·감사2건](list-after-database.json)으로 바뀌고 별도 폼version1은 유지했다.

390px 첫 스크린샷은 문서 가로 넘침0이어도 제목이 좁게 세로로 접혔다. `*-before-heading.png`와 `list-responsive-before-heading.json`은 이 결함의 수정 전 기록이다. 두 목록만 감싸는 CSS 범위에서900px 이하 제목·설명·버튼과 날짜 필터 배치를 보완했다. 최종 빌드에서 390·768·1440px 두 화면의 제목 높이36px·문서 가로 넘침 없음을 확인했다. 390px 스크린샷을 직접 확인해 제목 한 줄과 버튼 배치를 검토했다.

재현 순서: Node24와개발DB로 `qa-r08-template-list.ts`(시험 준비), `qa-r08-list-acceptance.ts before`, Ego에서fixture01/02 삭제, `qa-r08-list-acceptance.ts after`, 서버 재시작 뒤 `qa-r08-list-acceptance.ts restart`. 이미 삭제한fixture에 준비 명령을 반복하면13개 단언에서 멈추며 삭제한 레코드를 임의 재생성하지 않는다.

[최종 품질 검사](quality-gates.json): DB26파일348개·화면2파일8개, 타입·린트 오류0(기존 img 경고3개)·production83페이지 통과. [재시작 DB](list-restart-database.json)는 템플릿11개(보관1), 삭제감사2개, 폼version1과 업무감사17개의 동일 해시를 확인했다. [브라우저 재시작](browser-after-restart.json)은 재로그인 없이 검색조건과 폼1행을 확인했다. [모바일 폼](forms-390.png)·[모바일 템플릿](templates-390.png)·[6개 화면 치수](list-responsive.json). 기존 다른 QA 자료는 유지했다.
