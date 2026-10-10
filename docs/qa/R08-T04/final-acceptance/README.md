# R08-T04 F7 전체 수용 — 서버·Ego Lite 중간 게이트

2026-10-11(KST) 기준 중간 검증이다. 이 결과만으로 R08-T04나 F7을 완료 처리하지 않는다.

## 결과

- 6개 파일, 61개 시험 통과
- PostgreSQL을 사용한 폼·템플릿 권한, CRUD, 경합, 게시 불변성, 삭제 제약, 16종 질문 통합 흐름을 다시 검사했다.

```text
Test Files  6 passed (6)
Tests       61 passed (61)
Duration    80.20s
```

## 범위

- `form-crud-gate.test.ts`
  - 독립 복제, 게시본 불변, 중지·재개, 최신 권한, 보관 서비스와 version 제약
- `form-list-deletion.test.ts`
  - 목록 검색·정렬·페이지·날짜, 정상·보관·게시 상태 작업, 미참조 초안 완전 삭제와 이력 보존
- `form-module-flow.test.ts`
  - 16종 질문, 템플릿, 동의, 승인, 게시, 파일·그림 응답, 공유, 새 version, 중지의 단일 DB 흐름
- `template-access-gate.test.ts`
  - 회사·서비스 격리, 현재 권한, 설명·라이선스 범위, 409, 보관·복원, 유효 구독, 삭제 캐시 410
- `template-gallery-ui.test.ts`
  - 사용 중·보관 목록의 편집·사용·보관·복원·삭제 동작 표시
- `form-module-concurrency.test.ts`
  - 저장·승인·게시·수정·파기 잠금 경합과 과거 응답·첨부·영수증 불변

## 명령과 원본 로그

```bash
npm test -- tests/server/form-crud-gate.test.ts tests/server/form-list-deletion.test.ts tests/server/form-module-flow.test.ts tests/server/template-access-gate.test.ts tests/server/template-gallery-ui.test.ts tests/server/form-module-concurrency.test.ts
```

- `server-gate.log`

## Ego Lite 원본 9개 경로 정상·빈 선택 상태

Ego Lite의 동일 로그인 세션으로 계획서에 명시된 9개 경로를 1440·768·390px에서 순회했다. 27개 조합 모두 수평 overflow가 없었고 브라우저 console warn/error는 0개였다.

| 경로 | 실제 상태 |
| --- | --- |
| `/form/ai/agreement` | 폼 미선택 안내와 목록 이동 |
| `/form/ai/basic-frame` | 신규 폼 편집기 |
| `/form/ai/basic-frame/v3` | 신규 폼 편집기 |
| `/form/ai/create` | 신규 폼 편집기 |
| `/form/ai/recipient` | 폼 미선택 안내와 목록 이동 |
| `/form/ai/set` | 폼 미선택 안내와 목록 이동 |
| `/form/ai/setting` | 폼 미선택 안내와 목록 이동 |
| `/form/manage` | 실제 캐치폼·업로드 목록 |
| `/form/template` | 실제 템플릿 목록 |

구조화 결과와 27개 스크린샷은 `browser-normal/`에 저장했다.

## Ego Lite 폼 선택·단계 재개 상태

게시된 `P06-T06 인증 실측 폼`(`ae8f8541-d66b-4db5-afe0-cd6954216920`)을 선택한 상태로 7개 단계 경로를 1440·768·390px에서 다시 열었다.

- 21/21 조합에서 예상 화면이 표시됐다.
- 로딩 문구가 남은 화면 0개, 수평 overflow 0개, console warn/error 0개였다.
- `/form/ai/agreement`는 수집·이용 동의 설정과 게시 문서 선택을 복원했다.
- `/form/ai/basic-frame`, `/form/ai/basic-frame/v3`, `/form/ai/create`는 게시 폼의 현재 편집 초안을 복원했다.
- `/form/ai/recipient`는 제3자 제공 동의 설정과 동일 서비스 문서 선택을 복원했다.
- `/form/ai/set`, `/form/ai/setting`은 응답 설정·일정·참여 인증 상태를 복원했다.
- 수집·이용 동의 경로에서 제3자 제공 경로로 이동한 뒤 Ego Lite의 뒤로·앞으로 동작으로 각 단계와 선택 폼 ID가 복원되는지 확인했다.
- Tab 키 포커스 60개를 추적했다. 제공 동의·수집 동의·설정 단계, 수집 목적, 문서 선택, 임시저장·다음 동작에 키보드로 도달했다.
- PostgreSQL에서 선택 폼의 `updatedAt=2026-10-10T15:51:57.699Z`가 유지되어 이 순회가 읽기·재개만 수행했음을 확인했다.

구조화 결과와 21개 스크린샷은 `browser-selected/`에 저장했다.

## 회사 전환 테넌트 격리 결함·수정

대시보드에서 회사 A→B를 전환할 때 헤더는 B로 바뀌었지만, 같은 `/dashboard` 경로에서 자식 `useResource`가 유지되어 A의 서비스·폼·문서·응답 집계가 남는 결함을 실제 Ego Lite에서 재현했다.

