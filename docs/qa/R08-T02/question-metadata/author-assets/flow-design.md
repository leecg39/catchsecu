# 작성자 자료 실제 수용 QA helper

소유 파일: `scripts/qa-rea-author-assets-flow.ts`와 이 문서. 작성 시 DB·HTTP·시험·브라우저·빌드를 실행하지 않았으며 샘플/fixture/성공 증거도 아직 생성하지 않았다. 실행 후의 HTTP·DB·바이트 검증과 코드 작성 완료를 구분한다.

## 안전 경계

- API origin은 `http://localhost:3100`으로 고정한다. `BETTER_AUTH_URL`의 origin이 이 값과 같고 `DATABASE_URL`이 localhost/127.0.0.1의 `catchsecu_dev`일 때만 진입한다. 테스트/운영 DB는 거부한다.
- `.local/rea-fullstack/author-assets`는 mode 700, fixture·샘플은 600이다. 계정/비밀번호/cookie/공개 token/초대 code는 fixture에만 저장한다. stdout·공유 가능한 증거에는 넣지 않는다. assertion actual/expected 객체와 raw HTTP body도 실패 로그에 출력하지 않는다.
- prepare는 `fixture.json`을 `wx`로 먼저 독점 생성한다. 이미 있으면 기존 준비 상태와 관계없이 거부한다. 중간 실패 시 파일을 자동 삭제하거나 새 계정을 재생성하지 않는다. 담당자가 private fixture와 실제 상태를 조사한 뒤 수동으로 재개 여부를 판단해야 한다.
- 기존 fixture의 freeze hash가 있으면 모든 HTTP 모드·DB 변이 모드를 거부한다. HTTP GET download도 감사가 추가되므로 변이로 취급한다. DB 읽기 assertion은 frozen 데이터를 바꾸지 않으며 필요한 baseline이 없으면 실패한다.
- 표본은 실행 시 PDFKit으로 유효한 PDF 2개와 sharp로 PNG 2개/JPEG 1개를 만든다. sample 파일 경로/크기/SHA/MIME/용도는 private fixture에 고정한다. snapshot에는 스토리지 bytes를 새로 만들거나 성공 상태로 DB를 조작하는 동작이 없다.

## root 실행 방법

저장소 루트에서 Node24와 `.env.local`을 사용한다. 이 명령은 문서 예시이며 작성 에이전트는 실행하지 않았다.

```sh
/Users/user01/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --env-file=.env.local --import tsx scripts/qa-rea-author-assets-flow.ts prepare
```

마지막 인자만 원하는 모드로 바꾼다. `upload-sample`은 추가 인자 `reference-a|reference-b|radio|checkbox|replacement`를 받는다. 성공/실패 증거는 `docs/qa/R08-T02/question-metadata/author-assets/flow/<mode>-<runUUID>.json`에 개별 기록된다. 스크립트를 실행하지 않은 상태에서는 그 디렉터리나 증거를 만들어 성공을 가장하지 않는다.

## prepare가 만드는 것

새 계정 → 이메일 확인 QA 설정 → 로그인 → 별도 회사/기본 서비스 → 3질문 초안이다. 다른 fixture나 기존 사용자에 영향을 주지 않는다. 이메일 확인은 기존 QA helper와 같은 **명시 DB fixture 설정**이며 실제 이메일 수신 검증이 아니다. 이후 회사/폼 작업은 HTTP API를 호출한다.

- 제목: `작성자 자료 검증`
- 질문1 객관식: `자료와 이미지 선택`, 보기 A/B.
- 질문2 체크박스: `확인한 항목`, 항목 A/B.
- 질문3 필수 단문: `확인 내용`.
- 한국어·동의 필수·동의 목적 설정·보유 30일·응답 상한 20.

생성 파일은 다음 절대 폴더에 저장된다.

`/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/.local/rea-fullstack/author-assets`

| sample key | 파일 | 실제 UI 용도 |
| --- | --- | --- |
| reference-a | reference-a.pdf | 최초 질문1 FILE 참고자료 |
| reference-b | reference-b.pdf | 개정 후 FILE 교체 |
| radio | radio-blue.png | 질문1 보기 A 이미지 |
| checkbox | checkbox-orange.jpg | 질문2 항목 A 이미지 |
| replacement | replacement-green.png | 개정 후 질문1 보기 A 교체 이미지 |

## 최소 실제 Ego 수용 순서

