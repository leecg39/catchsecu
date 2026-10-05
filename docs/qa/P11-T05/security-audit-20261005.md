# P11-T05 보안 감사 — 2026-10-05

범위: 인프라 노출 → 의존성 → 애플리케이션(OWASP). 도구: `git log`(시크릿 이력), `npm audit`, 정적 소스 스캔, 기존 PostgreSQL 게이트 테스트.

## Critical / High — 미해결 0(런타임 기준)

| 심각도 | 항목 | 상태 |
|---|---|---|
| High×9 | `braces`/`fast-glob` ReDoS (GHSA-vfj7-8cjw-p6xm 등) | **dev 전용** — shadcn·ts-morph·eslint-config-next 체인의 빌드타임 도구. 런타임 번들·서버 경로에 포함되지 않아 배포 앱에 비악용. 수정은 breaking shadcn 업그레이드 필요로 추적 항목으로 기록 |
| — (수정됨) | 500 에러 로그에 `error.stack` 첫 줄(메시지)이 포함돼 비밀 문자열 유출 가능 | **수정·커밋 fcc778d** — 스택 첫 줄 제외, `platform.test.ts`가 재검증 |

## 인프라 표면

- git 이력에 `.env.local`/실제 시크릿 커밋 없음 — `.env.example`만 존재
- 세션 쿠키: `HttpOnly; SameSite=Lax; Secure(https 시)` — `sso.ts`의 `sessionCookie` 직접 확인
- 비밀 로그: 회전 세리머니(P14-T04)에서 구키 폐기·신키 전수 복호를 DB 레벨로 실증
- `MAIL_TRANSPORT=local`은 production에서 빌드타임에도 거부 — `ALLOW_LOCAL_MAIL` 미설정 시 `next build` 실패 확인(의도된 가드)

## 애플리케이션(OWASP)

- XSS: 공지·메시지 본문은 `sanitize-html` 허용목록으로 서버 정제 후 `dangerouslySetInnerHTML` 렌더 — `notices.ts`·`message-content.ts`
- SQLi: `$queryRawUnsafe` 포함 전 경로 `$1` 파라미터 바인딩 — 문자열 보간 없음(78개 파일의 raw 쿼리 표본 확인)
- 인증/세션: ORIGIN_REJECTED(비-GET의 origin 검사)·세션 만료·계정 회수 즉시 파기·IP 서명 증명·MFA 강제 — `tests/server/security-gate.test.ts` 통합 시나리오 통과
- Idempotency: 쓰기 경로는 `idempotency-key` 필수 — 누락 시 400 `IDEMPOTENCY_REQUIRED` 실측
- 레이트리밋: 반복 로그인이 429로 실제 차단됨을 확인(로컬 QA 중 유발)

## 판정 보류 사유(외부 의존)

- 실제 IdP(OIDC/SAML)·결제 PG·SMS/카카오 공급자 경계는 자격 증명 없이 미검증 — blocked로 유지
- "critical/high 미해결 0"은 런타임 표면 기준; dev 체인 ReDoS 9건은 추적 항목으로 명시한다

재현 명령: `npm audit`, `git log --all -p -- .env.local .env`, `grep -rn "dangerouslySetInnerHTML\|queryRawUnsafe" src/`, `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/security-gate.test.ts`
