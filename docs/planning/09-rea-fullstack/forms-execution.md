# R08 폼·질문·템플릿 실행 순서

2026-10-10. 기존 승인된 R08-T01~T04를 구체화한다. [원본 대조와 기준 검증](../../qa/R08-T01/README.md)에서 105개 기존 시험 통과와 실제 누락을 구분했다. 구현 진행 중이며 완료 선언이 아니다. 새 상품/공식 인증 성공을 임의로 가정하지 않는다.

## F1 현재 권한과 정책 — R08-T02 우선 결함 재현

- [x] 현재 Context를 얻은 뒤 Company 잠금에서 대기시키고 MFA/IP/비밀번호 정책 변경을 커밋한다. 대기한 폼/템플릿 CRUD가 새 정책으로 거절되는지 검사한다. 선택 회사 변경·세션 비활동 만료도 포함한다.
- [x] Form/Service/Template 잠금 및 감사 저장 지연 중 세션·MFA 예외·전문가·비밀번호 유예의 자연 만료를 재현한다. 성공 시점의 마지막 기한 검사를 서버 트랜잭션에 넣는다.
- [x] 기존 `lockServiceActor`의 회사→구성원→grant→사용자→정책→세션 순서를 대조해 폼 가드에 통합한다. 모든 서비스 잠금이 필요한지, 기존 폼/문서 잠금과 순서가 뒤집히는지 검토한다. 전역 가드를 무작정 치환하지 않는다.
- [x] create/update/copy/revise/publish/pause/resume/archive/purge/favorite/template create/update/delete/use와 캐시 재전송의 현재 권한을 확인한다. 감사 실패 롤백도 테스트한다.
- [x] 재현 실패→수정 후 통과를 보존하고 관련 폼·템플릿·문서·SSO·보안 회귀를 실행한다.

F1 완료 체크포인트: [기존 193개 회귀·HTTP29·Ego·재시작](../../qa/R08-T02/authority-flow/README.md)에 현재 회사/구성원/계정/이메일/세션/grant/서비스 상태와 템플릿 보관·복원, 게시·개정·템플릿 사용 캐시 재전송을 추가했다. 확장 전용 35개가 통과했고 10개 무효화 유형마다 28개 폼·템플릿·승인·고정 URL 동작을 거절했다. 전문가 소속은 DB 계약상 viewer만 허용하므로 쓰기 감사 조합을 만들지 않고 실제 허용 동작인 즐겨찾기 저장 중 배정 만료로 검사한다. [후속 구조화 증거](../../qa/R08-T02/authority-flow/verification-followup.json). R08-T02 전체는 F2~F7이 남아 진행 중이다.

## F2 질문·옵션의 안정적인 식별자 — R08-T01/T02

- [x] 질문 logical ID, 버전별 DB 질문 행 ID, 보기 logical ID, 버전별 보기 행 ID를 명시한다. 같은 폼 초안 저장·재정렬·보기명 변경에는 logical ID를 보존한다. 새 폼 복제·템플릿 사용은 새 ID와 내부 참조를 함께 배정한다.
- [x] options 문자열의 기존 공개 API/템플릿 JSON을 호환 파서로 읽고, 새 DTO의 ID/label/value/직접입력/이동 목적지 계약을 정의한다. ID 중복·다른 질문의 ID 사용·삭제된 보기 참조·순환/잘못된 이동을 서버에서 거절한다.
- [x] 기존 게시본과 암호화 응답은 그대로 유지한다. 필요한 추가 컬럼은 새 migration으로만 적용하고, 기존 자료의 백필 정책·빈 설치·업그레이드·제약/인덱스를 시험한다.
- [x] 제목만 저장/보기 재정렬/문구 변경/삭제/복제/명시적 revise의 ID·조건·기존 응답 불변을 DB로 검증한다. 문자열 라벨로 과거 응답을 다시 해석하지 않는다.

F2 완료 체크포인트: [ID·label/value·구 응답·재시작](../../qa/R08-T02/identities/README.md)에 F3의 기타 직접입력과 F4의 보기별 페이지 이동을 결합했다. 기존 문자열 보기 호환, 직접입력 `optionId`, 이동 목적지, 중복·재소유·삭제 참조·자기 이동·다른 버전·순환 차단을 현재 소스의 10파일 82개로 재검증했다. [후속 구조화 증거](../../qa/R08-T02/identities/verification-followup.json). 원본 option.value는 재정렬되는 위치값이며 UUID는 독립 구현 계약이다. R08-T01/T02 전체는 다른 F3~F7 범위가 남아 진행 중이다.

