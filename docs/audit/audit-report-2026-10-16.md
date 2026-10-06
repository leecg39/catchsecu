# 보안 감사 보고서 — 2026-10-16

- 범위: Security 모듈(인프라 표면 → 의존성 → 애플리케이션 OWASP). P11-T05 "critical/high 미해결 0" 조건 검증용.
- 도구: `git log -p`(시크릿 이력), ripgrep 하드코딩 스캔, `npm audit --omit=dev`, 중앙 라우팅 래퍼 코드 리뷰.

## Phase 1 — 인프라 공격 표면: 이상 없음

| 점검 | 결과 |
|---|---|
| `.env` git 추적 | `.env.example`만 추적, 실제 env 파일 이력 없음 |
| git 히스토리 시크릿 | `git log --all -p -G`(key/secret/token/password 패턴) 매칭 0건 |
| 소스 하드코딩 시크릿 | 0건 — 발견된 `clientSecret` 리터럴 3건은 QA 스크립트 더미값(`qa-*`) |
| `NEXT_PUBLIC_*` 서버 경로 노출 | 0건 |
| 서드파티 웹훅 | Origin 우회 6개 경로 전부 `signed-webhook`/`unsubscribe-token`/`saml-assertion` 명시 + 각자 암호 검증(결제 HMAC·수신거부 서명 토큰·SAML 어서션 검증은 테스트에서 실측) |

## Phase 2 — 의존성 취약점: 해소

- 감사 시점 `npm audit --omit=dev`: **high 7건** — 전부 `shadcn` CLI(scaffolding 도구)가 프로덕션 의존성에 선언돼 있어 `braces`(stack-exhaustion DoS, GHSA-vfj7-8cjw-p6xm) 체인이 런타임 표면에 포함.
- 조치: `shadcn`을 `devDependencies`로 이동(코드·스크립트에서 import 0건 확인). 이동 후 **`npm audit --omit=dev` = 0 vulnerabilities**.

## Phase 3 — 애플리케이션 보안 (OWASP)

| 항목 | 점검 | 결과 |
|---|---|---|
| SQL Injection | `queryRawUnsafe` 사용 5곳 전수 확인 — 전부 파라미터 바인딩(`$1` 플레이스홀더), 행 잠금(FOR SHARE/UPDATE) 용도 | 이상 없음 |
| XSS | `dangerouslySetInnerHTML` 1곳(공지 본문) — 저장 시 `sanitize-html` 화이트리스트(`p/br/strong/em/ul/ol/li/a[href]`, `http/https` 스킴만) 정제 | 이상 없음 |
| CSRF | 중앙 `route()` 래퍼가 모든 비-GET 요청의 `Origin` 헤더를 `BETTER_AUTH_URL`과 비교, 우회는 암호 인증 3종뿐 | 이상 없음 |
| `eval`/`new Function` | 0건 | 이상 없음 |
| 인증·세션 | 쿠키 세션 + 정책 만료 + 정지 즉시 파기(security-gate.test.ts 실측) | 이상 없음 |
| 요청 크기 | body()가 content-length·스트림 이중으로 1MB 제한 | 이상 없음 |
| 속도 제한 | ApiRateLimit DB 카운터, 로그인·조직인증 등 공개 경로 적용(테스트 실측) | 이상 없음 |

## Phase 4 — 심각도 분류

| 심각도 | 건수 | 내용 |
|---|---|---|
| Critical | 0 | — |
| High | 0 (발견 7 → 조치 완료) | `braces` DoS — `shadcn` devDep 이동으로 런타임 표면 제거 |
| Medium | 0 | — |
| Low | 1 (참고) | 공지 `a[href]` 허용 시 `rel="noopener"` 미지정 — 클릭재킹급 아님, 서버 정제로 javascript: 차단됨 |

## 결론

**critical/high 미해결 = 0건.** dev 의존성 트리(`npm audit` 전체)에는 shadcn 체인의 잔여 항목이 있으나 런타임·배포 표면에 포함되지 않는다.

잔여 범위 밖 항목: License(SPDX)·Privacy(GDPR) 모듈은 P11-T05 조건 범위가 아니므로 본 보고서에 미포함 — 필요 시 별도 감사.
