# P11-T02 — IP 접근 관리 부분 구현

> **완료 판정 정정 (2026-10-04): 미완료.** 0934f4e의 일괄 완료 표시는 수용 조건의 증거를 충족하지 못해 철회했다. 아래 구현·시험 주장은 각 실제 파일/실행 결과와 다시 대조한다. 테스트 파일의 존재는 실행 통과나 브라우저/외부 연동 완료를 뜻하지 않는다. [재검증 계획](../../planning/05-completion-recovery.md).

최신 검증: [회사 2FA·임시 예외·보안 현황](mfa/README.md). 아래는 앞선 IP 구현 시점의 기록이다.

2026-10-04. 상태: **진행 중**. IP 관리의 모델·API·화면과 실제 접근 검사를 구현했다. 2FA 강제·예외 만료·보안 현황 전체는 남아 있다.

## 구현

- 회사별 IP/CIDR 등록·목록·상세·수정·삭제, 검색·정렬·페이지와 제한 활성화/해제. 직접 소속 owner만 변경하며 관리자/보안 담당자는 조회한다.
- IPv4/IPv6 정규화, 매핑된 IPv6 검사, 중복·엄격한 쿼리·version 충돌·동일 생성 재시도. 삭제 후 생성 캐시 원문과 해시도 제거한다.
- 활성화 때 현재 비밀번호를 확인하고, 현재 owner의 접속 주소를 차단하는 변경과 마지막 허용 규칙 삭제를 거부한다.
- 로그인·회사 선택·회사 데이터 요청·파일/서비스 변경에서 현재 IP 정책을 검사한다. 회사 목록에는 접근 가능한 회사만 표시한다.
- 회사 잠금과 PostgreSQL CHECK/trigger로 CIDR·version·소속 불변성과 마지막 허용 규칙을 보호한다.
- `/security/ip`, `/security/ip/setting`, `/not-allow-ip` 화면을 API에 연결했다. 회사 전환 때 이전 회사의 편집 상태를 새로 만든다.

## 접속 주소와 실행

Node HTTP의 실제 소켓 주소를 기준으로 IP 헤더를 덮어쓰고 요청마다 서명된 내부 증명을 발급한다. 소켓 API는 [Node 공식 문서](https://nodejs.org/docs/latest-v24.x/api/http.html#requestsocket)에 따른다. 임의의 Forwarded·X-Forwarded-For·X-Real-IP·내부 증명 헤더는 직접 요청의 주소를 바꾸지 못한다.

Node 24에서 `npm run dev`, 또는 빌드 후 `npm start`를 사용한다. 실행 파일은 `scripts/server.ts`다. 기본 바인딩은 127.0.0.1:3100, 신뢰 프록시는 0개다. 필요할 때 APP_BIND_ADDRESS·APP_PORT·APP_TRUSTED_PROXY_CIDRS에 실제 배포 설정을 지정한다. 프록시 CIDR은 제한된 범위만 허용하며 /0은 거부한다. 직접 next start를 실행하면 내부 IP 증명이 없어 활성 IP 제한은 접근을 거부한다.

## 검증

| 검증 | 결과 | 기록 |
|---|---|---|
| 관련 PostgreSQL 시험 | 4파일 105개 통과, 실패/대기 0; IP 32개 포함 | [관련 시험](related-tests.json) |
| Production HTTP | 21 + 재시작 뒤 17 = 38개 통과 | [준비](http-prepare.json), [재시작·거부·삭제](http-finish.json) |
| 타입 검사 | 오류 0 | [로그](typecheck.log) |
| 변경 파일 린트 | 오류 0; 기존 인증 화면 이미지 경고 4개 | [기존 범위](lint.log), [최종 범위](lint-final.log) |
| Production 빌드 | 성공 | [로그](build.log) |
| Dev/test DB | migration 65개 체크섬 일치, 신규 CHECK/trigger 존재 | [개발 DB](dev-schema.json), [시험 DB](test-schema.json) |
| 별도 DB 확인 | 합성 규칙/세션 0, 삭제 생성 캐시 원문 제거 | [확인](dev-database.json) |

서버 PID 98372→99106 재시작 뒤 IP 설정·규칙·기존 세션 접근이 유지됐다. 자기 합성 회사에만 불허 IP를 설정해 실제 연결 거부·헤더 위조 우회 거부·로그인 거부·회사 정보 비노출·제한 화면 SSR을 확인했다. 마지막에는 자기 합성 제한을 해제하고 규칙을 삭제했다. 기존 회사 31개·계정 33개와 연결 업무 해시는 유지됐다. 전역 worker는 실행하지 않았다.

시험 입력 699개 중 이후 변경은 실행 파일의 @next/env CommonJS 가져오기 수정 1개다. 최종 타입·린트와 실제 기동/재시작 HTTP로 확인했다. [입력 대조](verification-summary.json).

초기 시험은 캐시 삭제 시 requestHash 누락과 마지막 owner를 제거하는 시험 fixture 때문에 4개 실패했다. 수정 후 관련 105개가 통과했다. 초기 실행 파일의 named import 오류도 수정했고 이후 정상 실행됐다. 초기 시험 로그는 별도 보존한다.

## 남은 조건

회사 2FA 강제·owner 예외 만료·복구 경로·보안 현황과 개선 action, P11-T01 선행 조건, 정상 원본 대조·실제 브라우저 조작이 남았다. 브라우저 호출은 0이며 SSR 성공은 화면 조작 검증을 뜻하지 않는다. 기존 Ego 제어 중단의 재개 질문은 아직 답을 받지 못했다. [ego-browser SKILL.md](/Users/user01/.agents/skills/ego-browser/SKILL.md:74)의 “stop and ask the user” 지침에 따라 재개 응답 전에는 브라우저를 조작하지 않는다.

공식 완료는 15/72, 상태는 완료 15·진행 20·계획 37이며 전체 goal은 active다.

2026-10-04 후속: MFA 화면을 가리던 대시보드 분기와 검색 포커스·모바일 표 넘침을 수정했다. [실제 화면/37개/최종 빌드 근거](revalidation/README.md). 전체 Task는 진행 중이다.

## IP 접근 관리 브라우저 실측 (2026-10-05, `scripts/qa-ip-access.ts` → [ip-access-browser.json](ip-access-browser.json))

owner/viewer 계정으로 `/security/ip`를 실브라우저 실측했다. 10/10 통과.

- 목록 화면: 정책 카드(접근 제한 사용 여부)·현재 접속 IP·검색/필터 렌더 ([screenshot](states/ip-list-owner.png))
- 규칙 생성: `POST /security/ip-rules`는 `idempotency-key` 필수 — 헤더 포함 시 201, 잘못된 CIDR(`999.999.999.999/99`)은 422
- 목록 반영: 생성 후 새로고침에 `203.0.113.0/24` 행 표시, 삭제 204
- viewer: 쓰기 POST 403, 목록은 읽기/게이트로 종결 ([screenshot](states/ip-list-viewer.png))
- pageerror 0

남은 범위: 원본 대조·Ego 세션·선행 전체 게이트는 계속 미완료.
