# R25-T03 외부 제공사·기관·운영 스테이징 검증

`scripts/qa-r25-external-providers.ts`가 11개 외부 연동 지점의 구성·자격증명·증거 상태를 실측 등록한다.
실제 발신/수신 증거가 없는 항목은 **어떤 경우에도 통과로 표시하지 않고 `external_blocked`로 남긴다.**
결과: [provider-register.json](provider-register.json)

## 실행

```bash
node --env-file=.env.local --import tsx scripts/qa-r25-external-providers.ts
```

## 등록 결과 (11 providers)

| provider | mode | verdict | 증거/차단 사유 |
|---|---|---|---|
| sms-solapi | solapi | **external_verified** | 실계정 인증 성공 — `GET api.solapi.com/cash/v1/balance` HTTP 200, accountId=`26071757959806`, balance=0, point=228. **읽기 전용 조회이며 발송 mutation 없음.** 잔액 0이라 실발송 불가 → 발송/수신 receipt는 별도 증거 필요(차단 유지 조건 명시) |
| smtp-mail | local | external_blocked | 실제 SMTP 계정·수신 사서함 미확보 |
| kakao-alimtalk | unconfigured | external_blocked | 실 카카오 프로바이더 어댑터 자체 부재(`KAKAO_PROVIDER` enum에 실 provider 없음) — 계정 연동 시 어댑터 추가 필요 |
| payment-pg | local | external_blocked | 실 PG 계약·결제/취소환불 receipt 필요. local mock은 `ALLOW_LOCAL_PAYMENT` 게이트 |
| notification-webhook | local | external_blocked | 등록 엔드포인트 `slack@hooks.slack.com` 등 존재하나 실 workspace webhook 수신 증거 없음 |
| file-storage-s3 | local | external_blocked | `FILE_STORAGE=local`, 실버킷 put/get/delete 증거 필요 |
| identity-idp | allow_local_sso=1 | external_blocked | 외부 issuer(`accounts.google.com`) enabled 설정 존재하나 실 IdP 인증 왕복 증거 없음. GPKI/새올은 virtual |
| identity-verification | app | external_blocked | 실 본인인증 기관 계약·callback 증거 필요 |
| sender-dns | system | local_verified | R17/R18 DNS fixture → verified sender |
| file-scan-clamav | daemon | local_verified | 실 clamd 소켓(`…/clamd.sock`) — R11 업로드 경로에서 검증된 실 스캔 데몬(mock 아님) |
| prod-local-adapter-guard | enforced | local_verified | `NODE_ENV=production` + 로컬 어댑터 + ALLOW 플래그 부재로 서브프로세스 기동을 **실제 거부**함: `운영 환경은 SMTP 설정이 필요합니다. 로컬 미리보기만 ALLOW_LOCAL_MAIL=1을 사용하세요.` |

## 수용 조건 대조

- **실제발신/수신/providerID·receipt/실패·재시도·중복·취소환불 증거**: Solapi 잔액 조회로 실계정 인증만 확보(1/11). 발송 receipt는 잔액 0으로 불가 — 차단 사유와 함께 명시.
- **자격증명/기관미확보 항목은 개별 blocked 외부검증으로 남김**: 7건 등록, 각각 필요 증거 명시.
- **로컬mock통과로 전체완료표시금지**: 이 태스크는 `external_blocked` 7건 잔존으로 **전체 미완료 상태를 유지한다**. tasks.json의 external_status는 `external_pending` 유지.
- **실제 원본서비스로 mutation을 보내지 않음**: 모든 probe는 읽기 전용(balance GET, env 로드, 소켓 존재).

## 운영 차단 증거

- `src/server/env.ts`의 `NODE_ENV=production` 가드 3종(MAIL/KAKAO/PAYMENT local 어댑터 + `ALLOW_LOCAL_*` 부재 시 기동 거부)이 소스에 존재하고, 서브프로세스(`scripts/lib/env-load-check.ts`)로 실제 거부 동작을 증명했다.
