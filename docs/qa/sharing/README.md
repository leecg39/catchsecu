# 외부 공유 열람자·공유 파일 검증

2026-10-03. P06-T04 및 P06-T03의 부분 구현 증거. 전체 181경로/72 Task의 완료 선언이 아니다.

## 구현 결과

- migration 22: ShareGrant·ShareField·ViewerChallenge·ViewerSession. 회사/서비스/폼/게시 버전/질문 복합 FK와 상태 제약, 회수된 권한 재활성화 금지.
- 공유 관리자 CRUD: 게시 버전·질문 선택, 이메일·기한 수정, 전체 이메일 일치 검색·상태·페이지, 초대 재발송·회수, 열람 로그. `share.manage`와 현재 서비스·응답 권한 검사. 파일 항목은 `file.read`도 필요하다.
- 이메일 암호화, 초대·인증코드·세션 HMAC 저장. 6자리 인증코드는 브라우저에 연결되고 10분/5회/일회용으로 제한된다. 잘못된 초대 조합도 같은 발급 응답을 받는다. 발급은 이메일당 10분에 5회, 전역 분당 120회 제한.
- 외부 세션은 HttpOnly·SameSite=Strict 쿠키, HTTPS에서 Secure. 30분 또는 공유 종료 중 빠른 시점에 만료된다. JSON·감사 로그에 코드나 세션 토큰을 반환하지 않는다.
- 범위·이메일·기한 수정과 초대 재발송은 초대코드를 교체하고 기존 challenge/session을 무효화한다. 회수도 즉시 적용하며 파일 다운로드에도 동일한 검사를 한다.
- 지정 버전·질문의 현재 답변만 열람한다. 새 게시본은 자동으로 포함하지 않는다. 철회·파기 요청·파기·보유 기한 종료 응답, 메모·정정 전 값·동의 영수증을 제외한다. 보존 조치가 외부 열람 기간을 연장하지 않는다.
- 일반/공유 파일 목록·단일 파일 네 경로 연결. 공유 파일은 선택 질문의 **현재 답변**에 연결된 검사 완료 첨부만 제공한다. 정정 이전 파일·다른 응답/질문 조합은 차단한다.
- 외부 UI는 15초 및 창 포커스 시 새로 검사하고 서버 오류 시 이전 내용을 지운다. 이미 열람한 자료의 복사본을 원격에서 회수하는 기능은 없다.

## 실제 검증

| 검사 | 결과 | 근거 |
|---|---|---|
| 실제 PostgreSQL 통합 테스트 | 공유 20개 포함 전체 **215/215** | [전체 로그](tests-all.log), [공유 테스트](../../../tests/server/sharing.test.ts) |
| 권한·범위 | 역할/회사/서비스/다른 게시본/공유 외 필드 차단 | 위 통합 테스트 |
| 인증 | 브라우저 바인딩·5회 실패 유지·만료·동시 1회 소비·메일 작업자 전달 | 위 통합 테스트 |
| 변경/회수 경합 | 진행 중 허용 읽기 종료 후 회수 완료, 다음 요청 차단 | 위 통합 테스트 |
| Ego 초대·인증·열람 | UI 초대 → 실제 로컬 전달 메일 → 오류 코드 거부 → 인증 → 지정 항목만 표시 | [생성](02-created.png), [오류](03-wrong-code.png), [열람](04-authorized.png), [표시 내용](browser-visible.json) |
| 실제 파일 | UI 다운로드 116 bytes, 저장된 SHA-256 일치 | [내려받은 파일](browser-attachment.txt), [독립 대조](final-verification.json) |
| 공유 변경 | 기존 응답·파일 401, 새 인증 후 이름만 표시·파일 404 | [기존 세션](browser-update-denied.json), [새 범위](browser-new-scope.json), [화면](08-new-scope.png) |
| 최종 회수 | 세션 2개 revokedAt 저장, 응답·파일 401 | [브라우저](browser-revocation.json), [파일 차단](11-revoked-file.png), [DB 대조](final-verification.json) |
| 390px UI | 화면/문서 너비 모두 390, 가로 넘침 없음 | [화면](09-final-mobile.png), [너비](browser-final-mobile.json) |
| 열람 로그 | 인증·목록·파일·변경·회수 17건, 답변·이메일·코드 미포함 | [관리 화면](12-access-log.png), [독립 대조](final-verification.json) |
| 타입·lint·배포용 빌드 | 통과; 기존 lint 경고 21개, 오류 0 | [typecheck](typecheck.log), [lint](lint.log), [build](build-final.log) |

파일 SHA-256: `3c5a74116405f4f6aa48c315fbc53de9b208f6585a519da16799121e27f41949`.

프로덕션 서버 재시작 후에도 미소비 인증 요청으로 정상 인증·새 공유 범위 열람을 확인했다. 브라우저 합성 폼은 `외부 공유 브라우저 QA 2026-10-03`, ID/질문/응답은 [fixture](browser-fixture.json)에 있다. 최종 공유 권한은 회수 상태로 남겼다.

## 재현

```sh
npm test -- tests/server/sharing.test.ts
npm test
npm run typecheck
npm run lint
ALLOW_LOCAL_MAIL=1 npm run build
node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa-sharing.ts final
npm run verify:plan
```

[qa-sharing.ts](../../../scripts/qa-sharing.ts)는 localhost 개발 DB·지정 합성 회사/폼을 검사한 뒤 독립 대조를 수행한다. invite/challenge 모드는 실제 local worker 전달 파일을 확인하고 인증값은 `.local`의 권한 600 파일에만 임시 기록한다. 최종 검증 후 임시 인증 파일은 제거했다.

## 남은 범위

- 원본 `/shared-privacy/*` 조사본은 모두 인증 전 입력 화면이다. 인증 이후 원본 관리·열람 UI의 동일성은 미확정이며 이번 UI는 [독립 구현 계약](PLAN.md)을 따른다.
- 메일 작업자와 로컬 전달 파일을 실제 확인했다. 외부 SMTP 발송·수신은 자격증명 없는 현재 환경에서 검증하지 않았다.
- 공유 이메일/인증/열람 이력의 보존·삭제 운영 정책, S3 저장, 전체 선행 게이트는 후속 작업이다. 현재 회수는 권한의 소프트 삭제다.
- P06-T05 정보주체 인증·조회·철회, 외부 본인확인/서명, 발송 suppression 등은 별도 미완료다. P06-T04의 선행 P06-T02/P09-T02 전체 게이트가 남아 정식 Task 완료 수는 2/72를 유지한다.
