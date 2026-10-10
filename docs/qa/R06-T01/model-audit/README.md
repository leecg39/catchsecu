# R06 보안 데이터 모델 대조

개발/테스트 PostgreSQL의 SecurityPolicy·IpAccessPolicy·IpRule·MfaException 4개 모델을 읽기 전용으로 대조했다. 두 DB 모두 42컬럼·21제약·7인덱스·4트리거를 확인했다.

- [개발 DB](catchsecu_dev.json), [테스트 DB](catchsecu_test.json)
- 회사 단일 정책, 회사/CIDR unique, 정규화된 CIDR, 양수 version과 갱신 시 +1, 같은 회사 구성원/생성자 복합 FK, 예외 사유 암호화, 자기 예외 금지, 최초 생성부터 최대 24시간을 검사했다.
- PasswordHistory·PasswordDeferral·TwoFactor는 [R02 모델 검사](../../R02-T01/model-audit/README.md)와 이번 비밀번호/MFA 서버 회귀 시험을 함께 참조한다.

신규 migration은 없다. 기본 비밀번호 12자·세션 30분 등의 수치는 현재 독립 구현 계약이며 원본 서비스의 미관찰 기본값으로 단정하지 않는다.
