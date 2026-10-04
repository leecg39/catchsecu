# P12-T01 감사 이벤트 수집·조회 — 완료

2026-10-04. TASKS.md의 업무 변경/민감 열람/발송/권한/인증/파기 기록, 원자성, 원장 U/D 차단, 역할·회사·필드 격리와 종류별 안전 조회의 수용 조건을 검증했다. P12-T01만 완료로 갱신하며 공식 상태는 완료17/72·진행40·계획15다. 후속 Task는 시작하지 않는다.

## 변경과 생산 경계

- 비밀번호 변경/재설정·세션 종료를 동일 transaction과 HTTP 요청 ID에 연결했다. migration77은 실제 DELETE 반환 행마다 종료를 기록한다. [신규7개와 관련75개](../revalidation/credential-audit/README.md).
- 공지 첨부/가이드 다운로드의 실제 바이트 준비·현재 권한·최종 기한·감사를 원자 처리했다. [실제 ClamAV를 사용한 신규12개와 관련27개](../revalidation/downloads/README.md).
- 이메일/캠페인의 전송·수신거부·실패·receipt 재처리·lease 소진 결과와 업무/시도 상태를 함께 기록한다. worker의 회사 미지정 인증 메일도 tenantId+정확한 jobId로 제한한다. [mail10개·종류7개와 이전239개](../revalidation/mail-outcomes/README.md).
- 공개 수신동의/재동의를 접수와 같은 요청 ID로 감사한다. 두 채널의 실제 DB 저장과 감사 fault 시 접수/응답/동의/횟수 전체 롤백을 검사했다. 공유 관리자가 이메일을 읽는 목록·상세·멱등 재요청 응답에도 현재 권한/기한과 안전한 열람 감사를 연결했다.
- 메신저 알림의 보내기 시작·결과·취소·lease 복구, 결제 결과/원장/체험 만료/카카오 심사 결과의 누락을 보완했다. 서명 수신의 HTTP 요청 ID 또는 내부 작업/원장/상관 ID와 NULL 시스템 actor를 사용한다. 신규8개가 중복 수신·업무/시도/잔고 롤백·원문 비기록을 검사한다.
- [생산 경로/transaction/실행 근거 표](producer-matrix.md), [AST 목록](event-producers.json)은 별도 대조 자료다. v34에서 고정한 소스239파일에서236호출/69파일, root-client AuditEvent 쓰기0을 확인했다. 호출의 존재 자체를 누락 없음이나 실행 통과로 해석하지 않는다.

## 실행 결과와 범위

[전체 회귀](tests-full.log)는84파일1247개 중1246개 통과, 폼 승인2요청의 잠금 대기를2초 안에 관측하지 못한1개 실패였다(종료코드1,1883.97초). 이 결과를 전체 통과로 바꾸지 않았다. 다른 작업의 코드 변경이 들어온 공유 폴더에서 실행했으며 최종 검증은 dede388 기준의 별도 checkout에 이번16개 파일 변경만 복사해 고정했다.

[고정 소스의 관련 검사](tests-completion.log)에서 기존 실패했던 폼 경합6개를 포함한11파일103개가 통과했다. 최초 실행은 의존성 복사 중 Next 모듈이 없던 marketing suite, 빈 알림 endpoint fixture2개로 실패했다. 알림 fixture를 올바른 암호화 endpoint로 고쳤고 marketing의 Next 실험용 테스트 모듈이 오류를 표시할 때 필요한 Node AsyncLocalStorage를 hoisted 초기화했다. Next에 설치된 node-environment-baseline과 같은 실제 Node 구현을 사용한다. [부분 진단](tests-public-consent-runtime.log)의49개 skip은 선택 실행이며 완료 근거로 세지 않았다. [최종 관련2파일59개 전체 실행](tests-producers-all-final.log)이 모두 통과했다. 따라서 최종 변경 범위에 관련된13파일162개 고유 시험은 모두 통과했고 마지막 실행은 skip0이다. 초기 실패 기록은 보존했다.

[고정 소스 production v34 빌드](build-isolated-final.log), [타입](typecheck-tests-final.log), [제품/시험 린트](lint-isolated.log)와 [최종 시험 린트](lint-tests-complete.log), [289 API/418 operation/38정책 계약](contracts-final.log), [181 경로/72 Task/의존성 검사](plan-final.log)를 통과했다. 계약·경로 검사는181개 CRUD 전체 E2E 성공을 뜻하지 않는다. 이후 다른 작업의 일별 수집·파기 집계 커밋176296d를 보존해 checkout 기준을 올렸으며 [통합 v35 빌드](build-latest-base.log)도 검증했다. 해당 집계의 브라우저 대기 조건은 이번 P12-T01 완료로 바꾸지 않는다.

## 실제 화면·CSV·독립 DB·재시작

