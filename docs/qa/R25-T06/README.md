# R25-T06 최종 수용·추적표·릴리스 보고

집계 결과: [final-acceptance.json](final-acceptance.json)

## 판정: `implementation_acceptance_complete__external_verification_deferred_to_R26_T01`

**구현 수용 완료 — 외부 검증은 별도 트랙.** 사용자 결정으로 외부 자격증명 검증을 `R26-T01`로 이관했다. 도메인 작업 107개는 전부 로컬 수용 완료(completed), 외부 증거만 `R26-T01`(planned)에 남는다. Solapi는 읽기 전용 잔액 API로 계정 인증만 확인했고 잔액 0이라 발송 receipt는 없다.

## 표면별 검증 범위·제약

| 표면 | 증거 | 결과 |
|---|---|---|
| 경로(UI) | [R25-T01](../R25-T01/README.md) | 186경로 중 161 검사 전부 통과(0 실패), fixture 불가 25 스킵(토큰·동적 파라미터 — 사유 기록) |
| 교차 도메인 | [R25-T02](../R25-T02/README.md) | 폼게시→제출·동의→공유열람→캠페인발송→과금→철회파기→감사통계 7단계 PASS |
| 외부 제공사 | [R25-T03](../R25-T03/README.md) | 11개 등록: external_verified 1(Solapi 인증) · external_blocked 7 · local_verified 3 |
| 운영 런북 | [R25-T04](../R25-T04/README.md) | 레거시 dry-run/적용·마이그레이션 상태·워커 회수·백업복구 지문 4단계 PASS |
| 접근성·성능·원본 | [R25-T05](../R25-T05/README.md) | a11y 10p 통과, 목록 API 중앙값 21~58ms, 원본대조 153건(similar115/close13/diverged25 — 100%일치 미주장) |

## 작업 추적

- 활성 108개: **completed 107 · in_progress 0 · planned 1(R26-T01)**
- 이전 in_progress 22개는 외부 검증을 R26-T01로 이관하며 completed 처리 — task-level `external_status`는 `external_pending`을 유지해 공식 증거 잔여를 표기한다.
- 레거시 72개 전부 현재 작업에 매핑, `verify-plan-integration.ts` `passed`.

## 외부 공급사 잔여(차단)

SMTP 메일 · 카카오 알림톡 · 결제 PG · Slack/Teams 웹훅 전달 · S3 · 외부 IdP · PASS 본인확인 — 각 제공사 staging 자격증명 확보 시 동일 스크립트로 재측정한다. 발신번호 DNS·ClamAV·로컬 어댑터 프로덕션 가드는 별도 증거로 기록.

## 재현 명령

- 서버: `APP_PORT=3121 BETTER_AUTH_URL=http://localhost:3121 ALLOW_LOCAL_MAIL=1 ALLOW_LOCAL_PAYMENT=1 ALLOW_LOCAL_KAKAO=1 ALLOW_LOCAL_SSO=1 KAKAO_PROVIDER=local SMS_TRANSPORT=local npm run start`
- 각 검증 명령은 `final-acceptance.json > reproduce` 참조.
- 백업·복구 자료: `docs/qa/R01-T01/db-rehearsal/`(복원 지문 131 테이블).
