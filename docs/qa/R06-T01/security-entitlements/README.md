# 보안 기능 권한 모델

105번째 마이그레이션은 BillingPlanVersion에 명시적 capabilities 배열을 추가한다. 회사 정책·IP 관리·회사 MFA 관리의 세 키만 허용하며 NULL·중복·다른 키를 CHECK로 차단한다. 기존 버전 불변 트리거를 복원하고 유지한다. 표시용 features나 상품 이름으로 권한을 추론하지 않는다.

- [개발 DB 검사](catchsecu_dev.json), [시험 DB 검사](catchsecu_test.json): 필드·검증된 CHECK·활성 불변 트리거·초기 상품 5버전의 매핑 및 적용 마이그레이션 105개 확인.
- [개발 스키마 대조](catchsecu_dev-contract.json), [시험 스키마 대조](catchsecu_test-contract.json): 예상 밖 차이 0. 기존 SQL 전용 FK 1개는 유지한다.
- 이번 검증은 기존 DB에 대한 업그레이드이며, 과거 104개 마이그레이션의 빈 DB 설치 시험을 105개 새 설치 시험이라고 주장하지 않는다.

trial-v1은 전체 보안 기능 체험, 기존 LIFE/TERMS에 대응해 명명된 유료 버전은 회사 MFA 관리만 포함하도록 명시했다. 이는 독립 제품 계약이며 원본 서버 상품 매핑을 확인한 결과가 아니다. [구현 계약](../../../planning/09-rea-fullstack/security-entitlements.md).
