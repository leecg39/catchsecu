# 문서 CRUD·게시·공개 링크·서비스 표시 검증

2026-10-03. 로컬 PostgreSQL과 합성 자료로 검사했다. 원본 운영 계정에는 쓰지 않았다.

## 구현 범위

- 동의서·처리방침·국외 이전 동의서의 초안 CRUD, 목적/제공자 연결, 문구 템플릿 CRUD·복사·보관·복원.
- 게시 버전의 본문·공개 이름·수집 근거를 불변 스냅샷과 SHA-256으로 보존. 버전 비교, 공개 링크 만료·개별 회수·전체 비공개·보관·복원.
- 서비스 수집/제공 탭의 표시 문구·외부 HTTPS 주소·같은 서비스의 처리방침 게시 버전을 DB에 저장. 연결 중인 처리방침의 회수는 거부한다.
- 회사·서비스·역할 권한을 실행 시 재확인. 동시 수정·게시 및 연결/회수 경합을 검사하고 DB 제약으로 불변 자료와 참조를 보호한다.

## 검증 결과

| 검사 | 결과와 증거 |
|---|---|
| 실제 DB 통합 테스트 | 문서 21개와 기존 149개, 총 **170/170 통과**. [로그](tests-final.log) |
| 타입·린트·빌드 | 타입 오류 0, 린트 오류 0(기존 경고 21), 배포용 빌드 통과. [타입](typecheck-final.log), [린트](lint-final.log), [빌드](build-initial.log) |
| DB migration | migration 19 개발·시험 DB 적용. [개발](migrate-dev.log), [시험](migrate-test.log) |
| Ego CRUD | 문구 생성→동의서 생성→게시 v1→초안 변경→게시 v2→비교→보관→복원→재게시 v3. [초안](browser-draft.png), [버전](browser-versions.png), [문구 복원](browser-clause-restored.png) |
| 공개 문서 | HTML 입력을 문자로 표시하고 스크립트 실행 0. 링크 회수 후 접근 거부. [결과](browser-public-check.json), [공개 화면](browser-public-v1.png), [회수 화면](browser-revoked.png) |
| 서비스 연결 | 두 탭 저장값이 서로 유지됨. 연결된 처리방침의 비공개 전환 409. [설정](browser-service-collection.png), [차단](browser-policy-blocked.json) |
| 독립 DB 대조 | 본문/해시 재계산, 공개 DTO 내부 ID 부재, v1/v2 회수·v3 활성, 템플릿 v4 변경과 문서 v1 독립성. [최종 결과](database-final.json) |
| 서버 재시작 | 같은 게시본·회수 상태·서비스 설정이 유지됨. [결과](browser-restart.json) |
| 반응형 | 에디터 1440/768/390px 페이지 넘침 0; 표 내부만 가로 스크롤. [측정](browser-responsive.json), [390px](browser-document-390.png), [공개 문서 모바일](browser-public-mobile.png) |

## 계약과 남은 범위

원본 도움말 3-0/3-1/3-2/9-1을 확인했다. 원본 유료 `/basic/*` 정상 화면, P/C/OC 코드와 서비스별 agree 파라미터는 미확정이다. 독립 공개 경로 `/document/view/:token`을 사용한다. [이번 계획](PLAN.md).

현재 서비스 표시 설정은 관리 화면의 저장·미리보기까지 구현했다. 게시 문서 PDF는 [후속 검증](../document-pdf/README.md)에서 구현했다. 폼의 문서 버전 선택·동의 영수증 연결과 원본 미확정 경로는 후속 작업이다. 재위탁 공지·외부 발송도 남아 있다. P05-T02/P03-T04의 부분 증거로 기록하며 전체 181개 경로나 72 Task 완료를 뜻하지 않는다.

재실행: `npm test`, `npm run typecheck`, `npm run lint`, `ALLOW_LOCAL_MAIL=1 npm run build`. 브라우저 합성 자료 대조: `node --env-file=.env.local --import tsx scripts/qa-documents.ts final`.
