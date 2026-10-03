# 첨부파일 구현·검증

2026-10-02 당시 기록이다. P01-T03와 P06-T03의 **로컬 저장소·회사 구성원 열람 범위**를 구현했다. 이후 [외부 공유](../sharing/README.md), S3 어댑터/서명 시험과 [현재 파일 권한·기한 재검사](../P06-T03/README.md)를 추가했다. 실제 운영 S3/외부 저장소와 원본/UI 전체 게이트는 남아 있다. 제출된 응답의 실제 파기와 캐시 정리는 [파기 검증](../destruction/README.md)에서 구현·검증했다. 아래 98개 테스트와 캡처는 당시의 기록이다.

## 구현한 동작

- FileObject를 회사·서비스·게시본·질문·응답과 복합 FK로 연결했다. 질문 종류와 서비스 일치, 상태 전이, 원본 바이트 불변은 DB 트리거로도 검사한다.
- 파일명은 암호화해 DB에 저장하고, 바이트는 AES-256-GCM으로 비공개 경로에 저장한다. 객체 ID를 추가 인증 데이터로 사용하므로 암호화 파일을 다른 키로 옮겨도 복호화하지 못한다. 폴더 700, 파일 600이다.
- 공개 업로드는 별도 권한 값을 발급하고 DB에는 해시만 저장한다. 응답 제출 트랜잭션에서 파일을 연결하면서 권한을 회수한다. 업로드 권한으로 다운로드할 수 없다.
- 확장자, MIME 시그니처, UTF-8, 1~10MB 크기, SHA-256을 검사한다. 이는 파일을 렌더링하거나 문서 구조 전체를 파싱하는 기능은 아니다.
- 실제 ClamAV와 공식 서명 DB를 사용한다. 검사 실패·통신 장애·7일 이상 지난 정의 파일은 통과 처리하지 않는다. 검사 전, 제출 전 공개 파일, 삭제 중 파일은 다운로드하지 못한다.
- 다운로드는 현재 회사·서비스 권한과 응답·질문 조합을 확인한다. 개인정보 담당자의 교체 업로드는 submission.write와 file.read를 함께 요구한다. 이전 첨부는 정정 증거로 보존한다.
- 임시 업로드는 1시간 뒤 정리 대상으로 바뀐다. worker가 암호화 객체를 삭제하고 FileObject의 파일명·해시·크기를 지운다. 저장소 삭제 실패 시 접근 차단 상태를 유지하고 재처리한다.
- 회사 용량은 기본 1GiB이며 DB 잠금으로 예약 경합을 제어한다. 개별 첨부 증거의 임의 삭제는 금지한다. 보유 기한이 지난 응답 파일은 열람을 차단하며 보존 조치는 유지한다.

## 검증 결과

| 검사 | 결과 | 근거 |
|---|---|---|
| 첨부파일 통합 시나리오 | 19개 통과 | [파일 테스트](tests-expanded.log) |
| 기존 기능 포함 전체 테스트 | 98개 통과 | [전체 테스트](tests-all.log) |
| 타입 검사·프로덕션 빌드 | 통과 | [타입 검사](typecheck.log), [빌드](build.log) |
| 린트 | 오류 0, 기존 경고 21 | [린트](lint.log) |
| DB migration | 개발·테스트에 11번 적용 | [마이그레이션](../../../prisma/migrations/20261002143000_private_files/migration.sql) |
| 공식 악성코드 정의 | daily/main/bytecode 검증 통과 | [갱신 로그](clamav-update.log) |
| 실제 브라우저 다운로드 대조 | 두 파일의 바이트·해시 일치 | [DB 증거](database-evidence.json) |

통합 테스트는 별도 PostgreSQL catchsecu_test와 실제 ClamAV 프로세스를 사용했다. EICAR 표준 시험 파일 차단, 스캐너 중단·정의 만료·복구, 10MB 경계, 위장 MIME, 타 회사·역할·서비스·질문·응답 차단, 권한 재사용, 동시 취소/제출, 업로드 중복 요청, 용량 경합, 파일 교체, 보존 조치, 삭제 실패 후 재처리를 확인했다. 파일 최초 테스트의 EICAR fixture에 마지막 문자 누락이 있어 보정한 뒤 실제 탐지를 확인했다.

## Ego 브라우저

프로덕션 서버에서 UI로 폼 생성 → 게시 → 형식 오류 확인 → 파일 제출 → 관리자 다운로드 → 파일 정정 → 이력 확인을 수행했다. API 성공 응답만으로 완료 판정하지 않고 다운로드 파일을 디스크·DB와 별도로 대조했다.

