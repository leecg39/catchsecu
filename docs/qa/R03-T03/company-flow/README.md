# 회사 화면 실제 조작 기록

2026-10-10. Ego Lite 공간3의 로컬 앱에서 합성 회사 `7d2f5f95-3493-4a30-8dcd-65220489d65e`를 생성했다. 원본 서비스 운영 데이터에 쓰지 않았다.

- 회사 등록의 9개 필드 입력→등록→회사/기본 서비스 자동 선택·조회. `created.json`.
- 편집 중 별도 API 수정→409, 미저장 입력 유지→최신 불러오기 취소/확정→다시 저장. `concurrent.json`, `conflict.json`, `conflict-recovery.json`.
- 합성 PDF 첨부→실제 다운로드의1426바이트 일치→두 번째 PDF로 교체→첨부 삭제. `uploaded.json`, `download.json`, `replaced.json`, `deleted-file.json`과 PDF 원본/다운로드를 보존했다. 실제 사업자등록증이 아닌 시험 문서다.
- 잘못된 회사명으로 폐쇄 요청 거부·사유 입력 유지→정확한 회사명으로 접수→요청 취소. `closure-validation.json`, `closure-requested.json`, `final.json`. 회사는 최종 active·version8이며 폐쇄 요청과 첨부는 없다.
- 새로고침과 새 서버 프로세스에서 회사 정보·삭제 상태를 확인했다. `reload.json`. 독립 DB·재로그인 HTTP 결과는 R03-T04에서 별도 기록한다.
- 390폭에서 회사 선택 버튼이 있는 상단 메뉴가12px 넘치는 문제를 재현했다. `company-390-before.png`, `responsive-before.json`. 수정 후390/768/1440폭에서 문서 가로 넘침이 없고390폭 스크린샷의 메뉴와 컨트롤을 확인했다. `responsive.json`, `company-390.png`.
- 서비스 초안을 편집하던 중 회사 선택 버튼으로 전환하면 확인 없이 입력이 사라졌다. `context-guard-before.json`. 공통 입력 보호 적용 후 전환 취소는 입력·회사 선택을 유지하고, 확인한 전환 성공은 대시보드에 선택 회사를 반영했다. `context-guard-after.json`. 실패 시 보호 유지도 구현했으며 별도 실패 주입 브라우저 시험은 아직 하지 않았다.

완료로 집계하지 않은 범위: 최초 계정부터의 온보딩 전 과정, 서비스 접근요청의 모든 역할·거절/취소·실패 상태, 원본 유료 화면 동등성.
