# 문항 이미지·본문 이미지 실행 계획

상태: QI-01~04를 검증했다. 별도 본문 rich HTML 이미지 BI-01~07도 [전체 수용 기록](../../body-images/full-acceptance/README.md)까지 완료했으며 R08-T02 전체는 계속 진행 중이다.

## 근거와 범위

- 원본 번들 `main.183e9d2c.js`, SHA-256 `3538d47856c6ba1b4207059dc09434066c7ca692a5907ed792dd9e27c7dba78f`, REA `ev_87493e79c4f053718022b23e1e5d42acf1af245f8c7838a89cd7ebc3918df152`를 재사용한다. 발췌 위치·해시는 `source-review.json`, 설명은 `source-review.md`에 기록한다.
- 문항 이미지는 추가 설명 문자열과 별개인 단일 `questionImageKey`다. 원본 쓰기에는 URL·크기 필드를 보내지 않는다. JPG/JPEG/PNG, 1 MiB, 일반 질문 유형 전환에서 유지한다. IDV에서는 지원하지 않는다. 현재 로컬 질문 enum에는 IDV가 없으므로 향후 본인인증 유형 도입 시 제거 확인·정리 계약을 연결한다.
- 화면 순서는 질문 제목 → 문항 이미지 → 참고 자료 → 추가 설명 → 답변이다. 이미지 가운데 정렬, 최대 너비 min(696px,100%), 원본 비율, 모서리 8px. 원본 문항 이미지 렌더에는 클릭 확대가 없다.
- 본문은 rich HTML `mainText`/`pageContent` 안의 이미지이며 FORM_CONTENT_IMAGE/PAGE_CONTENT_IMAGE는 별도 업로드 흐름이다. 14 MiB 한도와 HTML/PDF/페이지 저장 구조를 확인한 후 별도 단계에서 구현한다. 문항 이미지 완료로 본문 이미지까지 완료 처리하지 않는다.
- 원본 서버의 역사 보존·권한·검사 구현은 확인되지 않았다. 아래 암호화 저장·검사·소유권·버전 참조는 이미 검증한 로컬 보안/보존 설계를 확장하는 구현 결정이다.

## QI-01 계약·호환성

- [x] `QuestionDefinition.questionImageKey?: UUID | null` 추가. 누락은 같은 현재 질문의 기존 값을 유지, null은 삭제. 저장 DTO는 없는 값 생략. 이전 버전에서 삭제 값을 복원하지 않는다.
- [x] URL, 임의 경로, 배열, 이미지 메타데이터 필드는 거부한다. 원본의 단일 필드 구조를 따른다.
- [x] `QUESTION_IMAGE` 자산 용도, 1 MiB 및 JPEG/PNG 확장자/MIME 검사 추가. 문항/보기 이미지 용도는 서로 바꿔 쓸 수 없다.
- [x] 일반 질문 16종·형식 전환·조건·선택 보기 유무와 독립적으로 유지. 구조 복제는 임시로 키를 보존하며 서버 복제에서 새 소유 키로 변환한다.
- [x] 기존 폼/템플릿 생성·수정 정규화와 공개 API 스키마를 연결한다. 구형 이미지 없는 JSON 직렬화·해시 불변을 시험한다.

## QI-02 DB·백엔드

- [x] 적용된 migration 1~123을 수정하지 않고 신규 additive migration을 추가한다. `Question.questionImageKey` nullable FK/index, AuthorAsset purpose/check, reference slot `question`을 확장한다.
- [x] SQL projection, JSON→reference 계산, parent validation, asset-purpose validation, GC fence, 기존 물리 질문 참조를 모두 확장한다. slot별 위치 유일성 및 물리 질문 FK를 유지한다.
- [x] Form DTO/질문 생성·갱신, template 정규화, authorAssetSlots, copy remap, 시스템 템플릿 import를 연결한다. 불필요한 Question UPDATE를 만들지 않는다.
- [x] upload reservation→PUT→실제 이미지 decode/검사→complete→save→pin 흐름을 재사용한다. 기존 quota와 stale version·오류·취소·청소·감사 이벤트를 유지한다.
- [x] form/current publication/approval/submission/correction/template/viewer 각각의 기존 권한 및 고정 버전으로 읽는다. viewer 선택되지 않은 질문 이미지와 만료·폐기된 공유는 접근 불가여야 한다.
- [x] 직접 SQL 우회, 잘못된 purpose, 타 서비스·회사 소유, 미검사 자산, 누락 pin, pinned 삭제, 변경/GC 경쟁, 오래된 입력을 실제 DB 시험으로 확인한다.
- [x] migration 전후 기존 데이터 해시, 깨끗한 스키마 설치, dev/test schema drift 확인. 모든 DB·마이그레이션·시험은 root가 직렬 실행한다.

## QI-03 편집·조회 화면

