# F2 질문·보기 식별자와 과거 응답 보존

2026-10-10. R08-T01~T04의 부분 구현·검증 기록이다. 전체 R08 완료가 아니다. 직접입력·보기 이미지·페이지 이동은 F3/F4 후속이다.

## 원본 관측과 구현 계약

보존한 원본 번들 SHA256 `3538d47856c6ba1b4207059dc09434066c7ca692a5907ed792dd9e27c7dba78f`와 REA Evidence `ev_87493e79c4f053718022b23e1e5d42acf1af245f8c7838a89cd7ebc3918df152`를 재대조했다. [원문 위치](source-observations.json)는 UTF-16 기준이다. 원본 클라이언트의 `option.value`는 정수 위치이며 보기 이동 후 다시 배정된다. 라벨 변경은 다른 필드를 유지하고, 삭제는 배열 제거다. 원본 서버의 영속 ID나 복제 내부 구현은 확인되지 않았다. 이번 UUID 안정성은 승인된 데이터 무결성 요구를 위한 독립 구현이다.

| 구분 | 저장·수정 | 개정·복제 |
|---|---|---|
| 질문 logical ID | `Question.stableKey`; 제목 저장·재정렬 때 보존 | 같은 폼 revise 보존; 새 폼 copy/template use는 새 ID |
| 질문 DB 행 ID | 같은 초안 행 보존 | 새 버전은 새 DB 행 |
| 보기 logical ID | `QuestionOption.stableKey`; 값과 질문 소유권 불변 | 같은 폼 revise 보존; 별도 폼 복제는 새 ID |
| 보기 DB 행 ID | 같은 초안에서 재정렬·문구 변경 시 보존 | 버전별 새 행 |
| label / value | 사용자에게 label 표시, 암호화 응답에는 value 저장 | 응답은 제출한 버전의 label로 조회·공유·CSV 표시 |

기존 `options: string[]` 요청과 템플릿 JSON을 읽는다. 새 DTO는 `optionDefinitions: {id,label,value}[]` 및 조건의 `optionId`를 추가한다. projection 불일치·ID 중복·질문 간 ID 이전·동일 ID의 value 변경·삭제된 조건 참조를 거부한다. 비선택형 질문에 선택지 메타데이터를 주입해 자유 입력 표시를 바꾸는 요청도 거절한다. 이름/이메일 역할 교환은 같은 트랜잭션 안에서 중간 고유 제약 충돌을 피한다.

## DB 변경과 호환성

추가 migration 2개로 총111개다. `FormVersion.optionSchemaVersion`과 nullable `QuestionOption.stableKey/label`, unique/index/검증 trigger를 추가했다. 기존 게시본·응답·승인 JSON의 백필은 하지 않았다. format0 승인 지문에서는 새 메타데이터를 제외하며 format1은 ID와 label을 포함한다. 과거 템플릿의 읽기용 ID는 템플릿/질문/value에서 결정적으로 생성하고 원본 JSON을 수정하지 않는다.

- [이전](migration-before.json) / [이후](migration-after.json): 8개 테이블 전체 기존 행에서 추가3컬럼을 제외한 지문 동일, 신규 컬럼의 legacy 값도 검증.
- [빈 스키마 설치](fresh-schema.json): 격리 시험 DB의 새 스키마에111개 migration 적용 성공. 기존 스키마를 초기화하지 않았다.
- [개발](schema/catchsecu_dev-contract.json) / [시험](schema/catchsecu_test-contract.json): 예상밖 스키마 차이0, 의도된 SQL 전용 FK1개 확인.
- 최초 migration에 조건 JSON 검증 함수가 빠져 실제 테스트가 실패했다. 적용된 SQL을 고치지 않고 두 번째 migration으로 보완했다.
- 시험 DB `migrate reset` 시도는 자동 안전 검토에서 거절되어 실행되지 않았다. 이를 우회하지 않고 새 빈 스키마 설치로 검증했다. 해당 실패 로그는 `fresh-install.log`에 보존한다.

## 실제 실행 증거

| 단계 | 결과 | 증거 |
|---|---|---|
| 최초 ID 결함 재현 | 3개 실패 | [before.json](before.json) |
| 초기 migration/fixture 보완 후 | 22개 통과 | [core-final.json](core-final.json) |
| 관련 회귀 | 28파일345개 통과 | [regression.json](regression.json) |
| 일괄 저장 최적화 후 | 12파일144개 통과; 4,000보기 create/reorder 포함 | [batch-regression.json](batch-regression.json) |
| 독립 검토 결함 재현 | 역할 교환·비선택형 메타데이터 2개 실패 | [review-before.json](review-before.json) |
| 검토 수정 후 최종 회귀 | 6파일67개 통과, 실패·보류0 | [review-final.json](review-final.json) |
| 타입·린트·최종 production 빌드 | 모두 exit0; lint 오류0/기존 img 경고2 | [typecheck](typecheck-final.log), [lint](lint-final.log), [build](build-reviewed.log) |

회귀 실행 사이에는 중복이 있으므로 합산하지 않는다. 345개는 일괄 저장 최적화 전, 144개는 최적화 후, 67개는 마지막 검토 수정 후의 범위다. 과거 전체1,834개 실행을 현재 소스의 전수 통과로 표시하지 않는다. 다섯 선택 유형의 코드 제출/라벨 표시, 조건 remap, 복제 독립성, 구버전 응답·정정·공유·CSV, DB 강제 제약을 포함한다.

