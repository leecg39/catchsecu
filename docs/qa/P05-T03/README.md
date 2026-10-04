# P05-T03 공개 문서·안내 경로 검증

## 개요

P05-T02에서 게시된 문서와 서비스별 카탈로그 조회를 확정된 계약에 연결하고, 허용되지 않은 파라미터 및 회수된 링크를 엄격히 차단한다.

## 구현 내용

1. **엔드포인트**:
   - `GET /api/v1/public/services/[serviceId]/documents`: 서비스별 공개 문서 카탈로그 조회
   - `GET /api/v1/public/documents/[token]`: 개별 공개 문서 상세 조회
2. **보안 및 유효성 검증**:
   - 서비스 ID 및 테넌트 활성 상태 확인
   - `serviceDocumentQuery` Zod 스키마로 `view`, `agreement`, `category`, `country` 등 파라미터 정밀 검증 (허용되지 않은 임의 키 입력 시 422 반환)
   - 만료되었거나 회수된(revoked) 게시본은 410 반환
   - `tokenCipher`, 내부 ID, 테넌트 식별자 등 내부 민감 정보 노출 차단

## 검증 내역

- 테스트 스위트: `tests/server/public-service-documents.test.ts`
- 주요 검증 항목:
  - 게시 문서만 공개 목록에 반환
  - 허용되지 않은 agree·category 및 unknown 파라미터 422 거부
  - `unique_identifier` 포함 시 resident view 필터 동작
  - 국외 이전 문서의 `overseas` view 필터 동작
  - 회수(`revoke`) 즉시 공개 카탈로그에서 제외 및 상세 조회 410 반환
  - Rate limiting 방어 (분당 60회)