- [x] `QuestionImageEditor` 추가/교체/삭제·확인 취소. 실패한 교체는 기존 키 유지, 업로드/확인 도중 질문·서비스·저장 상태 변경은 stale 결과를 연결하지 않는다.
- [x] 기존 업로드 session과 autosave barrier를 재사용한다. draft 업로드 추적, 삭제/화면 이탈 cleanup, 서비스 변경 차단에 questionImageKey를 포함한다.
- [x] `QuestionImage` 공통 컴포넌트: 권한이 있는 현재 scope URL만 사용, 공유 이미지 최적화 캐시 사용 금지, URL/스토리지 경로를 JSON에 저장하지 않는다. 로딩·읽기 실패는 깨진 이미지 대신 적절한 안내를 표시한다.
- [x] 편집·public·미리보기/승인/템플릿 요약·과거 응답·정정·공유 viewer에 동일한 원본 배치와 크기를 적용한다. 문항 이미지 자체는 답변 선택/제출을 유발하지 않는다.
- [x] 390/768/1440px에서 자연 비율·가운데 정렬·가로 overflow·질문 순서 확인. 키보드로 업로드/삭제 확인 취소, 조회 페이지에 불필요한 이미지 조작 버튼이 없는지 점검한다.
- [x] 기존 FormEditor 유형 변경 문구의 조사 오류도 해당 파일 수정 시 정리한다.

## QI-04 실제 실행 검증·완료 기록

- [x] 새 격리 QA 회사/서비스/폼/이미지 생성. 이전 frozen 19세트는 HTTP/UI로 열지 않는다.
- [x] 실제 정상 PNG/JPEG와 초과·형식 위조·오염/손상 입력, hash 일치, 잘못된 용도·권한·stale 요청을 검증한다.
- [x] Ego에서 실제 업로드→저장→새로고침→공개→제출→교체→재공개→과거 응답/정정 읽기. 승인 대기 중 변경과 이전 승인 snapshot도 확인한다.
- [x] 같은 서비스의 템플릿 등록은 기존 자산 키에 독립 pin을 만들고, 폼 복제·템플릿 사용은 새 owner ID와 같은 blob bytes를 갖는지 확인한다. 등록 템플릿의 수정·삭제 이후에도 사용해 만든 폼과 원래 게시본을 보존한다.
- [x] viewer 선택 질문만 표시/다운로드 가능, 미선택 질문 404, revoke 후 401. 실제 이미지 bytes와 DB 참조를 비교한다.
- [x] 관련 계약·DB·HTTP·UI 시험, lint, typecheck, production build, 서버 재시작, 새 fixture/기존 19세트/영수증 bytes 보존을 확인한다.
- [x] 실제 통과한 범위만 quality checkpoint·TASKS·progress에 반영한다. 과거 시험을 현재 전체 회귀 통과로 표현하지 않는다. fixture freeze 후에는 감사 이벤트를 만드는 읽기도 하지 않는다.

## BI 후속 상세 작업 — 문항 이미지와 별도이며 완료됨

1. BI-01: 원본 rich editor 도구·정렬·크기·본문/페이지/완료/마감 네 위치의 HTML wire·삭제/복제 URL 치환·저장 실패 흐름 추적. 확인되지 않은 원본 동작은 별도 표시한다.
2. BI-02: 기존 plain `body`와 영수증 해시를 보존하는 versioned rich-content 계약 설계. 임의 원격 img URL을 가져오지 않고 owned asset ID→인가된 URL로 렌더한다. HTML sanitizer allowlist와 paste/직접 입력 round trip을 정의한다.
3. BI-03: 14 MiB image 용도별 limit, Blob/Asset DB 5 MiB 제한 및 readFileBody/scanFile 및 암호화 저장·복호화 읽기 10 MiB 제한을 해당 흐름에 한해 확장. 압축/해상도/메모리·동시 decode 상한을 별도 설정한다.
4. BI-04: questionKey 없는 root/page/end/private slot 모델, parent 유일성/FK·SQL projection·전체 FormContent 단위 lock/write/pin 동기화, 복제·템플릿 URL/ID remap을 설계하고 migration한다.
5. BI-05: rich editor와 각 표시 화면 구현, body/page/완료/마감별 상태전이 연결. 페이지 미구현 부분은 F4 계획과 연결하며 한 장의 보조 필드로 축소하지 않는다.
6. BI-06: ConsentEvidence.formBody·PDF 렌더를 versioned 방식으로 확장. 신규 영수증 이미지 포함 정책과 불변 bytes/snapshot을 시험하고 과거 영수증은 재생성하지 않는다.
7. BI-07: QI와 같은 실제 DB·HTTP·Ego·복제/삭제·역사/권한·재시작 검증을 각 슬롯별 수행하고 별도 checkpoint를 만든다. 결과는 [BI-07 전체 수용](../../body-images/full-acceptance/README.md)에 기록했다.

## 작업 소유권

- root: 계약·계약 시험·계획·통합·실행 검증·최종 기록.
- prior_evidence: 계획 검토 후 서버/Prisma/신규 migration 구현 및 독립 DB/API 시험 작성. 실행은 root.
- bundle_analysis: 원본 근거 확정 후 문항 이미지 UI/클라이언트 helper·렌더/이벤트 시험 작성. 실행은 root.
- 모든 담당자는 공유 작업 트리의 다른 변경을 되돌리지 않으며, 적용 migration/기존 frozen fixture/과거 checkpoint를 수정하지 않는다.

## 수용 범위 보충

323개는 이번 관련 회귀 실행이며 전체 앱 회귀가 아니다. 감염 입력은 공통 자산 경로의 실제 ClamAV/EICAR DOCX 시험, 문항 이미지 전용에서는 정상 PNG/JPEG 실제 검사와 손상/위조/hash/용도 경계를 확인했다. 템플릿·승인·공유 변경은 실제 API, 편집/게시/제출/정정은 실제 Ego 조작이다. viewer는 로컬 OTP API 인증 세션을 Ego로 연결해 표시·회수를 확인했으며 UI 인증 및 외부 메일 송신 수용으로 세지 않는다. [최종 실행](execution.json), [재시작](restart.json).
