# R25-T05 UI·접근성·성능·원본 대조 마무리

`scripts/qa-r25-ui-final.ts`가 세 축을 한 번에 측정한다. 결과: [ui-final.json](ui-final.json) · 스크린샷: [screens/](screens/)

## A) 접근성 — 10개 대표 페이지

`/dashboard`·`/notice`·`/form/manage`·`/sms`·`/security`·`/my-page/info`·`/log/authority`·`/pay/history`·`/help-center`·`/jap_intro`를 1440px에서 측정했다.

- 전 페이지 `lang="ko"`, `main`/`h1` 랜드마크 존재.
- 레이블 커버리지 100%(입력·버튼에 접근 가능 이름).
- 오류 알림 `role=alert`/`aria-live` 영역 1~3개.
- Tab으로 초점 이동 가능한 요소 6~40개, 초점 이동 동작 확인.
- `word-break: normal`(한글 단어 단위 줄바꿈, `break-all` 미사용).
- 390px 뷰포트 가로 오버플로 없음.
- `/jap_intro`는 벤더 정적 폼이라 앱 공통 스킵링크가 없는 것이 유일한 비적용 항목(행동은 정상 기록).

## B) 성능 — 목록 API 5종(프로덕션 빌드·실 데이터)

환경과 데이터량 스냅숏은 `ui-final.json > perfContract`에 기록. 기준: 목록 API 중앙값 3초 이내.

| API | 중앙값 | 최대 |
|---|---|---|
| GET /notices | 21ms | 28ms |
| GET /audit-events?pageSize=50 | 49ms | 101ms |
| GET /forms?pageSize=50 | 46ms | 121ms |
| GET /campaigns?serviceId=…&channel=sms | 58ms | 93ms |
| GET /support-tickets | 47ms | 67ms |

전 항목 통과. 대기열의 가장 오래된 queued 작업 dueAt도 함께 기록.

## C) 원본 대조 — 153개 참조 캡처

`docs/design-references`의 원본 캡처와 현재 화면을 픽셀 비교(차이 비율).

- similar 115 · close 13 · diverged 25 (전체 153행, 각 `diffPct` 기록).
- diverged 25건은 15~85% 차이: 로그인/약관·GPKI 계열은 원본의 레거시 마크업과의 구조적 차이, 알림톡 5건은 현 구현이 카드형 재설계, `/form/ad-manage`·`/set/authority`·`/security/two-factor`는 동적 데이터·레이아웃 차이.
- **100% 일치 주장 금지 원칙에 따라 발산 항목을 숨기지 않고 행 단위로 남겼다.**
- `unmapped`는 매니페스트 미등록 경로로 유추가 불가한 참조 파일(전수 스윕 밖 대상) — 목록만 기록한다.