Ego Lite45/p1에서 `/log/service`, `/log/info-monitoring`, `/log/ad-monitoring`, `/log/customer`, `/log/member`, `/log/authority`, `/log/external-viewer`, `/log/access-history`, `/log/mail`, `/my-page/activity-log`의 실제 이벤트·검색·CSV 다운로드·빈 결과·초기화를 수행했다. 각 화면의 `*-ui.json`, CSV, desktop/mobile PNG를 남겼다. 1440px과390px에서 페이지 넘침 없이 표 내부 스크롤을 확인했다. 서비스 변경12개는2페이지2행도 확인했다. 비밀번호 변경으로 종료된 브라우저 세션의 로그인 이동→실제 재로그인→회사 선택을 검증했다. [복구/페이지](error-recovery-pagination.json).

v30은8개 회사 로그와 본인 활동, v31은 보완된 공개 광고 동의 화면의 기록이다. 이번10종류의 화면·DTO 코드는 이 캡처와 같으며 별도 v34 프로세스에서10종류를 다시 HTTP200으로 대조했다. [최종13 HTTP 검사](restart-http.json)는 안전 DTO, PATCH/DELETE405, 익명401도 확인한다. 이전 v27의 owner/privacy 서비스A/B·처리자/ID 마스킹·원장 U/D 차단, v28/v29의 MFA·실제 서명 이메일 인증/복구 UI 증거를 보존했다. [역사113개 파일의 SHA 불일치0](historical-evidence-check.json).

[독립 DB 대조](database-before-restart.json)는 CSV10개의 ID/행 수/시각/처리내용/대상과 목록을 대조했다. 목록의 원장 열람1건 및 필터/건수에 맞는 CSV 감사도 확인했다. 재로그인 뒤 새 선택 이벤트가 생겼으므로 각 CSV를 해당 조회 시각의 DB 원장과 비교했다. 본인 활동의 회사 생성2개는 본인 사용자 범위이며 회사 로그는 지정 합성 회사 범위다.

비밀번호 HTTP 요청은 세션 종료1·password.changed1·새 세션1의 동일 요청 ID를 확인했다. [실제3이벤트](credential-http.json). 공개 동의 HTTP 요청의 submission.created와 marketing.granted도 같은 요청 ID다. [요청](marketing-http.json). 지정 초대 메일만 실제 로컬 작업으로 처리해 Job/시도/원장/파일을 확인했다. [작업](mail-receipt.json). 전역 worker와 외부 발송은 실행하지 않았다.

v34를 새 프로세스로 시작하고 health200을 확인한 뒤 [DB 재조회](database-after-restart.json)로 선택한 감사120행·서비스version·회원·세션 선택 상태의 해시 `f6b80cf69d5683f0dfd384675c89797094104a48f3ea3c1508f4c8d584022e06`가 동일함을 확인했다. 이후10종류 HTTP 재조회로 새 열람 이벤트가 추가되는 것은 정상 동작이다. 과거 v29 사용자에게 이번 로그인/회사/비밀번호 활동을 추가했으므로 과거 사용자 전체 상태 해시가 지금도 같다고 주장하지 않는다.

## 실패 이력과 다른 Task의 남은 조건

최초 회사 등록 UI 요청은 TypeError500이었고 원인은 확정하지 못했다. 그 실패로 회사는 생성되지 않았다. 이번 합성 회사는 실제 HTTP201로 생성했으며 UI로 등록했다고 표시하지 않았다. [설정](company-setup.json). 회사 등록 전체 UI 수용은 P03의 미완료 게이트다. 잘못된 context 경로의404와 share fixture의422를 제품 정상 성공으로 세지 않았다.

v35 첫 빌드는 Node의 --env-file 옵션을 Next worker가 NODE_OPTIONS로 전달해 실패했다. Next 자체 .env.local 로딩으로 바꾼 최종 명령에서 빌드가 통과했다. [최초 기록](build-latest-base-attempt1.log).

로컬 preview의 ALLOW_LOCAL_MAIL 누락, checkout 밖 node_modules symlink의 Turbopack 제한, 빌드 완료 전 서버 시작 실패는 각각 확인 후 올바른 로컬 opt-in·독립 의존성 복사·빌드 성공 뒤 새 서버로 검증했다. 최초 DB after-restart-attempt1은 서버 준비 실패 때의 독립 조회여서 재시작 성공 근거로 사용하지 않고 최종 파일을 따로 남겼다.

감사 DTO는 원장에 없는 접속 IP/고객번호/사유를 `-`로 표시하며 값을 만들어내지 않는다. 로컬 전달·서명된 공급자 fixture는 SMTP·PG·카카오·Slack/Teams 실제 공급자 수용 증거가 아니다. 외부 전달과 DB commit 사이의 분산 transaction/exactly-once도 주장하지 않는다. 실제 공급자, 일별 집계, 개인정보 활동 검토, 월마감, 보존/백업 복원/성능/전 경로 staging은 원래 P08/P09/P10/P03-T03/P12-T02/T03/T04/P14 Task를 따른다. 전체 목표는 미완료이며 이번 커밋·푸시 후 사용자 요청대로 일시 정지한다.
