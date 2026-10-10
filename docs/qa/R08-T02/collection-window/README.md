# 폼 응답 수집 시작·종료 일정 검증

2026-10-10에 원본 캐치폼 설정에서 관찰한 응답 수집 시작·종료 예약을 독립 버전 계약, PostgreSQL 제약, 게시본, 공개 상태와 편집·승인 화면에 연결했다. 이 체크포인트는 일정 경계만 다룬다. 중복 참여, 대상자 목록, 인증 방법 전체와 R08 전수 수용은 포함하지 않는다.

## 구현 계약

- 초안의 `collectionOpenAt`·`collectionCloseAt`은 오프셋이 있는 ISO 시각으로 받고 `FormVersion` 독립 컬럼에 저장한다.
- 시작·종료가 모두 있으면 종료가 시작보다 뒤여야 한다. 게시할 때 설정된 시작·종료는 현재보다 미래여야 한다.
- 브라우저의 `datetime-local` 값은 현재 브라우저 시간대로 표시하고 UTC ISO 값으로 전송한다.
- 구버전 클라이언트가 두 키를 생략한 편집은 기존 일정을 보존한다. 명시적인 `null`만 일정을 해제한다.
- 복제·템플릿 사용·개정·승인 스냅샷은 저장된 일정을 보존한다.
- 게시본은 `Publication.opensAt`·`expiresAt`을 고정한다. 이전 `expiresAt` 게시 요청이 저장된 종료 시각과 다르면 409로 거절한다.
- 시작 전 공개 GET은 제목·언어·시작 예정 시각만 반환하고 질문·동의·본문을 노출하지 않는다. 제출은 425로 거절하며 응답 수를 늘리지 않는다.
- 시작 후에만 본문과 제출을 허용하고, 종료 뒤에는 사용자 지정 마감 화면을 반환하며 추가 제출은 410으로 거절한다.
- 기존 버전은 `schema 0 / NULL`, 기존 게시본은 `opensAt NULL`로 유지해 과거 승인 지문과 공개 상태를 바꾸지 않는다.

## 검증 결과

- migration 142개를 개발·시험 DB에 적용하고 빈 격리 스키마에도 142개를 설치했다. 일정 컬럼 4개와 CHECK 제약 2개를 확인했다.
- 개발 DB의 기존 폼 버전 196개와 게시본 154개를 migration 전후 해시로 대조했다. 새 컬럼을 제외한 해시가 동일하며 모든 기존 행은 legacy 상태를 유지한다.
- 일정 전용 PostgreSQL/API 시험 5개가 통과했다. ISO·순서·과거 시각, 구클라이언트 보존/명시 해제, 복제·템플릿·개정, 시작 전 425·시작 후 201·종료 후 410, DB 우회 변조를 확인했다.
- 폼·질문·페이지·복제·템플릿·게시 회귀 14파일 158개가 통과했다.
- TypeScript와 변경 파일 ESLint, production 82페이지 빌드가 통과했다. 빌드는 로컬 QA 공급자임을 명시하는 `ALLOW_LOCAL_MAIL/KAKAO/PAYMENT=1`에서 실행했다.
- 스키마 계약의 예상 밖 차이 0, OpenAPI 323경로·458작업, API 정책 누락 0, 활성 계획 107작업·의존 순환 0을 확인했다.
- Ego Lite에서 설정 화면의 한국 시간 시작 `2026-10-11 22:35`·종료 `2026-10-12 22:35`, 시작 전 예정 안내, 시작 후 실제 제출 1건, 종료 후 사용자 지정 마감 문구를 확인했다.
- production 서버 PID를 바꿔 재시작한 뒤 DB 지문 `aa1fc891301293d7907cfa44d1b72d486675172f4c16b8e27ba7c927ffa1aec5`와 마감 화면이 그대로 유지됐다.

## 증거

- 전체 판정: [verification-final.json](verification-final.json)
- 실제 Ego Lite 단계: [ego-flow.json](ego-flow.json)
- migration 전후 보존: [pre-upgrade.json](pre-upgrade.json), [upgrade-preservation.json](upgrade-preservation.json)
- 빈 스키마: [fresh-schema.json](fresh-schema.json), [fresh-schema.log](fresh-schema.log)
- 브라우저 fixture·경계·재시작: [browser-prepare.json](browser-prepare.json), [browser-open.json](browser-open.json), [browser-close.json](browser-close.json), [browser-freeze.json](browser-freeze.json), [browser-verify.json](browser-verify.json)

## 남은 범위

- 중복 참여 방지와 대상자 목록
- EMAIL_OTP·SOCIAL 등 인증 방법별 실제 증거와 외부 제공사 수용
- R08 전체 경로의 권한·동시성·빈 상태·오류·접근성 전수 수용
- NLP/AI 문항 분류와 법정 동의 문안 전체 생성

따라서 F5의 시작·종료 일정 단위는 검증됐지만 R08-T01~T04와 전체 목표는 계속 `in_progress`다.
