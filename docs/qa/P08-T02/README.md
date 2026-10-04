# P08-T02 발송 캠페인·수신자·예약

> 2026-10-04: 실제 부분 구현을 근거로 planned에서 in_progress로 정정했다. 전체 완료는 아니다. [근거](../status-revalidation/README.md).

> **완료 판정 정정 (2026-10-04): 미완료.** 0934f4e의 일괄 완료 표시는 수용 조건의 증거를 충족하지 못해 철회했다. 아래 구현·시험 주장은 각 실제 파일/실행 결과와 다시 대조한다. 테스트 파일의 존재는 실행 통과나 브라우저/외부 연동 완료를 뜻하지 않는다. [재검증 계획](../../planning/05-completion-recovery.md).

## 개요

문자/이메일 발송 캠페인의 직접 입력 및 폼 응답 대상 수신자 선택, 유효성 검증, 미리보기, 초안 CRUD, 즉시/예약 발송, 예약 취소를 구현한다.

## 구현 내용

1. **엔드포인트**:
   - `GET /api/v1/campaigns`: 캠페인 목록 (검색/상태/채널/페이지네이션)
   - `POST /api/v1/campaigns`: 캠페인 생성 (초안)
   - `GET /api/v1/campaigns/[id]`: 캠페인 상세 및 수신자 미리보기
   - `PATCH /api/v1/campaigns/[id]`: 캠페인 수정 (draft 상태만 허용)
   - `POST /api/v1/campaigns/[id]/send`: 즉시 발송
   - `POST /api/v1/campaigns/[id]/schedule`: 예약 발송
   - `POST /api/v1/campaigns/[id]/cancel`: 예약 취소
2. **수신자 정제 및 무결성**:
   - 잘못된 형식의 번호/이메일 자동 필터링
   - 마케팅 수신동의 철회자 및 suppression 차단 목록 실시간 대조/제외
   - 중복 수신자 자동 제거
   - 초안(draft) 상태에서만 수정 허용 및 버전 충돌(409) 방지

## 검증 내역

- 테스트 스위트: `tests/server/campaigns.test.ts`
- 주요 검증 항목:
  - 인증되지 않은 발신자로 캠페인 생성 차단
  - 수신거부 대상자 및 중복 대상자 자동 필터링
  - 예약 발송 등록 후 발송 전 취소 성공 확인
  - 발송 실행 시 테넌트 격리 및 서비스 grant 권한 확인
