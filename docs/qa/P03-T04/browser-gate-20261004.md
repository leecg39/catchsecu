# P03-T04 브라우저 게이트 (2026-10-04)

실제 Chrome(DevTools MCP) + live dev 서버(3100) + `catchsecu_dev` DB로 확인한 대화형 증거.
구현·시험 주장이 아니라 화면 동작과 DB 행을 직접 대조했다.

## 환경
- 서버: `npm run dev` (node --import tsx scripts/server.ts --dev), 포트 3100
- 계정: admin-20261003@catchsecu.local.test (회사 A owner)
- 대상 화면: `/set/service/consent`, `/set/service/consigment/mail`

## 1) /set/service/consent — 동의 표시 설정
- 서비스 선택(기본 서비스/제한 서비스), 수집·이용 동의 탭 / 제3자 제공 동의 탭 분리 렌더
- 표시명 모드 선택자, 동의 안내문 textarea들, 처리방침 링크 모드(없음/게시 문서/외부 링크)
- 외부 링크 선택 시 '외부 처리방침 주소' 필드 노출
- **`javascript:alert(1)` 입력 → 거부**: "사용자 정보가 없는 HTTPS 주소를 입력해주세요."
- **`http://insecure.example.com/privacy` 입력 → 동일 거부** (HTTPS 강제)
- '없음'으로 되돌려 정상 저장

## 2) /set/service/consigment/mail — 재위탁 수신자·발송
- 화면 구성: 메일 발송 이력 토글, 재위탁 서비스 선택, 수신자 관리(검색/등록/새로고침/페이지네이션), 안내 메일 폼
- 수신자 미선택 시 '메일 발송' 버튼 비활성화 — 선택 게이팅 정상
- 수신자 등록(QA 수신자 / qa-recipient-1004@catchsecu.local.test / 변경 내용) → 토스트 "수신자 정보를 저장했습니다.", 목록 1명·상태 활성·선택/수정 버튼
- **DB 대조**: `Subprocessor` 행 생성(serviceId=기본 서비스 20000000-…-0001, version 1, status active) — 이메일은 `emailCipher`/`emailHash` 컬럼으로 암호화·해시 저장
- 수신자 선택 → "선택한 수신자: QA 수신자 · qa-recipient-1004@…" 표시 + '선택한 수신자 새로고침' + 발송 버튼 활성화
- 제목/본문 입력 후 발송 → 토스트 "재위탁 안내를 발송 대기열에 넣었습니다. 같은 내용은 다시 보내지 않습니다."
- **DB 대조**: `SubprocessorNotice` 행 생성(status=queued, jobId 연결) — Outbox 큐잉 확인
- **메일 발송 이력 패널**: 1건(요청일시·수신인·제목·발송상태 '발송 대기'·처리일시 —), 페이지네이션
  - UI 고지: "전송 처리 완료는 메일 작업이 끝난 상태이며 수신함 도착을 확인한 결과는 아닙니다. 로컬 환경에서는 미리보기 파일만 생성됩니다." — **로컬/외부 메일 구분이 화면에 명시됨**
- **중복 발송 차단**: 동일 수신자·동일 제목·동일 본문 재발송 → alert "같은 재위탁 안내는 이미 기록되어 있습니다." (SubprocessorNotice @@unique(tenantId, subprocessorId, contentHash) 경유)
- **서비스 격리**: '제한 서비스'로 전환 → 수신자 0명(QA 수신자는 기본 서비스 스코프)
- **무효 이메일 차단**: 'not-an-email' 등록 → 브라우저 이메일 형식 검증으로 제출 차단 (서버는 Zod 계약으로 재검사)

## 판정
- 수신자 관리·발송·이력·중복 차단·서비스 격리·외부 URL 검증이 live 화면에서 실데이터로 동작.
- 잔여: 재시작 후 상태 유지·권한 재검사 브라우저 경로는 revalidation/ 기존 증거(recipient-db-after-restart, subprocessor-authority-*)와 함께 본다.
- 외부 SMTP 실발송은 별도 제공자 연동 필요 — 로컬 환경 한계를 UI가 스스로 고지함을 확인.
