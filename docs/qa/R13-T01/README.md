# R13-T01 정보주체·동의이력·본인인증 모델 대조

2026-10-14. DataSubject·SubjectAccessRequest/Scope·SubjectSession·SubjectWithdrawal·ConsentReceipt/Event·VerificationIntegration/Revision·VerificationReceipt를 `prisma/schema.prisma`와 서버 코드로 대조했다.

## 동명이인·서비스 분리

- `DataSubject`: contactCipher(암호화)+nameHash/emailHash/**identityHash**(이름+이메일 조합 HMAC) — 동일 이메일 다른 이름 분리, tenant·service 범위 독립.
- `SubjectAccessScope`: access-request를 서버가 결정한 제출 범위로 좁힘 — 요청자가 임의 범위를 넓히지 못함.

## 접근 토큰·세션

- `SubjectAccessRequest`: tokenHash unique·browserHash(발급 브라우저만 소비)·expiresAt·consumedAt 단일소비.
- `SubjectSession`: requestId unique(요청당 세션1)·tokenHash·expiresAt·revokedAt.

## 동의 이력·철회

- `ConsentReceipt` 불변 + `ConsentEvent`(granted/withdrawn)·`SubjectWithdrawal`(requested→completed/cancelled, version 기반 stale 거부)·`Suppression`(철회 후 서비스별 메일 억제).

## 본인인증

- `VerificationIntegration`+`Revision`(provider·environment·status 버전 이력, service unique).
- `VerificationReceipt`: attemptId unique(중복 callback 거부)·eventId·formVersionId·publicationId·documentHash·proofHash 불변 결합, provider/kind/environment 명시. 검증 미설정이면 영수증 생성 없음.

## 대조 결과

스키마=구현 일치, migration 불요. 외부 제공사 차원: 실 본인인증 기관 미연동 → external_pending.