실제 HTTP는 준비12·게시2·개정3·재게시4·최종 빌드9, 총30개다. [flow 폴더](flow) 각 `*-http.json`에 요청 결과가 있다. 최종9개는 실행 서버에서 역할 교환, 실패 시 version 보존, 보기 일괄 저장·재정렬의 물리 ID 보존, 템플릿·과거 응답을 확인했다. QA 가입 계정의 이메일 검증 상태는 명시적 로컬 DB 준비이며 외부 메일 도달 증거가 아니다.

Ego 공간2/p1에서 보기 문구 수정·이동·새 보기 저장 후 삭제, 조건에 사용 중인 보기 삭제 금지, 실제 공개 폼 제출, 개정 후 이전 응답 표시, 템플릿 저장을 수행했다. 390/768/1440px 가로 넘침0 및 키보드 Tab을 확인했다. [최종 빌드 화면](flow/final-build-browser.json), [과거 응답](flow/historic-response.png), [편집기](flow/editor.png), [반응형·키보드](flow/responsive-keyboard.json), [실제 CSV](flow/response.csv).

검증 도구 오류도 구분했다. 미등록 `/form/ai/edit` 경로, implicit submit 버튼에 대한 잘못된 CSS 대기, 추가/삭제가 합쳐진 자동저장 문구 대기는 각각 실제 경로·접근성 selector·서버 저장 완료 조건으로 고쳐 다시 확인했다. 이를 제품 결함이나 성공으로 집계하지 않는다.

## 재시작과 보존

최종 빌드 `.next-rea-option-identities-final`에서 PID29046→31062로 재시작했다. [freeze](flow/freeze.json) / [verify](flow/verify.json): 폼4·응답1·감사31건 해시 `cabbb43824081bc7d1752de513090fcdd18f0afcbc6c166c0026ee8defcbb689` 동일. 게시 v1과 암호화 응답·동의 영수증의 별도 해시도 동일하다. [Ego 재시작 확인](flow/browser-after-restart.json)에서 공개 개정 문구와 편집기 저장 상태가 유지된다.

이전 SSO 6개와 F1 검증 데이터도 읽기 전용 검사로 대조했다. F1은 기존 로그인 상태에서 대시보드를 조회해 `analytics.dashboard_viewed`·`marketing.summary_viewed` 두 감사 행이 추가되어 최초 비교가 실패했다. [정확한 두 행과 지문](f1-read-audit-delta.json)을 별도 기록했고 원래 fixture/기준 해시를 바꾸지 않았다. 이 두 행의 ID·내용 해시를 확인하고 제외하면 원래 전체 스냅샷 해시와 일치한다. 이후 다른 변경은 계속 실패하도록 검사한다. HTTPS의 과거 조회2건 처리도 기존 기준을 그대로 유지했다.

비밀번호·쿠키·공개 토큰은 `.local/rea-fullstack/option-identities/fixture.json`에만 보관하며 이 파일은 동결 후 verify 전용이다. 소스·보고서에는 자격증명을 넣지 않는다. 현재 런타임은 로컬 SMTP/결제 모드이고 외부 서비스 수용은 미검증이다.

## 재현 명령과 다음 작업

Node24 런타임을 사용한다. `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/question-identities.test.ts tests/server/question-rules.test.ts tests/server/form-draft-save.test.ts tests/server/form-module-flow.test.ts tests/server/submission-export.test.ts tests/server/sharing.test.ts --reporter=json`으로 마지막 범위를 재현한다. DB 변경 시험은 직렬 실행한다. 동결 자료는 `node --env-file=.env.local --import tsx scripts/qa-rea-option-flow.ts verify` 및 `qa-rea-form-authority.ts verify`만 실행한다.

F2의 ID/label/value 기반은 검증됐으나 직접입력·이동 목적지 계약은 F3/F4와 함께 남아 있다. 질문 특수 유형·길이/설명·이미지/참고 첨부·행렬 EXACT, 여러 페이지, 참여 설정, 템플릿 입력 보호와 전체9경로 상태 수용을 이어간다. 공식107개 작업은 완료0·진행53·계획54를 유지한다.

## 2026-10-11 F2 통합 후속

당시 후속으로 남긴 직접입력과 이동 목적지 계약은 이후 F3 기타 보기와 F4 페이지 분기에서 구현됐다. 현재 소스에서 ID 모듈과 두 후속 모듈을 한 번에 다시 실행했다.

- 기존 `options: string[]`은 값이 정확히 일치하는 기존 보기의 ID를 보존하고 새 값만 ID를 발급한다. 명시적 `optionDefinitions`는 ID·label·불변 value를 사용한다.
- 기타 직접입력은 `isCustomValue`와 답변의 `custom.optionId`를 사용하며, 질문당 하나·지원 유형·마지막 보기·소유권·길이·숨김 답변을 검사한다.
- 보기별 이동은 `branchDestination`을 사용하며, 지원 질문 유형·한 페이지 한 분기 질문·직접입력 보기 금지·자기/없는/다른 버전 목적지·전체 그래프 순환을 거절한다.
- 폼 복제와 템플릿 사용은 질문·보기·페이지·조건·이동 대상 ID를 함께 새로 발급한다. 같은 폼의 개정은 logical ID를 보존한다.
- 게시된 라벨·암호화 응답·정정·공유·CSV는 제출 버전에 계속 고정된다.

PostgreSQL 통합 6파일 63개와 계약·화면 상태 4파일 19개, 총 10파일 82개가 현재 HEAD에서 통과했다. 기존 Ego의 보기 편집·직접입력·분기·구 응답·3개 화면 폭·키보드 증거와 production 재시작 지문도 유지된다. 구조화된 결과는 [verification-followup.json](verification-followup.json)에 기록했다.

이 후속으로 F2 하위 범위는 완료했다. R08-T01/T02와 전체 목표는 F3~F7 및 외부 공급자 수용이 남아 완료가 아니다.
