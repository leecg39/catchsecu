# R01-T02 API·권한·경합·멱등 공통 경계

2026-10-11 완료. Node 24.18.0과 격리된 실제 PostgreSQL 17.11 `catchsecu_test`에서 현재 Route Handler를 호출해 공통 서버 경계를 검증했다. 이 작업에는 브라우저 화면과 외부 공급자 연동이 없다.

## 현재 결과

- 세션이 선택한 회사에서만 `tenantId`를 결정한다. 서비스 생성 본문의 `tenantId` 주입은 엄격 DTO가 422로 거부했고, 회사 B가 회사 A 서비스를 참조한 폼 생성은 404로 숨겼다.
- API를 우회한 회사 교차 폼 삽입도 PostgreSQL 복합 FK `Form_tenantId_serviceId_fkey`가 거부했다. 폼 소유자와 서비스 grant도 tenant 복합 FK를 사용한다.
- 같은 멱등 키와 같은 본문의 동시 폼 생성 2건은 모두 같은 응답 ID를 돌려주고 `Form`과 `IdempotencyRecord`를 각각 한 건만 남겼다. 순차 재전송도 같은 ID를 반환했다.
- 같은 멱등 키에 다른 제목을 보낸 요청은 `409 IDEMPOTENCY_MISMATCH`였고 추가 폼을 만들지 않았다.
- 같은 version으로 동시에 보낸 폼 PATCH 두 건은 200과 `409 VERSION_CONFLICT` 한 건씩 끝났다. DB version은 한 번만 증가했고 `form.draft_updated` 감사도 한 건만 남았다.
- viewer의 `service.read`·`form.read` grant는 서비스와 폼 읽기만 허용했다. 서비스·폼 create/update/delete는 모두 403이었고 DB version은 바뀌지 않았다. 다른 회사 소유자는 같은 ID를 404로만 받았다.
- 200/201/204와 400/401/403/404/409/410/413/415/422/429, `X-Request-Id`, 비공개 no-store 응답, 1 MiB 요청 제한, 엄격 DTO, 이름 정렬과 ID tie-break의 반복 목록 안정성을 확인했다.
- 실제 PostgreSQL SQLSTATE 23514/0A000/40001/40P01/55P03은 내부 상세를 숨긴 안전한 409로 변환됐다. 알 수 없는 SQL 오류는 상세를 숨긴 500이었다.

## 실행 결과

| 검증 | 결과 | 증거 |
|---|---:|---|
| R01 전용 경계 통합 시험 | 5/5 | `r01-api-boundaries.json` |
| 보호 라우트 회사 격리 회귀 | 2/2 | `tenant-boundary.json` |
| 실제 PostgreSQL 오류 변환 | 6/6 | `http-database-errors.json` |
| TypeScript | 통과 | `tsc --noEmit` |
| ESLint | 통과 | 변경 시험과 공통 서버 4개 파일 |

총 3개 파일, 13개 시험이 통과했다. 집계와 환경은 `verification-summary.json`에 고정했다.

## 재현 명령

```bash
/Users/user01/.local/bin/node24 --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/r01-api-boundaries.test.ts
/Users/user01/.local/bin/node24 --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/tenant-boundary.test.ts
/Users/user01/.local/bin/node24 --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/http-database-errors.test.ts
/Users/user01/.local/bin/node24 node_modules/typescript/bin/tsc --noEmit
/Users/user01/.local/bin/node24 node_modules/eslint/bin/eslint.js tests/server/r01-api-boundaries.test.ts src/server/http.ts src/server/context.ts src/server/permissions.ts src/server/idempotency.ts
```

이 증거는 공통 서버 경계의 완료를 뜻한다. 다른 도메인의 화면 CRUD나 외부 연동 완료로 합산하지 않는다.
