# P03-T04 수신자 관리 화면 후속 구현

2026-10-04. 수신자 관리 부분 구현·검증이며 전체 Task 완료가 아니다.

## 구현과 계약

수신자 등록, 이름 검색, 서버 페이지, 선택, 수정·보관·복원을 실제 API에 연결했다. 기존 첫100명 선택 제한을 제거했다. 다른 서비스를 선택하면 해당 서비스의 목록과 빈 선택으로 전환된다. 보관된 수신자는 새 안내 대상이 될 수 없으며 이미 요청한 발송과 과거 이력은 유지된다.

GET `/services/{id}/subprocessors/{subId}`로 현재 수신자 상세·version을 읽는다. 수정409에서는 저장을 막고 최신 정보 재조회 후 재편집할 수 있다. 등록·발송 재시도는 같은 본문에 같은 Idempotency-Key를 유지한다.

발송 POST의 `recipientVersion`은 **필수**다. 선택한 뒤 주소가 바뀌면409로 거부해 보지 못한 주소로 발송하지 않는다. 화면은 제목/본문을 유지하고 최신 수신자 정보를 읽어 주소를 확인한 후 다시 요청한다. 이전 API 클라이언트가 version 없이 호출하면422가 된다. OpenAPI 생성기와 생성 JSON도 갱신했다.

## 검증

- 격리 PostgreSQL의 재위탁8개와 documents/form-documents를 포함한 3파일44개 통과(`recipient-related.log`). 이전41개와 중복되므로 합산하지 않는다. 상세의 회사/서비스/권한 경계, archive→restore와 stale409, 주소 변경 시 Job 추가0, version 누락422, 최신 주소 enqueue, 102명 페이지/검색을 포함한다.
- 최종 `.local/recovery-production-v8` production build+TypeScript 통과(`recipient-build-final.log`), 변경 TS/TSX 7파일 lint통과(`recipient-lint-final.log`), git diff --check 통과. Prisma schema/migration 변경 없음. 전체 저장소 회귀를 이번 범위의 검증으로 주장하지 않는다.
- Ego 공간45/p1, 합성 QA 회사 6d8eed27에서 UI 등록version1→수정2→보관3→복원4. 보관 후 선택과 발송 차단을 확인했다.
- 편집 화면이version4인 동안 별도HTTP PATCH로5를 저장했다. 화면 저장409→버튼disabled→최신값 로드→수정 저장6을 확인했다.
- 선택 화면version6 이후 별도HTTP PATCH로주소/version7 변경. 화면발송409, 제목·본문 유지, DB 신규notice/Job0을 확인했다. 새로고침 후 최신 주소로 요청해 정확히1개의 notice/Job이 등록됐다. 이 Job은queued로 남겼으며 외부 발송은 하지 않았다.
- 페이지 시험용 수신자101명을 별도 합성fixture로 추가했다. 총103명 중 100행 크기의2페이지에서101~103행을 보고103번째를 선택했다. 이름 검색1행, 서비스B 빈목록과 선택 초기화도 확인했다. 해당101명에는 안내를 요청하지 않았다.
- 첫390px 검사에서 관리 도구 모음이 화면을 넘쳤다. 고유 class의 flex-wrap 보완 후 최종390px 폭/scrollWidth390과 모든 도구 버튼의 화면 내 위치를 확인했다. 최종 모바일 및 desktop 캡처를 시각 검사했다. 표의 내부 가로스크롤은 유지한다. 실패 캡처는 보존했다.
- 새 production 프로세스19546→27649에서 화면 재조회와 DB 상태를 확인했다. 수신자103명·notice53건(기존52+신규1)·검증 수신자version7/활성·수신자audit7건·신규Job1queued가 유지됐고 해시가 일치했다. 이전 자체 서버3107/3108은 종료했고 기존 사용자3100은 유지했다.

UI/DB/해시 상세는 `recipient-summary.json`, `recipient-db-before-send.json`, `recipient-db-before-restart.json`, `recipient-db-after-restart.json`, `recipient-browser.json`, `recipient-mobile-final.json`에 있다. 당시 타임아웃/환경누락/모바일 실패는 `recipient-browser-harness-notes.md`에 별도로 구분했다.

## 남은 조건

동의 표시 탭별 입력/복원·URL·문서 참조의 최신 UI, 현재 권한·만료·재요청 경계, 선행 P05-T02/P09-T02와 실제 SMTP 수신, 전체 공통 완료 조건이 남아 있다. 전체 완료15·진행21·계획36을 유지한다.
