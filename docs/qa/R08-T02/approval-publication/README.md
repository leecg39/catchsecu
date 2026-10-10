# R08-T02 F5 승인·게시·중지·재개 체크포인트

검증일: 2026-10-11 (Asia/Seoul)

이 기록은 R08의 F5 중 **승인 입력 보호, 승인 경합 복구, 승인된 초안 게시, 공개 중지·재개, production 재시작 보존**을 실제 PostgreSQL과 Ego Lite에서 확인한 부분 체크포인트다. R08-T02와 F5 전체 완료 선언은 아니다. 카카오·네이버 실제 OAuth, 외부 SMTP 실수신, 고정 URL을 포함한 전수 결합 수용은 계속 남아 있다.

## 구현한 보완

- 승인 요청 메시지·증빙 번호와 검토 의견을 제어 입력으로 유지한다.
- 승인 입력이 남아 있으면 편집 단계 링크와 이전/다음 이동에 공통 이탈 확인을 적용한다.
- 폼 초안 자동저장이 먼저 필요한 이동은 저장 후 승인 입력 폐기 여부를 확인한다.
- 사용자가 이탈을 확정한 뒤에는 확인된 보호 상태를 지우고 한 번만 이동한다.
- 폼 설정이 dirty 또는 저장 중이면 승인 요청·승인·반려·취소를 잠근다.
- 승인 결정 409는 작성 중인 검토 의견을 보존하고 명시적인 최신 상태 다시 불러오기를 제공한다.
- 승인 조회 실패에는 재시도를 제공하고, 성공한 승인 변경 뒤 폼 재조회 실패를 별도 상태로 표시한다.

## 실제 브라우저 흐름

Ego Lite TaskSpace 2의 기존 페이지 `p8`과 `http://localhost:3120` production 빌드를 사용했다. 시험 회사는 seed fixture인 `캐치시큐 테스트 회사 A`, 서비스는 `기본 서비스`다.

1. 합성 폼을 생성하고 제목·질문·수집 목적·최대 응답 수를 저장했다.
2. 승인 요청 메시지와 필수 증빙 번호를 입력한 채 `질문` 단계로 이동했다.
   - 최초 production 실행에서 경고 없이 이동하는 결함을 재현했다.
   - 편집 단계 링크를 `GuardedLink`로 바꾸고 폼 자동저장 경로를 승인 입력 확인과 연결했다.
   - 수정 빌드에서는 이탈 확인이 열렸고 `계속 편집` 뒤 두 입력이 동일했다.
3. 최대 응답 수를 101, 이어 102로 바꾸는 동안 승인 요청 버튼이 잠기고 저장 안내가 나타났다.
   - 임시저장 후 승인 입력은 보존되고 요청 버튼이 다시 활성화됐다.
4. 첫 승인 요청을 만들고 검토 의견을 입력했다.
   - 같은 인증 세션의 별도 HTTP 요청이 먼저 반려해 row version을 1→2로 올렸다.
   - 오래된 화면의 승인 시도는 409였고 검토 의견이 보존됐다. 승인·반려 fieldset은 잠겼다.
   - `최신 승인 상태 다시 불러오기` 후 반려 사유가 표시되고 오래된 검토 입력은 제거됐다.
5. 두 번째 승인 요청을 만들고 UI에서 승인했다.
   - 승인 row는 `approved` version 2가 되었고 게시 뒤 `consumed` version 3이 됐다.
6. UI에서 게시하고 공유 페이지와 공개 폼을 확인했다.
7. 목록 UI에서 일시 중지·재개를 두 차례 확인했다.
   - 중지 중 공개 폼 조회는 `closed: true`, 제출은 410 `PUBLICATION_CLOSED`였다.
   - 재개 뒤 조회는 `closed: false`, 최대 응답 수 102였다.
8. production 서버 PID를 44389에서 54494로 재시작했다.
   - 폼 version 12, 승인 2건, 게시본 1건, 감사 13건의 안정 지문이 재시작 전후 동일했다.
9. 합성 폼을 UI로 보관했다.
   - 폼은 `archived` version 13, 게시본은 `revoked` version 2, 공개 API는 410이다.
   - 같은 제목 접두사의 활성 합성 폼은 0건이며 승인·감사 증거는 보존했다.
10. 합성 브라우저 세션을 로그아웃했고 `/api/v1/me`가 401을 반환했다.

## PostgreSQL 증거

- 승인 1: `rejected` version 2
- 승인 2: 게시 전 `approved` version 2, 게시 뒤 `consumed` version 3
- 두 승인 모두 같은 `FormVersion`과 `contentHash`를 가리킨다.
- 게시본은 승인 2를 참조하며 활성 시 최대 응답 수 102, 응답 수 0이었다.
- 감사 순서: `form.created` → `form.draft_updated` 3회 → `approval.requested` → `approval.rejected` → `approval.requested` → `approval.approved` → `form.published` → `form.paused` → `form.published` → `form.paused` → `form.published`.
- 재시작 전후 안정 지문: `b576d6f8f265fbf0ad06fd90a4d75f7bc81f881658ca8b70b9ae4b587df68e5c`.

원자료:

- `database-before-restart.json`
- `database-after-restart.json`
- `database-cleanup.json`
- `verification.json`

## 화면 증거

- `screenshots/01-approval-dirty-navigation-warning.png`
- `screenshots/02-approval-input-preserved.png`
- `screenshots/03-form-dirty-blocks-approval.png`
- `screenshots/04-form-save-preserves-approval-input.png`
- `screenshots/05-approval-request-pending.png`
- `screenshots/06-approval-conflict-input-preserved.png`
- `screenshots/07-latest-rejected-state.png`
- `screenshots/08-second-approval-complete.png`
- `screenshots/09-published-share-page.png`
- `screenshots/10-form-paused-from-list.png`
- `screenshots/11-form-resumed-from-list.png`
- `screenshots/12-after-production-restart.png`
- `screenshots/13-synthetic-form-archived.png`

## 자동 검증

최종 로그는 `logs/`에 보존했다.

- `tests.log`: 승인 입력·history guard·정책 승인·게시 상태·폼 흐름 5파일 35개 통과
- `typecheck.log`: `tsc --noEmit` 통과
- `eslint.log`: 승인·Workflow·공통 이탈 보호 변경 파일 오류 0
- `build.log`: local provider 허용 production 82페이지 build 통과
- `verify-plan.log`: 활성107개 작업·원본186개 경로·추가21개 경로, 의존 순환 0 통과

## 외부 의존성

이 체크포인트는 내부 seed fixture와 로컬 production 서버만 사용했다. 공식 카카오·네이버 OAuth, 외부 SMTP 수신, 외부 본인확인·전자서명 공급자 결과는 검증하지 않았으며 기존 `external_pending` 상태를 유지한다.