## F3 질문 유형·부가 필드 — R08-T01~T04

- [ ] 원본 ADDRESS/FOREIGN_ADDRESS/CONTACT/EMAIL/EMAIL_DIRECT/BIRTH/DRAW와 서명/인증 계열 각각의 값 구조·필수·길이·형식·빈 값·정정·CSV/PDF 표현을 정의한다.
- [x] 단문/장문의 원본 UI 제한을 새 설정에 반영하되 기존 게시본의 허용 길이를 뒤늦게 줄이지 않는다. 버전별 저장·공개 제출·정정·복제·템플릿·승인 지문과 재시작을 검증한다.
- [x] 패턴은 확인된 분류/허용 목록과 실행 상한을 사용하고 임의 입력 정규식으로 서버를 멈추게 하지 않는다.
- [x] 질문 설명·보기 이미지·참고 파일/링크·기타 직접입력·개인정보 분류를 저장/읽기/수정/제거·게시 스냅샷에 연결한다. 첨부는 기존 tenant/service·ClamAV·토큰·게시본 참조 규칙을 적용한다.
- [x] 선택 사항 행렬 EXACT의 전체 미응답/일부 행 응답/모든 행 정확 응답을 원본 렌더와 대조하고 서버·화면 검증을 맞춘다.
- [x] 외부 본인확인/서명은 제공사 준비 여부를 표시한다. 가상 성공을 공식 인증 완료로 저장하지 않는다.

F3 외부 인증·서명 준비 상태 체크포인트: 로컬 `sandbox` 인증과 외부 공급자 공식 인증을 설정·공개 화면에서 분리했다. 제출에서 영수증을 소비한 뒤에도 `sandboxVerified`가 유지되며, 완료 뒤에도 비공식 테스트 안내가 남는다. 집중3파일37개·관련7파일118개, 타입·변경 린트·production82페이지, 실제 브라우저 제출과 PostgreSQL의 `local/sandbox/signature` 소비 영수증 연결을 확인했다. 외부 공급자 자격증명·공식 sandbox·production은 `external_pending`이며 R08-T01~T04와 F3 전체는 진행 중이다. [검증](../../qa/R08-T02/verification-readiness/README.md).

F3 EXACT 체크포인트: [서버·화면·기존 계약 보존·재시작](../../qa/R08-T02/exact-selection/README.md). 새 명시적 EXACT 설정에 원본 전체행 규칙을 적용하고 기존 게시본의 mode 없는 min/max는 유지한다. 원본 단문100/장문1000은 입력 UI 제한으로 관측했으며 서버 강제 규칙은 미관측이다. 길이·특수 질문·부가 필드 구현을 이어간다.

F3 길이 체크포인트: [DB·89/38개·실제 HTTP12·Ego·재시작](../../qa/R08-T02/text-limits/README.md). 역할별 공백 정규화 호환도 검사했다. 특수유형/부가필드/패턴은 계속 구현한다.

F3 입력 패턴 체크포인트: [허용 목록·DB 제약·공개 제출/정정·Ego·재시작](../../qa/R08-T02/question-patterns/README.md). 원본에서 확인한 ID 1·2·3·4·7·8만 허용하고 호출자 정규식은 계약에서 거부한다. 주민등록번호는 고정 길이 문자 검사로 처리하며 이메일·주소·날짜는 전용 질문 계약에 맡긴다. 집중6·관련27·기존 frozen fixture20/20, 빈 스키마 migration140개, 기존 질문415개 중립 보존, production82페이지를 확인했다. 외부 본인확인/서명과 NLP 자동 분류·자동 동의서, R08 전수 수용은 잔여다.

F3 특수 유형 체크포인트: [국내 CONTACT·EMAIL/EMAIL_DIRECT·BIRTH의 모델/CRUD/실제 제출·정정](../../qa/R08-T02/special-questions/README.md). 고유125개·HTTP11·Ego·migration114·재시작 보존 통과. 국제전화·ADDRESS/FOREIGN_ADDRESS/DRAW·서명/인증·메타데이터와 이미지 검토는 남아 있어 첫 통합 항목은 미완료로 유지한다.

