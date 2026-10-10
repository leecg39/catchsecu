# 관리자 CRUD 라우트 수용 증거

검증일: 2026-10-11 05:00 KST  
실행 환경: Node.js 24.18.0, 로컬 격리 PostgreSQL `catchsecu_test`

## 범위

- 관리자 요금제: 목록·생성·상세·수정·삭제 5개 operation
- 관리자 공지: 목록·생성·상세·수정·삭제 5개 operation
- 관리자 가이드: 목록·생성·상세·수정·삭제 5개 operation

각 시험은 Next.js route handler를 실제 `Request`로 호출한다. 로그인한 플랫폼 운영자 권한을 검사하고, 생성부터 수정·삭제까지 같은 PostgreSQL 저장소와 감사 이벤트를 사용함을 확인한다. 공지와 가이드는 일반 공개 경로와 관리자 별칭 경로가 같은 레코드를 사용한다.

## 결과

- 대상 테스트 파일 3개, 시험 24개 통과
- 관리자 CRUD operation 15개 모두 route handler에서 실행
- 타입 검사와 변경 파일 ESLint 통과
- API 감사: 직접 handler 시험 연결 416→431, 미연결 50→35
- operation 작업 소유자 누락 25→0

[Vitest JSON 결과](regression.json)와 [전체 API 감사](../api-audit/README.md)를 함께 사용한다. 이 결과는 세 관리자 도메인의 라우트 수용 증거이며 R00-T02 전체 완료나 남은 35개 operation의 실행 성공을 뜻하지 않는다.

## 재현

```bash
PATH=/Users/user01/homebrew/bin:$PATH npm test -- \
  tests/server/admin-plans.test.ts \
  tests/server/notices.test.ts \
  tests/server/guides.test.ts
PATH=/Users/user01/homebrew/bin:$PATH npm run verify:api-audit
```
