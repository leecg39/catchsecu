# P12-T01 생산 경로와 원자성 대조

2026-10-04. AST 호출 목록은 경로를 찾기 위한 자료이며 시험 통과나 외부 공급자 성공을 대신하지 않는다. 업무 상태와 원장의 저장 경계를 소스로 대조하고 다음 실행 시험·실제 HTTP/화면 증거를 결합한다. DB fixture 변경, migration, lease claim·캐시 같은 내부 조정과 사용자 업무 변경을 구분한다.

| 업무 경계 | 생산 위치 / 같은 DB transaction의 대상 | 실행 근거 |
|---|---|---|
| 가입·이메일 확인·거절/성공 로그인·복구·MFA·로그아웃 | auth-adapter/auth-mutations/auth.ts의 scope transaction; 사용자/Verification/Session/TwoFactor와 event | public-auth 14파일264개, auth-mutations 11파일163개; 실제 signed email/UI/DB/재시작 자료 보존 |
| 비밀번호 변경·재설정·세션 종료 | credential-lock의 app.auth_request_id와 migration77의 record_credential_change; Account/PasswordHistory/DELETE Session 반환 행마다 event | credential-audit 7개+관련75개; 실제 HTTP credential-http.json의 3이벤트가 같은 요청 ID |
| 회사·서비스·프로필·구성원·초대·전문가·선택 | 각 idempotent/transaction 안의 audit; 현재 actor/service lock와 마지막 기한 검사 | company/members/expert/account/context 현재 권한 시험, v27 역할 UI와 선택 DB, 이번 producer-http 기록 |
| 폼·질문·템플릿·승인·게시·고정 URL | forms/templates/approvals/fixed-urls에서 불변 개정·상태와 event | forms/form-module/approvals/fixed-url 실제 DB 시험과 경합 자료 |
| 문서·수집 목적·제공/수탁자·표시·재위탁 | documents/processing-catalog/subprocessors의 업무 변경과 audit | documents/processing-catalog/subprocessors 현재 권한 시험과 기존 실제 화면 자료 |
| 공개 접수·동의·수신동의·응답 열람/정정 | submissions/submission-management/marketing의 암호화 응답·preferences/events와 audit | 공개 marketing 2개 신규: 두 채널 grant/reconsent 같은 HTTP ID 및 감사 실패 전체 롤백; 실제 v31 광고 동의 화면/DB |
| 파일·영수증·PDF·지원 첨부 다운로드 | file-bindings/files/file-download/consent-receipts/document-pdf/notice-attachments/guides: bytes 준비·현재 권한·deadline과 audit | download-audit 12개+실제 ClamAV 포함 관련27개; scanner 생략 결과는 별도 이전 기록 |
| 가져오기·응답 내보내기·민감 문의·파기 | imports/import-worker/exports/support-tickets/destruction/destruction-worker 상태 및 이벤트, 실패 시 같은 rollback | imports/export/destruction/support-ticket 시험; 기존 삭제·암호화 증거, 불변 증명서 자료 |
| 이메일 작업·캠페인 전송 결과 | jobs/campaign-worker: Job/JobAttempt/recipient/delivery/campaign과 event; SMTP accepted와 local_delivered 구분 | mail-job-audit 10개+audit-events 7개; campaign 감사 fault와 다중 worker; 실제 로컬 mail-receipt.json |
| 메신저 알림 결과·취소·lease 복구 | notification-worker/notifications: sending intent·최종 상태·NotificationAttempt와 event; 외부 불확실은 unknown | system-producer-audit fault/복구 시험 및 기존 notifications의 실제 로컬 파일·2worker·불확실 응답 시험 |
| 결제 결과·원장·체험 만료·카카오 심사 결과 | payments/ledger/subscription-worker/kakao: signed webhook HTTP ID 또는 시스템 작업 ID; 업무 상태·이력·잔고와 event | system-producer-audit의 실제 DB fault/중복/서명/rollback 및 기존 payment-orders/kakao-templates/ledger/subscriptions 시험 |
| 정책·IP·MFA 정책/예외·발신자·캠페인/알림 설정 | security-policy/ip-access/mfa-policy/senders/campaigns/message-templates/notifications/verification | 해당 서비스 현재 권한·회수·최종 기한·감사 시험; 종류 prefix 보완과 authority/mail 실제 UI |
| 감사 조회·CSV·본인 활동·통계·월마감 | audit-events/analytics/compliance-close/compliance-exports: 안전 DTO/건수와 audit 한 snapshot transaction | audit-current-authority/audit-events/account-current-authority; 기존 P12-T03 자료, 10개 CSV 독립 DB 대조 |

감사 helper는 필드명·고정 enum·건수만 저장한다. 외부 공급자 메시지·주소·원문·토큰은 event detail에 복사하지 않는다. DB의 audit_immutable 트리거와 시험의 UPDATE/DELETE 차단을 유지한다. 일반 앱에는 원장 생성·수정·삭제 API가 없다.

외부 전달과 DB commit 사이에 분산 transaction은 없다. 이번 검증은 로컬 전달/서명 fixture/불확실 상태/DB 원자성을 구분하며 SMTP·PG·카카오·Slack/Teams의 실제 공급자 수용 또는 외부 효과의 exactly-once를 주장하지 않는다. 해당 공급자 기능과 운영 보존·백업/복원·성능·전 경로 staging은 원래 P08/P09/P10/P12-T04/P14 Task에서 추적한다.
