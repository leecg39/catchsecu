# A15–A18 작성자 자산 UI 설계·검증 경계

원본 source-review.json 및 확정 PLAN/API-design을 재사용한다. 원본 서버 구현을 재현했다고 주장하지 않는다. root의 uploadAuthorAsset/discardAuthorAssetUpload와 AuthorAssetProvider/OptionImage를 사용하고 FILE/DRAW 응답 업로드와 분리한다.

- 참고 자료는 FILE/LINK 판별 union의 전체 배열을 전달하고 합계 3개, 0 기반 연속 순서를 유지한다. 파일 추가·교체는 ready 결과가 현재 문항에 붙을 때만 기존 값을 교체한다. 실패·취소는 기존 자료를 보존한다. 개별 제거·전체 off는 확인 후 현재 참조만 지운다.
- 일반 객관식/체크박스 보기만 이미지 1개씩, 문항당 20개까지 연결한다. 기타/드롭다운/행렬은 업로드 UI를 제공하지 않는다. 이미지 삭제는 optionImageKey:null을 명시한다. 객관식↔체크박스는 키를 보존하며 비지원 유형 전환은 기존 기타 설정 확인과 한 번에 확인하고 키를 제거한다.
- 새 폼은 부모 ID 없이 선택한 serviceId로 예약한다. 편집기 임시 metadata map을 Provider에 전달하고 저장된 부모는 정확한 form/template ID·version으로 manifest를 읽는다. 기존 form에서 템플릿 등록을 시작한 경우 저장 전 원래 form의 문맥으로 읽는다.
- 업로드를 시작할 때 service, 전체 편집 내용, 회사, 논리 문항/보기 위치, immutable 저장 snapshot과 요청 token을 캡처한다. 변경·삭제·off·권한 상실·unmount 뒤 도착한 결과는 연결하지 않고 best-effort discard한다. 실패 재시도는 같은 파일의 cache/idempotency key를 유지한다. 사용되지 않은 새 예약 삭제의 409(이미 참조됨)는 정상적으로 무시한다.
- FormDraftSession의 동기 저장 pause는 예약 시작 전에 timer를 중단하며 수동 save/flush/navigation-save도 막는다. 중첩 업로드의 마지막 finally에서 현재 draft의 자동저장을 재개한다. 이미 저장 중이면 업로드를 시작하지 않는다. 첨부가 있거나 업로드 중이면 새 부모의 서비스 변경을 차단한다.
- 표시 이미지는 72px slot/확대를 사용하며 선택 label과 zoom link를 형제 요소로 분리한다. disabled fieldset에서도 링크 확대는 가능하되 답변 변경은 금지한다. 서버가 반환한 이미지 metadata와 부모 문맥 URL만 사용한다.
- 관리자 안내/업로드 실패·재시도는 한국어 독립 문구다. 공개 확대 라벨은 확보한 16개 언어 원문 키를 그대로 사용한다.

## 실행 책임

이 담당자는 코드/정적 문서/순수 UI 시험을 작성하고 시험·DB·빌드·브라우저는 실행하지 않는다. 주 에이전트가 직렬 실행한 로그가 생기기 전에는 통과로 표시하지 않는다. 이 문서의 후속 검증 기록에 실제 실행자·파일을 연결한다.

## 저장한 구현과 정적 확인

- `AuthorAssetUpload.tsx`: React UI와 독립인 요청 session을 분리했다. 취소·unmount는 저장 pause를 즉시 해제한다. 이전 HTTP 요청은 별도 cache를 끝까지 소유하며 늦은 완료는 discard하므로 새 시도 cache·pending·metadata를 건드리지 않는다. 정상 실패 재시도는 같은 cache를 유지한다.
- `FormEditor.tsx`: 서비스·전체 내용·저장 snapshot·회사 context와 동기 편집 revision을 확인한다. revision은 React commit 전의 두 완료 또는 입력 경합도 구별한다. temporary uploads Provider와 form/template version scope를 연결했다.
- `QuestionMaterialsEditor.tsx`: mixed 자료의 추가/양방향 유형 교체/재정렬/개별 삭제/전체 off. `QuestionOptions.tsx`와 `OptionImageEditor.tsx`: ordinary 이미지 제한·추가/교체·null 삭제·전체 off. 유형 전환은 기존 기타 설정 확인과 통합했다.
- `QuestionInput.tsx`·`CustomChoiceQuestionInput.tsx`: label과 zoom sibling, 72px 슬롯, custom 보기 제외. ordinary disabled change handler도 no-op 처리했다.
- `form-draft.ts`·`use-form-draft.ts`: 중첩 pauseSaving seam. 이미 진행 중인 저장은 acquire를 거절하고 pause 동안 수동/강제/이동 저장 및 reload를 차단한다. 마지막 해제 후 기존 phase·dirty 조건에 따라 예약만 재개해 기존 error/conflict 재시도 의미를 유지한다.
- 신규 순수 시험: `author-asset-upload-events.test.ts`, `author-asset-draft-events.test.ts`, `author-asset-ui-render.test.ts`. mock transport와 real React SSR·FormDraftSession을 사용한다. 실제 파일 PUT/ClamAV/브라우저 확대·키보드·리사이즈는 이 시험의 증거가 아니다.
- 담당자가 수행한 검증은 소스 읽기 및 소유 tracked 파일에 대한 `git diff --check`(종료0)뿐이다. 타입 검사·lint·시험·빌드·DB·브라우저는 아직 담당자 미실행. root 실행 로그가 제공되면 구별해 기록한다.
