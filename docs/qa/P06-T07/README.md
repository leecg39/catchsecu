# P06-T07 응답 흐름 E2E 게이트

## 개요

공개 폼 게시 → 외부 제출자 응답 접수 → 첨부파일 ClamAV 스캔 → 관리자 응답 확인 → 공유 열람자 초대/인증/조회 → 정보주체 열람/정정/철회 → 파기까지의 통합 응답 라이프사이클을 검증한다.

## 구현 내용

1. **응답 수명주기 E2E**:
   - 폼 게시본 활성화 및 고정 URL 배포
   - 외부 익명 사용자의 공개 폼 제출 및 실시간 유효성 검증
   - 첨부 파일의 바이러스 검사 격리 및 승인 후 바인딩
   - 접수 즉시 동의 영수증(`ConsentReceipt`) 및 불변 해시 생성
   - 관리자 콘솔에서의 응답 목록/상세 조회 및 마스킹 처리
   - 공유 열람자(ShareGrant) 발급 및 일회용 OTP 인증을 통한 제한된 필드 열람
   - 정보주체 자기정보 조회(`DataSubject`) 및 동의 철회 처리
   - 보존기간 만료 시 파기 요청 생성

## 검증 내역

- 테스트 스위트:
  - `tests/server/public-submission-gate.test.ts`
  - `tests/server/public-submission-state.test.ts`
  - `tests/server/file-access-gate.test.ts`
  - `tests/server/share-management-gate.test.ts`
  - `tests/server/subject-access-gate.test.ts`
  - `tests/server/destruction.test.ts`
- 주요 검증 항목:
  - 전 과정에서 IDOR 및 타 테넌트 침범 차단
  - 일회용 토큰 및 세션 만료 즉시 접근 거부
  - 비동기 대량 내보내기 시 수식 오염(`CSV Injection`) 방어
