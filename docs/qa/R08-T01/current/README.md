# R08 현재 폼 모델·필드 대조

2026-10-11 재점검. 최초7모델72열 보고서는 당시 이력이다. 현재는 페이지·작성자 자산·참여 대상까지13모델184열·118제약·55인덱스·45트리거를 검사한다. dev/test 정의와 소스 지문을 비교하며 실제 상태 전이는 별도 PostgreSQL 회귀로 검증한다.

## 원본 관측과 현재 저장 계약

기준은 [원본14개 발췌](../source-audit/excerpts.json)와 각 기능별 추가 발췌다. 원본 클라이언트 관측은 원본 서버의 DB/검증 규칙을 증명하지 않는다. 최초 누락 목록을 아래처럼 갱신한다.

| 항목 | 현재 모델·계약 | 차이와 남은 범위 |
|---|---|---|
| 폼·버전 | Form의회사/서비스/owner·동시성 version, FormVersion의초안/게시 상태·버전번호 | 게시본은 불변. 개정은 새 버전이며 원본 서버 내부 구조를 복원한 것은 아님 |
| 질문16유형 | Question.type과전용 답변 DTO. 연락처/이메일/생년월일/주소/해외주소/그리기 포함 | 외부 본인확인·서명은 질문 문자열을 인증 성공으로 처리하지 않고 별도 VerificationAttempt/R11 경계 |
| 질문·보기 식별 | Question.stableKey, QuestionOption.stableKey/label/value, optionSchemaVersion | 원본 option.value는 위치값. 독립 구현 UUID는 저장/재정렬/개정 보존, 복제/템플릿 사용 시 새 ID와 참조 재배정 |
| 텍스트·패턴 | Question.textMaxLength/infoPatternId, 고정 허용 패턴 DTO | 새 UI100/1000, 구버전 제한 보존. 외부 임의 정규식 실행 없음 |
| 설명·참고자료 | additionalExplanation, materialList의 LINK/FILE 구조 | 원본3,000자·자료합계3개·명시 제거와 생략 보존. 파일 원문/소유/검사는 AuthorAsset 계층 |
| 문항·보기 이미지 | questionImageKey/optionImageKey와 AuthorAssetReference | 회사/서비스·소유자·용도·게시/승인 참조와 실제 blob 수명주기를 별도 보존 |
| 개인정보 분류 | catchFormPersonalInformationRequests와 consentItems·schema version | 수동 분류와 동의 항목 투영 구현. NLP/AI 분류·법정 문안 전체 생성은 별도 미완료이며 자동 구현으로 집계하지 않음 |
| 행렬 선택 수 | matrixRows/selectionLimits, EXACT mode | 명시 EXACT는 일부 응답 시 전체행 정확한 개수. 구 mode 없는 min/max는 호환 유지 |
| 여러 페이지 | FormSection.pageKey/order/body/bodyRich/default destination/allowBack, Question.sectionId | 기본 이동·보기별 이동·질문 조건은 별도. 참조/자기 이동/순환/도달 불가를 계약·DB에서 거절 |
| 본문·완료·마감 | FormVersion의rich JSON과평문·schema version, FormSection 본문 | typed 문서만 렌더. 구 평문·단일 페이지 계약 유지 |
| 기간·언어·응답 상한 | collectionOpenAt/CloseAt/schema, formLanguage,maxResponses | 서버 UTC 저장. 시작 전/마감/응답 상한 상태는 게시·응답 처리에서 집행 |
| 참여 인증·대상 | participation 설정7필드, FormAccessTargetBatch/Target의hash/암호문 | EMAIL OTP/허용대상/중복 제한은 로컬 검증. KAKAO/NAVER 실제OAuth는 자격증명 대기·준비 안 되면 게시 거부 |
| 템플릿 | 제목/분류/설명/thumbnailAssetId/licenseScope/content/status/version | 회사/서비스/공용 범위·보관/복원/삭제 분리. 외부 결제 수신은 R21/R25 검증 경계 |
| 연결 동의문서 | FormDocumentBinding의회사/서비스/문서/버전 복합 FK·displaySnapshot | 다른 회사/서비스 문서 연결 거부, 승인/게시 스냅샷 불변 |

## 관계·상태·보존

- 초안 변경은 현재 회사/서비스/구성원/세션·보안정책을 잠금과 최종 기한 검사에서 다시 확인한다. 수정 version 충돌은409이며 감사와 변경을 함께 커밋한다.
- 저장/재정렬은 logical ID를 유지한다. 복제는 질문·보기·페이지 ID를 새로 만들고 조건·분기 목적지도 함께 변환한다. 기존 응답은 당시 게시 버전에 연결한다.
- 게시 버전·질문·보기·페이지와 문서 binding의 직접 변조는 DB 트리거로 거부한다. 상태 전이와 파일 소유/참조는 서버 검사와 DB 제약을 함께 사용한다.
- 폼의 보관과 물리 파기를 구분한다. 파기 가능 여부는 참조·응답·게시 이력을 검사하며 작성자 자산 참조 해제와 파기 유예를 연결한다. 템플릿 삭제는 생성된 폼을 삭제하지 않고 해당 템플릿의 자산 참조만 해제한다.
- 즐겨찾기는 회사/구성원/폼 복합 식별이며 읽기 권한을 현재 검사한다. 참여 대상의 이메일은 원문을 암호화하고 비교용 hash를 별도 저장한다.

`catchsecu_dev.json`·`catchsecu_test.json`은13모델 전체 컬럼/제약/인덱스/트리거 함수와 소스 지문을 포함한다. 검사 명령은 Node24의 `--env-file=.env.local` 또는 `.env.test.local --import tsx scripts/qa-r08-model.ts`다. 회귀/타입/린트 결과는 후속 검증 보고서에 기록한다. 이 문서만으로 전체 화면 수용·공식 외부 인증 성공을 주장하지 않는다.

현재 PostgreSQL 회귀는 [26파일348시험](regression.json)이 모두 통과했다. 모델 메타데이터는 [요약](model-summary.json)에서 dev/test 전체 정의 일치를 확인한다. 질문 식별·텍스트/특수 유형/자료/분류·행렬·페이지·본문·기간·참여 대상·첨부와 폼/템플릿 권한·경합·감사 원자성을 포함한다.