F3 응답 PDF 표현 체크포인트: [16종 현재 응답 PDF·파일 권한 마스킹·현재 권한 재검사·Ego Lite 다운로드](../../qa/R08-T02/special-question-acceptance/README.md). `GET /submissions/{id}/pdf`와 상세 화면을 추가하고, PostgreSQL 관련8파일84시험·계약329경로466작업·production82페이지·PDF.js·감사 이벤트를 확인했다. 외부 공급자 공식 인증·서명과 F3 첫 통합 항목의 남은 수용 범위가 있어 체크박스는 미완료로 유지한다.

F3 주소 체크포인트: [모델/암호화 저장·실제 검색/제출/정정/CSV·재시작](../../qa/R08-T02/address-questions/README.md). migration115와 원래8테이블/11fixture 불변, 고유85시험 통과. 이미지/PDF·모든 SDK 지연 조합 및 F3 나머지 유형은 잔여.

F3 직접 그리기 체크포인트: [PNG/권한/정정/CSV·터치·재시작](../../qa/R08-T02/drawing-questions/README.md). migration116·기존8테이블/12fixture 불변, 고유201시험 통과. 실제 적용 PNG·저장·다운로드 일치. 전체 화면 시각 일치·인증 서명·국제전화/언어·부가필드와 전체수용은 잔여.

F3/F5 국제 연락처·언어·PDF: 원본16언어·181국가/179코드·nullable 게시 언어/migration117 구현. 고유13파일192시험 후 PDF/번역 최종8파일126시험 통과(중복 합산 안 함). 원본 문구1952개 중 연결 범위 명시. Arabic 발행 실패를 v2 PDF로 수정하고 실제 Ego 발행/RTL/제출/암호화 저장 확인. 폼2/응답2/정정1/감사25·production 재시작 hash 일치, 기존13fixture 보존. PDF.js 복합 Arabic 추출·전체 시각/번역·인증 서명·메타데이터/여러 페이지·전체수용은 잔여. [검증](../../qa/R08-T02/international-contact/README.md).

F3 추가 설명 진행: [세부 구현 계획](../../qa/R08-T02/question-metadata/PLAN.md). 원본 textarea/3,000자/평문 공개 렌더를 확인했다. nullable 버전 필드, 구클라이언트 생략 보존과 명시적 제거, 복제/템플릿/승인/공개/정정 연결 및 기존 영수증 불변을 구현·검증한다. 개인정보 분류는 배열·탐지·동의 집계를 별도 설계한다. 아직 구현 수용 전이다.

추가 설명 후속 검증: F3 질문 추가 설명: nullable 평문/UTF-16 3000·migration118·생략 보존/명시 제거·복제/템플릿/승인/게시본 불변 구현. 고유10파일102시험, 실제 Ego 저장·제거·경계·조건·제출·개정·구 응답 정정·PDF 다운로드 통과. 폼1/버전2/응답1/정정1/감사17·재시작 hash 및 기존14fixture 보존. 시각/스크린리더·나머지 메타데이터/여러 페이지/전체수용은 잔여. [결과](../../qa/R08-T02/question-metadata/explanation/README.md).

참고 자료 LINK 상세 실행 계획: [사전 계획](../../qa/R08-T02/question-metadata/reference-link/PLAN.md), [원본 19개 발췌](../../qa/R08-T02/question-metadata/reference-link/source-review.json). 0 기반 materialList, 링크와 파일 합계3개 구조를 확인했고 먼저 LINK를 구현한다. FILE의 작성자 자산 경로는 후속으로 구분한다.

참고 링크 검증: F3 참고 자료 LINK: nullable JSON/migration119·원본5필드/순서/3개 상한·UTF-16 URL512/이름100·생략 보존/명시 삭제·복제/템플릿/승인 연결. 최종9파일81시험, 실제 Ego CRUD·취소·순서·새 탭·공개 제출/개정/구 응답 정정·원본PDF 다운로드 통과. 폼1/버전2/응답1/정정1/감사22·production 재시작 및 기존15fixture 보존. FILE/개인정보 분류/기타/다중페이지·시각/전체수용은 잔여. [결과](../../qa/R08-T02/question-metadata/reference-link/README.md).

