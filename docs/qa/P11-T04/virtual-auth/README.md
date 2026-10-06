# P11-T04 · P10 — 가상 조직 인증·가상 PG 브라우저 검증

- 실행: `npx tsx scripts/qa-virtual-auth-payment.ts` (dev 서버 3100 + catchsecu_dev)
- 일자: 2026-10-16 · 결과: `virtual-auth-results.json` — 8/8 PASS
- 주의: 가상(mock) 어댑터 검증이다. 실제 GPKI·새올·그룹웨어·PG 연동이 아니다.

## 단계별 증거

| 단계 | 결과 | 화면 |
|---|---|---|
| 가상 GPKI 공급자 UI 등록(프로토콜·가상 표시·사전검사 통과) | PASS | 01-virtual-provider-form.png |
| 디렉터리 모달 mock 안내 + 구성원 2건 등록(이메일 유/무) | PASS | 02-directory-members.png |
| `/login/gpki` mock 경고 문구 + 자격 로그인 → JIT viewer+세션+계정 생성(서비스 권한 없어 /service/none 도착 — 정상) | PASS | 03·04 |
| 이메일 미등록 구성원 → email-register 화면 → 등록 후 로그인 완료·디렉터리 반영 | PASS | 05·06 |
| `/pay/license-service`에서 가상 승인/실패 버튼 노출(mock 표기) → 승인 → 주문 paid·구독 active | PASS | 07·08 |
| 환불 요청 → 가상 환불 승인 → refunded 정산 | PASS | 09·10 |
| 390px 모바일 오버플로 없음 | PASS | 11-mobile-login.png |

## 검증 중 확인된 실제 동작(결함 아님)

- JIT 가입은 `assertQuota`를 통과한다: 구독이 있으면 active 구독이 필요 — 구성원 한도 초과 시 "이용 가능한 구독이 없습니다"로 로그인도 거부. 재실행 전 이전 JIT 구성원 소속 해제로 복구.
- 구독 행 삭제는 DB 트리거가 거부(BILLING_SUBSCRIPTION_DELETE_DENIED) — QA 잔여 pending 구독은 정리할 수 없어 provider/member만 태그 단위로 정리한다.
- User 행은 감사 로그 참조로 삭제 불가 — 소속 해제로만 쿼터 회복.

## 잔여/미검증

- 새올·그룹웨어 화면은 동일 컴포넌트 분기로 GPKI 검증에 포함하지 않음.
- link/invite 모드와 MFA 경유는 서버 테스트(tests/server/org-auth.test.ts)에서 검증.
- 실제 GPKI·새올·그룹웨어·PG 공급자 자격증명 연동은 별도 차단 항목.
