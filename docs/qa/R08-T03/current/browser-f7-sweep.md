# R08 F7 통합 수용 — 9개 원본 경로 스윕 (round 2026-10-11)

scope: 프로덕션 빌드(`RZjskxz6I-AaUctKd5PCl`)·서비스 계정 QA owner A·테넌트 A(10000000-…-0001)·기본 서비스(20000000-…-0001). 이전 F-시리즈 라운드(본문/설명/참고자료/개인정보 수동분류/기타 직접입력/FILE·보기 이미지)의 단건별 검증은 각 하위 디렉터리와 `current/` 아티팩트에 누적되어 있고, 본 라운드는 신규 F3 기능과 전체 경로 통합 상태를 확인한다.

## 경로별 렌더 확인 (formId 보존·알림 없음)

| RR | 경로 | 결과 |
|----|------|------|
| RR051 | `/form/manage` | 목록 정상 — 공개 중/초안/승인 대기 상태 혼재, 검색·정렬·즐겨찾기·행 액션(미리보기/편집/템플릿 등록/복사/공유/일시중지/보관/완전삭제) 렌더. 라운드2 상세 상태는 R09 수용과 템플릿 삭제 라운드에서 이미 검증 |
| RR055 | `/form/template` | 회사 템플릿 탭 정상 — 삭제 확인→`template.deleted`는 이번 라운드 직전 라운드에서 DB·감사와 함께 검증 완료 |
| RR042 | `/form/ai/create?formId=` | 편집기 로드 — 서비스/제목/본문/페이지/완료·마감/본인인증 섹션 정상 |
| RR040 | `/form/ai/basic-frame?formId=` | 동일 편집기 스텝 정상 |
| RR041 | `/form/ai/basic-frame/v3?formId=` | v3 경로 동일 편집기 정상 |
| RR043 | `/form/ai/recipient?formId=` | "제3자 제공 동의 설정" 스텝 — 게시 문서 연결 섹션 정상 |
| RR039 | `/form/ai/agreement?formId=` | "개인정보 수집·이용 동의 설정" — 문항 수집 개인정보 + 게시 문서 연결 정상 |
| RR044 | `/form/ai/set?formId=` | "캐치폼 설정" — 참여 인증·사용 승인 섹션 정상 |
| RR045 | `/form/ai/setting?formId=` | 동일 설정 화면 정상 |

미인증 요청: `PATCH /forms/{id}/draft`, `POST …/question-personal-information/analyze`, `POST …/consent-display/{kind}/generate` 모두 **403**.

## 신규 F3 NLP 자동 분류 — 브라우저→DB

폼 `a1644c7d-8d4e-457c-9b60-9c39e9e9eacb`(초안) Q1 라벨을 "귀하의 이메일 주소를 입력해 주세요"로 입력 → 700ms 디바운스 후 자동 분석:

- 제안 카드: "문항 분석 결과 개인정보 추정 항목 2건을 찾았습니다. **로컬 분석 결과이며 공식 외부 분석이 아닙니다.**" + 제안 확인/제안 무시
- 제안 확인 → 분류 편집 패널에 2건 프리필 + "'이메일 직접 입력' 유형에 적합한 항목" 안내(타입 자동전환은 RESIDENT 전용, 이메일은 안내만)
- 분류 적용 → 임시저장 → PostgreSQL `Question.catchFormPersonalInformationRequests`:
  `[{nlpFeedbackId: uuid, PERSONAL_INFORMATION, NLP, "이메일"}, {…, "주소"}]` — NLP source/feedbackId 페어로 저장됨
- 제안 그대로 적용 → 피드백 감사 없음(정정 없음) — 설계 일치. 정정 시 `question-nlp` 피드백 경로는 서버 테스트로 검증됨

## 신규 F3 동의 문안 자동 생성 — 브라우저→DB→감사

`/set/service/consent` → 개인정보 수집·이용 동의서 탭:

- "문안 자동 생성" → 제안 카드: "처리 목적 0건 · 수집 항목 2건 · 수탁 1건을 반영한 제안 문구입니다. 검토 후 적용해주세요. 법적 검토가 필요한 문구일 수 있습니다." + 4개 섹션 제안문(시작/수탁사/처리방침 안내/거부권 필수·선택)
- "제안 문구 적용" → 5개 textarea 채워짐(제안은 화면 상태만 변경, 미저장)
- "수정사항 적용"(기존 PATCH 경로) → 저장
- 감사: `service.consent_display_generated`(12:27:40) → `service.consent_display_updated`(12:27:59) — 생성과 저장이 별도 이벤트로 분리 기록
- DB: `ServiceConsentDisplay.kind=collection, version=1`, startText "기본 서비스은(는) 아래와 같이 개인정보를 수집·이용합니다."

## 재시작 지문

`scripts/qa-r08-acceptance.ts` — 테넌트 A의 forms 33/versions 36/questions 59(분류 NLP 2건 반영)/templates 2/displays 1/감사 128 스냅샷 → SHA-256. 재시작 전후 동일: `5192c9b7…184cb005` (`acceptance-database-before.json`, `acceptance-database-restart.json`).

## 외부 제공사 상태

- NLP: 로컬 결정적 어댑터(engine `local-deterministic-v1`). 외부 NLP 제공사 연결 증거 없음 → `external_pending`
- 문안 생성: 로컬 결정적 생성기 — 외부 항목 없음
- 템플릿/편집기 나머지 외부 항목(결제 라이선스 등)은 도메인 표준 `external_pending` 유지
