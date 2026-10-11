# R22-T04 감사로그·활동 검토 수용검증

2026-10-11 현재 격리 test PostgreSQL, production 서버, 작업 처리기와 Ego Lite에서 로컬 수용을 실행했다. 실제 SMTP 받은편지함 영수증은 없어 외부 검증은 `external_pending`으로 유지한다.

- 9종 로그의 목록·CSV 동일 행, KST 날짜 경계, 동일 시각 21행의 3페이지 무중복, 감사·검토 PATCH/DELETE 405를 HTTP로 확인했다.
- owner·privacy·viewer·미인증과 A/B 회사 격리, 제한 역할의 처리자·대상 식별자 마스킹을 확인했다.
- 실제 검토 사건과 암호화 메시지, 구성원, 서비스, 대표 감사 사건 9건의 지문 `dda8101b5f424d73024c23bc9eeede702eda0c3933515459c43b2614a8a54667`은 서버와 worker 재시작 전후 동일했다.
- Ego Lite 저장 세션과 fresh 로그인을 확인했다. 재시작 전 14개, 재시작 후 16개 화면 상태와 각 6개 반응형 조합이 통과했다.
- R22 관련 실제 생산자·서버·UI 16파일 313개, TypeScript, 변경 파일 ESLint, production build 83페이지가 통과했다.

## 외부 대기

검토 알림의 로컬 메일 outbox·전달 계약은 시험했지만 실제 SMTP 받은편지함 수신 영수증은 없다. 외부 SMTP 증거를 확보할 때까지 R22-T04는 `in_progress / external_pending`으로 유지한다.

## 증거

- [재시작 전 HTTP·DB](current/api-before-restart.json)
- [재시작 후 동일 지문](current/api-after-restart.json)
- [재시작 전 Ego](current/browser-before-restart.json)
- [재시작 후 Ego](current/browser-after-restart.json)
- [worker 재기동](current/worker-restart.log)
- [품질 게이트](current/quality-gates.json)
- [외부 대기 목록](current/external-pending.json)
