# R23-T01 통계·준수 모델 대조

2026-10-11 현재 `catchsecu_dev`와 `catchsecu_test`를 같은 감사 스크립트로 대조했다.

- `BillingMonthClose`, `ComplianceClose`, `ComplianceExportJob` 3개 모델의 36개 컬럼, 13개 제약, 11개 인덱스, 3개 상태·불변 트리거를 확인했다.
- 두 DB 모두 150개 migration이 적용됐고 누락·추가 migration과 잘못된 서비스 범위·출력 범위는 0건이다.
- 결제 월마감과 준수 월마감을 별도 모델로 유지하고, 준수 마감 snapshot·근거 hash·출력 작업의 회사/서비스/요청자 결합을 확인했다.
- dev/test의 정의 hash `7959f93ecf116ef17e6f5bfe24b6085a0aea9c651f1a53c10e6d13cd4fecfbf7`와 migration hash `70ac76b6548de190a2ece069d561d0d585169ea149c47ee45e296fb386deef1a`가 일치한다.

## 증거

- [개발 DB 대조](current/catchsecu_dev.json)
- [시험 DB 대조](current/catchsecu_test.json)
