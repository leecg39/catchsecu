# 작성자 자료 production HTTP 경계 QA

대상 스크립트는 `scripts/qa-rea-author-assets-http.ts`이다. 작성 단계에는 스크립트·HTTP·DB·시험·브라우저·빌드를 실행하지 않았다. 실행 결과 JSON은 root의 실제 호출이 있을 때만 생성한다. 코드 작성 및 정적 검사 통과는 HTTP 수용 통과가 아니다.

## 진입 조건과 실행

- origin은 `http://localhost:3100`, DB는 localhost 또는 127.0.0.1의 `catchsecu_dev`만 허용한다. `BETTER_AUTH_URL`의 origin도 일치해야 한다.
- 기존 `.local/rea-fullstack/author-assets/fixture.json`을 읽는다. 회사·서비스·발급 회원·폼·로그인 cookie가 준비되어야 한다. 계정 생성·로그인·ready/clean DB 설정은 하지 않는다.
- Ego 작성 후 `assert-authoring`으로 최초 자산 3개를 기록하고, 게시 및 응답을 한 뒤 실행한다. 최신 게시본에 새 응답을 요구하지는 않으며 같은 폼의 구버전 응답도 불변 보호한다.
- 실제 active publication과 로그인 manifest의 200을 먼저 확인한다. 유효하지 않은 토큰 때문에 나온 404를 비연결 자산 차단으로 인정하지 않는다.
- 주 fixture의 `hash` 또는 `frozenAt`이 있으면 세 모드 모두 거부한다. 모든 HTTP 요청 직전에도 다시 검사한다. root의 Ego/다른 QA 쓰기와 겹치지 않게 직렬 실행하고, 이 helper 완료 후 주 fixture를 freeze한다.

저장소 루트에서 다음 명령을 사용한다. 문서에 적은 예시이며 작성 에이전트는 실행하지 않았다.

```sh
/Users/user01/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --env-file=.env.local --import tsx scripts/qa-rea-author-assets-http.ts run
```

마지막 인자를 `cleanup` 또는 `verify`로 바꿀 수 있다. `run`은 한 번만 가능하며 기존 `http-probes.json`이 있으면 재예약하지 않는다. 실패한 run을 나중에 cleanup 성공으로 바꾸지 않는다. cleanup/verify 보고서는 해당 모드의 결과와 최초 run 결과를 별도 필드로 기록한다.

## 실제 12개 검사

| 번호 | 요청/관찰 | 성공 조건 |
| --- | --- | --- |
| 1 | cookie 없는 회원 manifest | 401 UNAUTHENTICATED |
| 2 | 현재 폼 revision보다 1 낮은 scope | 409 VERSION_CONFLICT |
| 3 | form scope에 templateId 혼합 | 422 VALIDATION_ERROR |
| 4 | kind query 반복 | 422 VALIDATION_ERROR |
| 5 | 저장·pin된 최초 자산을 최신 asset version으로 DELETE | 409 AUTHOR_ASSET_IN_USE. 낡은 version 때문에 나온 409는 불인정 |
| 6 | OPTION_IMAGE purpose와 PDF MIME/확장자 조합으로 init | 422 VALIDATION_ERROR, tenant 자산 수 불변, idempotency row 미생성 |
| 7 | 5 MiB + 1 metadata size init | 422 VALIDATION_ERROR, 자산/예약 미생성 |
| 8 | 같은 payload/idempotency key로 PDF 예약 재전송 | 같은 ID와 201, 자산 수 불변 |
| 9 | PDF 예약에 image/png Content-Type PUT | 415 FILE_CONTENT_TYPE, pending 유지 |
| 10 | 길이가 같은 변조된 PDF bytes PUT | 422 AUTHOR_ASSET_INTEGRITY, pending 유지 |
| 11 | 정상 PDF PUT/complete 뒤 공개 비연결 다운로드 | PUT 200, complete 200 ready, 실제 ClamAV clean/scannedAt, 공개 404 NOT_FOUND |
| 12 | 메모리에서 생성한 유효 DOCX 내부의 EICAR 표준 시험 파일 | PUT 200을 먼저 확인한 뒤 complete 422 AUTHOR_ASSET_UNSAFE, rejected/quarantined/infected와 실제 ClamAV engine/scannedAt, preview 409 AUTHOR_ASSET_NOT_READY |

