# R22-T01 감사로그·활동 검토 모델 대조

2026-10-11 현재 dev/test PostgreSQL과 Prisma 스키마를 읽기 전용으로 대조했다. 스키마 변경은 필요하지 않았다.

- `AuditEvent`, `ActivityReview`, `ActivityReviewMessage` 3모델 35열, 16제약, 13인덱스, 3트리거가 dev/test에서 동일했다.
- 감사 원장은 UPDATE·DELETE 불변 트리거로 보호된다. 검토 메시지도 승인된 보유 기한 파기 외에는 수정·삭제할 수 없다.
- 검토는 회사·서비스·감사 사건·처리자 복합 FK로 연결되고, 요청자·수신자도 회사 범위 복합 FK를 사용한다. 실제 고아 참조는 0건이었다.
- 상태·일시·파기 증거 제약, 열린 사건 단일 검토 unique, 동일 시각 페이지를 위한 `createdAt,id` 인덱스, 150개 migration을 확인했다.
- 원문·IP·외부 고객번호·사유는 추정해 추가하지 않고, 현재 관계에서 안전하게 확인 가능한 폼·응답 식별자만 DTO에 제공한다.

## 증거

- [dev 모델 대조](current/catchsecu_dev.json)
- [test 모델 대조](current/catchsecu_test.json)
- [대조 스크립트](../../../scripts/qa-r22-model.ts)
