# P12-T01 감사 이벤트 수집·조회 — 완료

> 2026-10-04: 이번 개별 수용 검증으로 완료했다. 공식 상태는 완료17·진행40·계획15다. [최종 결과와 실패 이력](completion/README.md). 0934f4e의 일괄 완료 판정 철회 이력과 이번 개별 판정을 구분한다.

## 최종 수용

비밀번호·개별 세션 종료, 다운로드, 공개 수신동의와 민감 공유 열람, 이메일·메신저·결제·원장·체험·심사 결과의 감사 누락 및 원자성을 보완했다. 최종 관련13파일162개, 빌드·타입·린트·계약·계획과 실제10종류 로그 화면/CSV·독립 DB·새 프로세스 검증을 통과했다. 전체 회귀의 잠금 관측1개 실패는 보존했고 별도 환경에서 해당6개가 통과했다. 전체 회귀 통과나 외부 공급자 완료로 확대하지 않는다. [상세 근거](completion/README.md), [생산 경계](completion/producer-matrix.md).

가입·서명 이메일 확인·MFA·로그아웃의 앞선 v27~v29 증거를 유지한다. [v29 공개 인증](revalidation/public-auth/README.md), [v28 인증 변경](revalidation/auth-mutations/README.md).

## 이전 구현 기록

2026-10-03. 감사 조회와 CSV 내보내기의 구현 근거다. `TASKS.md`의 전체 이벤트 생산·브라우저·원자성 게이트는 아직 충족하지 않아 완료로 표시하지 않는다.

## 이번 구현

- `GET /api/v1/audit-events`에 현재 회사·서비스별 조회, `company|mine` 범위, 종류·기간·처리자·서비스·검색·페이지 필터를 연결했다. PostgreSQL에서 필터·정렬·페이지를 처리한다. 다른 회사 서비스는 404, 일반 사용자의 회사 감사 조회는 403이다.
- 회사 전체 감사는 owner/admin/security/auditor 역할만 전체 이벤트를 본다. privacy 역할은 현재 `audit.read` 서비스 grant 범위만 본다. 본인 활동은 현재 회사의 본인 이벤트와 현재 서비스 권한 범위로 제한한다.
- 응답에서 감사 `detail`, 이메일, 토큰, IP 원문을 제외한다. 서비스 범위 조회에서는 처리자명과 대상 ID를 숨긴다. 현재 원장에 없는 접속 IP·고객번호·사유는 화면에 `-`로 표시한다.
- 로그인 시 새 `session.created` 이벤트에 선택된 회사 ID를 연결하고, 세션 회수에도 현재 회사 ID를 연결했다. 이전에 저장된 회사 미지정 로그인 이벤트는 소급 변환하지 않았다.
- `/log/service`, `/log/info-monitoring`, `/log/ad-monitoring`, `/log/customer`, `/log/member`, `/log/authority`, `/log/external-viewer`, `/log/access-history`, `/log/mail`, `/my-page/activity-log`를 실제 감사 조회 API에 연결했다. 기존 광고 동의 로그의 하드코딩된 데모 행을 제거했다. 각 종류의 실제 이벤트가 없는 경우 빈 결과를 표시한다.
- `GET /api/v1/audit-events/export`는 목록과 동일한 회사·서비스·역할 범위 및 적용된 필터를 사용한다. 최대 5,000건을 내보내며 초과 시 일부만 반환하지 않고 413 오류를 준다. UTF-8 BOM과 CSV 수식 방어를 적용했다.
- 성공한 감사 CSV 다운로드는 `audit.exported`를 회사·사용자·요청 ID·건수와 함께 원장에 기록한다. 필터의 검색어 원문은 기록하지 않고, 413으로 거절된 다운로드는 성공 이벤트를 남기지 않는다.
- 날짜 필터의 `from`은 포함, `to`는 미포함이다. 화면에서 선택한 종료일은 브라우저 현지 시간의 다음 날 0시로 변환해 해당 날짜의 마지막 순간까지 조회한다.
- CSV 가져오기 작업의 목록·상세와 암호화된 문의의 작성자/운영자 목록·상세 열람을 추가로 감사한다. 목록·상세 DTO 생성과 이벤트 생성을 한 DB 트랜잭션에 두고, 권한 거부 후에는 이벤트를 만들지 않는다. 운영자의 여러 회사 문의 목록은 반환한 문의별 회사에 이벤트를 기록한다.
- 기초 migration에 이미 있는 `audit_immutable` 트리거가 감사 원장의 UPDATE·DELETE를 막는다. 개발 DB의 트리거 활성 상태를 조회했고, 시험 DB에서 UPDATE·DELETE 거부를 확인했다.
- OpenAPI의 감사 조회·CSV 내보내기 경로와 필터를 추가했다. 이벤트 생성·변경 API는 제공하지 않는다.