과대 크기 검사는 init metadata 경계다. 스트리밍 전송 중 413, 권한 회수 경쟁, worker GC 경쟁, 공유 이메일 인증은 이 스크립트의 12개 통과 범위에 포함하지 않는다. 실제 브라우저 파일 선택이나 화면 동작의 증거로도 취급하지 않는다.

## 예약 기록과 실패 뒤 정리

private 폴더는 700, 신규 `http-probes.json`과 lock은 600이다. 기존 주 fixture는 수정하지 않는다. 별도 probe에 실행 전 DB 지문·보호 자산 ID·예약 payload와 idempotency key·응답 ID·진행/정리 상태를 기록한다. `http-probes.lock`은 독점 생성하며 정상 종료 때 제거한다. 프로세스 강제 중단 후 lock이 남으면 담당자가 프로세스 종료와 private 상태를 확인한 뒤 처리해야 하며 자동 중복 실행하지 않는다.

정상 경로는 실제 예약 2개(PDF, DOCX)다. 거절 예정인 init도 먼저 기록하므로 예상 밖의 성공으로 자산이 만들어져도 추적한다. 잘못된 init이 실제 422이고 자산 수와 캐시 부재까지 확인된 경우에만 `not-created`로 구분한다. 응답 ID는 status assertion 전에 저장한다. 네트워크 결과가 불명확하면 저장된 idempotency key의 DB resourceId를 읽기만 하여 복구한다. 캐시도 아직 없으면 `unresolved`로 남기며 미생성을 주장하지 않는다.

run은 검사 실패 뒤에도 cleanup과 보호 지문 검사를 각각 시도한다. cleanup은 시험용 ID에만 작동하며 최초 보호 ID 제외·현재 tenant/service/발급 member·입력 hash/size·pin 0개를 검사한 다음 최신 version GET → DELETE 204 → GET 410을 확인한다. DB에서는 asset/blob tombstone, 이름 암호문 삭제, 해당 blob의 다른 live 소유권 부재, idempotency 무효화를 읽기 확인한다. 상태나 스토리지 bytes를 직접 조작하지 않는다.

만료 410·삭제 대기 503·권한/세션 오류가 발생하면 정리 실패로 남긴다. helper가 worker를 실행하거나 기한을 늘리지 않는다. 원래 요청이 커밋 중일 수 있는 네트워크 오류를 성공적인 cleanup으로 해석하지 않는다. 후속 `cleanup`은 기존 예약만 처리하며 검사 전체를 다시 실행하지 않는다.

## 불변 보호와 보고서

run 직전 RepeatableRead 조회로 해당 tenant의 다음 상태를 SHA-256으로 고정한다: 전체 폼과 모든 버전/질문/보기/게시, 템플릿, 승인 snapshot, 기존 AuthorAsset/Blob, 전체 pin, 응답 암호문/영수증, 정정 payload, 공유 필드·challenge·session. 종료 시 신규 시험 예약 ID만 자산 목록에서 제외하고 같은 조회와 자산 ID 집합을 비교한다. 기존 최초 3개 자산을 포함해 전체 보호 상태가 같아야 한다.

HTTP 요청이 정상적으로 추가하는 감사, idempotency, rate limit, 로그인 session 갱신은 지문 대상 밖이다. 외부 저장소의 원본 bytes 자체 지문은 기존 flow helper의 downloads/freeze가 담당한다. 본 스크립트는 DB 지문과 실제 새 업로드 백신 경계를 증명한다.

`verify`는 HTTP/DB 쓰기 없이 기록된 삭제 상태와 기존 DB 지문만 재확인한다. 로컬 lock과 실제 검사 보고서는 생성한다. 최초 run에 실패가 있었다면 그 사실을 `originalProbeRunResult`로 유지한다.

실제 호출의 결과만 `docs/qa/R08-T02/question-metadata/author-assets/http-boundaries/<mode>-<UUID>.json`에 기록한다. 실행한 case·status·허용된 error code·실패 단계·오류 종류·지문/정리 여부만 기록하고 raw body, 토큰, cookie, 비밀번호, assertion 원문, 스택은 기록하지 않는다. DOCX는 메모리 ZIP으로만 만들고 디스크 샘플을 쓰지 않는다. 서버의 암호화된 private upload 저장은 실제 업로드 시험에 필요한 정상 경로이며 API 정리 후 tombstone으로 확인한다.

ClamAV outage/구버전 signature는 실제 실패다. mock이나 DB clean 설정으로 바꾸지 않는다. 성공/실패 보고서의 존재와 개수는 실제 root 실행 후에만 판단한다.
