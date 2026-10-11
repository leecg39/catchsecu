# R12-T01 외부 공유·열람자 인증 모델 대조

2026-10-14. ShareGrant·ShareField·ViewerChallenge·ViewerSession을 `prisma/schema.prisma`와 `src/server/viewer.ts`로 대조했다.

## 공유 범위

- `ShareGrant`: tenant·service·form·**formVersion** 복합 FK — 게시본 버전에 고정, 이후 버전 자동 공유 안 함. `emailCipher`+`emailHash`(검색용 해시, 평문 비저장), `codeHash` unique, `expiresAt`, `shareFormBody`, `revokedAt`, `version`(grantVersion).
- `ShareField[]` — 허용 질문 목록; 회사·폼버전 범위 밖 질문은 복합 FK로 거부.

## challenge·세션 무효화

- `ViewerChallenge`: `grantVersion` 핀(권한 수정 시 구 챌린지 무효), `clientHash`(발급 브라우저만 verify 가능), `codeHash`, `attempts ≤5`, `expiresAt`, `consumedAt` 단일소비.
- `ViewerSession`: `challengeId` unique(챌린지당 세션 1), `tokenHash` unique, `expiresAt`(공유 만료 상한 30분), `revokedAt`. 매 요청 `grant.revokedAt/expiresAt/fields.empty`·발급자 멤버십·전문가 배정기한 재검사.
- 권한 수정(PATCH)·회수(DELETE)는 `version` 증가 → `grantVersion` 불일치로 구 챌린지·초대코드 즉시 무효.

## 대조 결과

스키마·제약·관계=구현 일치, migration 불요. 외부 제공사 차원 없음(로컬 메일 어댑터; 실 제공사 수신 증거는 external_pending).
