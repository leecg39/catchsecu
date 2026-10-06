# 동적 페이지 Mock fixture

2026-10-06: 실제 격리 PostgreSQL `catchsecu_mock_admin`에 합성 계정·회사·구독·결제·목적·국외 수탁자·문서·폼·응답·정보주체 세션을 생성했다. 정상 데이터와 잘못된 토큰/쿠키 거부를 포함한 **API 검사36개 통과**, 경로19개를 준비했다. [결과](report.json).

- 결제 결과4경로: 가상 PG 승인 후 persisted paid 상태 확인.
- 문서3종: 처리방침/수집동의서/국외이전동의서의 실제 `/document/view/:token` 게시 링크를 사용한다. 기존 P/C/OC 연결은 원본 매핑 증거가 없으므로 제거했다. P/C/OC 원본 경로 수용은 미완료다.
- 폼5경로: 실제 게시 토큰과 공개 폼·응답 저장 확인. `/url/:outerToken`은 별도로 생성한 fixed URL의 slug를 사용하고 조회 결과의 토큰 일치를 검사한다.
- 정보주체2경로: 합성 응답→접근 요청→로컬 큐 메일의 인증 링크→브라우저 바인딩 세션→동의/처리이력 확인. 실제 이메일 발송0.

- 첨부4경로와 공유목록1경로: 실제 바이트 업로드→ClamAV 검사→응답에 연결→내부/외부 다운로드 동일성, 공유 인증·선택 필드만 조회·쿠키 없는 접근401 확인.

## 재생성

지원 Node22/24에서 아래를 실행한다. `.local/mock-admin.env`는 `.env.test.local`과 동일한 로컬 키 및 전용DB 연결을 사용한다. 개발DB와 실제 발송 설정은 건드리지 않는다. 새 fixture를 추가하므로 기존 데이터를 삭제하지 않는다.

```sh
PRIVATE_STORAGE_DIR=.local/mock-page-storage MAIL_TRANSPORT=local PAYMENT_PROVIDER=local node --env-file=.local/mock-admin.env --import tsx scripts/prepare-mock-page-fixtures.ts
```

계정·원본 토큰·쿠키·URL은 Git에서 제외된 `.local/mock-page-fixtures.json`(0600)에만 저장한다. 보고서에는 경로 템플릿(문서는 유형별 실제 게시 경로)과 fixture SHA-256만 남긴다. 파일은 `.local/mock-page-storage` 전용 저장소에 보관하며 앱 서버도 같은 저장소를 사용해야 한다. 정보주체·공유 세션은30분 후 만료되므로 브라우저 실행 직전에 재생성한다.

`QA_MOCK_FIXTURES=1`이면 기존 `scripts/qa-full-page-gate.ts`가 이 파일의 계정·경로·쿠키를 사용한다. DB·origin·세션 만료를 검사하고, 원본 URL/캡처는 `.local/mock-page-sweep`에만 저장한다. 브라우저 실행 시 동일DB/origin을 가진 앱 서버가 필요하다. 브라우저 사용은 기존 Ego 작업 공간 제어권 규칙을 따른다.

**이 폴더의 증거는 API fixture 검증이다.** 후속 Ego 브라우저 검증 결과는 [별도 보고서](../ego-pages/README.md)에 기록한다. 외부 콜백과 아직 매핑하지 않은 경로의 정상 fixture와 전체 페이지 수용은 계속 미완료로 추적한다.
