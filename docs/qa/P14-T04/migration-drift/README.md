# DB 변경 이력과 새 설치 구조 대조

2026-10-06. `scripts/qa-migration-drift.ts`로 개발 DB는 읽기 전용 트랜잭션에서 조사하고, 새 설치는 시험 DB의 임의 이름 schema에서 수행했다. 해당 임시 schema만 종료 시 제거한다.

## 확인 결과

| 시점 | 개발/새 설치 파일 수 | 구조 비교 | 증거 |
|---|---|---|---|
| 조사 시작 | 95 / 95 | 2,825개 항목 동일 | [baseline95-catalog-comparison.json](baseline95-catalog-comparison.json) |
| 유료 만료 수정 적용 전 | 95 / 96 | 함수 1개·인덱스 1개 차이 감지 | [pre-upgrade-catalog-comparison.json](pre-upgrade-catalog-comparison.json) |
| 새 migration 적용 후 | 96 / 96 | 2,826개 항목 동일 | [catalog-comparison.json](catalog-comparison.json) |

테이블 속성, 컬럼·기본값, 제약조건, 인덱스, 트리거, 함수, enum, view, RLS policy 정의를 비교한다. schema 이름만 정규화하고 함수 본문의 공백 차이는 숨기지 않는다. 역할/DB 권한, 확장 버전, 실제 업무 동작은 이 구조 비교만으로 증명하지 않는다. 유료 만료 결함은 두 환경에 동일하게 있었으며 별도 동작 시험으로 찾아 수정했다.

## 체크섬 4건은 미해결

- `20261006100000_payment_methods`
- `20261006110000_paid_activation`
- `20261006120000_refund_closing`
- `20261007000000_sso_providers`

각 파일의 현재 소스와 Git에 남은 버전은 일치하지만 개발 DB의 적용 당시 체크섬과 다르다. Git의 해당 파일 이력에서 일치 원문을 찾지 못했다. 추가로 저장된 Git blob 중 100바이트 초과·40,000바이트 미만 3,578개를 검사했으나 동일 체크섬 원문을 찾지 못했다. 줄바꿈/주석 제거 등 점검한 포맷 변형에도 일치가 없었다. 당시 적용 원문이 보존되지 않아 정확한 원인을 확정하지 않는다.

현재 DDL이 같다는 이유로 적용 이력을 덮어쓰거나 체크섬 검사를 면제하지 않았다. 새 migration과 빈 설치의 체크섬은 모두 일치한다. 감사 스크립트는 기존 4건 때문에 **종료 코드 1**을 유지한다. 로그 [pre-upgrade.log](pre-upgrade.log), [post-upgrade.log](post-upgrade.log).

유료 만료 수정은 새 96번째 migration으로 적용했다. 과거 95개 적용 기록과 결제·구독 관련 10개 테이블의 행 수/해시를 보존했다. [동작 및 데이터 보존 증거](../../P10-T04/expiration/README.md).

## 운영 후속

당시 배포 SQL/백업을 확보하면 해당 SHA-256과 현재 DDL을 다시 대조한다. 원문을 확보하기 전에는 변경 이력의 무결성이 확인됐다고 판단하지 않는다. 앱 업무 동작의 추가 수정은 기존 파일을 고치지 않고 새 migration으로 적용한다. 외부 계정·승인 대기와 별개로 다른 내부 구현·검증을 계속할 수 있다.

```sh
node --env-file=.env.local --import tsx scripts/qa-migration-drift.ts
```

이 명령은 조사 결과 파일을 갱신한다. 이전 결과가 필요한 경우 별도 이름으로 먼저 보존한다. 개발 DB에 migration을 적용하는 명령은 포함하지 않는다.
