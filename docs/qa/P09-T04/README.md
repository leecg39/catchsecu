# P09-T04 알림톡 발송·수신 결과 — 미완료

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

2026-10-12: `KAKAO_PROVIDER=local` 로컬 발송 어댑터 + **공통 캠페인 채널 연결**까지 완료.

- 캠페인 `channel="kakao"`: 발신자 대신 승인 `KakaoTemplate`을 테넌트·서비스 스코프로 바인딩하고 `kakaoTemplateVersion`을 고정(`Campaign.kakaoTemplateId/Version` + 복합 FK, `check_campaign` 불변성).
- 수신자·동의: `marketingChannel`에 `kakao` 추가, `kakaoQuestionId` 폼 수집·공개폼 체크박스, 동의 해시 `marketing:kakao:` 분리.
- 예약/재예약/재시도: `requireTransport`가 공급자·승인·채널 확인·버전 일치를 재검증(템플릿 수정 시 409 `TEMPLATE_UNAVAILABLE`, 공급자 없음 503 `KAKAO_PROVIDER_REQUIRED`).
- 워커: `kakao-local` 전송이 `sending` 선기록 → `LOCAL_KAKAO_DIR/<jobId>.json` 영수증 → `local_delivered`; 잔액 예약·capture/release·리스 회수·`sending` 복구 경로를 SMS와 같은 정산 규칙으로 처리. 잡-캠페인 발신자 바인딩은 `IS NOT DISTINCT FROM`으로 NULL 허용.
- UI: `/alimtalk`(채널 등록·확인), `/alimtalk/templates`(초안·심사), `/alimtalk/direct|catchform|history`(캠페인 작성·발송 내역), 카카오는 메시지 템플릿 라이브러리·발신자 선택 비노출.

증거: `tests/server/campaigns.test.ts` "kakao campaigns pin an approved template, deliver locally and reject stale or foreign bindings" — 발신자 지정 422, 타 테넌트 템플릿 404, 승인 템플릿 바인딩→버전 고정→`local_delivered`+영수증 본문 치환(`#{name}/#{contact}`), 템플릿 수정 후 스케줄 409·재저장 시 신버전 재고정, `unconfigured` 시 503+잡 0건. 파일 58/58, 카카오 템플릿 2/2 포함 60/60 통과.

## 남은 구현·수용

대체 SMS 발송 정책, 공급자 sandbox 실제 발송·수신 결과 webhook 대사.

원래 범위: 승인 템플릿과 수신자, 예약·취소·발송내역·실패 대체발송 정책을 공통 캠페인에 연결한다.

수용 조건: 공급자 sandbox 실제 결과; 변수 누락/거부/부분실패; 대체발송 중복/요금 검증

선행: P09-T03, P08-T03. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.
