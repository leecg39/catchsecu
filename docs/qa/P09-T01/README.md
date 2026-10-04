# P09-T01 이메일 작성·템플릿·발신 도메인

## 개요

이메일 본문 HTML 정제(Sanitization), 템플릿 변수 치환 검증, 파일 첨부 검증, 발신 도메인 DNS 인증 상태 확인 및 템플릿 CRUD를 구현한다.

## 구현 내용

1. **템플릿 및 콘텐츠 엔진**:
   - `MessageTemplate` 모델 CRUD
   - HTML 본문 내 위험 태그(`script`, `iframe`, 인라인 이벤트 등) 제거 (`sanitize-html`)
   - 템플릿 변수(예: `#{name}`) 유효성 검사 (미확정 변수 잔존 시 422 차단)
   - 실시간 본문 미리보기 (`POST /api/v1/message-content/preview`)
2. **도메인 및 첨부파일 검증**:
   - SPF/DKIM TXT 레코드 확인 완료된 도메인만 발송 허용
   - ClamAV 검사 완료된 비공개 파일만 첨부 허용

## 검증 내역

- 테스트 스위트: `tests/server/message-content.test.ts`, `tests/server/campaigns.test.ts`
- 주요 검증 항목:
  - 악성 HTML 스크립트 정제 확인
  - 유효하지 않은 치환 변수 차단
  - 미검증 발신자 도메인으로의 템플릿 발송 거부
  - 템플릿 CRUD 및 테넌트 격리 확인
