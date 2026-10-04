# P06-T05 정보주체 조회·동의 철회 — 브라우저·HTTP 게이트 (2026-10-04)

live dev(3100), `/infoOwner/*` 공개 포털, 정보주체 `idem@catchsecu.local.test`(응답 `ff705ae3` 보유).

## 접근 요청 — 존재 추측 불가
- `POST /subjects/access-requests`: 존재 이메일·비존재 이메일·이름 불일치 모두 **202 `{"accepted":true}`** 동일 응답
- 이름+이메일이 실제 응답과 일치할 때만 `SubjectAccessRequest` 생성(10분 만료·tokenHash·**browserHash** 저장) — 비매칭은 저장조차 없음
- mail Job queued → worker가 로컬 전달 (`동의 이력 조회 이메일 인증`, 일회용 링크)

## 인증 — 일회용·브라우저 바인딩
- curl로 요청한 토큰을 Chrome에서 사용 → **거부** "조회를 요청한 브라우저에서 다시 시도해주세요"(browserHash 불일치 — 타인·타기기 토큰 차단)
- 같은 브라우저에서 요청→메일 링크→인증 완료 → 세션 발급, URL이 불투명 세션 ID로 전환
- 소비된 토큰 재사용 → **422 SUBJECT_LINK_INVALID** (일회용 소비)
- 세션 만료 표시 "조회 인증 종료: 21:47:37" (발급+30분), `SubjectSession.expiresAt` 일치

## 동의 이력 조회
- 본인 응답만: 폼 제목·서비스·상태(동의 완료)·제출일·보유 종료일·동의 목적·동의일
- 처리 이력 탭·새로고침·조회 종료 제공

## 철회 E2E
- "동의 철회 요청" → 확인 화면(후속 발송 차단 안내) → 확정 → "동의 철회가 완료되었습니다" + 필수 안내는 수신 가능 안내
- DB: `Submission.status=withdrawn·version=3`, `SubjectWithdrawal status=completed·sessionId 바인딩·finishedAt`
- **Suppression 반영**: `Suppression channel=email reason=subject_withdrawal` 생성 → 다음 발송 suppression에 즉시 반영
- (참고) 관리자 철회는 `reason=administrator_withdrawal`로 구분 기록
