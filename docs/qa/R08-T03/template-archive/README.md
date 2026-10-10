# R08-T03 템플릿 보관·복원 체크포인트

2026-10-11(KST)에 회사 템플릿의 보관·복원을 모델·API·권한·화면·PostgreSQL까지 검증했다. 이 기록만으로 R08-T03 전체를 완료 처리하지 않는다.

## 구현 범위

- `FormTemplate.status`는 `active`와 `archived`만 허용한다.
- 회사 템플릿 목록은 사용 중·보관됨 상태를 분리해 조회한다.
- 보관은 편집·사용을 차단하고 복원 action만 제공한다.
- 복원은 같은 템플릿 ID를 활성 상태로 되돌리고 version을 증가시킨다.
- 공개 템플릿과 권한이 회수된 서비스 템플릿의 보관·복원을 거부한다.
- 보관·복원은 현재 계정·세션·구성원·전문가 배정·서비스 grant를 transaction 안에서 다시 검사하고 감사 이벤트를 저장한다.

## 검증 결과

- 서버 회귀: 3개 파일 19개 시험 통과
- TypeScript 검사: 통과
- 변경 파일 ESLint: 오류 0개. 기존 `<img>` 경고 3개
- OpenAPI/API 감사: 328경로·465작업, 누락 0개, 정책 누락 0개
- production 빌드: 로컬 메일·카카오·결제 adapter 플래그로 82페이지 통과. 외부 공급자 성공 증거로 사용하지 않는다.
- migration: 기존 dev/test와 빈 shadow DB에 148개 적용. 잘못된 status는 PostgreSQL SQLSTATE `23514`로 거부
- schema 검사: 예상 밖 차이 0개. Prisma가 표현하지 못하는 의도된 SQL 제약 차이 1개
- Ego Lite: 보관→활성 목록 제외→보관 목록 표시→직접 편집 차단→복원→직접 편집 허용→production 서버 재시작 뒤 활성 상태 유지 확인
- DB: 템플릿 `3c625a37-a5ac-4e6b-a44c-b6dd7ac42a64`가 최종 `active`, version 7이며 `template.archived`와 `template.restored` 감사 이벤트가 각각 1건 남았다.

## 남은 범위

- 실제 삭제 확인 대화상자와 삭제 후 목록·DB 수용
- 미저장 입력 폐기 확인
- 대표 이미지의 실제 브라우저 업로드·표시·교체·삭제
- 실제 외부 결제 라이선스 승인

## 증거

- [브라우저 검증](browser-verification.json)
- [최종 검증 요약](verification-final.json)
- [migration 검증](migration-verification.json)
- [스키마 검사](schema/catchsecu_dev-contract.json)
- [복원 직후 화면](browser-restored.png)
- [서버 재시작 후 화면](browser-after-restart.png)
