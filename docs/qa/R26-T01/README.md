# R26-T01 — 카카오 Solapi 어댑터 로컬 구현 증거

외부 자격증명은 별도 추진으로 결정됐고, 그와 무관하게 코드로 구현해야 했던 유일한 제공사 갭(`KAKAO_PROVIDER` 실제 어댑터 부재)을 이번에 메웠다. 외부 공식 증거는 여전히 `external_pending`이다 — 이 문서는 로컬 구현·검증 증거이며 외부 수용 증거가 아니다.

## 구현 범위

| 영역 | 내용 | 위치 |
|---|---|---|
| 스키마 | `KakaoChannel.providerKey`(pfId 고정), `KakaoTemplate.providerTemplateId`(심사 연동키), `KakaoReceipt`(회차별 멱등 영수증, `(deliveryId,attempt)`·`receiptId` 유니크, 상태 CHECK `provider_accepted/failed/unknown`) | `prisma/schema.prisma`, `prisma/migrations/20261029000000_kakao_solapi_provider/` |
| 환경 | `KAKAO_PROVIDER` enum에 `solapi` 추가, `KAKAO_WEBHOOK_SECRET`, `SOLAPI_API_BASE`(기본 공식 엔드포인트) | `src/server/env.ts` |
| 공통 | Solapi HMAC 서명 요청을 `solapiRequest()`로 추출 — SMS/알림톡 공유 | `src/server/sms-adapter.ts` |
| 어댑터 | `resolveKakaoChannelPfId`(searchId→pfId, 미연동시 `KAKAO_CHANNEL_NOT_LINKED`), `registerKakaoTemplate`(심사 등록), `fetchKakaoTemplateStatus`(승인/반려 폴링 전이), `deliverKakaoAlimtalk`(`kakaoOptions` + `disableSms` — 대체발송은 앱 fallback에만 위임), `applyKakaoReceipt`(서명검증·회차일치·멱등·원장 capture/release) | `src/server/kakao-adapter.ts` |
| 도메인 | 채널 인증·템플릿 제출·심사 조회에 solapi 분기 — 외부 HTTP는 행 잠금 밖에서 수행 | `src/server/kakao.ts` |
| 워커 | `kakao-solapi` 트랜스포트 — 예약→I/O직전 재검증→영수증행 생성→capture, 422는 fallback, 그 외 오류는 `unknown`(webhook 대사) — sms-solapi와 동일 의미론 | `src/server/campaign-worker.ts` |
| 스케줄링 | `requireTransport`가 solapi 시 `providerKey`/`providerTemplateId` 요구, 잡 페이로드 `kakao-solapi` | `src/server/campaign-scheduling.ts` |
| API | `POST /api/v1/kakao/receipts` (`x-kakao-signature`, `signed-webhook` 정책) + OpenAPI·정책행 등록 | `src/app/api/v1/kakao/receipts/route.ts` |

## 검증 증거

- `tests/server/kakao-adapter.test.ts` — 2/2 통과
  - fetch 스텁으로 HMAC 헤더(date+salt 서명 재계산 일치)·`kakaoOptions` 페이로드·채널 pfId 해결·템플릿 등록/승인 매핑·`KAKAO_PROVIDER_REJECTED`(statusCode≠2000)·`KAKAO_PROVIDER_UNAVAILABLE`(5xx)·테넌트 자격 부재 `KAKAO_PROVIDER_REQUIRED` 확인
  - 서명 영수증 경로: 401(서명 불일치) → 202 적용 → `KakaoReceipt` 행 생성 → 동일 영수증 재적용 `duplicate:true` → 다른 receiptId 409 `DUPLICATE_WEBHOOK` → 회차 불일치 409 `STALE_KAKAO_RECEIPT` → 비밀 부재 503
- `tests/server/campaigns.test.ts` — 82/82 통과 (신규 e2e 포함)
  - 채널 검증(공급자 목록 일치 → `verified`+`providerKey`) → 템플릿 제출(`submitted`+`providerTemplateId`) → `GET /kakao/templates/{id}/review` 폴링 전이(`approved`, `providerMatched:true`) → 캠페인 예약(잡 페이로드 `kakao-solapi`, `unitCost:25`) → 워커 실행(`messages/v4/send` 호출, 수신번호 +82 정규화) → 전달 `accepted` + `KakaoReceipt(provider_accepted)` + 원장 `reserve 25 → capture 25`
- 회귀: `kakao-templates.test.ts`(local 모드)·`sms-adapter.test.ts`(공유 리팩터) 전부 통과
- `prisma migrate deploy` dev/test DB 적용, `migrate diff` schema↔DB 0문장, `prisma validate` 통과
- `scripts/verify-plan-integration.ts` — `passed` (openapiPaths 337, operations/policyRows 478, prismaModels 146)

## 외부 수용 미완료 사유 (정직 표기)

- Solapi 계정 인증은 R25-T03에서 확인됐으나 카카오 비즈채널 연동·템플릿 심사·실발송 receipt는 계정 상태(채널 개설·심사 승인·잔액)에 의존해 아직 없다.
- `POST /kakao/receipts`는 서명 검증·멱등·정산 경로를 스텁 없는 실제 DB로 검증했지만, 실제 제공사가 발행한 webhook 페이로드는 미수신 — `external_status`는 `external_pending` 유지.
- 다른 6개 제공사(SMTP·PG·Slack/Teams·S3·IdP·PASS)는 어댑터가 이미 존재하며 자격증명 확보 후 `scripts/qa-r25-external-providers.ts` 재실행으로 갱신한다.
