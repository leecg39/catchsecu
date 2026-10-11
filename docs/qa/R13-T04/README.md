# R13-T04 정보주체·동의이력 라이브 수용

2026-10-14. `scripts/qa-subject-access.ts`(QA_ORIGIN=http://localhost:3121, production 빌드) 3단계 재실행 — QA_ORIGIN/QA_OUT override 추가로 P06 증거 보존.

## prepare — 60 케이스 ([http-prepare.json](access/http-prepare.json))

- 독립 회사·2개 서비스·주민 식별 폼 게시 → 같은 이메일 다른 이름/서비스 제출 3건
- access-request 202(알 수 없는 신원도 동일 수용 — 열람 정보 유출 없음) → 실제 로컬 메일 링크
- **브라우저 바인딩 단일소비**: 링크 GET은 소비하지 않음·다른 브라우저 소비 422·재소비 422·세션1개
- 범위 서버 결정: stale 페이지 보정(999→2)·비밀답변/이메일 비노출·strict 쿼리 422·URL 세션id·타인 UUID 401
- **철회 멱등**: 반복 start 동일 id·cancel 재시도 멱등·cancelled confirm 409·새 요청 별개
- **철회 확정→억제**: confirm 후 동일 서비스 메일 `{suppressed:true}`, 다른 서비스는 발송 허용
- **stale version**: 정정된 응답의 구 요청 confirm 409 → version2 재요청
- **세션 실시간 만료** 2040ms 후 캡처 쿠키 401
- 공개 HTML 6경로 200·영수증 해시 불변·대조군 지문 보존

## finish — 서버 재시작 후 11 케이스 ([http-restart.json](access/http-restart.json))

동의이력 2건·완료/대기 철회 상태·이벤트 1건 withdrawn·억제 유지·로그아웃 후 401.

## database — 독립 대조 ([database.json](access/database.json))

- DataSubject 2건: contactCipher 암호화·nameHash/emailHash/identityHash HMAC 재계산 일치
- 철회 completed1/cancelled3/requested1·withdrawn 이벤트1·Suppression1·응답 status withdrawn+version2
- 활성 주체 세션0·소유자 세션0·영수증 해시 불변·주체 감사에 연락처 평문 없음·migration checksum 전수 일치

## 누적·외부 경계

- subjects.test.ts 17건 + verification-flow/configuration 21건 + [docs/qa/subjects/](../subjects/) 브라우저 12경로.
- **실제 본인인증 기관(통신사 PASS·GPKI) 미연동** — external_pending 유지.