## 검증

`tests/server/audit-events.test.ts` 5건: 실제 `catchsecu_test`에서 익명 401, viewer 회사 감사 403, privacy 서비스 A1만 노출·A2/B 차단, 처리자/ID 마스킹, `detail` 비노출, 종류·기간·검색·페이지, 본인 활동을 검사했다. CSV와 목록의 동일 필터 결과, BOM·수식 방어, 타 회사/역할 차단, 5,001건 초과 오류, 원장 직접 삭제 거부도 검사했다.

같은 시험에서 내보내기 이벤트의 요청 ID·처리자·건수, 검색어 원문 비기록, 실패 시 성공 이벤트가 없는지도 확인했다. `tests/server/imports.test.ts`는 목록·상세의 회사/서비스 감사와 타 회사 404 시 기록 부재를 확인한다. `tests/server/support-tickets.test.ts`는 작성자·운영자 목록 및 운영자 상세의 회사별 감사, 무권한 상세 404 시 기록 부재를 확인한다.

전체 회귀 `npm test`는 24개 파일·401개 시험을 통과했다. 이후 종료 시각 경계 수정에 대한 감사 시험 5건, 운영자 문의 목록 감사의 일괄 쓰기 변경에 대한 문의 시험 4건, TypeScript·변경 파일 ESLint(오류 0), 로컬 production build를 다시 통과했다. 종료 시각 수정 뒤 실제 HTTP QA도 통과했고, 최종 빌드의 `/api/v1/health`는 DB 준비 상태를 반환했다. OpenAPI 생성 결과는 217개 API 경로다.

[실제 HTTP 실행 기록](http.txt): 로컬 production 서버에서 로그인 이벤트 조회 200, viewer 감사 화면 307·회사 API 403, 본인 활동 200, 타 회사 서비스 404, PATCH/DELETE 405, 로그 화면 5개 경로의 HTML 200을 확인했다. CSV 응답 200과 목록/CSV ID 일치, 요청 ID로 DB에 저장된 다운로드 이벤트의 처리자·건수, viewer CSV 403, 타 회사 서비스 CSV 404도 확인했다. 재현 명령은 `node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa-audit-events.ts`다.

## 다른 Task의 남은 조건

- 일별 수집·파기 및 서비스별 집계의 전체 수용은 P12-T02, 검토 workflow는 P03-T03에서 추적한다. 일별 집계의 별도 구현 커밋176296d는 브라우저 수용을 대기 중이다.
- 운영 보존·백업 복원·대량 조회 계획·전 경로 통계 및 staging은 P12-T04/P14의 원래 수용을 따른다. 월마감 PDF/CSV는 P12-T03 완료 기록을 따른다.
- SMTP·문자·PG·카카오·Slack/Teams의 실제 공급자 검증은 각 P08/P09/P10 Task다. 감사 DTO에 없는 IP·고객번호·사유는 빈 값으로 표시한다.

이번 Task 커밋·푸시 성공 뒤 사용자 요청대로 일시 정지하며 다음 Task는 시작하지 않는다.
