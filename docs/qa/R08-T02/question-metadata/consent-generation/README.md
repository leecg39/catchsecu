# F3 동의 문안 자동 생성(로컬 결정형) 검증

2026-10-11. 동의서 표시 설정의 문안 자동 생성을 명시적 API/UI 동작으로 구현했다. 생성은 **제안만 돌려주고 저장하지 않으며**, 검토자가 제안 문구를 적용한 뒤 기존 PATCH(version 검사·감사)로만 실제 저장된다. 외부 문안 생성/법률 제공사 연결 없음 — 로컬 결정형 구성이며 법적 완결성을 주장하지 않는다.

## API (OpenAPI 336경로/477op, 정책행 477)

- `POST /services/{id}/consent-display/{kind}/generate` — `service.manage`+현재 서비스 grant, 보관 서비스 409.
- 입력 없음. 응답 `{basis, proposals}`: basis는 반영 근거 건수(purposeCount·itemCount·subprocessorCount·recipientCount·truncated), proposals는 5개 표시 문구(start/processor/policy/required/optional, 각 ≤200자).
- 생성할 때마다 `service.consent_display_generated` 감사 이벤트를 남기되 문구 원문 대신 채워진 필드명·건수만 detail에 둔다(테스트로 이름 비포함 검증).

## 생성 근거(`generateDisplayProposal`, `src/server/documents.ts`)

- 회사/서비스 공개명(`displayNames`의 serviceName)
- 활성 `ProcessingPurpose` 이름 → collection startText
- 활성 `Subprocessor` 이름 → processorText(수탁 안내)
- 활성 `Recipient`(source 제외) 이름 → third_party processorText(제공받는 자)
- 서비스 내 미삭제 폼의 최신 `consentItemSchemaVersion=1` 버전의 `consentItems` 투영 → 수집 항목 건수(basis)
- 긴 이름 목록은 `A, B 외 N건`으로 줄이고 `basis.truncated`로 표시, 문구는 200자로 clip

## UI(`ConsentDisplay.tsx`)

- "문안 자동 생성" 버튼 → 제안 패널에 근거 건수·생략 안내·"법적 검토가 필요할 수 있습니다" 문구와 함께 필드별 제안을 표시.
- "제안 문구 적용"은 편집 폼 값만 채우고, "제안 닫기"는 폐기한다. 실제 저장은 기존 "수정사항 적용"(version 낙관적 잠금·VERSION_CONFLICT 복구·감사) 경로를 그대로 탄다.
- 저장 성공 시 제안 패널을 닫는다. 게시본·동의 증거·수신 스냅샷은 변경하지 않는다.

## 검증

- `tests/server/consent-display-generate.test.ts` 5개 + consent-display-authority 4개 + document-policy 11개 = [20개 전부 통과](tests.json): 이름 반영·제3자 제공처·미저장(version 0 유지)·빈 카탈로그 폴백·viewer 403·보관 409·절단 플래그.
- typecheck·eslint·프로덕션 빌드 통과, verify:plan/plan-integration 통과(op 477=policy 477).
- 브라우저 종단(버튼→제안→적용→저장→충돌 복구)은 F7 전수 수용 범위.

## 경계

- 생성 문구는 결정형 템플릿+등록 데이터 조합이며 원본 제품의 문안 생성 동작이 관측되지 않아 동등성을 주장하지 않는다.
- 수집 항목 자체는 기존 consentItems 투영(버전 고정)이 그대로 표시되며, 생성은 5개 자유 문구만 채운다.
