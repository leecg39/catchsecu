# R19-T01 — 알림톡 채널·템플릿·발송: 모델·규칙 대조

## 대상 모델 (prisma/schema.prisma)

| 모델 | 핵심 필드·규칙 |
|---|---|
| `KakaoChannel` | tenant/service 귀속, (serviceId,searchId) 유일, 상태 pending→verified→archived, `generation` 재인증 세대, `version` 낙관적 잠금 |
| `KakaoTemplate` | channelId 귀속, (serviceId,name) 유일, 상태 draft→submitted→approved|rejected→archived, `reviewNote`, `version` |
| `KakaoMockReceipt` | 로컬 발송 영수증: templateId+templateVersion·channelId+channelVersion 발송 시점 핀, `contentHash`(본문+버튼), requestId |

## 규칙 대조 결과

- 채널: 등록→로컬 공급자는 심사 콜백 경로(`applyKakaoReview`)로 내부 서명 통과 — 실제 webhook 계약을 그대로 탄다 (`src/server/kakao.ts:79-95`). searchId 변경 시 인증 해제 + 소속 비보관 템플릿 심사 초기화(draft) + `kakao.template_review_reset` 감사.
- 채널 보관: 사용 중(비보관) 템플릿이 있으면 409 `CHANNEL_IN_USE`, 빈 채널은 삭제, 템플릿 보유 채널은 보관.
- 템플릿: 심사중·보관은 수정 불가(`TEMPLATE_LOCKED`), 승인 템플릿 수정 시 draft 복귀(재심사 강제), 제출은 draft|rejected만(`REVIEW_UNAVAILABLE`).
- 발송: 승인 템플릿+확인 채널만(`TEMPLATE_NOT_APPROVED`), 버전 핀(불일치 409), 멱등키로 동일 영수증, `KakaoMockReceipt`에 템플릿·채널 버전+contentHash 저장.
- 미리보기: `#{name}`·`#{contact}` 외 변수는 정의만 되고 치환값 없으면 422 `MISSING_VARIABLE`.
- 캠페인 알림톡: `kakaoTemplateId`+버전 핀, `fallbackSenderId`는 sms 채널 발신자만 허용, 카카오 캠페인은 senderId 금지(`SENDER_NOT_ALLOWED`), `FALLBACK_NOT_ALLOWED`는 비카카오 채널에서 거부.
- SMS 대체발송: 카카오 배달 실패 시 sms 동의·공급자·시도한도 확인 후 attempt+1로 잡 교체(`campaign:{delivery}:{attempt}` dedupe), `campaign.delivery_fallback` 감사.
- 심사 webhook: HMAC-SHA256 서명 검증(불일치 401), 상태 전이는 조건부 updateMany로 경합 방지.

결론: 채널 귀속·템플릿 버전·심사·버튼·영수증 핀·fallback 계약이 계획 범위를 충족. `KakaoMockReceipt`는 실제 카카오 수신 결과가 아님을 명시 — 실 제공사 승인/수신은 external 차원.
