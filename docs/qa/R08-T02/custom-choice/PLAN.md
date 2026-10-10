# F3 기타 보기·직접입력 실행 계획

2026-10-10. 계약을 확정하고 구현·범위 검증을 완료했다. 실제 결과는 [README](README.md)를 따른다. [상세 작업·수용 시나리오](PLAN-draft.md)와 [원본 15발췌·현재 43파일 영향 분석](backend-impact.json)에 아래 결정을 적용한다. 조사 당시의 미실행 진술은 초안에 보존하고 실제 실행은 별도 기록한다.

## 확정 계약

- nullable `QuestionOption.isCustomValue`를 추가한다. true만 DB/DTO에 남기고 false는 명시 해제다. 생략은 현재 버전의 같은 문항·보기에서만 보존한다. 이력은 ID/value 소유권 검사에만 쓰며 과거 true가 부활하지 않게 한다.
- 일반 선택의 기존 string/string[]를 유지한다. 기타를 실제 선택할 때만 strict `{kind:"custom-choice",selectedValues:string[],custom:{optionId,text}}`를 사용한다. 선택값과 기타 ID는 제출 당시 보기에서 검증한다. 원본 숫자/pipe wire를 추측 변환하지 않는다. text는 공백 포함 원문을 보존하고 trim-empty, NUL, 잘못된 Unicode 및 100 UTF-16 초과를 거절한다.
- 질문당 기타 한 개·마지막 위치·객관식/체크박스/드롭다운 세 종류를 허용한다. 선택 수에서 기타는 한 개다. 조건은 text가 아닌 stable value를 비교한다. 기타 해제·일반 선택 전환·분기 숨김 시 직접입력을 지운다.
- helper는 `src/contracts/custom-choice.ts`다. typed-server 답변 관계/형식 오류는 `INVALID_CUSTOM_CHOICE`422 (HTTP strict shape 파싱 실패는 기존 `VALIDATION_ERROR`422), 일반 보기 오류는 기존 `INVALID_OPTION`, 선택 수는 `SELECTION_COUNT`, 숨긴 답변은 `HIDDEN_ANSWER`를 사용한다. 정의 오류는 기존 questions/identity 오류 경로를 유지한다.
- 직접입력 편집은 원본의 한 줄 input과 달리 textarea를 사용한다. 로컬 wire가 허용한 저장 답변의 LF를 한 줄 input이 제거하는 문제를 방지하기 위한 독립 UI 보완이다. UI 임시 선택은 기타를 켰다 끄더라도 원래 순서를 유지한다. 서버에서 새 custom 객체를 저장할 때만 보기 순서로 정규화한다.
- textarea가 CR/CRLF를 LF로 노출하므로 변경 구간만 원문에 적용하는 UI helper로 수정하지 않은 줄바꿈을 보존한다. 사용자가 새로 입력한 줄바꿈은 LF이며 원문 기준100 UTF-16을 별도로 검사한다. 자동저장 전후에는 immutable draft snapshot 객체를 비교해 오래된 확인을 적용하지 않는다.
- CSV는 초안 7절의 `kind/selected/custom` JSON 한 셀 형식을 채택한다. selected의 optionId/value/label은 제출 당시 버전이다. 기존 일반 답변 CSV와 이전 PDF 바이트는 바꾸지 않는다. 공유/정정/내보내기/subject·marketing 경계를 초안 표대로 검증한다.
- 일반 API500 code point 호환은 유지한다. 새 UI는250 UTF-16이며 기존 긴 값은 초기 표시·그대로 저장·복제에서 자르지 않는다. 실제 수정 시 새 한도를 안내한다. 기타=true label은 서버에서도250 UTF-16을 강제한다.
- 기타가 있는 현재 문항에서 options/optionDefinitions를 모두 생략하여 비선택형으로 바꾸는 요청은 묵시 제거로 처리하지 않고 거절한다. 명시 `options:[]/optionDefinitions:[]` 제거는 허용한다. 행렬 전환은 기타를 명시 false로 해제하거나 해당 보기를 제거해야 한다.
- ‘답변 형식’과 ‘정보주체 조회 항목’은 모두 선택형을 다른 유형으로 바꿀 수 있다. 두 경로 모두 기타 제거 확인을 거치며 취소하면 전체 문항을 유지한다. 조건의 source로 쓰는 문항은 연결을 먼저 해제하게 하고, 비동기 확인 중 문항·권한·저장 상태가 달라지면 오래된 변경을 적용하지 않는다.

## DB 쓰기와 경합

- last-order는 API/typed-server의 최종 목록 검사로 집행한다. DB는 nullable true-only, 질문별 기타 한 개, 이름250 UTF-16 및 부모 유형을 검사한다. row-level 즉시 트리거로 last-order를 강제하지 않는다.
- 현재 writeQuestions는 질문 유형을 옵션 해제보다 먼저 쓴다. 유효한 기타→비선택형 최종 상태를 허용하도록 해제를 먼저 하거나 deferred 최종 검사로 구현한다. true A→B 전환에서는 A를 먼저 해제한다. ID/value를 재생성하는 방식으로 해결하지 않는다.
- 직접 SQL 부모 유형/자식 옵션 경합은 실제 READ COMMITTED로 검증한다. 고정 스냅샷 격리까지 단순 행 잠금만으로 보호된다고 주장하지 않는다. 잘못된 최종 상태가 commit할 가능성이 있으면 보호 구현 또는 명시 거절을 추가한다.

## 순서와 완료 조건

1. 초안 8절의 정의·답변·ID·이력·분기·정정·권한·DB·CSV 시험을 현재 계약/서버에서 실행해 RED를 기록한다. 없는 helper import로 수집만 실패시키지 않는다.
2. DB/서버 계약과 DTO·생략 병합·실제 옵션 일괄 UPDATE·공개·정정·공유·CSV를 구현한다. 제품과 시험의 소유 파일을 나누고 DB 변경/마이그레이션은 root만 직렬 실행한다.
3. 보기 편집·일반 앞삽입/기타 마지막·명시 제거·분기 보호·직접입력·100자·읽기전용/처리중·16언어 안내를 UI에 연결한다. 기존 긴 보기 값과 기존 일반 입력을 보존한다.
4. dev/test/빈 설치·원래 공통 컬럼/암호문·17개 고정 fixture, 관련 회귀·타입·린트·OpenAPI·production 빌드를 확인한다.
5. 실제 Ego에서 세 유형의 편집/제출·빈/경계 오류·해제·조건·선택 수·정정·공유·CSV·PDF·390/768/1440·키보드를 검사한다. 독립 DB와 실제 다운로드를 대조한다.
6. production 재시작 후 DB/API/브라우저를 확인하고 소스 지문·검증 한계·남은 전체 작업을 기록한다. 실제 결과 전에는 완료로 집계하지 않는다.

직전 개인정보 분류 checkpoint617파일과 고정 해시 `64368a29d8ca01c2fefb26ef001ba354d86c62bfcf992c8faf3b4d7cd26b00d5`, 이전16fixture를 보존한다. 새 null 컬럼만 확인 후 옛 지문에서 제외하며 baseline을 바꾸지 않는다. [독립 계획 검토](plan-review.json)의 확정 보완점은 구현 전 반영한다.
