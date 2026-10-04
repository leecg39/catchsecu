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
