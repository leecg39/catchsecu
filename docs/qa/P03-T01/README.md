# P03-T01 회사·서비스 CRUD

2026-10-03. 실제 PostgreSQL, 로컬 production 앱, Ego Lite TaskSpace 34로 수용 조건을 확인했다.

## 구현

- 회사 생성은 소유자 Membership·기본 서비스·보안 정책·무료 체험·현재 세션 회사 선택·감사를 하나의 트랜잭션으로 저장한다.
- 회사 기본 정보와 세금계산서 담당자 이름·연락처를 조회·수정한다. 버전 충돌은 409로 거부한다.
- 소유자는 회사명을 확인하고 폐쇄를 요청하거나 취소할 수 있다. 사유는 암호화하며 관리자에게만 공개한다. 이 단계는 요청 접수다. 실제 폐쇄·물리 삭제는 청구·자산·보존 확인 절차가 필요하다.
- 사업자등록증 PDF/PNG/JPG는 최대 10MB, 형식·바이트·ClamAV 검사·회사 저장 한도를 적용한다. 회사 관리자만 첨부·다운로드·교체·삭제한다. 파일명과 바이트는 암호화하고, DTO에는 저장소 키·암호문을 노출하지 않는다.
- 교체·삭제는 기존 다운로드를 즉시 차단한다. 저장소 삭제 실패는 worker가 재시도한다.
- 서비스 생성·검색·편집·보관·복원과 회사/서비스 선택을 DB 세션에 연결한다. 업무 데이터 참조가 있는 서비스의 DELETE/PATCH 보관은 409다. 보관된 서비스는 선택할 수 없다.
- 여러 회사에 소속된 사용자를 위한 회사 선택 UI와 새 회사 등록 진입점을 추가했다. 전환은 현재 기기의 세션에 적용된다.

## 서버·DB 검증

- `tests/server/company-management.test.ts`: 14개 통과. 실제 API의 생성·수정·새 로그인·동시 변경, owner/admin/viewer/B회사·미인증·Origin·엄격 입력, 폐쇄 확인·취소·요청자 tenant FK, 파일 왕복·교체·위장 형식·경로탈출·실제 감염 PDF 차단·동시 업로드·삭제 재시도, 서비스 선택·보관·복원·참조 409를 확인했다.
- ClamAV 감염 검증은 표준 EICAR 파일을 첨부한 유효한 PDF를 사용했다. 단순히 PDF 앞뒤에 시험 문자열을 붙이는 방식은 PDF 내부 파일 검사 증거로 사용하지 않았다.
- `full-test.txt`, `full-test.json`: 전체 31파일·453개 통과.
- `migration.txt`: shadow DB 빈 설치 52개, 51→52 업그레이드, 실패 migration 롤백·복구·seed 통과. 상세 결과는 `../P01-T01/db-rehearsal.json`. dev/test의 기존 자료는 초기화하지 않았다.
- `typecheck.txt`, `lint.txt`, `helper-lint.txt`: 타입 통과·린트 오류 0. 최종 변경 파일 전체 검사에서 기존 이미지 경고 5개가 남아 있다.
- `build.txt`: 최종 production 빌드 통과.

## 실제 화면 검증

1. 합성 계정으로 `/company-info`에서 회사를 생성했다. 청구 담당자·주소·연락처·사업자번호와 기본 서비스가 표시됐다.
2. 파일 입력으로 사업자등록증을 업로드하고 브라우저 다운로드를 수행했다. 원본과 내려받은 바이트가 같았다. 교체 후 이전 파일 주소는 404였다.
3. 틀린 회사명으로 폐쇄 요청하면 오류가 표시됐다. 올바른 이름으로 접수한 후 화면에서 요청을 취소했다.
4. 회사 주소·담당자와 서비스명·소개를 수정했다. 서비스 검색과 선택을 수행했다.
5. 로그아웃 후 새 암호·미사용 복구코드로 로그인했다. 회사 선택 UI에서 생성한 회사로 전환하고 저장된 회사·서비스 정보가 유지됨을 확인했다.
6. 서비스 보관→보관 목록→복원→운영 목록을 화면에서 확인했다.
7. 사업자등록증을 화면에서 삭제했다. 합성 수집 목적은 실제 API로 생성하고, 그 서비스의 화면 보관 요청이 실패하는 것을 확인했다. 서버 시험에서도 DELETE와 PATCH 모두 409였다.
8. 390px 화면에서 회사 선택과 정보가 표시되고 `scrollWidth === viewport === 390`임을 확인했다. 화면 검토에서 9개 정보 필드가 암묵적 세 번째 열로 배치되는 문제를 발견했다. 데스크톱은 명시적 두 열, 600px 이하에서는 한 열로 수정하고 production 빌드를 다시 통과했다. 수정 후 최종 화면 확인은 Ego 제어 재개 응답을 기다리는 중이다. 임시 viewport는 복원했다.

`browser.json`은 화면 흐름·다운로드 해시·이전 파일 차단 증거다. `database.json`은 화면 조작 후 별도 DB 연결로 확인한 회사 버전 7·서비스 버전 4, 폐쇄 취소, 파일 2개 원문·키 삭제, 참조 자료와 감사 이벤트다. 계정 비밀번호·복구코드는 Git에서 제외한 `.local/`에만 있다. 검증 자료는 합성 데이터다.

화면 증거: `company-created.png`, `business-file-uploaded.png`, `closure-requested.png`, `company-after-relogin.png`, `service-archived.png`, `service-restored.png`, `service-in-use.png`, `company-mobile.png`.

실행:

```sh
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/company-management.test.ts
npm test
npm run verify:p01-db
npm run typecheck
ALLOW_LOCAL_MAIL=1 npm run build
node --env-file=.env.local --import tsx scripts/verify-company-browser.ts
```

브라우저 DB 검증 스크립트는 로컬 `catchsecu_dev`와 이 항목에서 생성한 `.local/p03-company-fixture.json`만 읽는다. API 계약은 `docs/planning/contracts/openapi.json`·정책표에 함께 반영했다.
