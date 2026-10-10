# 내부 별칭·집계 라우트 수용 증거

검증일: 2026-10-11 05:04 KST  
실행 환경: Node.js 24.18.0, 로컬 격리 PostgreSQL `catchsecu_test`

## 범위

- 보유기간 규칙: 목록·생성·상세·수정·보관 5개 operation
- 피드백: 본인 목록·생성·상세·수정·보관 5개 operation
- 분석/준수: 개인정보 집계·마케팅 집계·준수 현황 3개 operation

보유기간과 피드백은 새 별칭 route handler가 기존 서비스 계층의 권한·경합·멱등·암호화·감사 규칙을 그대로 적용하는지 확인했다. 세 집계 경로는 회사 및 서비스 권한 범위를 적용해 실제 PostgreSQL 원천 데이터만 반환하고, 비로그인 요청을 거부하는지 확인했다.

## 결과

- 대상 테스트 파일 3개, 시험 17개 통과
- 내부 route operation 13개 직접 실행
- 타입 검사와 변경 파일 ESLint 통과
- API 감사: 직접 handler 시험 연결 431→444, 미연결 35→22

[Vitest JSON 결과](regression.json)와 [전체 API 감사](../api-audit/README.md)를 함께 사용한다. 이 결과는 지정한 13개 route의 수용 증거이며 R00-T02 전체 완료나 남은 22개 operation의 실행 성공을 뜻하지 않는다.

## 재현

```bash
PATH=/Users/user01/homebrew/bin:$PATH npm test -- \
  tests/server/retention-rules.test.ts \
  tests/server/support-tickets.test.ts \
  tests/server/analytics.test.ts
PATH=/Users/user01/homebrew/bin:$PATH npm run verify:api-audit
```