## F4 여러 페이지와 이동 — R08-T01~T04

- [x] FormSection의 안정 페이지 ID/순서/제목/본문/기본 이동/뒤로 허용과 질문 배치를 FormVersion에 속한 모델과 편집 화면으로 구현했다. 기존 단일 페이지 폼 읽기·게시를 유지한다.
- [x] 기존 질문 표시 조건과 기본 페이지 이동을 별도로 저장하고 객관식/드롭다운 보기별 분기를 연결했다. 없는 페이지·자기 이동·도달 불가·순환, 페이지당 복수 분기 질문, 조건부/사용자입력 보기의 분기를 계약과 DB에서 거절한다. 질문이 있는 페이지 삭제는 막고 빈 페이지 삭제는 들어오는 참조를 다음 목적지로 다시 연결한다.
- [x] 서버가 제출·정정 시 방문 경로를 재계산하고 미방문 답변 주입·필수 질문 우회·참여대상 제외 제출을 막는다. 공개 화면은 뒤로 수정과 분기 변경 시 미방문 답변·파일·업로드 캐시를 정리한다.
- [x] 편집 자동저장·새로고침·2탭409 입력 보존, 저장 실패 재시도와 회사 전환 경고, production 재시작 뒤 두 페이지 보존을 실제 UI와 PostgreSQL로 확인했다. [검증](../../qa/R08-T02/page-save-company-switch/README.md).

F4 저장 실패·회사 전환 체크포인트: 공통 이탈 보호에 폼 초안의 저장 중·실패·충돌·검증 실패를 연결했다. 집중24개·관련97개·타입·변경 린트·production82페이지가 통과했고, Ego Lite에서 서버 중단→페이지2 수정→회사 전환 경고→편집 유지→서버 재시작·재시도→다른 회사 전환→복귀·재열기를 확인했다. PostgreSQL에서 폼 동시성 버전2·편집 버전1·페이지2개·초안 감사1·회사 선택 감사2를 대조했다. [검증](../../qa/R08-T02/page-save-company-switch/README.md). R08 전체는 F3/F5/F6/F7 잔여 때문에 진행 중이다.

## F5 참여·게시 설정 — R08과 R09/R11 경계

- [~] 시작/종료 시각과 기존 응답 상한·언어를 버전 계약에 연결했다. 시작 전 본문 비노출/425, 시작 후 제출, 종료 후410/마감 화면과 브라우저 현지 시각↔UTC 저장을 PostgreSQL·Ego Lite·재시작으로 확인했다. 이메일 OTP·전체/허용 대상·대상 CRUD·폼 범위 중복 참여 제한도 PostgreSQL·production 브라우저·재시작으로 확인했다. R08 전수 수용은 남아 있다. [일정 검증](../../qa/R08-T02/collection-window/README.md), [참여 인증 검증](../../qa/R08-T02/participation-access/README.md).
- [~] EMAIL_OTP는 로컬 암호화 outbox로 구현·검증했다. SOCIAL은 카카오/네이버 계약·설정 UI와 자격증명 미설정 시 게시 거부까지 구현했으며 실제 OAuth는 외부 앱 자격증명·승인 callback/domain을 기다린다.
- [ ] 게시/일시중지/재개/승인/고정URL은 R09의 버전·hash·token 계약과 함께 검사한다. 외부 성공 조건은 별도 external_pending으로 남긴다.

## F6 템플릿과 입력 보호 — R08-T03/T04

- [~] 설명·썸네일·라이선스 범위·공개범위의 허용 역할/회사 경계를 정의하고 DB/API 회귀를 통과했다. 공용 템플릿 변경은 회사 권한으로 허용하지 않으며 사용에는 유효 구독 또는 체험을 요구한다. 실제 외부 결제 라이선스 확인은 남아 있다.
- [~] 템플릿 생성/읽기/편집/사용/복제/보관/복원/삭제와 이전 폼의 독립성을 API·DB로 점검했다. Ego Lite에서 생성·편집·검색·미리보기·내부 체험 사용·보관·복원과 복제 뒤 원본 수정 불변을 확인했고, 격리 브라우저에서 admin/owner/editor/privacy/viewer/security/auditor/billing/sender와 A/B 회사 격리를 확인했다. 보관 중 편집·사용 차단과 production 서버 재시작 뒤 복원 상태 유지를 확인했다. 썸네일 자산 pin은 템플릿에만 귀속하고 생성된 폼 콘텐츠로 복사하지 않는다. 삭제 확정·대표 이미지 검증은 남아 있다.
- [~] 목록·미리보기 조회 오류 재시도, dirty 보호, 저장 동기 잠금, 409 후 입력 보존과 명시적 최신본 적용을 구현했다. Ego Lite 두 탭 409 입력 보존·최신본 적용 취소, production 서버 중단/재기동 뒤 목록 재시도, 390/768/1440px 페이지 폭, 목록 Tab 순서와 대화상자 포커스 트랩/Escape 복귀를 확인했다. 입력 폐기 확정은 남아 있다.

