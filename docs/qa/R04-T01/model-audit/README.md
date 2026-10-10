# 구성원·초대·전문가 모델 대조

2026-10-10. dev/test의 Membership, ServiceGrant, Invitation, ExpertAssignment, ExpertAssignmentService를 읽기 전용으로 대조했다. 각각 43컬럼·20제약·21인덱스·7트리거이며 신규 migration은 없다.

- 회사/사용자별 멤버십과 회사/멤버/서비스 grant는 유일하다. grant의 멤버·서비스 FK는 tenantId를 함께 참조한다.
- Invitation은 tokenHash가 유일하고, 회사+lower(email)의 pending 부분 유일 인덱스로 대기 초대 중복을 막는다. pending/accepted/revoked/expired 상태를 제약한다. 서비스 배열·초대자/수락자 문자열의 유효 scope는 서버의 현재 권한/서비스 검사로 확인하며 모든 속성에 FK가 있다고 주장하지 않는다.
- 전문가 배정은 회사/전문가별 유일하며, 배정 서비스와 전문가 멤버십은 회사 및 사용자 범위를 포함한 FK로 연결된다. active/revoked 상태와 revokedAt, version·만료의 업무 규칙은 서버 검사와 함께 대조한다.
- 마지막 활성 owner 변경/삭제 트리거는 회사 행을 잠그고 나머지 owner 존재를 확인한다. 관련 동시성·회수·만료 검사는 R04-T02 서버 시험으로 별도 실행한다.

실행: `node --env-file=.env.local --import tsx scripts/qa-rea-members-model.ts` 및 `.env.test.local`.

[dev](catchsecu_dev.json) · [test](catchsecu_test.json). 메타데이터 확인이 전체 원본/운영 수용 완료를 의미하지 않는다.
