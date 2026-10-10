# 구성원·초대·전문가 DB·HTTP·재시작 대조

2026-10-10. `qa-rea-members.ts`는 로컬 catchsecu_dev/3100/local mail만 허용하고, 기존 fixture를 덮어쓰지 않는다. 합성 계정 5개·회사 2개와 주 회사 서비스 2개를 만들었다. 계정 이메일 인증과 전용 운영자 권한은 시험 준비용 직접 설정이며, 실제 가입·이메일 인증은 R02 증거와 구분한다.

## 최종 확인

- 멤버십 3개: 소유자 active v3, 직접 구성원 admin/active v12, 전문가 viewer/revoked v8. 활성 owner는 1명. 전문가 service grant는 0개.
- 초대 3개: 최초 accepted v3, 재초대 accepted v2, 취소 revoked v3. 재참여는 기존 멤버십 ID를 재사용했다.
- 전문가 배정 1개 revoked v9. 배정 범위 이력은 남고 접근 권한은 회수됐다.
- 감사 45건. member.updated 7, member.removed 1, 소유권 이전 2, 초대 생성/재발송/수락/취소 3/2/2/1, 전문가 생성/변경/재배정/회수 1/4/2/2를 독립 조회·단언했다.
- 초대 outbox 5개 중 4개 실제 로컬 전달(각 1회/영수증 1개), 재발송으로 구버전 job 1개 취소/시도 0회. 메일 파일 SHA-256을 전후 대조했다. worker는 tenantId와 jobId를 모두 지정해 해당 시험 메일만 처리했다.
- 별도 권한 경계 HTTP 11개와 최종 읽기/거부 HTTP 11개를 검사했다. 후자 11개는 새 서버 프로세스에서 다시 통과했다. 반복 실행 건수를 독립 시나리오로 더하지 않는다.

상태 SHA-256: `2e863d4e187da32216f47a8ca029f0e9db2b3d7293981433b4b76fdbd6af980a`. 멤버십·grant·초대·배정·outbox/영수증·감사 전체를 포함한 동일한 지문이다.

[서버 재시작 전](verified.json) · [재시작 후](verified-after-restart.json) · [권한 경계 11개](boundaries.json) · [실제 UI](../../R04-T03/members-flow/README.md)

## 실행 및 한계

`node --env-file=.env.local --import tsx scripts/qa-rea-members.ts verify verified-after-restart`는 HTTP와 독립 DB를 읽고 최초 `verified.json`의 지문과 비교한다. 비밀번호·세션 쿠키·전체 초대 링크는 공개 증거에 저장하지 않는다. private fixture는 `.local/rea-fullstack/members/fixture.json`(0600)이다.

현재 서버 계약은 PostgreSQL 5파일68개가 통과했다. dev/test 5모델43컬럼·20제약·21인덱스·7트리거를 대조했고 신규 migration은 없다. 마지막 owner의 동시성·초대 중복·진행 중 권한 회수는 서버 시험 근거이며, 두 브라우저 동시 조작으로 주장하지 않는다.

타입 검사와 변경 파일 린트(경고 0), 로컬 미리보기 production 빌드가 통과했다. 초기 빌드 호출의 잘못된 tsconfig 이름과 로컬 메일 플래그 누락은 로그에 보존하고, 기존 `tsconfig.rea-build.json` 및 `ALLOW_LOCAL_MAIL=1 ALLOW_LOCAL_PAYMENT=1`로 교정한 빌드가 최종 결과다.

이 자료는 R04의 새 로컬 흐름에 대한 부분 수용이다. 모든 역할·다중 페이지·원본 화면 동등성·별도 브라우저 프로필·외부 SMTP/SSO 제공사 수신·만료 worker의 새 프로세스 수용은 남아 있다.