- `AppShell`의 회사 선택 후 이동을 client router refresh에서 `window.location.replace('/dashboard')`로 바꾸어, 회사에 속한 모든 resource hook을 새 문서에서 다시 생성했다.
- Ego Lite 회사 B 대시보드: 활성 서비스 0, 폼 0, 표시 문서 0, 보유 응답 0.
- B에서 A의 게시 폼 `ae8f8541-d66b-4db5-afe0-cd6954216920`을 직접 열면 `캐치폼을 찾을 수 없습니다.`로 차단됐다.
- A로 복귀하면 헤더·대시보드 집계와 같은 폼 편집기가 복원됐다.
- PostgreSQL에서 B는 서비스·폼·문서·응답이 모두 0임을 대조했다. QA 회사는 `closed`, 멤버십은 `revoked`로 정리해 선택 목록에서 제거했고, 불변 `context.company_selected` 감사 이력은 보존했다.
- 정리 후 Ego Lite에서 A 단일 소속과 회사 선택 버튼 0개를 다시 확인했다.

구조화된 브라우저·DB·정리 결과는 `browser-selected/company-switch-verification.json`에 있다.

## 별도 브라우저 세션 재개

Ego Lite와 분리된 Codex 인앱 브라우저 세션에서 같은 게시 폼 URL을 직접 열었다.

- 두 브라우저 모두 `캐치시큐 테스트 회사 A`와 `P06-T06 인증 실측 폼` 편집 초안을 재개했다.
- PostgreSQL의 2026-10-10 생성 활성 세션은 2개였고 모두 회사 A를 선택했다. 증거에는 세션 ID의 SHA-256만 기록했다.
- 폼 `updatedAt=2026-10-10T15:51:57.699Z`가 유지되어 두 재개가 읽기 흐름임을 확인했다.
- 쿠키·세션 토큰·비밀번호는 증거에 기록하지 않았다.

구조화 결과는 `browser-selected/separate-session-verification.json`에 있다.

## 목록 빈 상태·조회 실패·재시도

분리된 브라우저의 `/form/manage`에서 정상 목록부터 production 서버 중단·재기동 후 복구까지 한 세션으로 확인했다.

1. 정상 목록 총 24개를 불러왔다.
2. 결과가 없는 검색어로 `데이터가 없습니다` 및 총 0개를 확인했다.
3. production 서버를 중단하고 재조회해 네트워크 오류 안내와 빈 테이블을 확인했다.
4. 같은 빌드를 재기동하고 `P06`으로 검색해 `불러오는 중입니다` 상태 후 오류·로딩이 사라지고 실제 6개가 복원되는 것을 확인했다.
5. 기준 게시 폼의 version 4와 `updatedAt=2026-10-10T15:51:57.699Z`가 유지되어 이 흐름이 DB를 변경하지 않았다.

구조화 결과는 `browser-selected/list-state-retry-verification.json`에 있다.

## 품질 게이트

- `npm run typecheck`: 통과
- `ALLOW_LOCAL_MAIL=1 ALLOW_LOCAL_KAKAO=1 ALLOW_LOCAL_PAYMENT=1 npm run build`: production 82페이지 통과
- 회사 격리 수정 전 집중 회귀: `analytics.test.ts`, `context-audit.test.ts`, `form-draft-save.test.ts`, `template-access-gate.test.ts` 47개 통과
- `AppShell.tsx` 변경 린트: 오류 0, 기존 `<img>` 경고 1
- 원본 로그: `typecheck.log`, `build.log`, `app-shell-eslint.log`, `company-isolation-regression.log`, `server-gate.log`

## 남은 F7 조건

- 원본 9개 편집·목록 경로의 정상/폼 미선택 상태와 3개 화면 폭, 목록의 로딩·빈 결과·조회 실패·서버 재기동 후 재시도를 확인했다. 권한 거절, 검증 실패, 409, 저장 실패, 완료, 새로고침을 폼 변경과 묶은 하나의 브라우저 결합 흐름으로 남긴다.
- 게시 폼의 7개 단계 재개는 3개 화면 폭에서 확인했다. 질문 3종 이상+제공자+동의서 초안의 변경 결합 흐름, 회사 A/B 문서 연결 거절, 게시 후 구 문구·질문·보기·PDF 불변을 실제 화면·DB로 대조한다.
- 390/768/1440px의 정상·미선택·폼 선택 상태, 뒤로·앞으로 복원, 주요 단계의 키보드 도달성, A/B 회사 전환·직접 URL 격리와 별도 브라우저 세션 재개를 확인했다. 로그아웃 후 재로그인 복원은 전체 결합 흐름에서 확인한다.
- production 빌드와 현재 재시작 세션의 A/B DB 격리를 기록했다. 폼 변경 결합 흐름의 재시작 전후 객체 지문과 관련 전체 회귀는 남아 있다.
- OAuth·SMTP·외부 본인확인·전자서명·실결제 라이선스는 외부 자격증명 의존으로 `external_pending`을 유지한다.
