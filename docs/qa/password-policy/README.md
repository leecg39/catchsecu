# 비밀번호 정책·변경·유예 검증

2026-10-02. P02-T02/P02-T04/P11-T01의 부분 구현이다. 전체 181개 경로의 완료 보고는 아니다.

## 구현 범위

- 회사 정책 조회·저장·기본값 복원에 최소 길이 12~128자, 변경 주기 없음 또는 1~12개월, 재사용 제한 없음/현재 암호/최근 10개, 유예 없음/현재 로그인/다음 변경 주기를 연결했다.
- 변경 주기는 한국 시간의 달력 월로 계산한다. 월말은 다음 달의 마지막 날로 맞춘다. 기본값은 3개월, 12자, 현재 암호 재사용 금지, 유예 없음이다.
- 변경·이메일 재설정 모두 활성 회사 소속 중 가장 엄격한 길이·재사용 정책을 적용한다. 현재 회사의 변경 주기가 지나면 회사 API는 403을 반환하고 보호 화면은 비밀번호 변경 화면으로 이동한다.
- 새 비밀번호 길이는 다음 변경·재설정부터 적용한다. 기존 암호의 길이는 해시에서 알아낼 수 없으므로 소급 판정하지 않는다. 비밀번호가 없는 계정은 정기 변경 대상에서 제외한다.
- 로그인별 유예는 해당 세션에만 적용한다. 기간 유예는 누른 시점부터 설정한 개월 수까지 유효하다. 비밀번호 정책 revision 변경, 암호 변경, 만료 후에는 이전 유예를 사용할 수 없다.
- 계정별 DB 잠금 안에서 현재 암호·최근 해시·재설정 증명을 검사한다. 인증 어댑터와 훅을 같은 PostgreSQL 트랜잭션에 묶어 실패 시 전체를 원복한다.
- 성공한 변경은 과거 해시를 최대 9개 보관한다. 현재 해시와 합쳐 최근 10개를 검사한다. 성공 시 기존 세션·남은 재설정 링크·모든 유예를 회수한다. 인증 라이브러리가 변경 직후 발급한 새 세션도 변경 화면에서 로그아웃시킨다.
- 해시와 변경 시각·감사 이벤트는 DB 트리거에서 함께 기록한다. 암호·해시·토큰은 API DTO와 감사 상세에 넣지 않는다.
- 서버 내부의 인증 API 직접 호출로 정책 검사를 우회하는 것도 거부한다. 변경/재설정 요청의 Origin, 본문 크기·필드, 계정별 요청 제한을 검사한다.

## 실제 검증 결과

| 검사 | 결과·증거 |
|---|---|
| 전체 PostgreSQL 통합 | [79개 통과](integration.log): 기반 42, 승인 15, 비밀번호 22 |
| TypeScript | [통과](typecheck.log) |
| 프로덕션 빌드 | [통과](build.log), 로컬 메일을 명시한 ALLOW_LOCAL_MAIL=1 사용 |
| ESLint | [오류 0, 기존 경고 21](lint.log) |
| 개발·테스트 DB migration | [개발](migrations-dev.log), [테스트](migrations-test.log): migration 9/10 적용 |
| 브라우저 변경 후 독립 DB 조회 | [최종 대조](database-evidence.json), [기간 유예 상태](period-database-evidence.json) |
| 배포용 서버 재시작·재로그인 | [화면](production-restart.png), [기록](production-restart.txt) |

정상 변경 외에 잘못된 현재 암호, 다른 Origin, 직접 API 우회, 여러 회사 규칙, 현재/이전 해시 재사용, 동시 변경·동시 재설정, 실패한 재설정 링크 재사용 가능 여부, 세션 생성 실패 시 전체 원복, 원복 후 요청 제한 유지, 달력 월말·윤년, 회사 전환·정지·세션 만료, 유예와 재설정 경합을 검사했다.

## Ego Lite 검증

