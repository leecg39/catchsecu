# R19-T02 — 알림톡 채널·템플릿·발송: 서버 API·업무 처리

## 라이브 수용 (`scripts/qa-r19-acceptance.ts run`, 7/7 PASS)

실행 환경: 프로덕션 서버(3121), `KAKAO_PROVIDER=local` + `ALLOW_LOCAL_KAKAO=1`, 워커는 스크립트 환경 `SMS_TRANSPORT=local`.

1. **channel-verified** — 채널 등록 → 로컬 서명 심사 → `verified`. 동일 서비스+searchId 409, 재검증 409(`ALREADY_VERIFIED`).
2. **template-review** — 등록→제출→로컬 승인. 구버전 제출 409. `#반려` 표지 → `rejected`+reviewNote → 수정 → 재제출 → `approved`.
3. **preview-send** — 변수 누락 미리보기 422, 값 지정 렌더. send: `KakaoMockReceipt`에 templateVersion/channelVersion/contentHash 핀 + `mock:true`, 동일 멱등키 → 동일 receiptId. 승인 템플릿 수정 → draft → send 409 → 재심사 → 발송.
4. **channel-reset** — searchId 변경 → 채널 pending 복귀 + 템플릿 draft 초기화 + `kakao.template_review_reset` 감사.
5. **campaign-kakao** — kakao+sms 동의 수신자 → 알림톡 캠페인(템플릿 핀+대체발신자) → 즉시 발송 → 워커 → `local_delivered` + `LOCAL_KAKAO_DIR` 영수증(이름 치환 확인·SHA-256).
6. **sms-fallback** — `#{company}` 미치환 변수 템플릿 캠페인 → 카카오 실패(VARIABLE_MISSING) → SMS 대체발송 잡 → sms-local 영수증(동일 전화번호) + `campaign.delivery_fallback` 감사 + attempt-dedupe 잡 유일.
7. **channel-archive-guard** — 빈 채널 DELETE 204, 삭제 후 verify 404, 사용중 채널 보관 409, 존재하지 않는 템플릿 404.

## API 표면

- `/api/v1/kakao/channels` CRUD·verify·DELETE(If-Match 버전)
- `/api/v1/kakao/templates` CRUD·preview·submit·send·review 조회
- `/api/v1/kakao/reviews` 서명된 심사 콜백
- `/api/v1/campaigns` channel=kakao(템플릿 핀·fallbackSender)·schedule·retry

한계(정직 표시): 로컬 공급자의 "승인/수신"은 내부 서명 심사·로컬 영수증 파일이며 실제 카카오 채널 승인·알림톡 수신 증거가 아니다 — `mock:true`·`local_delivered`·`local-kakao:` receiptId로 구분.