F6 현재 체크포인트: [템플릿 카탈로그 검증](../../qa/R08-T03/template-catalog/README.md), [보관·복원 검증](../../qa/R08-T03/template-archive/README.md). PostgreSQL 제약·API 권한/CRUD·썸네일 수명주기·복제 독립성과 Ego Lite 생성/사용/보관/복원/409/재시도·3개 화면 폭·키보드, 격리 브라우저 전체 로컬 역할·A/B 회사 격리를 확인했다. 삭제·입력 폐기 확정·대표 이미지와 실제 외부 결제 라이선스 검증 전이므로 R08-T03/T04는 진행 중으로 유지한다.

## F7 전체 수용

- [ ] 원본9개 편집/목록 경로별 정상·빈 목록·로딩·조회 실패·권한 거부·검증 실패·409·저장 실패·재시도·완료·새로고침을 대조한다.
- [ ] 질문3종 이상+제공자+동의서 초안, 전체 단계 재개, 회사A/B 문서 연결 거절, 게시 후 응답의 구 문구/질문/보기/PDF 불변을 확인한다.
- [ ] 390/768/1440px·키보드·뒤로/앞으로·회사 전환·별도 세션을 실제 Ego에서 검증한다.
- [ ] API/DB/감사/메일·객체 지문과 production 재시작 후 유지, 관련 회귀·타입·린트·빌드를 기록한다. 모든 조건을 충족한 작업만 완료로 바꾼다.


수동 개인정보 분류 실행 계획: [확정 계약/검증 순서](../../qa/R08-T02/question-metadata/personal-information/PLAN.md). 원본 38개 발췌를 검증했다. USER/null 엄격4필드·5분류·이름50 UTF-16·독립20개 상한·NONE/행렬/RESIDENT 필수, 구클라이언트 생략·원본 게시본을 보존한다. NLP/자동동의·기타 답변은 별도 후속이다. 아래 후속 검증 기록을 완료했다.

기타 직접입력 실행 계획: [wire·DB·조건·정정·공유·CSV·수용 순서](../../qa/R08-T02/custom-choice/PLAN.md). 일반 문자열/문자열 배열과 기존500자 이름 호환을 유지하고 기타 선택만 명시 객체로 저장한다. 원본15발췌/현재43파일 영향 근거를 대조했으며 아래 후속 검증을 마쳤다.

수동 분류 검증: F3 수동 개인정보 분류: nullable JSON/migration120·엄격4필드/5분류·UTF-16 이름50·독립20개 상한·행렬/RESIDENT 필수·생략 보존/제거·복제/템플릿/승인·공개 JSON 비노출 구현. 최종11파일103시험, 실제 Ego CRUD·취소·언어·공개 제출/개정/구 응답 정정·원본PDF 다운로드 통과. 폼1/버전2/응답1/정정1/감사21·production 재시작 및 기존16fixture 보존. NLP/자동동의/FILE/기타/다중페이지·시각/전체수용은 잔여. [결과](../../qa/R08-T02/question-metadata/personal-information/README.md).


F3 기타 직접입력: nullable isCustomValue/migration121·세 선택형/질문당1개/마지막 보기·100 UTF-16 strict 객체·현재 설정 보존/명시해제·기존 일반 답변/긴 이름 호환·조건/정정/공유/CSV 연결. 최종15파일182시험, 실제 Ego CRUD·자동저장 stale 확인 거절·공개 제출/개정/구 응답 정정·로컬메일 공유/회수·CSV/PDF 다운로드 통과. 폼1/게시2/응답1/정정1/감사36·production 재시작과 이전17fixture 지문 보존. FILE/보기 이미지/NLP/자동동의/다중페이지·시각/전체수용은 잔여. [결과](../../qa/R08-T02/custom-choice/README.md).


