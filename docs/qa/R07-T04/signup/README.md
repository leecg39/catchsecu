# OIDC 신규 가입 동의 수용 검증

실제 로컬 RSA/JWKS·PKCE 시험 IdP와 개발 DB, Ego Lite TaskSpace2/p5에서 확인했다. 공식 제공사 인증 성공을 뜻하지 않는다.

| 경계 | 실행 증거 |
|---|---|
| 동의 전 사용자·계정·영수증0, 동의 후1 | `browser-before-database.json`, `browser-database.json` |
| HTTP 신규/초대 가입·role/grant·누락 동의422·재전송410 | `http.json` 14검사 |
| 읽기 전용 신원·키보드·전체 동의·초기 제출 차단 | `browser-pending.json`, `signup-390.png` |
| 390/768/1440px 가로 넘침0 | `browser-pending.json` |
| 새로고침 후 동일 신원 복원·체크 초기화 | `browser-reload.json` |
| 네트워크 오류 후 체크 유지·재시도 성공 | `browser-network-error.json`, `browser-success.json` |
| 재로그인 시 동의 단계 생략·현재 서비스 권한 유지 | `browser-relogin.json` |
| 취소 후 요청 삭제/사용자0·위조 data/enc 직접 진입 거부 | `browser-cancel-and-invalid.json`, `cancel-database.json` |
| 실제 화면 만료 타이머·API410·사용자0 | `browser-expiry.json`, `expired-database.json` |
| 동의 시각으로 최근 인증 시각 갱신하지 않음 | `browser-proof-time.json`, 최종 가입30시험 |
| 서버 재시작 후 기존 세션/사업 데이터 보존·대기 요청1회 수락 | `after-restart.json` 4검사, `browser-after-restart.json` |
| 격리 test DB의 실제 worker 두 번 기동·정상종료·만료3개 삭제·유효 요청 보존 | `worker-restart.json` |

`http.json`의14검사는 최종 인증시각 보완 전에 실행했다. 보완 후 브라우저 인증시각·재로그인·재시작과 실제 PostgreSQL175시험을 다시 확인했다. 관련 회귀의 중복 제외 전체 집계는 [16파일471시험](../../R07-T02/current/signup-verification-summary.json)이다.

첫 과부하 개발 서버 요청은15초 트랜잭션 제한으로 실패했고 사용자/계정/영수증0·대기 요청1을 유지했다. `timeout-rollback-database.json`과 `environment-notes.md`에 개발 서버 부팅 문제, 컴파일 지연, 복구 과정을 기록했다. 초기 worker 검증 스크립트의 enum/필수 URL fixture 오류를 DB 제약에 맞춰 수정한 뒤 실제 worker 검증을 통과했다. 기존 test의 로컬 인증메일만 허용하며 외부 SMTP는 사용하지 않았다.

회사 표시명은 초대 회사이며 회사 생성 입력이 아니다. 원본 외부 `data`/`enc`를 신원으로 신뢰하지 않는다. 일반 이메일 가입은 별도 흐름을 유지한다. 새 가입자는 서비스 권한이 없으므로 `/service/none`에 도착하며 `/me`에서 로그인 신원을 확인했다.

외부 Google/Microsoft/GPKI/새올 수신, native beforeunload 취소, 전체 도메인 조합 검증은 별도 잔여다. 과거 HTTPS 증거와 동결 fixture는 보존했고 시험 CA를 다시 설치하지 않았다.

최종 production83페이지 빌드의 기존 세션200과 서비스 접근 제한을 [배포 모드 브라우저](production-browser.json)에서도 확인했다.
