# R09 승인·게시·고정URL 모델 현재 대조

2026-10-11 현재 소스와 dev/test PostgreSQL을 재점검했다. R09-T01은 선행 R08-T04·R10-T04·R21-T04의 전체 수용이 남아 있어 `in_progress`로 유지한다. 이 문서는 R09 모델·상태 규칙의 로컬 검증 증거이며, 선행 도메인이나 외부 제공사 검증을 대신하지 않는다.

## 모델·규칙 대조

| 범위 | 현재 저장 계약 | DB 강제 |
|---|---|---|
| 보안 정책 | 승인 필수, 승인 역할, 증빙 필수, 정책 revision | 역할 배열·revision CHECK, 정책 변경 감사 |
| 폼·버전 | 현재 초안, 게시 버전 포인터, 폼 동시성 version | tenant/service 복합 FK, 게시본 불변 트리거 |
| 승인 요청 | 폼 버전·폼 revision·정책 revision·content hash·snapshot·요청/결정 암호문 | 폼당 pending/approved 1건, pending→approved/rejected/cancelled/superseded→consumed 상태 전이, snapshot/결정 불변, 삭제 금지 |
| 게시본 | 폼·버전·승인 복합 참조, token hash/cipher, 시작/종료, 응답 상한 | token hash 고유, 승인 정책·상태 트리거, 기간·응답수 CHECK |
| 고정 URL | 전역 고유 slug, tenant·게시본 복합 FK, active/revoked·version | slug UNIQUE, tenant/status 인덱스, 게시본 삭제 제한 |

dev/test 모두 5모델·73열·33제약·20인덱스·8트리거·149 migration으로 일치한다. 정의 해시 `654d088469bbea5d46a3fa19983281f61212173682fab6a51d0614f6ad14c918`, migration 해시 `975d7958685a7630ede7858afe6aa69fdf6684fde3ef5c1b0e82a9928f2ec3b2`다.

- [dev DB 메타데이터](catchsecu_dev.json)
- [test DB 메타데이터](catchsecu_test.json)
- [현재 회귀 8파일·14suite·96개](regression.json): 승인 요청/결정/취소, 승인 본문 바꾸기 거부, 요청자·검토자 권한 회수, 게시/중단/재개, 고정URL C/R/U/D·경합·tenant/service 격리와 승인 목록 URL 복원을 검사한다.

실제 API로 별도 회사에 폼12개·승인12건(대기/반려/승인/게시완료 각 3건)·게시본3개를 만들었다. 이 자료는 [R09 화면 검증](../../R09-T03/current/README.md)과 서버 재시작 지문 대조에 사용했다.

## 남은 게이트

- R08 폼 전체 수용, R10 동의문서, R21 결제/라이선스 선행 수용을 연결해야 한다.
- 승인·게시 전체 화면 상태 조합과 외부 제공사 의존 조건은 R09-T03/T04에서 계속 검사한다.
- 외부 본인인증·전자서명·소셜 OAuth는 실제 수신 증거가 없으며 완료로 집계하지 않는다.
