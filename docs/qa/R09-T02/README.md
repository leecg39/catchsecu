# R09-T02 승인·게시·고정 URL 서버 API·업무 처리 검증

2026-10-11 현재 소스와 격리 PostgreSQL `catchsecu_test`에서 검증했다.

## 결과

- R09-T02 소유 OpenAPI 작업 33개를 9개 실제 Route Handler와 대조했다. 실행 계약과 달리 `POST /forms/{id}/revise`의 필수 `Idempotency-Key`가 생성 원본에 누락돼 있어 추가했고, 전체 계약은 333 path·474 operation·474 정책 행으로 일치한다.
- 자기승인 계약을 확정했다. 회사 `SecurityPolicy.approvalRoles`에 구성된 역할(`owner|admin|security`)이면 요청자 본인도 결정할 수 있고, 미구성 역할은 본인 요청도 `REVIEWER_FORBIDDEN`으로 거부된다. `form.approve` capability가 없으면 결정 API 자체가 403이다. 게시 시점에는 검토자의 현재 활성 멤버십·역할·서비스 grant를 다시 검사해 상실 승인을 `REVIEWER_UNAVAILABLE`로 차단한다.
- 만료 라이선스 write gate를 확정·검증했다. 구독 한도는 신규 청구 자원(`services|members|subjects|forms`) 생성만 402로 막고, 기존 폼의 승인 요청·결정·게시·고정 URL 생성·중단·재개는 현재 capability/서비스 grant로 계속 처리한다.
- 수용 시나리오 핀을 PostgreSQL 통합시험으로 고정했다. 초안→승인→게시→외부접속→중단410→재개, 승인본 바꿔치기 거부(`STALE_APPROVAL`/superseded), 고정 URL의 재게시 대상 교체와 이전 링크 410, 같은 slug 동시 생성 201+409, 링크 조회·복사만으로 게시/응답/감사가 생기지 않음, 승인 증빙·검토본 불변 스냅샷을 확인했다.
- 감사 저장 실패는 승인 요청·승인 결정·게시·고정 URL 생성의 업무 행과 함께 원자 롤백된다(`form.published`, `approval.requested`, `approval.approved`, `fixed_url.created` 결함 주입 시험).
- 현재 권한 재검사를 고정했다. 세션/멤버십/회사/이메일/서비스 grant/정책 변경 후 이전 Context·멱등 재전송·캐시 성공을 재사용한 쓰기·조회가 거부되고, 게시·승인·고정 URL 재전송도 현재 grant를 다시 검사한다.
- 승인·게시·고정 URL·폼 생명주기 회귀 12파일 143시험이 통과했다.
- 실제 DB 독립 대조 결과 폼당 중복 활성 승인 0, 게시 없이 consumed된 승인 0, 폼당 복수 active 게시 0, 보관 폼의 active 게시 0, 교차 회사 고정 URL 0, 다른 폼 버전에 연결된 게시 0이다.

실제 본인인증·전자서명·참여 인증 공급자 수신 증거는 이 로컬 API 작업의 완료 조건과 분리하며 R09-T04에서 `external_pending` 여부를 판정한다. 게시 시 local sandbox 공급자만 허용하는 `PROVIDER_ADAPTER_REQUIRED`/`SOCIAL_PARTICIPATION_PROVIDER_REQUIRED` 게이트는 서버 계약으로 확인했다.

## 증거

- [API·DB 대조](current/api-audit.json)
- [승인·게시 12파일 143시험](current/regression.log)
- [계약 핀 시험](../../../tests/server/r09-publish-contract.test.ts)
- [OpenAPI 계약](../../planning/contracts/openapi.json)
- [작업별 정책 행렬](../../planning/contracts/operation-policy-matrix.csv)
- [자기승인·라이선스 게이트 결정](../../planning/contracts/README.md#r09-t02-승인게시고정-url-계약-결정)