- [잘못된 PNG 형식 거부](browser-invalid-type.png) · [상태 기록](browser-invalid-type.txt)
- [공개 폼 제출](browser-submitted.png) · [상태 기록](browser-submitted.txt)
- [첨부 정정](browser-corrected.png) · [상태 기록](browser-corrected.txt)
- [서버 재시작 뒤 이전·현재 첨부 이력](browser-history.png) · [상태 기록](browser-history.txt)
- [파일 목록](browser-file-list.png) · [파일 단건](browser-file-single.png)
- [잘못된 질문 ID 차단](browser-wrong-question.png)
- [로그아웃 후 열람 차단](browser-unauthenticated.png)
- 다운로드한 [원본 합성 파일](download-original.txt), [정정 합성 파일](download-corrected.txt)

합성 QA 폼은 38b8b364-d37a-43cc-ab98-35b8222ca0a5, 응답은 449cbb40-42ad-430d-a0c2-70a8434fc5d9이다. 공개 토큰과 로그인 암호는 보고서에 저장하지 않는다.

## 검사 도구 실행

공식 ClamAV 1.5.4 macOS 패키지의 Cisco 배포 서명과 Apple 공증을 확인했다. [패키지 확인 결과](clamav-package-signature.txt). 시스템 경로에 설치하지 않고 프로젝트의 .local/tools/clamav에 압축을 풀었다. 로컬 실행 파일 두 개는 상대 라이브러리 경로를 추가한 뒤 ad-hoc 서명했다. 원본 패키지는 그대로 보관한다.

[패키지 해시와 소켓 권한](scanner-installation.json), [worker 1회 실행](worker-once.log), [181개 경로 계획 검사](plan-check.log)도 기록했다.

Homebrew는 시스템 경로 권한과 사용자 경로의 의존성 체크섬 문제로 설치하지 못했다. 해당 오류를 무시하거나 체크섬 검증을 끄지 않았다. 사용한 바이너리는 공식 패키지에서 꺼낸 것이다.

프로젝트 루트에서:

```sh
node --import tsx scripts/clamav-local.ts configure
node --import tsx scripts/clamav-local.ts update
node --import tsx scripts/clamav-local.ts serve
# 별도 프로세스: 주기적 공식 정의 갱신
node --import tsx scripts/clamav-local.ts updater
# .env.local/.env.test.local의 CLAMAV_SOCKET을 configure 출력 경로로 설정한다.
npm run worker
npm test
```

Unix 소켓만 사용하며 외부 TCP 포트는 열지 않는다. 런처는 UTC와 CVD_CERTS_DIR을 지정한다. 공식 정의의 인증서 검증은 유지한다. 환경이 바뀌면 실행 파일과 라이브러리 설치 및 해당 환경에서의 재검증이 필요하다.

공식 근거: [ClamAV 설치](https://docs.clamav.net/manual/Installing.html), [검사 프로토콜](https://docs.clamav.net/manual/Usage/ClamdProtocol.html), [공식 서명 관리](https://docs.clamav.net/manual/Usage/SignatureManagement.html), [CVD 인증서 설정](https://github.com/Cisco-Talos/clamav/releases).

## 남은 범위와 판정

- 현재 저장 어댑터는 로컬 파일시스템이다. S3 구현·시험은 미완료이다.
- file-view의 customerId는 이 독립 구현에서 Submission.id, questionId는 stableKey로 매핑한다. 회사 내부 목록·단건 경로는 작동한다. 두 /shared 경로는 외부 인증·ShareGrant가 구현될 때까지 열람을 허용하지 않는다.
- 제출된 응답·첨부의 실제 파기, 원문/정정 이력/동의 증거와 중복요청 캐시 정리는 P07-T03 후속 구현에 연결했다. 실제 삭제와 증명서 발급까지 [별도 검증](../destruction/README.md)했다. 만료 시 접근 차단과 파기 완료 상태는 구별한다.
- IdempotencyRecord의 암호화 응답 캐시는 24시간 TTL 또는 연결된 파일·응답 파기 시 제거한다. 재실행 방지 표식만 남기며 과거 소속 없는 캐시는 migration 12에서 무효화한다.
- 서비스 보관 상태의 파일 열람은 현재 차단된다. 공유·보관·파기 정책의 전체 수용조건과 181개 경로 E2E는 계속 진행한다.
- Node pg 드라이버의 기존 동시 query 폐기 예정 경고가 남아 있다. 테스트 실패는 없으며 pg 9 전환 전 점검 대상이다.

따라서 P01-T03/P06-T03은 부분 증거를 연결하고 72개 Task의 완료 수를 올리지 않았다.
