# P07-T04 개인정보 수명주기 게이트

## 개요

개인정보 CSV 대량 수집 → 마케팅 수신동의 관리 및 suppression 필터링 → 보존 기한 경과에 따른 백그라운드 파기 워커 동작 → 파기 증명서 발급 및 감사 추적에 이르는 수명주기 전 과정을 통합 검증한다.

## 구현 내용

1. **대량 가져오기 (Import)**:
   - CSV 파일 파싱, 컬럼 매핑, 유효성 검증
   - 비동기 워커(`import-worker`)를 통한 안전한 배치 적재
   - 실패 행 CSV 다운로드 및 중복 실행 방어
2. **마케팅 동의 및 차단 목록**:
   - 채널별(SMS/이메일) 수신동의 및 철회 상태 전이
   - 일괄 철회 처리의 멱등성 및 원자성 보장
   - 발송 전 suppression 목록과의 실시간 대조
3. **보존 및 파기 (Destruction)**:
   - 개인정보 처리 목적별 보존 기간 만료 계산
   - 법적 보존(`legalHold`) 상태인 경우 파기 유예
   - 파기 워커에 의한 암호화 원문 삭제, 파일 물리 삭제
   - 파기 증명서(`DestructionCertificate`) 발급 및 감사 로그 보존

## 검증 내역

- 테스트 스위트:
  - `tests/server/imports.test.ts`
  - `tests/server/marketing.test.ts`
  - `tests/server/destruction.test.ts`
  - `tests/server/compliance-close.test.ts`
  - `tests/server/retention-designation.test.ts`
- 주요 검증 항목:
  - 파기 완료 후 원본 데이터 및 파일 완전 소멸 확인
  - 2개 회사 간 테넌트 격리 및 상호 침범 불가
  - 파기 이력 및 증명서의 불변성 보장