1. root가 prepare를 실행한다. private fixture에서 계정을 읽어 실제 Ego에 로그인하고 해당 초안을 연다. 비밀번호/cookie/token을 사용자 메시지나 QA 문서에 복사하지 않는다.
2. UI에서 질문1의 참고자료에 reference-a.pdf, 보기 A에 radio-blue.png를 추가한다. 질문2의 항목 A에 checkbox-orange.jpg를 추가하고 저장한다. 질문1 참고자료는 총 3개를 다음 순서로 맞춘다: FILE(reference-a.pdf) → LINK `개인정보 안내` / `https://example.test/privacy` → LINK `이용 안내` / `https://example.test/terms`. 질문2에는 참고자료를 추가하지 않고 보기 이미지만 둔다. 질문3은 참고자료·보기 이미지 모두 없는 상태를 유지한다.
3. `assert-authoring`: 정확한 3 logical question ID, FILE1+LINK2 혼합 순서·3개 상한, Q3 자산 부재, 실제 FILE/이미지 binding, physical question FK, scope, ready/clean, 저장된 ClamAV engine, sample SHA/size/MIME와 실제 복호화 bytes를 확인한다. 최초 baseline을 private fixture에 캡처한다. 다시 실행하면 같은 baseline과 비교한다.
4. UI에서 게시한다. `capture-publication`은 현재 실제 active publication token을 private fixture에만 저장한다. helper `publish`도 가능하지만 그 경우 HTTP 게시 증거이며 UI 게시 성공으로 기록하지 않는다.
5. Ego 공개 폼에서 **보기 A / 항목 A만 선택 / 단문 `작성자 자료 확인` / 동의 체크** 후 실제 제출한다.
6. `assert-submission`: 해당 기본 폼 응답이 정확히 1개/원본 version1이고 답변이 위 값과 일치하며 동의영수증 PDF의 실제 복호화 bytes SHA가 저장 hash와 같은지 확인한다. 원래 FormVersion 전체/질문/옵션 및 pin 집합 지문을 캡처한다. 기존 수집 응답의 수정 성공을 대신 주장하지 않는다.
7. Ego에서 개정 초안을 만들고 참고자료를 reference-b.pdf로 바꾸거나 기존 이미지 하나를 replacement-green.png로 교체하고 저장한다. `assert-history`는 새 version의 새 asset ID/교체 sample을 확인하고, 최초 게시본 전체 지문·pin 지문·원본 receipt hash가 같은지 확인한다. 버전2 게시 여부는 실제 row status로 별도 구분한다.
8. 필요 시 copy/template/approval/share 흐름을 실제 UI에서 수행하고 아래 보조 모드를 사용한다. 모든 다운로드·공유 회수 검증이 끝난 뒤 freeze한다.
9. `freeze`는 authored/submission/history baseline이 있어야 하며 현재 tenant의 폼·모든 버전·게시·템플릿·승인·Asset/Blob·pin·응답/정정/영수증·공유/인증 기록·감사를 해시한다. 실제 ready blob bytes도 SHA/size 검증해 지문에 포함한다. 이후 재시작 뒤 `verify`가 같은 지문과 실제 bytes를 검사한다. 세션/cookie/ApiRateLimit·다른 회사 자료는 지문 범위 밖이다.

## 모드별 의미

| 모드 | 실제 작업 | 증거의 한계 |
| --- | --- | --- |
| prepare | 독립 계정/tenant/서비스/초안, sample 생성 | 이메일 확인은 DB QA 설정 |
| state | DB read-only 상태·개수·safe IDs/hash 출력 | 성공 수용을 대신하지 않음 |
| login | QA 계정 HTTP 재로그인·private cookie 갱신 | freeze 후 금지 |
| capture-publication | DB read-only로 실제 현재 token을 private 보관 | public UI 열림 검증은 아님 |
| assert-authoring | 최초 UI 저장 graph+sample+실제 bytes 대조 | UI 픽셀·동작은 root Ego 증거와 합쳐 판단 |
| assert-submission | 실제 응답 exact values·원본 version·receipt SHA | 임의 응답이나 교정된 응답을 첫 제출로 인정하지 않음 |
| assert-history | 교체된 새 version + 과거 게시/pin/receipt 불변 | 새 버전 게시 여부는 row status에 따름 |
| assert-approval | 가장 최근 실제 approval snapshot의 독립 pin 집합, 후속 재조회 지문 | 승인 정책 활성화/승인 요청/판정은 root UI에서 먼저 수행 |
| upload-sample KEY | 실제 init→PUT→complete HTTP 및 ready/SHA 확인 | UI 파일 선택·모달의 증거가 아니며 부모에 자동 첨부하지 않음 |
| publish / revise | 실제 현재 version 기준 lifecycle HTTP | 실제 UI 클릭의 증거가 아님 |
| copy | 실제 HTTP 복사 후 source와 다른 Asset IDs/같은 blob·size·purpose, 새 question IDs/pin 확인 | 읽은 source와 target이 별도 결과이며 blob 재백신을 주장하지 않음 |
| template-create / template-use | 실제 저장 content 등록/사용; use에서 새 소유권 copy 대조 | 현재는 같은 서비스 경로. 다른 회사/system 경로는 서버시험 담당 |
| downloads | 현재 member·현재 public(캡처 token 있을 때)·구응답 manifest와 실제 다운로드 bytes/hash·보안 header 확인 | HTTP 감사가 추가되므로 freeze 전만 가능 |
| share-prepare | 원본 version 질문1만 공유·private 초대 code 보관 | 외부 열람 이메일 인증은 root Ego에서 수행 |
| share-revoke | 현재 share version 기준 HTTP 회수 + revokedAt 확인 | 옛 viewer URL 거절은 Ego에서 따로 관찰해야 함; 자동 통과로 기록하지 않음 |
| freeze / verify | DB read-only + ready blob 실제 read; local baseline 봉인/대조 | write worker/감사 추가가 있으면 정확히 불일치 처리 |

assert 계열은 제품 DB에 쓰지 않지만, 최초 baseline만 private fixture에 저장하고 결과 증거 파일을 만든다. frozen 상태에서는 baseline을 다시 쓰지 않는다. ready blob이 격리·삭제되면 검증이 실패하며 이를 통과로 완화하지 않는다.

모든 동작을 한 거대한 자동 시나리오로 만들지 않았다. UI 교체/승인/공유 인증·회수 후 옛 URL 확인, 다른 서비스/공용 템플릿, 파기/GC 경쟁은 root와 기존 통합시험의 개별 증거를 유지한다. 이 helper의 성공은 실제 실행한 해당 모드의 assertion만 뜻한다.
