# P09-T04 알림톡 발송·수신 결과 — 미완료

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

2026-10-12: `KAKAO_PROVIDER=local` 로컬 발송 어댑터 + **공통 캠페인 채널 연결**까지 완료.

- 캠페인 `channel="kakao"`: 발신자 대신 승인 `KakaoTemplate`을 테넌트·서비스 스코프로 바인딩하고 `kakaoTemplateVersion`을 고정(`Campaign.kakaoTemplateId/Version` + 복합 FK, `check_campaign` 불변성).
- 수신자·동의: `marketingChannel`에 `kakao` 추가, `kakaoQuestionId` 폼 수집·공개폼 체크박스, 동의 해시 `marketing:kakao:` 분리.
- 예약/재예약/재시도: `requireTransport`가 공급자·승인·채널 확인·버전 일치를 재검증(템플릿 수정 시 409 `TEMPLATE_UNAVAILABLE`, 공급자 없음 503 `KAKAO_PROVIDER_REQUIRED`).
- 워커: `kakao-local` 전송이 `sending` 선기록 → `LOCAL_KAKAO_DIR/<jobId>.json` 영수증 → `local_delivered`; 잔액 예약·capture/release·리스 회수·`sending` 복구 경로를 SMS와 같은 정산 규칙으로 처리. 잡-캠페인 발신자 바인딩은 `IS NOT DISTINCT FROM`으로 NULL 허용.
- UI: `/alimtalk`(채널 등록·확인), `/alimtalk/templates`(초안·심사), `/alimtalk/direct|catchform|history`(캠페인 작성·발송 내역 + **실패 시 문자 대체발송** 발신자 선택), 카카오는 메시지 템플릿 라이브러리·발신자 선택 비노출.

2026-10-12 추가: **대체 SMS 발송** 로컬 구현.

- `Campaign.fallbackSenderId/fallbackSenderVersion` — 카카오 채널 전용, 동일 테넌트·서비스의 SMS 발신자만 허용(바인딩 시 버전 핀, `check_campaign` 불변성 + 채널·스코프 DB 가드).
- 스케줄 재검증: 대체발신자 상태·버전·만료·SMS 트랜스포트 확인, 불가 시 `FALLBACK_UNAVAILABLE`; SMS 트랜스포트 정책은 기존 sms 채널과 동일.
- 워커: 카카오 발송 최종 실패 시 SMS 채널 동의(`marketing:sms:` 해시 + contactCipher) 존재 수신자에 한해 `failed→queued(attempt+1)` 전이 후 대체 잡 생성(`senderId=fallbackSenderId`, `sms-*` 트랜스포트, SMS 단가 과금, 원장 원천 `<deliveryId>:fallback`으로 카카오 홀드와 분리). 동의 없음·미등록 대체발신자·시도 한도 초과 시 그대로 실패 종결.
- 트리거: `check_campaign_job`이 대체발신자 바인딩 허용, `check_sender_job`이 카카오 캠페인의 등록된 대체발신자 SMS 잡 허용, `check_campaign_delivery_lifecycle`의 `failed→queued` attempt 증분 규칙 준수.

증거:
- `tests/server/campaigns.test.ts` "kakao campaigns pin an approved template, deliver locally and reject stale or foreign bindings" — 발신자 지정 422, 타 테넌트 템플릿 404, 승인 템플릿 바인딩→버전 고정→`local_delivered`+영수증 본문 치환(`#{name}/#{contact}`), 템플릿 수정 후 스케줄 409·재저장 시 신버전 재고정, `unconfigured` 시 503+잡 0건.
- 같은 파일 "kakao failure falls back to a consented SMS sender once, billed at the SMS rate" — 카카오 실패→SMS 동의 수신자만 대체 잡 생성·`LOCAL_SMS_DIR` 영수증·`local_delivered`, 원장 `reserve 25→release 25`(카카오 해제)+`reserve 15→capture 15`(SMS 단가), 종료 잡 재실행은 `CAMPAIGN_JOB_SCOPE`로 거부·잡 수 2개 유지, SMS 미동의 수신자는 대체 없이 `dead` 종결. 파일 59/59 통과.

## 남은 구현·수용

공급자 sandbox 실제 발송·수신 결과 webhook 대사(외부 계정 필요).

원래 범위: 승인 템플릿과 수신자, 예약·취소·발송내역·실패 대체발송 정책을 공통 캠페인에 연결한다.

수용 조건: 공급자 sandbox 실제 결과; 변수 누락/거부/부분실패; 대체발송 중복/요금 검증

선행: P09-T03, P08-T03. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.
