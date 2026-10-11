# R19-T04 — 알림톡 채널·템플릿·발송: DB·브라우저·재시작 수용검증

## 수용 절차

1. `scripts/qa-r19-acceptance.ts run` — 7/7 PASS (R19-T02 증거 참조). fixture에 channelId·templateId·campaignId·fallbackJobId·receiptId 기록.
2. 프로덕션 서버 재시작(`APP_PORT=3121`, `KAKAO_PROVIDER=local`).
3. `scripts/qa-r19-acceptance.ts restart` — PASS: 채널 상태·템플릿 상태·캠페인 완료·영수증 contentHash·fallback SMS 영수증 파일 잔존.
4. 브라우저 수용(R19-T03): 채널·템플릿·상세/편집·보내기·내역·플레이그라운드 전 경로 실제 데이터 렌더.

## 검증된 보장

- 채널 검증은 실제 webhook 계약(서명+HMAC·버전 조건부 전이)을 그대로 통과.
- 승인 템플릿 수정·채널 searchId 변경은 재심사를 강제하고 감사를 남긴다.
- 캠페인 발송은 템플릿·채널 버전을 핀하며, 미치환 변수 실패 시 SMS 동의·발신자·dedupe를 확인한 뒤 대체발송한다.
- 채널/템플릿/캠페인/영수증·감사가 재시작 후 유지.

## 외부 공급자 증거 상태 — external_pending

`KAKAO_PROVIDER=local`의 심사·발송은 내부 서명과 로컬 파일이다. 실제 카카오 채널 인증·템플릿 심사 승인·알림톡 수신·공식 수신 결과 웹훅 증거는 미확보이며, 이 작업은 `external_pending`을 유지한다. API/UI는 `mock:true`·`local_delivered`·"로컬 전달" 라벨로 이를 정직하게 구분한다.
