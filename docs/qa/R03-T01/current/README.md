# R03-T01 회사·서비스·초기 설정 모델·규칙 완료 검증

2026-10-11 현재 소스와 dev/test PostgreSQL을 기준으로 회사·서비스·구성원·서비스 권한·접근 요청·사업자 파일 6개 모델을 다시 대조했다.

## 결과

- dev/test 각각 6개 모델, 66개 열, 29개 제약조건, 24개 인덱스를 실제 카탈로그에서 확인했다.
- `Service.tenantId → Company.id`, 회사 안의 서비스명 unique, `ServiceGrant`의 회사·구성원·서비스 복합 관계를 확인했다.
- 접근 요청의 pending/approved/rejected/cancelled 상태와 회사 범위 복합 FK, 동일 서비스 대기 요청 partial unique를 확인했다.
- 회사 폐쇄는 `Company.status`와 `closureRequested*`로, 구성원 탈퇴·회수는 `Membership.status=revoked`로 분리돼 있다.
- 사업자 파일은 회사 소유 FK와 active 파일 1개 partial unique를 사용한다. 업로드·교체·삭제 경합은 `Company.version`으로 직렬화하고, 파일 행은 검사·삭제 증거로 보존한다.
- 서비스 삭제 API는 물리 삭제 대신 보관 상태로 전환하며, 연결 업무가 있으면 409를 반환한다. 회사 종료도 즉시 삭제 대신 요청·취소 이력을 남긴다.
- 회사/서비스/접근 요청의 C/R/U/D 및 권한·회사 격리·버전 충돌·파일 보존을 실제 PostgreSQL 6파일 158시험으로 검증했다.
- typecheck, 대상 ESLint, production build 82페이지가 통과했다.
- 현재 스키마와 DTO가 완료 조건을 충족해 신규 migration은 추가하지 않았다.

[검증 집계](verification-summary.json) · [회귀 시험](model-regression.json) · [품질 게이트](quality-gates.json) · [dev 모델 감사](../model-audit/catchsecu_dev.json) · [test 모델 감사](../model-audit/catchsecu_test.json)

이 작업은 내부 모델·규칙 단계이므로 외부 자격증명이 필요하지 않다. 원본 사이트의 화면 동등성과 운영 회사 폐쇄 승인은 후속 화면·수용검증 작업에서 판정한다.