F3 FILE·보기 이미지: migration122/123·암호화 blob/소유 자산·참조 pin·백신/용량/권한·복사/템플릿/승인/공개/정정/열람 구현. 중복제거24파일314시험·실제HTTP경계12·Ego CRUD/3폭/키보드·ClamAV·다운로드·공유회수 확인. 폼3/응답1/정정1/승인2/감사171·실제blob5와 이전18세트의 production재시작 해시 보존. NLP/자동동의·본문/설명 이미지·다중페이지·전체수용은 잔여. 전체107개 완료0·진행53·계획54, goal active. [검증](../../qa/R08-T02/question-metadata/author-assets/README.md).

F3 문항 이미지: 원본61발췌·단일 questionImageKey·JPEG/PNG 1 MiB·migration124·현재/과거 버전 참조·복제/템플릿/승인/열람 구현. 관련23파일323시험·실제 HTTP 경계12·수명주기71요청·Ego 편집/공개/제출/교체/정정/3폭/선택 공유 확인. 폼3·자산11·참조14·실제blob3 및 이전19세트의 재시작 해시 보존. 실제 원영수증 다운로드42,202bytes도 해시 일치. 별도 본문 rich HTML 이미지 BI-01~07도 전체 수용을 완료했다. NLP/자동동의·R08 전수 수용은 잔여다. [문항 이미지](../../qa/R08-T02/question-metadata/content-images/README.md), [본문 이미지](../../qa/R08-T02/body-images/full-acceptance/README.md). 공식 완료0/진행53/계획54 유지.

F3 동의 항목 자동 집계: 원본에서 관찰한 수동 문항 분류→동의 항목 투영을 구현했다. `NON_PERSONAL_INFORMATION` 제외, 문항/항목 순서와 중복 보존, 버전별 `schema 1` 고정, 기존196버전 `schema 0 / NULL` 보존, DB 지연 트리거 불일치 거절을 확인했다. Ego 편집·공개·제출, 영수증 증거/PDF, production 재시작 뒤 동일 해시가 통과했다. [검증](../../qa/R08-T02/question-metadata/consent-items/README.md). 여기서 완료한 자동화는 수동 분류 결과의 항목 집계다. NLP/AI 분류와 법정 동의 문안 전체 생성, R08 전수 수용은 계속 남아 있다.

F3 질문 부가 필드 통합 완료: 질문 설명·문항/보기 이미지·참고 LINK/FILE·기타 직접입력·수동 개인정보 분류를 현재 소스의 PostgreSQL·통합 7파일132개와 계약·화면 렌더 5파일36개, 총12파일168개로 재검증했다. 기존 Ego Lite·DB·production 재시작 증거도 각 모듈에서 다시 연결했다. [통합 증거](../../qa/R08-T02/question-metadata/integrated-acceptance/README.md). 특수 질문 전체와 외부 본인확인/전자서명, NLP/AI 분류, F4~F7이 남아 F3 및 R08-T01~T04 전체는 진행 중이다.


BI 본문/페이지/완료/마감 상세 계획: [계획](../../qa/R08-T02/body-images/PLAN.md), [순수 문서 계약](../../qa/R08-T02/body-images/CONTRACT.md). 원본90개 발췌와 현재47파일 해시를 대조하고 BI-02a~07을 구현·검증했다.
BI-02a~07 체크포인트: typed 문서·strict HTML/React 표시·구형 평문 호환·nullable FormContent·migration125, 네 본문 이미지 용도의 14 MiB 전송·migration126, 24MiPixels/16,384px 자원 상한, FormSection/질문 배치·완료/마감 버전 설정·migration127/128, 전체 콘텐츠 소유 자산 pin·복제·템플릿·승인·게시 이력·GC fence·migration129, 보기별 분기와 제출/정정 방문 경로·migration130~137, 네 rich 표시 영역·권한·증거 v2/PDF·실제 4슬롯 전체 수용을 완료했다. 3폭·RTL·키보드·장애22·production82페이지·재시작 hash·기존 fixture20/20이 통과했다. [검증](../../qa/R08-T02/body-images/full-acceptance/README.md).
