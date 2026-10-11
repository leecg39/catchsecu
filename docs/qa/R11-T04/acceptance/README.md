# R11-T04 잔여 수용 — 멱등·동의·만료·철회·첨부·공유범위·타회사·내보내기·재시작

2026-10-14. `scripts/qa-r11-acceptance.ts`를 production 서버(localhost:3121)와 `catchsecu_dev` DB로 실행했다. 로컬 시험 데이터만 사용했다.

## 실행 결과 (acceptance.json)

| 단계 | 실측 |
|---|---|
| 게시 | 동의 필수 + 파일 문항 폼 생성→승인→publish 201, 공개 토큰 발급 |
| 필수 동의 누락 | `consent:false` 제출 → **422 CONSENT_REQUIRED** |
| 실제 첨부 | `/uploads` init→content→complete — 실 ClamAV `scanStatus:clean` + `file.scan_passed` 감사 |
| 멱등 재제출 | 동일 Idempotency-Key → 동일 submission id, responseCount 1 유지(중복 행 0). 새 키 제출 정상 |
| 첨부 해시 | 관리자 `GET /files?submissionId` 목록 포함 → 단건 정보 200 → 다운로드 200. 다운로드 SHA-256 = 업로드 SHA-256 = DB `FileObject.sha256` 삼중 일치 |
| 메모·철회 | 메모 201 → `POST /withdraw` → `status:"withdrawn"` |
| 내보내기 재권한 | `submission.read` 없는 viewer 역할 → **403**; owner → 200 CSV 2행. 요청마다 권한 재검사 |
| 타 회사 차단 | owner-b 세션으로 응답 상세·파일 정보·다운로드 → 모두 **404** |
| 공유 범위 | qText만 grant한 열람자: 활성 응답 상세 200, **철회된 응답 상세 410**, 범위 밖 파일 정보·다운로드 모두 **404** |
| 만료 게시 | `expiresAt` 과거 → 공개 조회 `closed:true, closedReason:"expired"` + 제출 `410 PUBLICATION_CLOSED` (이후 복원) |
| 감사 | 18건 — `file.upload_initialized/uploaded/scan_passed/attached`, `submission.created/viewed`, `file.list_viewed/viewed/downloaded`, `form.created/published` 등 |

## 재시작 지문

`fingerprint.json`: submissions·answers·corrections·notes·files·receipts·publications·grants·sessions 전수 SHA-256 = `1e93d5f4…52b8`. production 서버 SIGTERM→재기동 후 `check-fingerprint` **동일** 확인. health `{"status":"ok","database":"ready"}`.

## 실행 명령

```bash
QA_ORIGIN=http://localhost:3121 node --env-file=.env.local --import tsx scripts/qa-r11-acceptance.ts run
QA_ORIGIN=http://localhost:3121 node --env-file=.env.local --import tsx scripts/qa-r11-acceptance.ts check-fingerprint
```

## 기존 증거 재사용

- 공개 제출→관리자 조회→정정→메모→영수증 PDF→충돌 복구: `../browser-flow/README.md`
- 제출→공유인증→정정→철회→파기→증명서 전체 E2E: `../../P06-T07/README.md`
- 파일 암호화 저장·ClamAV·교차 권한: `../../files/README.md`

## 미해결

- 외부 제공사(실 SMTP로 공유 초대 수신, 실 SMS 인증)는 로컬 메일 디렉터리로 검증 — `external_pending` 유지.
