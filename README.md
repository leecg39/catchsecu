# 캐치시큐 클론 — 풀스택 구현 진행 중

CSV의 181개 경로를 대상으로 화면을 조사하고 독립 백엔드를 구현하고 있습니다. 전체 페이지의 기능 구현은 아직 완료되지 않았습니다.

## 실행

Node 22.23.1과 PostgreSQL을 사용합니다. 최초 DB 설정은 `scripts/setup-local.py`를 사용하며, 기존 설정을 덮어쓰지 않습니다.

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

[로그인](http://localhost:3100/login) · [대시보드](http://localhost:3100/dashboard)

로그인은 실제 Better Auth 인증과 DB 세션을 사용합니다. 개발 계정의 초기 암호는 Git에서 제외된 `.local/catchsecu_dev-accounts.json`에 있습니다.

```sh
npm run worker              # 메일·파기·만료 파일·응답 캐시 처리
npm test                    # 별도 catchsecu_test PostgreSQL DB
npm run typecheck
npm run lint
ALLOW_LOCAL_MAIL=1 npm run build
ALLOW_LOCAL_MAIL=1 npm start -- --port 3100
```

실제 운영 환경은 SMTP와 비밀 설정이 필요합니다. `ALLOW_LOCAL_MAIL`은 로컬 빌드·미리보기용입니다.

## 구현 및 검증

- 인증·이메일 검증·암호 복구·2단계 인증·역할/회사/서비스 권한.
- 회사·서비스·프로필·로그인 기기 관리, 구성원·초대·역할·소유권 이전.
- 서비스 템플릿 CRUD·전체 복제, 게시 승인 요청·검토·게시 연결.
- 비밀번호 변경 주기·최소 길이·최근 해시 재사용 제한·로그인/기간 유예, 계정별 원자적 변경·재설정과 세션/링크 회수.
- 폼 생성·설정·게시·공유·검색·복제·보관, 고정 URL 관리.
- 공개 응답 제출, 관리자 조회·정정·철회, 메모 CRUD, 변경 이력·보존 조치·파기 요청.
- 공개 첨부 업로드·암호화 저장·실제 악성코드 검사·비공개 다운로드·첨부 정정·임시 파일 삭제/재처리.
- 보유 기한 정책, 파기 승인·예약·취소·실패 재처리, 원문·첨부·캐시의 실제 삭제와 증명서 다운로드.
- 수집 목적·국외 제공/수탁자 CRUD, 보관·복원·당시 설정의 변경 이력과 두 기초 자료 화면.
- CSV 업로드·매핑·행 검증·부분 반영·실패 다운로드·원본 정리.
- 문서·문구 CRUD, 게시 버전·본문 해시·공개 링크·회수·복원, 서비스 표시 설정.
- 한글 게시 문서 PDF 생성·버전별 파일 보존·권한/공개 링크 다운로드.
- DB 트랜잭션, 중복 요청 방지, 수정 충돌 처리, 감사 이력, 민감값 암호화.

현재 구현 범위의 **실제 DB 통합 테스트 368개**, 타입 검사·빌드, 린트 오류 0을 확인했습니다. Ego 브라우저에서 생성→게시→응답 제출→조회·정정·메모 관리와 첨부파일 제출·교체·다운로드를 조작했습니다. 합성 응답의 파기 승인→실제 삭제→증명서 다운로드까지 독립 DB·파일 저장소와 대조했습니다. 수집 근거의 생성·수정·보관·복원·이력과 2페이지 검색도 실제 화면에서 확인했습니다.

[구현 현황](docs/IMPLEMENTATION-STATUS.md) · [최근 검증 증거](docs/qa/campaigns/README.md) · [72개 실행 Task](TASKS.md)

폼 문서 연결·필수/선택 동의·승인 해시·암호화 동의 영수증과 PDF를 구현했습니다. 폼 개정·철회·서버 재시작 후 파일 보존, 실제 파기 후 삭제/다운로드 차단을 [검증 보고서](docs/qa/form-documents/README.md)에 기록했습니다.

외부 열람자 초대·수정·회수·이메일 인증, 지정 버전/항목과 공유 파일 열람을 연결했습니다. 실제 로컬 메일·Ego·DB에서 권한 변경과 회수 후 차단을 [검증](docs/qa/sharing/README.md)했습니다.

## 남은 작업

전문가 배정, 원본 공용 템플릿 전체 질문, 분기·행렬 문항, 원본 미확정 문서 경로, S3, 외부 SMTP·공유 이력 운영 보존 정책, 백업 복원 후 재파기, 발송·결제·외부 연동, IP·SSO·보유 기간 미지정 정책과 통계·공지, 전 경로 E2E가 남아 있습니다. 일부 화면은 초기 클론의 정적 또는 브라우저 데모 상태입니다.

첨부파일을 받으려면 [ClamAV 실행 안내](docs/qa/files/README.md)의 검사 프로세스와 공식 정의 갱신이 필요합니다. 검사 서비스가 없거나 오래된 경우 게시·업로드를 차단합니다. 본인인증 공급자는 아직 미연결입니다. 파기 완료는 worker의 실제 삭제와 증명서 발급으로 확인합니다. 증명 범위는 현재 DB와 비공개 파일 저장소이며 백업·WAL·외부 사본은 제외합니다.

## 원본 조사 자료

- [원본 확인 범위](docs/research/COVERAGE.md), [181개 경로 CSV](docs/research/route-coverage.csv)
- [초기 화면 QA](docs/research/QA.md), [초기 경로 HTTP 검사](docs/research/route-http-check.json)
- [반응형 검사](docs/research/responsive-qa.json), [화면 캡처](docs/design-references/), [컴포넌트 명세](docs/research/)
- `public/assets/`: 원본에서 수집한 이미지·SVG·PDF
- `src/data/route-manifest.json`: 경로와 원본 확인 상태

원본 유료 기능·실제 ID가 필요한 일부 화면은 관찰이 제한되었습니다. 조사 자료의 화면 확인 여부와 현재 백엔드 구현 여부는 각각 기록합니다.

## 기술 구성

Next.js 16 App Router · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL 17 · Prisma 7 · Better Auth 1.7 · Zod 4 · Vitest 5.

`src/server/`에 권한과 데이터 로직, `src/app/api/v1/`에 API, `src/components/`에 화면이 있습니다. 비밀 설정과 테스트 계정 파일은 Git에서 제외됩니다.

CSV 업로드·컬럼/근거 설정·부분 반영·실패 CSV·원본 삭제·응답 정정/파기도 연결했습니다. [CSV 검증 결과](docs/qa/imports/README.md). 전 페이지 전체 구현은 계속 진행 중입니다.

정보주체의 명시적 이름·이메일 연결, 인증·동의 이력·철회, CSV 매핑과 이메일 발송 차단 검증은 [검증 기록](docs/qa/subjects/README.md)에 정리했다. 전체 기능 구현은 진행 중이다.

서비스·채널별 마케팅 동의·제외·철회·원문 삭제, 기존 응답의 근거 등록·CSV·통계와 전달 직전 차단을 구현했다. 실제 worker·Ego·DB·390px 결과는 [마케팅 검증](docs/qa/marketing/README.md)에 기록했다. 외부 SMTP·SMS 운영 검증은 후속 작업이다.

발신번호·주소 CRUD, 이메일/DNS 확인·대표·중지·재인증, 암호화 증빙·실제 삭제와 발신자 버전별 예약 차단을 연결했다. 실제 Ego 검증에서 이전 worker의 잘못된 발송을 발견해 작업 유형·DB 보호를 추가하고 재검증했다. [발신자 검증 결과](docs/qa/senders/README.md). 배포 시 모든 기존 worker를 중지하고 migration 후 같은 코드로 재시작해야 한다.

이메일/문자 6개 화면에 캠페인 초안 CRUD·수신자 CSV/폼 선택·예약·취소·실패 재처리·결과 CSV를 연결했다. 실제 로컬 메일, 파일 실패 후 복구, 앱/worker 재시작과 390px를 [캠페인 검증 결과](docs/qa/campaigns/README.md)에 기록했다. 문자 전송·실제 요금과 외부 SMTP 검증은 남아 있다. HTML 정제·메시지 템플릿 CRUD·검사된 첨부와 실제 메일/삭제·모바일·재시작은 [이메일 내용 검증](docs/qa/email-content/README.md)에서 확인했다.

이메일 전달·반송·신고 이력과 수신거부, 신규/예약 발송 차단, 결과 CSV 및 실제 로컬 HTTP·메일·재시작 검증을 [이메일 수신 결과 보고서](docs/qa/email-feedback/README.md)에 기록했다. 실제 외부 공급자·DKIM 검증은 남아 있다.

Slack·Teams 알림 설정 CRUD·필터·시험 전송·전송 이력, 공개 폼/CSV 실제 이벤트와 대기 취소를 연결했다. 로컬 worker가 만든 파일, DB, Ego 화면·390px·재시작을 [알림 검증 보고서](docs/qa/notifications/README.md)에 대조했다. 외부 시험 채널 수신은 남아 있다.
