# R08-T02 F5 승인·게시·고정 URL 결합 수용

검증일: 2026-10-11 (Asia/Seoul)

승인된 게시본을 고정 URL에 연결한 뒤 새 초안을 만들고, 새 승인으로 재게시했을 때 같은 주소가 새 게시본으로 원자적으로 전환되는 흐름을 실제 PostgreSQL과 Ego Lite에서 확인했다. 중지·재개와 production 재시작, 합성 자료 정리까지 같은 흐름에서 수행했다.

## 발견하고 수정한 결함

폼 일시 중지와 기간 만료, 응답 한도 도달이 공개 API에서 모두 `closed: true`로만 반환됐다. 공개 화면은 원인을 구분할 수 없어 일시 중지된 폼에도 “응답 수가 초과되어”라는 잘못된 안내를 표시했다.

- 공개 게시 상태에 `closedReason: paused | expired | response_limit`를 추가했다.
- 기본 마감 안내를 기존 다국어 문구에 연결했다.
  - `paused` → 종료된 캐치폼 안내
  - `expired` → 기간 만료 안내
  - `response_limit` → 응답 한도 안내
- 직접 작성한 마감 화면은 기존처럼 작성자가 저장한 내용을 우선한다.

## Ego Lite 결합 흐름

1. 기본 서비스에서 질문 1개와 수집 목적이 있는 합성 폼을 만들었다.
2. 첫 초안의 승인 요청을 생성·승인하고 게시했다.
3. 고정 URL을 만들고 첫 게시본의 질문을 표시하는지 확인했다.
4. 게시 폼을 개정해 질문을 `결합 검증 응답 v2`로 바꿨다.
   - 새 초안을 저장한 동안 같은 고정 URL은 첫 게시본 질문만 표시했다.
5. 두 번째 승인 요청을 생성·승인하고 재게시했다.
   - 고정 URL 경로는 그대로였고 질문은 v2로 전환됐다.
   - 첫 승인과 두 번째 승인은 각각 연결된 게시본에서 `consumed`로 보존됐다.
6. 폼을 일시 중지했다.
   - 고정 URL은 제출 화면 대신 “종료된 캐치폼입니다. 더 이상 응답을 받지 않습니다.”를 표시했다.
   - 기존의 잘못된 응답 한도 안내는 표시되지 않았다.
7. 폼을 재개하고 같은 고정 URL에서 v2 질문을 다시 확인했다.
8. production 서버를 재시작했다.
   - 폼 1개·버전 2개·승인 2개·게시본 2개·고정 URL 1개·감사 10건의 안정 지문이 동일했다.
   - 재시작 뒤 같은 고정 URL에서 v2 게시본을 표시했다.
9. 고정 URL을 사용 종료하고 폼을 보관했다.
   - 고정 URL은 종료 안내를 반환하고 활성 합성 폼은 0건이다.
   - 승인 2건과 게시본 2건은 증거로 보존됐다.
10. QA 브라우저 세션을 로그아웃했다.

## PostgreSQL 증거

- 재시작 전후 안정 지문: `3c4c5f3bfb1f83f6ca106c85a7a36e178e7dcd17fafcdfe5da35fd1ef372c807`
- 게시 전 초안 격리: 첫 게시본과 두 번째 초안은 서로 다른 `FormVersion`이다.
- 재게시 연결: 고정 URL의 `publicationId`는 두 번째 게시본으로 변경됐다.
- 승인 연결: 두 게시본은 각각 별도의 `consumed` 승인 행을 참조한다.
- 정리 결과: 폼 `archived` version 12, 고정 URL `revoked` version 3, 게시본 2건 `revoked`, 활성 합성 폼 0건.

원자료:

- `database-before-restart.json`
- `database-after-restart.json`
- `database-cleanup.json`
- `verification.json`

## 화면 증거

- `screenshots/01-two-consumed-approvals.png`
- `screenshots/02-fixed-url-linked.png`
- `screenshots/03-paused-reason-corrected.png`
- `screenshots/04-after-restart-active-v2.png`
- `screenshots/05-revoked-after-cleanup.png`

## 자동 검증

최종 실행 결과는 `logs/`에 보존했다.

- `tests.log`: 수집 일정·기초 CRUD·폼 전체 흐름 PostgreSQL 통합 3파일 50개 통과
- `typecheck.log`: `tsc --noEmit` 통과
- `eslint.log`: 변경한 서버·공개 화면·시험 파일 오류 0
- `build.log`: local provider 허용 production 82페이지 build 통과
- `verify-plan.log`: 활성107개 작업·원본186개 경로·추가21개 경로, 의존 순환 0 통과

## 남은 범위

F5의 내부 승인·게시·고정 URL 결합 수용은 이 체크포인트에서 확인했다. 카카오·네이버 공식 OAuth, 외부 SMTP 실수신, 외부 본인확인·전자서명 공급자 결과는 자격증명 의존성이므로 `external_pending`을 유지한다. R08 F7의 9개 원본 경로 전수 상태·3개 화면 폭·회사 전환·별도 세션 수용은 별도 잔여 작업이다.
