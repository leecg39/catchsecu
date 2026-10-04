# P14-T01 로컬 데이터 이전·가짜 상태 제거 — 미완료

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

주요 도메인은 DB 사용; 구형 미사용 localStorage 파일 잔존. 이번 소스 조사만으로 테스트 실행·브라우저·외부 연동 통과를 주장하지 않는다.

- [src/server/forms.ts](../../../src/server/forms.ts) — contentDto, formDto, fingerprint, lockCurrentForm
- [src/server/company-management.ts](../../../src/server/company-management.ts) — businessFileDto, companyDto, getCompany, listCompanies

## 남은 구현·수용

export→dry-run→import 및 원본 보존·격리 이관 구현.

원래 범위: 기존 localStorage 폼/응답/회사/프로필/동의설정의 export→dry-run→import, 중복키/회사귀속을 구현한다. 도메인 저장은 모두 DB로 전환한다.

수용 조건: 이관전후 개수/필드 검증; 잘못된자료 격리; 원본백업 유지; 비밀번호/임의token 이관0

선행: P13-T04. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.

구형 company.tsx/profile.tsx/editors.tsx의 localStorage는 남아 있지만 현재 디스패처는 LiveCompany/LiveProfile/SubprocessorMail을 사용한다. 문자열 잔존을 활성 저장 경로로 단정하지 않으며 별도 이관 도구 구현 증거도 없다.

## 2026-10-05 구현·라이브 검증: export→검사→이관 도구 + localStorage 데드코드 제거

### 구현

- `POST /api/v1/migration/legacy` — `dryRun` 모드는 쓰기 없이 변경·동일·격리 계획만 반환, 커밋 모드는 한 트랜잭션에서 User(프로필)·Company(활성 회사)를 갱신한다. [서버](../../../src/server/legacy-migration.ts), [계약](../../../src/contracts/migration.ts), [라우트](../../../src/app/api/v1/migration/legacy/route.ts).
- 화면 `/my-page/legacy-import` — 브라우저 `mg-*` 키 수집 → JSON 내보내기(원본 백업) → 검사 → 이관 → (선택) 브라우저 원본 정리. [컴포넌트](../../../src/components/management/LegacyImport.tsx). 181개 관찰 경로 외 추가 도구라 manifest가 아닌 page.tsx 직접 매칭으로 연결했다.
- 어디에서도 참조되지 않던 구형 localStorage 컴포넌트 `profile.tsx`·`company.tsx`·`editors.tsx`를 삭제했다. 활성 경로의 localStorage 사용은 로그인 화면의 "이메일 기억하기"(`catchsecu-demo-email`)뿐이며 이는 도메인 자료가 아니다.

### 검증 (테스트 8/8 통과, catchsecu_test2 격리 DB)

- dry-run은 DB·감사에 아무것도 쓰지 않음 / 커밋은 User·Company 동시 반영 + `migration.legacy_imported` 감사(필드명만)
- 동일 재이관은 전부 `unchanged`, version 미증가(멱등)
- 잘못된 값(200자 이름·불량 사업자번호)은 격리하고 유효한 형제 필드만 반영
- `password`·`token` 등 비밀 필드는 rejectedSecrets로 거부, 값 미기록 — 발견된 결함: 초기 정규식 `ssn`이 `busineSSNo`에 오탐해 businessNo가 비밀로 격리되던 것을 수정
- 알 수 없는 필드·섹션은 격리 목록으로 보고
- `company.manage` 없는 viewer는 회사 섹션만 skipped, 프로필은 정상 이관
- 미인증 401

### 브라우저 라이브 (Chrome DevTools, dev DB)

`mg-profile`·`mg-company`·`mg-mail-draft`·`mg-secret-test`를 실제 localStorage에 심고 전 과정을 조작했다. 검사 화면은 프로필 4·회사 3건의 현재→이관 diff와 알 수 없는 자료 2건 격리를 표시했다. 이관 후 DB 직접 대조(User 4필드·Company 3필드 일치), 프로필 배열의 비밀번호 인덱스는 이관되지 않았다. 원본 정리 후 `mg-*` 잔존 0. 다른 테넌트 자료는 변하지 않는다.

남은 범위: 원본 사이트의 실제 이관 도구 화면은 관찰하지 못해 독립 계약으로 구현했다. 선행 P13-T04 게이트 완료 후 정식 완료 판정.
