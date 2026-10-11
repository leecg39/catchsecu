# R12-T04 외부 공유 라이브 수용

2026-10-14. `scripts/qa-r12-acceptance.ts`(QA_ORIGIN=http://localhost:3121, production 빌드) 9케이스 통과 — [acceptance.json](acceptance/acceptance.json).

## 검증 체인

1. **fixture**: 3필드 폼 승인·게시 → 공개 제출 2건(s1 열람대상, s2 비공유)
2. **공유 생성**: q1/q2 2필드 지정 + 대조군 공유(q3만, 다른 수신자) → 실제 로컬 메일 작업 처리 → 초대코드 추출
3. **인증**: challenge(202) → OTP 메일 → verify(200) → 세션 쿠키 발급
4. **OTP 재사용**: 동일 코드 재검증 → 422 거부
5. **범위 조회**: s1 상세에서 q1/q2 값 노출, q3("비밀") 비노출
6. **id 주입**: 알 수 없는 UUID → 404 (동일 폼 내 타 응답은 공유 범위로 허용 — 명세상 범위는 폼·필드 단위)
7. **필드 회수 즉시성**: PATCH로 q2 제거 → 같은 세션 재조회에서 q2 비노출(grantVersion 무효화)
8. **완전 회수**: DELETE → 세션 읽기 401
9. **비밀 비노출**: shareGrant 감사 7건에 초대코드·OTP·평문 이메일 미포함

## 누적 보완 증거

- 동시 verify 단일소비·5회 시도·스로틀·수신자 변경 무효화·만료 세션·발급자 권한회수 차단·철회/파기중 응답 숨김·파일 정확결합·복합FK 거부·CSRF/origin: [sharing.test.ts](../../tests/server/sharing.test.ts) 20건
- 실제 브라우저 초대→인증→열람→회수 전정: [docs/qa/sharing/](../sharing/)
- 재시작 지문: [R11-T04 fingerprint](../R11-T04/acceptance/fingerprint.json)에 shareGrant·session 카운트 포함

## 판정

로컬 수용 완료. 실 제공사 메일 수신 증거 없음 — external_pending 유지.
