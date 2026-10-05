# P09-T04 알림톡 발송·수신 결과 — 미완료

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

2026-10-12: `KAKAO_PROVIDER=local` 로컬 발송 어댑터가 추가됐다. 승인 템플릿+확인 채널에서 `POST /kakao/templates/:id/send`가 `local_delivered` 영수증(`LOCAL_KAKAO_DIR/<templateId>.json`)을 남기며, 미승인/미확인 409 경계와 `unconfigured` 시 503 경계는 유지된다(`sendKakaoTemplate`). 채널 확인·템플릿 심사도 로컬 공급자에서 실제 webhook 코드 경로로 확정된다. [P09-T03](../P09-T03/README.md) 참조.

- [src/server/kakao.ts](../../../src/server/kakao.ts) — sendKakaoTemplate, requestKakaoChannelVerification, applyKakaoReview
- [tests/server/kakao-templates.test.ts](../../../tests/server/kakao-templates.test.ts) — 로컬 공급자 전체 경로 2/2 통과

## 남은 구현·수용

수신자 단위 발송(공통 캠페인 연결)·예약·취소·대체 SMS·과금, 그리고 공급자 sandbox 실제 발송·수신 결과 webhook.

원래 범위: 승인 템플릿과 수신자, 예약·취소·발송내역·실패 대체발송 정책을 공통 캠페인에 연결한다.

수용 조건: 공급자 sandbox 실제 결과; 변수 누락/거부/부분실패; 대체발송 중복/요금 검증

선행: P09-T03, P08-T03. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.