TaskSpace 30의 p1에서 전용 로컬 QA 회사와 계정을 사용했다. 계정·소속·이메일 인증 상태는 scripts/qa-password-policy.ts prepare로 준비했다. 만료 상태 재현을 위해 이 계정의 passwordChangedAt만 두 번 과거로 설정했다. 원본 사이트와 기존 A/B 회사 정책은 수정하지 않았다.

1. 1개월·최소 16자·최근 10개 제한·다음 로그인 유예를 화면에서 저장하고 새로고침했다. [저장 화면](policy-saved.png)
2. 오래된 암호 상태에서 대시보드가 변경 화면으로 이동했다. [만료 화면](expired.png)
3. 다음 로그인 유예 후 회사 기본 정보를 열었다. 로그아웃·재로그인하면 변경 화면이 다시 나타났다. [유예](session-deferred.txt), [재로그인](next-login-required.txt)
4. 같은 암호의 재사용을 거부했다. 다른 암호로 변경한 뒤 이전 암호의 로그인이 실패하고 새 암호의 로그인이 성공했다. [재사용 거부](reuse-rejected.png), [변경 완료](changed.png), [이전 암호 로그인 거부](old-login-rejected.txt)
5. 기간 유예를 저장하고 만료 상태에서 유예했다. 재로그인 후에도 회사 정책 화면에 접근했다. [기록](period-deferred-relogin.txt)
6. UTC 수정 후 배포용 빌드를 실행했다. 첫 번째 암호의 재사용을 다시 거부한 뒤 새 암호로 두 번째 변경을 완료했다. 변경 시각·해시 2개·유예 회수를 DB와 대조하고 새 암호로 로그인했다. [배포용 변경](production-changed.txt)

QA 계정 비밀은 Git 제외 파일 .local/password-policy-qa.json에 권한 600으로 보관한다. 화면 기록은 비밀번호 입력란을 비우거나 완료 화면에서 수집했다.

## 발견하고 수정한 시간대 오류

독립 DB 대조 중 SQL 트리거의 변경 시각이 실제 UTC보다 9시간 뒤로 저장되는 오류를 발견했다. PostgreSQL 기본 시간대 Asia/Seoul의 clock_timestamp()가 Prisma의 오프셋 없는 DateTime 열에 들어가면서 생긴 문제였다.

- 앱 DB 연결은 UTC를 명시한다. 트리거도 UTC 변환을 명시해 다른 시간대의 직접 연결에서도 올바르게 기록한다.
- migration 10은 기존 미래 시각의 암호 기록·요청 제한·작업 lease만 보정한다. 암호 감사 기록의 원래 시각과 보정 시각을 별도 system.timestamp_corrected 이벤트로 남긴다. 감사 수정 금지 트리거는 migration 트랜잭션 종료 전에 복원한다.
- [보정 전 발견 자료](change-before-timezone-repair.json)는 진단 이력이다. 현재 상태는 최종 DB 대조를 기준으로 한다.
- 한국 시간 연결에서 직접 암호를 갱신하는 검사, 예약 작업 조기 실행 거부, 활성 lease 중복 점유 거부, 요청 제한 만료 시각 검사를 추가했다.
- 최종 배포용 변경의 User.passwordChangedAt과 인증 계정 updatedAt이 1초 이내로 일치하고 미래 시각이 없음을 확인했다.

## 실행 명령과 제한

```sh
npm test
npm run typecheck
npm run lint
ALLOW_LOCAL_MAIL=1 npm run build
ALLOW_LOCAL_MAIL=1 npm start -- --port 3100
node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa-password-policy.ts evidence
```

- 과거 이력은 migration 이후의 변경부터 쌓인다. 이전 암호를 복원하거나 만들어 넣지 않는다.
- SMTP 실제 수신 시험, IP 정책, SSO, 사후 파기 정책과 전체 페이지 E2E는 남아 있다. 이 검증으로 해당 Task들을 완료 처리하지 않는다.
- pg 8 어댑터의 병렬 query deprecation 경고는 남아 있다. 현재 검사는 통과하며 pg 9 전환 전 확인이 필요하다.
