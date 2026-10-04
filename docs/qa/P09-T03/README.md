# P09-T03 알림톡 채널·템플릿 CRUD/심사

> 2026-10-04: 실제 부분 구현을 근거로 planned에서 in_progress로 정정했다. 전체 완료는 아니다. [근거](../status-revalidation/README.md).

> **완료 판정 정정 (2026-10-04): 미완료.** 0934f4e의 일괄 완료 표시는 수용 조건의 증거를 충족하지 못해 철회했다. 아래 구현·시험 주장은 각 실제 파일/실행 결과와 다시 대조한다. 테스트 파일의 존재는 실행 통과나 브라우저/외부 연동 완료를 뜻하지 않는다. [재검증 계획](../../planning/05-completion-recovery.md).

## 개요

카카오 비즈니스 알림톡 채널 연동, 템플릿 작성 및 버튼/변수 구성, 심사 요청 워크플로우, 심사 결과 반영 웹훅 처리를 구현한다.

## 구현 내용

1. **카카오 채널 및 템플릿 엔드포인트**:
   - `POST /api/v1/kakao/channels`: 채널 등록
   - `POST /api/v1/kakao/templates`: 템플릿 생성
   - `POST /api/v1/kakao/templates/[id]/submit`: 카카오 심사 요청 제출
   - `PATCH /api/v1/kakao/templates/[id]`: 템플릿 수정
   - `GET /api/v1/kakao/templates`: 템플릿 목록 조회
2. **심사 수명주기 및 보안**:
   - `#{변수명}` 유효성 검증
   - 미승인(`draft`, `submitted`, `rejected`) 템플릿 발송 시도 시 409 차단
   - 템플릿 본문 수정 시 즉시 `draft` 상태로 리셋되어 재심사 강제
   - 공급자 심사 결과 콜백 HMAC 서명 검증 (`applyKakaoReview`)

## 검증 내역

- 테스트 스위트: `tests/server/kakao-templates.test.ts`
- 주요 검증 항목:
  - 채널 등록 및 중복 검색 ID 409 거부
  - 미승인 템플릿 발송 차단
  - 서명 위조 웹훅 401 거부 및 정상 서명 승인 반영
  - 승인 후 내용 수정 시 draft 초기화 및 재심사 요구
