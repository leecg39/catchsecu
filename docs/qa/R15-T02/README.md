# R15-T02 광고 동의·수신거부 — 서버 API·업무 처리

2026-10-14. operation-policy-matrix 295-303 + 캠페인 억제 연계 대조.

## API 표면

| op | 기능 | 검증 |
|---|---|---|
| GET `/marketing/preferences` | 검색·채널·상태·제외 필터·정렬·페이지 보정·권한 플래그 | 수용 prepare |
| POST `/marketing/preferences` | 수동 동의 등록(attested+reference 필수)·멱등 키·삭제 후 재사용 410 | 수용 prepare·finish |
| GET/PATCH/DELETE `/marketing/preferences/{id}` | 상세(contact/evidence 권한 복호화)·excluded 토글 낙관 잠금·erased+연계 잡 사본 파기 | 수용 3단계 |
| POST `/marketing/preferences/withdrawals` | 다건 원자 철회·재요청 멱등(이벤트 불증) | 수용 prepare |
| GET `/marketing/preferences/export` | 수식문자 방어 CSV·`private,no-store` | 수용 prepare |
| GET `/marketing/sources` | 등록용 원본 응답 선택 | 수용 prepare |
| GET `/marketing/summary` | 서비스 동의 통계(중복제거 기준 대조) | 수용 prepare |
| GET `/email-suppressions` | 억제 목록 | 수용 prepare |

## 업무 규칙

- 예약 발송 억제: `enqueueMarketingMail` 잡은 claim 시점에 억제·철회 재검사 — 수용에서 철회 후 예약 잡이 발송되지 않고 payload까지 파기됨을 실측.
- `marketing-jobs.ts`: 캠페인 수신자 claim 직전 Suppression/철회 재확인(tests 32건 커버).
- 회사 경계: 모든 쿼리 tenant+service 복합 스코프·타사 export/복호화 불가.
- 재동의: 새 근거(attested+reference+grantedAt) 필요 — 원본 응답 정정으로 잘못된 주체에게 자동 부활하지 않음.
