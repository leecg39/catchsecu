# R06-T04 내부 수용 통과·외부 확인 대기

2026-10-11 현재 production 서버3121에서 기존 보안·구독 fixture7개 회사의 DB와 HTTP를 점검했다. [재현 스크립트](../../../../scripts/qa-r06-acceptance.ts)는 localhost/dev DB만 허용하고 기존 데이터의 정책·규칙·구독을 변경하지 않는다. 테스트용 로그인 세션과 회사 선택만 갱신하며 만료된 회사의 변경 요청은402로 거부된다.

- [기준23건](baseline.json): 새 로그인6건, 실제 TOTP2건, 소유자 정책/IP/MFA/현황200·보안담당200·유휴 폐기 세션401·조회자403·다른회사 규칙404. 만료 회사 설정 읽기는200, 변경은402, 미등록 관리자는MFA_REQUIRED403이다.
- [서버 재시작 후17건](after-restart.json): 기존 독립 HTTP 세션으로 위 집행을 다시 확인했다. 별도 실제 IPv6 리스너3122에서도 IPv4 허용 헤더를 위조한 요청2건은IP_NOT_ALLOWED403이다. 시험 IPv6 서버는 종료했다.
- [Ego 새 로그인](browser-after-restart.json): 암호 입력→실제 TOTP 인증 후 IP·MFA·정책 화면3개에서 보존 상태를 확인했다. IP제한 활성·허용 규칙이 유지된다.
- DB 정책 기본값v5/passwordRevision3/approvalRevision3, 기존IP정책v1/규칙v3, 회사7개의 규칙2건·예외0건·설정변경 감사100건을 재시작 전후 대조했다. 만료된 회사도IP제한과MFA강제를 유지한다. 삭제된 리소스의 멱등 응답/요청해시가 비워지고 무효화 시각이 유지됨을 확인했다.

두 시점의 상태 SHA256: `d9cdcec3f33d1de4ba434bc91a61dbeb50f71c76d466dfff986b203969472379`.

지문은 저장된 보안 정책·규칙·구독·무효화 캐시 참조와 명시한 설정변경 감사만 포함한다. 로그인·화면조회·회사전환 이벤트는 별도 활동이므로 포함하지 않는다. 이전 전체 감사 지문과 다른 범위를 명시했으며 과거 증거를 덮어쓰지 않았다.

현재 [DB222회귀](../../R06-T02/current/README.md), [UI15시험·24폭·품질](../../R06-T03/current/README.md), 기존 [실제 IPv4/IPv6·MFA 자연 만료·CRUD](../security-flow/README.md), [구독6상태·자연 만료·보호 유지](../security-entitlements/README.md)를 함께 수용 근거로 사용한다. 공통 worker 두 독립 실행은 격리 test DB의 [직전 R05 증거](../../R05-T04/current/worker-readiness.json)를 재사용하며, dev 전체 worker를 실행해 보존 fixture를 변경하지 않았다.

로컬 구현은 수용 통과다. 원본 Enterprise 활성 계정의 정확한 기능 매핑과 공식 결제 공급자의 실제 구독 변경 수신은 확보되지 않아 외부 상태를 `external_pending`으로 유지한다. 계획의 `local_acceptance_pass` 규칙에 따라 R07 내부 후속 작업은 진행 가능하다.
