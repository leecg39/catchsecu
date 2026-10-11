# F3 NLP 자동 분류(로컬 결정형) 검증

2026-10-11. 한국어 문항 제목 변경에 따른 자동 개인정보 분류 제안·확인·피드백을 로컬 결정형 엔진으로 구현하고 검증했다. 원본의 사내 NLP 서비스(`company-operated-service/nlp`, U02)는 관측 불가로 **외부 제공사 증거 없음 — `external_pending`을 유지**한다. 이 구현은 원본 엔진과 동등하다고 주장하지 않는 로컬 근사다.

## 계약 변경

- `question-personal-information.ts`: 항목 스키마를 `nlpFeedbackId: uuid|null` + `personalInformationSource: USER|NLP`로 확장하고 쌍 일관성을 강제한다(USER→null, NLP→uuid). 기존 USER 전용 계약과 저장값은 그대로 유효하다.
- `question-nlp.ts`(신규): `nlpAnalyzeInput/Result`, `nlpAnalyzedItemSchema`(NLP 전용), `nlpFeedbackInput`(proposed=NLP만), `NLP_ENGINE_ID="local-deterministic-v1"`.
- 마이그레이션 `20261025032000_question_personal_information_nlp_source`: `valid_question_personal_information`을 `CREATE OR REPLACE`로 갱신해 DB 체크도 동일한 source·feedbackId 쌍을 강제한다. dev/test DB 모두 적용.

## API (OpenAPI 335경로/476op, 정책행 476)

- `POST /services/{id}/question-personal-information/analyze` — `form.write`+현재 서비스 grant, 보관 서비스 409. `ko`+비행렬형만 제안을 돌려주고 `en` 등은 `{items:[],suggestedType:null}`. 감사·저장 없는 읽기형 제안.
- `POST /services/{id}/question-personal-information/feedback` — 수정 분류 피드백. `form.question_pi_feedback` 감사 이벤트에 count·유형 enum만 기록하고 항목명·문항 원문은 저장하지 않는다(테스트가 원문 비포함을 검증).

## 분류기(`src/server/question-nlp.ts`)

주민번호·여권·면허·건강/생체/위치/정치·결제(민감)와 이메일·휴대폰·성명·생년월일·주소·소속·계정(일반) 사전 규칙을 라벨+보기 라벨에 적용한다. 이름 dedup, 라벨 내 위치 순 정렬, 20개 상한, 행렬형은 빈 제안. `suggest`는 연락처→연락처, 이메일→이메일 직접 입력, 주민번호→단문형 답변 등 전용 문항 형식 힌트.

## 편집기(`QuestionPersonalInformationEditor`)

- `formLanguage`가 `ko`로 시작하고 분류가 없는 비행렬형 문항은 라벨 편집 700ms 후 자동 분석한다. 결과는 transient proposal로만 보이고 **확인 전 저장되지 않는다**(원본 isConfirm 동작).
- 제안 카드: 항목 수 + "로컬 분석 결과" 안내 + 제안 확인/무시. 제안 확인은 수동 분류와 같은 모달을 열어 수정 후 적용한다.
- 첫 항목이 NLP RESIDENT이면 적용 시 문항을 `단문형 답변`으로 전환하고 options·optionDefinitions·rows·selectionLimits·condition·infoPatternId·subjectRole(비허용)을 지운다. 다른 문항이 이 문항을 조건 참조하면 `conditionLinked`로 자동 전환을 건너뛴다(수동 전환은 기존 경로가 차단).
- 제안을 수정해 적용하면 proposed/corrected를 피드백 API로 보낸다. 피드백 실패 시 분류 적용은 유지하고 오류만 알린다.
- `FormPagesEditor` 페이지 복제는 NLP 분류를 제거해(재분석 트리거) USER 분류만 보존한다. 라벨 변경 시 재분석, 비한국어는 자동 분석 생략.
- `FormEditor`는 `formLanguage`·`conditionLinked`를 전달하고 세 번째 `patch` 인자로 형식 전환을 병합한다.

## 검증

- `tests/server/question-nlp.test.ts` 6개 + `form-page-state.test.ts` 6개(신규 복제 시험 포함) + 기존 `question-personal-information.test.ts` 21개 + render 2개 = [35개 전부 통과](tests.json).
- `npm run typecheck`, eslint, `ALLOW_LOCAL_*` 프로덕션 빌드 통과.
- `verify:plan`(통과), `verify:plan-integration`(통과: op 476=policy 476).
- 브라우저 종단 검증(제안 카드 표시·적용·RESIDENT 전환·피드백·복제 재분석)은 F7 전수 수용 범위에 남겨 둔다.

## 미검증/경계

- 외부 NLP 제공자 연결 증거 없음 → 원본 NLP 엔진 정확도·모델·응답 스키마 동등성은 미검증(`external_pending`).
- 템플릿 사용·전체 폼 복제는 분류를 그대로 보존한다(원본 정책 미관측, 독립 계약).
