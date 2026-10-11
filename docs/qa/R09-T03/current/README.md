# 고정URL 목록 상태 복원

R09-T03의 목록 하위 범위 검증 기록이다. 승인·게시·공유 단계와 전체 수용을 완료한 것으로 집계하지 않는다.

Ego Lite에서 URL명을 검색하고 `사용 종료` 상태를 선택한 뒤 새로고침하면 검색어가 사라지고 기본 `사용 중`으로 돌아가는 결함을 재현했다. [수정 전 기록](list-before.json).

`FixedUrls`의 검색 q·상태·페이지·페이지 크기를 URL에 연결했다. 뒤로/앞으로 이동할 때 검색 입력도 복원하고, 서버에서 페이지를 보정하면 같은 필터를 유지하면서 URL을 교체한다. 검색은100자·페이지 상한100,000·페이지 크기10/20/50/100으로 제한한다. 좁은 화면은 폼 목록과 동일한 제목 줄바꿈 규칙을 사용한다.

[회귀6개](ui-tests.json)는 URL 직접 진입·잘못된 값·기존 편집 dirty/충돌 상태를 검사한다. 새로 만든 별도 시험 폼과 고정URL12개의 C/R/D 요청은 실제 API를 거쳤고 [준비 DB](database-prepare.json)는 사용11·종료1·감사15건을 확인한다. 기존 R08 목록 폼과 템플릿을 변경하지 않았다.

재현: Node24, `BETTER_AUTH_URL=http://localhost:3121`, `.env.local`에서 `scripts/qa-r09-list.ts prepare` → Ego에서 마지막 페이지의 시험 주소01 사용 종료 → `after` → 서버 재시작 → `restart`. 준비 명령은 fixture ID를 보관하며 기존 행을 재생성하지 않는다. 이미 사용 종료 검증을 했다면 `prepare` 대신 상태 검증을 사용한다.

초기 build는 Next worker가 Node `--env-file` 실행인자를 거부했다. [실패 로그](build-initial-failure.log)를 보존하고 Next 자체 `.env.local` 로더를 사용하는 명령으로 수정했다. 최종 빌드는83페이지를 성공적으로 생성했다.

두 번째 build는 로컬 공급자 허용 환경값을 빠뜨려 운영 가드에서 중단됐다. [가드 로그](build-local-adapter-guard.log)를 보존한다. 제품 가드는 변경하지 않고 기존 QA의 ALLOW_LOCAL_MAIL/ALLOW_LOCAL_PAYMENT/ALLOW_LOCAL_KAKAO=1 설정으로 다시 실행했다.


## 최종 검증

- [목록 복원](list-after.json): 직접 URL의 검색·두 번째 페이지·10행 크기가 새로고침 후 유지되고, 빈 검색 후 뒤로가기로 입력과 목록이 함께 복원된다.
- [사용 종료](revoke-browser.json): 취소는 주소01을 보존한다. 확정은 사용 목록11개에서10개로 바뀌며 페이지2→1을 URL에도 반영한다. 종료 목록2개·검색·크기는 새로고침 후 유지된다.
- [3개 화면 폭](responsive.json):390·768·1440px의 가로 넘침0·제목 높이36px. [390px 스크린샷](fixed-url-390.png)을 직접 확인했다.
- [DB 재시작](database-restart.json): 주소12개 중 사용10/종료2·게시 폼·업무감사16건의 SHA256 `56c26f0e9a3934466b4de7e4840ec16c3f1a2232c675cea197e3145ba7a16882`가 재시작 전후 같다.
- [브라우저 재시작](browser-after-restart.json): 기존 로그인으로 context200·종료 필터·검색·2행을 복원했다.
- [품질 검사](quality-gates.json): 화면/편집6시험, 타입·린트 오류0, 최종production83페이지 통과. 실패한 초기 빌드는 성공 집계에서 제외했다.

R09 전체 승인·게시 화면 조합, 현재 권한/라이선스 통합 수용은 별도 남은 작업이다. 목록 검증만으로 R09-T01/T02/T04를 완료 처리하지 않는다.

## 승인 내역 목록 복원

`/log/form-approval`의 검색·상태·페이지·페이지 크기가 컴포넌트 메모리에만 있어 새로고침과 뒤로가기에서 유실되는 결함을 발견했다. 고정URL 목록과 같은 URL 계약으로 연결하고, 서버가 범위 밖 페이지를 보정하면 검색·상태를 유지한 채 URL을 `replace`한다.

- [화면 회귀9개](approval-ui-tests.json): 독립 승인 목록과 폼 내부 승인 내역의 직접 URL 복원·잘못된 값 정규화·페이지 상한, 요청·검토 입력 dirty/경합 보존을 검사했다.
- [API 시험 자료](approval-list-fixture.json): 별도 회사의 폼12개와 승인12건을 실제 API로 만들고 대기·반려·승인·게시완료를 각 3건으로 구성했다.
- [Ego 복원](approval-list-after.json): 12건의 2페이지 직접 진입→새로고침, 빈 검색→뒤로가기, 반려3건 필터→새로고침을 확인했다.
- [3개 화면 폭](approval-responsive.json): 390·768·1440px 가로 넘침00·제목 높이36px. [390px 화면](approval-log-390.png)을 직접 확인했다.
- [DB 재시작](approval-database-restart.json): 폼12·승인12·게시본3·업무감사36의 지문 `00f2dc6573efcd51c7f6d197229b7e934ba65b93a83a0eed997cb329db4e890a`가 재시작 전후 같다.
- [브라우저 재시작](approval-browser-after-restart.json): 기존 세션으로 context200·반려 필터·검색·3행을 복원했다. 검증 후 브라우저 context는 기존 R07 QA 회사로 복귀했다.
- [폼 내부 승인 이력](approval-panel-browser.json): 설정 화면의 `approvalPageSize=20` 직접 진입·새로고침·기본10 전환·뒤로가기20 복원과 범위 밖 페이지의 서버 보정1을 확인했다.
- [폼 내부 승인 3개 화면 폭](approval-panel-responsive.json): 390·768·1440px에서 제목·승인 패널·선택값20을 표시하고 가로 넘침0을 확인했다. 검증 후 viewport와 회사 context를 복원했다.

[R09 모델 대조](../../R09-T01/current/README.md)에서 dev/test 5모델·73열·33제약·20인덱스·8트리거와 8파일·14suite·96개 서버 회귀를 별도로 확인했다. [최종 품질 요약](quality-gates.json)은 승인 목록 복원 후 production83페이지·타입·린트 오류0을 기록한다.
