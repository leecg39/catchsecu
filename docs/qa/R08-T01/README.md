# 폼·질문·템플릿 모델과 원본 필드 대조

2026-10-10. R08-T01은 진행 중이다. 스키마가 일치하고 기존 시험이 통과해도 원본 필드 누락과 새 수용 조건이 해결된 것은 아니다.

## 확인한 범위

개발/시험 DB 각각 Form·FormVersion·Question·QuestionOption·FormTemplate·FormFavorite·FormDocumentBinding 7개 모델, 72컬럼·31제약·23인덱스·8트리거를 읽었다. 두 메타데이터 해시는 `153f6d1fae281fdff11d2a7730362b15c6ae25bec0393dadd8a67b07857e291b`로 같다. tenant 결합 FK·초안/질문 고유 제약·게시 질문/보기 보호 트리거에 명시적 단언을 사용했다. 전체 기능 수용을 대신하지 않는다.

- [개발 DB](model-audit/catchsecu_dev.json), [시험 DB](model-audit/catchsecu_test.json)
- [타입 검사](model-audit/typecheck.log), [새 helper 린트](model-audit/lint.log): exit0
- [폼 CRUD·초안·문서·경합 86개](../R08-T02/core/baseline.json), [질문·템플릿 접근 19개](../R08-T02/core/question-template-baseline.json): 총10파일105개 통과, 실패·보류0. 모두 격리 시험 DB에서 실행했다.
- 메타데이터 검사 첫 실행은 PostgreSQL이 불필요한 `id` 따옴표를 생략하는 표시 차이로 실패했다. 비교 시 식별자 따옴표를 정규화한 뒤 통과했으며 DB 결함이나 스키마 수정은 없었다.

게시본/문서 binding 불변 트리거, 초안 version 충돌, 문서 tenant/service 경계, 감사와 변경의 동일 트랜잭션을 확인했다. 소스 읽기만으로 감사 저장 실패 시 모든 CRUD 롤백까지 검증했다고 주장하지 않는다.

## 원본 필드 대조

원본 근거는 이미 확보한 클라이언트 번들 `main.183e9d2c.js`다. SHA256 `3538d47856c6ba1b4207059dc09434066c7ca692a5907ed792dd9e27c7dba78f`, REA Evidence `ev_87493e79c4f053718022b23e1e5d42acf1af245f8c7838a89cd7ebc3918df152`. 아래 위치는 0부터 시작하는 UTF-16 오프셋이다. [14개 원문 발췌](source-audit/excerpts.json)에 범위와 원본 경로를 보존했다. 원본 서버 스키마·강제 검증은 관측하지 않았다.

| 항목 | 원본 관측 | 현재 구현과 남은 작업 |
|---|---|---|
| 기본8종 | FB enum 7824152, 응답 renderer 8330230 | 단문·장문·객관식·체크박스·드롭다운·파일·행렬2종은 대응. 기본 이름 대응이 모든 부가 설정 동등성을 뜻하지 않음 |
| 특수 질문 | ADDRESS/FOREIGN_ADDRESS/CONTACT/EMAIL/EMAIL_DIRECT/DRAW/IDV·SIGNATURE 분기 | 별도 계약·입력·저장·응답 검증 미구현. 전자서명/본인확인 외부 제공사 성공과 로컬 입력을 분리할 것 |
| 생년월일 | rK 8216372, 최대8자 숫자·patternRegex | 현재 날짜 질문은 ISO 날짜. BIRTH와 동일하다고 취급할 수 없음 |
| 질문/보기 내용 | C_t 12625323, customValueYn 8180108 | 설명·이미지·참고 링크/파일·기타 직접입력·보기 value·개인정보 분류 미보존. 옵션은 현재 문자열 배열 |
| 텍스트 검증 | n1 8324515, t1 8323759 | 원본 입력 제한100/1000자 및 패턴 분류와 현재 단문1000/전체문자열20000이 다름. 기존 게시본을 변경하지 않는 설정 모델 필요 |
| 페이지와 이동 | AST-S011 6914770, f_t 12621071, C_t 12625323 | pageList/페이지 제목·본문/기본·보기별 pageOffset/usePageOffset/뒤로 이동 허용 누락. 현재 개별 질문 condition은 페이지 분기와 다름 |
| 참여 설정 | S_t 12626123, AST-S011 constraint | 시작시각·참여 대상·중복 제한·언어·인증별 설정 누락. maxResponses는 대응, 종료시각은 Publication.expiresAt로 부분 대응 |
| 템플릿 | AST-S030 6951442, payload 11981900 | 제목·분류·공개범위 일부 대응. 설명·라이선스 범위·썸네일·공개범위 편집 미구현 |
| 선택 수 | 8163699·xG 8166309 | NONE/MAX/EXACT를 없음/max/min=max로 표현 가능. 선택 사항 행렬의 EXACT는 원본이 일부 답변 시 모든 행 수를 요구하나 현재는 빈 행별로 생략해 동등하지 않음 |

## 서버·화면 후속

1. **보안정책 재검사:** `formScope → currentServiceScope`는 현재 역할·grant·세션 절대만료와 SSO를 검사하지만 MFA/IP/비밀번호/세션 비활동/선택 회사 재검사가 빠져 있다. 회사 잠금 대기 중 정책 변경 및 이후 잠금·감사 중 자연 만료를 실제 시험으로 먼저 재현한다. 이 문단은 최초 소스 감사 시점의 기록이다. 후속 [현재 권한 재현·보완](../R08-T02/authority-flow/README.md)에서 실제 실패11개를 재현하고 공통 가드를 수정했다.
2. **옵션 식별자:** `Question.stableKey`와 DB 행 ID를 구분해야 한다. 현재 초안 저장은 질문/옵션 전부 삭제·재생성하며 제목만 변경해도 옵션 ID가 바뀐다. 원본 옵션의 버전 간 ID 안정성은 미확인이다. 우리 계획의 안정적인 식별자 요구를 만족하도록 DTO/스키마/저장/복제/조건/응답 버전 계약을 함께 설계한다.
3. **미저장 입력:** `useFormDraft`는 클릭 저장과 beforeunload를 직접 처리하지만 공통 `useUnsavedChanges`에 등록하지 않는다. history/회사 전환을 실제 UI에서 재현하고 자동저장과 이탈 확인이 중복 충돌하지 않도록 연결한다. 템플릿 dirty·409 복구도 함께 점검한다.

구체적인 구현 순서와 완료 조건은 [폼 구현 실행 계획](../../planning/09-rea-fullstack/forms-execution.md)에 정리했다. 이번 대조에서 제품 코드·마이그레이션은 변경하지 않았다.

후속 F2: [질문/보기 식별자 보완](../R08-T02/identities/README.md)에서 ID·label/value·조건·복제/개정과 기존 자료 보존을 구현·검증했다. 위 옵션 문자열/삭제재생성 설명은 수정 전 관측 기록이다. 직접입력·이미지·페이지 등 원본 필드 수용은 계속한다.
