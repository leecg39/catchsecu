# F3 수동 개인정보 분류 — 실행 계획

2026-10-10. 참고 링크 검증을 보존한 뒤 시작한다. 원본 정적 조사 [38개 발췌](../remaining-source-review/source-review.json)와 [무결성 검사](../remaining-source-review/source-integrity.json), [남은 범위 초안](../remaining-source-review/PLAN-draft.md)을 근거로 한다. 본 단위는 분류의 저장·편집·관리 요약이며 NLP·자동 동의문·모든 경로의 수집 판단은 후속이다.

## 확정 계약과 원본 차이

- `Question.catchFormPersonalInformationRequests` nullable JSON 배열을 migration120으로 추가한다. 원본과 같은 항목 필드 4개: `nlpFeedbackId:null`, `personalInformationType`, `detectedPersonalInformation`, `personalInformationSource:"USER"`. NLP 성공/feedback ID는 만들지 않으며 API도 NLP/임의 ID를 거절한다.
- 분류 enum은 PERSONAL_INFORMATION/SENSITIVE/IDENTIFICATION/RESIDENT/NON_PERSONAL_INFORMATION 5개다. 이름은 원문 공백을 보존하되 NONE 외에는 trim-empty를 거절하고 최대 50 UTF-16 단위, NUL/잘못된 Unicode를 거절한다. NONE은 정확한 빈 문자열이다. 서버 길이 강제는 원본 프런트 상한에 대응하는 독립 보강이다.
- 배열 상한은 원본 미관측이므로 문항당 20개를 독립 계약으로 정한다. 빈 배열은 제거다. 원본 UI가 만들 수 있는 중복·NONE 혼합을 묵시적으로 제거하거나 임의로 금지하지 않는다. 저장 순서도 보존한다.
- 같은 현재 logical ID의 필드 생략은 기존 분류 보존, `[]`는 제거한다. 기존 null DTO에는 키를 추가하지 않으며 이전 승인/게시본/응답/영수증/PDF 지문을 바꾸지 않는다.
- 행렬형 2종은 NONE만 허용한다. RESIDENT가 있으면 required=true가 필수이며 API/DB에서 false를 거절한다. 구클라이언트가 분류를 생략한 채 required=false/행렬로 바꾸는 요청도 보존값을 병합한 후 검사한다. UI 적용은 true를 함께 보낸다. RESIDENT 삭제/다른 분류 변경 후에도 필수를 자동 해제하지 않는다. 질문 유형을 자동 변환하지 않는다.
- 수동 메타데이터는 제목 수정·개정·현재 전체 폼 복제·템플릿 저장/사용에서 보존한다. 원본의 한국어 NLP 재분석 및 질문/페이지 복제 시 reset과 구분한다. 현재 전체 폼 복제의 원본 서버 정책은 미관측이다. 향후 질문 단위 복제/NLP 흐름을 도입할 때 재확인 정책을 별도 설계한다. 제목 수정이 자동 분류 재확인 완료를 뜻하지 않는다.
- 16언어 전환에서도 같은 배열을 보존한다. 관리자 편집은 언어 공통 복수 수동 편집으로 제공한다. 원본 비한국어 첫 항목 중심 UI를 그대로 적용해 기존 복수 항목이 사라지게 하지 않는다. 공개 화면에 분류 목록을 표시하지 않으며 일반 토큰/고정URL 공개 JSON에서도 신규 관리자 분류 필드를 제외한다. publicForm의 공통 응답 projection만 좁히고 관리 DTO·저장본·서버 제출 검증은 그대로 둔다. 원본 공개 서버의 노출 정책은 미관측이며 이는 독립 최소노출 계약이다. subjectRole과 동의 내용/PDF/영수증을 이 메타데이터로 자동 변경하지 않는다.

## 작업과 검증 순서

1. **RED 계약 시험**: 기존 코드에서 누락을 재현한다. 5분류·strict4키·50/51 UTF-16·이모지·NUL/잘못된 Unicode·NONE 이름·20/21개·NLP/feedback위조·행렬·RESIDENT 필수를 검사한다. DB 시험은 root만 직렬 실행한다.
2. **DB/서버**: nullable JSON과 구조/이름/행렬/RESIDENT CHECK, 기존 게시 불변 트리거를 적용한다. DTO와 writeQuestions/normalize를 생성·수정·implicit draft·revise·copy·템플릿·승인에 연결한다. 기존 질문/보기 ID 유지, version409·권한/정책·감사 롤백을 검사한다.
3. **UI**: 질문별 ‘개인정보 분류’ 목록과 편집 모달을 추가한다. 임시 목록 추가/종류/이름/삭제/확인, dirty 취소·Escape 확인, 전체 제거 확인을 제공한다. 적용할 때만 한 번에 상위 초안에 반영한다. 20개 상한, 이름50, NONE의 이름 숨김/제거, 행렬 종류 제한, RESIDENT 필수 잠금과 이유를 표시한다. NONE 외 분류가 있는 기존 문항에서 행렬로 유형 변경은 option 비활성화와 handler 검사로 거절하고 먼저 분류를 수정하도록 안내한다. 묵시적으로 분류를 삭제하지 않는다. 편집 중 원래 질문/분류/유형/필수 상태가 바뀌면 오래된 모달 적용을 거절하고 저장 중 조작을 막는다.
4. **표면 연결**: 관리 요약·미리보기/승인·응답 상세(관리자)에 같은 평문 요약 컴포넌트를 사용한다. 기존 응답은 원래 게시 버전의 분류를 표시한다. 분류명과 이름은 HTML로 해석하지 않는다. 변경 내용은 자동 분석 결과로 표시하지 않는다.
5. **이관 확인**: 기존 8테이블 공통 컬럼 지문·새 컬럼 null, dev/test/빈 스키마120·drift0, 기존16개 고정 fixture를 확인한다. 해시 호환은 새 null 컬럼만 검증 후 제외하고 과거 baseline을 덮어쓰지 않는다.
6. **실제 수용**: 별도 QA 회사 Ego에서 추가/수정/취소/삭제/전체 제거/새로고침, 이름50 키보드 상한·주민번호 필수 잠금·행렬 제한·언어 변경 복수 유지, 게시→제출→분류 개정→구 응답 정정→PDF 원본 바이트를 확인한다. 원문 XSS·390/768/1440px·키보드·production 재시작·DB/API/감사 지문도 기록한다. 캡처 미지원 시 전체 시각 통과를 주장하지 않는다.
7. **마감 기록**: 관련 회귀·타입·린트·빌드·OpenAPI·계획 링크·소스 지문, 실제 범위·원본 차이·미검증을 기록한다. R08과 전체107개 목표는 전수 수용 전까지 진행 중이다.
