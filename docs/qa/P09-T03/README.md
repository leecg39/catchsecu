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

- 테스트 스위트: `tests/server/kakao-templates.test.ts` (2/2 통과, 2026-10-12 재실행)
- 주요 검증 항목:
  - 채널 등록 및 중복 검색 ID 409 거부
  - 미승인 템플릿 발송 차단
  - 서명 위조 웹훅 401 거부 및 정상 서명 승인 반영
  - 승인 후 내용 수정 시 draft 초기화 및 재심사 요구

### 로컬 공급자 (2026-10-12 추가)

`KAKAO_PROVIDER=local`을 설정하면 공급자 없이 전체 심사·발송 경로를 재현한다. `sms-local`·전자서명 local 어댑터와 동일한 경계 — 운영에서는 `ALLOW_LOCAL_KAKAO=1` 없이 부팅이 거부된다(`src/server/env.ts`).

- `POST /kakao/channels/:id/verify`: 내부 서명으로 **실제 webhook 경로(`applyKakaoReview`, HMAC·상태 가드·감사 포함)를 그대로 통과**해 `verified`로 확정. 재요청 409, 보관 채널 409.
- `POST /kakao/templates/:id/submit`: 제출 커밋 후 같은 경로로 즉시 승인. 본문의 `#반려` 표지는 반려를 재현하는 적대적 테스트 훅.
- `POST /kakao/templates/:id/send`: 승인 템플릿+확인 채널이면 `local_delivered` + `receiptId=local-kakao:<id>`를 반환하고 영수증 JSON을 `LOCAL_KAKAO_DIR`에 기록. 미승인/미확인은 여전히 409.
- `GET /kakao/templates/:id/review`: 로컬 공급자가 확정한 결과는 `providerMatched: true`를 반환한다.
- 미설정(`unconfigured`) 시 기존처럼 verify/send가 503 `KAKAO_PROVIDER_REQUIRED`를 유지한다 — 기본 동작 변화 없음.

검증: `kakao-templates.test.ts` 두 번째 테스트가 로컬 공급자로 verify 200→중복 409→submit 즉시 approved→send 200+영수증 파일→`#반려` 템플릿 rejected+reviewNote→반려 템플릿 send 409까지 실측.

## 남은 외부 조건

실제 카카오 비즈 채널 심사·승인, 실 알림톡 발송 결과(수신 성공/실패 webhook)는 공급자 계정이 필요해 여전히 외부 차단. 로컬 공급자는 상태 기계와 서명 경로의 완전한 재현이지 실제 카카오 승인 증명이 아니다.
