# R06-T01 보안 모델·규칙 대조 완료

2026-10-11 개발/테스트 PostgreSQL의 기존 보안 모델을 다시 읽고 DTO·집행 코드·네이티브 제약 시험을 대조했다. 새 migration은 필요하지 않았다.

| 모델 | 계약과 관계 |
| --- | --- |
| SecurityPolicy | 회사 PK/FK 하나, 비밀번호/세션/MFA/승인/보유 정책, version·passwordRevision·approvalRevision. 수정·초기화는 소유자/현재 암호와 낙관 잠금 및 감사 트랜잭션을 사용한다. |
| IpAccessPolicy | 회사 단일 접근 정책, 양수 version 및 갱신+1, 활성화 시 허용 규칙 필요. |
| IpRule | 회사+정규화 CIDR unique, IPv4/IPv6·매핑 주소, tenant 이동 차단·version+1·현재 관리자 차단 방지, 삭제 시 요청 캐시 무효화. |
| MfaException | 같은 회사 대상자·생성자 복합 FK, 대상별 unique, 암호화 사유, 최초 생성부터 최대24시간, 자기 예외 금지·version+1, 삭제/만료 즉시 보호 재적용. |
| BillingPlanVersion.capabilities | 현재 CHECK는 R06의 정책·IP·MFA 3개와 R07의 SSO 키를 포함한 4개 키를 허용한다. 기본 5개 상품 버전은 trial의 R06 3개, 유료 상품의 MFA 1개 매핑을 정확히 대조했다. non-null 배열 CHECK·버전 불변 트리거를 확인했다. 요금제 이름이나 표시 문구로 권한을 추정하지 않는다. |

두 DB 모두 보안 4모델 42컬럼·21제약·7인덱스·4트리거가 내용까지 동일하다. migration은148개다. [요약](model-summary.json), [개발](catchsecu_dev.json), [시험](catchsecu_test.json), [기능 권한](entitlements/).

권한 모델 검사에서 테스트용 다른 스키마의 동명 CHECK까지 세어14개로 실패하던 조회를 발견했다. 대상 public.BillingPlanVersion으로 한정한 후 통과했다. 다른 시험 스키마나 기존 DB 제약은 변경하지 않았다.

[13파일222개 PostgreSQL 회귀](../../R06-T02/current/regression-tests.json)가 직접 DB 제약 거부·CRUD·권한·경합·기한 집행까지 확인한다. [품질](../../R06-T02/current/quality-gates.json). 기본12자·세션30분 및 trial/유료 상품별 기능 매핑은 [독립 구현 계약](../../../planning/09-rea-fullstack/security-entitlements.md)이며 원본 서버의 미관찰 기본값을 확정하지 않는다.
