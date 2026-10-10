# F3 수동 개인정보 분류 검증

2026-10-10. 문항별 수동 분류의 모델·API·편집·관리 요약과 이전 응답 표시를 구현하고 검증했다. 전체 107개 작업이나 F3 전체가 완료된 것은 아니다.

## 계약과 원본 관찰

[실행 계획](PLAN.md), [원본 38개 발췌](../remaining-source-review/source-review.json), [발췌 무결성](../remaining-source-review/source-integrity.json)을 근거로 했다. 원본의 다섯 분류, 네 필드, 이름 50 UTF-16 제한, NONE의 빈 이름, 행렬형 제한과 주민번호 필수 조건을 연결했다.

`Question.catchFormPersonalInformationRequests` nullable JSON 및 migration120을 추가했다. 항목은 `nlpFeedbackId:null`, `personalInformationType`, `detectedPersonalInformation`, `personalInformationSource:"USER"`만 허용한다. 원문 공백·BOM은 보존하고 이름이 필요한 분류의 trim-empty, NUL, 잘못된 Unicode를 API/DB에서 거절한다. NONE은 빈 문자열이다. 문항당 20개 상한은 원본에서 관측하지 못한 독립 제한이다. 중복·NONE 혼합을 자동 제거하지 않는다.

같은 현재 질문의 필드 생략은 저장값 보존, `[]`는 제거다. null인 기존 DTO에는 키를 추가하지 않는다. RESIDENT는 필수여야 하며 행렬 두 유형은 NONE만 허용한다. 구클라이언트가 분류를 생략한 변경도 현재 값을 병합한 뒤 검사한다. 생성·수정·개정·복제·템플릿·승인 지문에 연결하고 기존 게시본과 응답은 보존한다.

수동 메타데이터는 제목·언어 변경에서도 보존한다. 원본의 NLP 재분석과 문항/페이지 복제 초기화는 이번 기능에 포함하지 않는다. 전체 폼 복제와 16언어 공통 복수 편집은 현재 구현의 정책이며 원본 서버 정책과 동등하다고 주장하지 않는다. 자동 동의문·subjectRole을 바꾸지 않는다. 관리자 분류는 공개 UI와 일반/고정URL 공개 JSON에서 제외하며 이 노출 정책도 독립 계약이다.

## 검증

- [구현 전 19개 시험](before.json)은 18개 실패·1개 통과였다. 구현 후 실제 Form 잠금 경합 시험을 추가하여 [20개 통과](after.json), 렌더링 [2개 통과](render.json)를 확인했다.
- 최종 [11파일·103개 회귀 시험](regression.json)이 모두 통과했다. 앞선 20개·2개는 포함되므로 합산하지 않는다. 실제 잠금의 200/409, 권한 회수·감사 롤백·25종 Unicode 공백·게시 불변·구 응답/PDF·복제/템플릿·공개 JSON을 포함한다.
- [기존 8테이블 공통 컬럼 보존](migration-after.json), [dev/test 스키마 차이 0](schema/), [빈 스키마 120개 설치](fresh-schema.json)를 확인했다. 백필 없이 새 컬럼이 null임을 검사했다.
- [타입](typecheck.log), [린트](lint.log), [production 빌드](build.log), [OpenAPI 311경로](openapi.log), [계획 검사](plan-validation.log)가 통과했다. [소스 UI 검토](frontend-review.json)의 확정 결함은 0건이다. 소스 검토는 실행 증거와 별개다.

## 실제 Ego와 보존 확인

격리 합성 회사에서 [이름 누락·50자 키보드 상한](flow/browser-input-boundary.json), [최대 20개·Escape·계속 편집/입력 버리기](flow/browser-limit-cancel.json), [주민번호 필수 잠금·분류 변경](flow/browser-resident.json), [제거 취소/확정·행렬 제한](flow/browser-delete-matrix.json)을 확인했다. 분류 변경/제거 후 기존 필수 설정을 임의 해제하지 않으며 사용자가 직접 해제할 수 있다.

[한국어→영어→한국어·새로고침](flow/browser-language-reload.json) 뒤 복수 분류와 원문 공백이 유지됐다. 390/768/1440px에서 document scrollWidth가 clientWidth를 넘지 않았다. `<script>` 이름은 평문으로 보이고 실행되지 않았다. 이는 DOM 기능 검사이며 화면 이미지의 시각 검증은 아니다.

[공개 UI/API 비노출](flow/browser-public-projection.json) → [한 번 제출](flow/browser-submission.json) → [DB 대조](flow/verify-submission.json) → 분류를 NONE으로 개정/게시 → [새 공개 버전](flow/browser-new-public-version.json) → [이전 응답의 원래 두 분류](flow/browser-original-response.json) → [조건 숨김/표시와 정정](flow/browser-correction.json) → [DB 대조](flow/verify-correction.json)를 통과했다. 이전 응답은 formVersion1을 계속 참조한다.

[PDF 실제 다운로드](flow/browser-receipt-download.json)는 41,973바이트이며 SHA-256 `604b2a4a54dce72ae1b075432496daadecf45b7e3c40e1a327a52e2f5e341ac9`가 제출 당시 원본과 같다. 분류를 동의 증거에 임의 추가하거나 영수증을 재생성하지 않았다.

[동일 빌드 재시작](restart.json) PID41458→49792 후 [DB 지문](flow/verify.json)과 [실제 공개 새로고침](flow/browser-after-restart.json)을 확인했다. 폼1/버전2/응답1/정정1/감사21, SHA-256 `64368a29d8ca01c2fefb26ef001ba354d86c62bfcf992c8faf3b4d7cd26b00d5`다. [이전 16개 고정 데이터](frozen-fixtures-after-restart/summary.json)도 보존했다. 새 null 컬럼만 검증 후 구 해시에서 제외하며 과거 baseline을 바꾸지 않았다.

## 한계와 후속

전체 화면 스크린샷·스크린리더 수용, 실제 NLP·자동 동의 집계, 참고자료 FILE, 기타 직접입력, 여러 페이지 및 R08 전체 상태/권한 조합은 남아 있다. 실제 외부 제공사 성공으로 집계하지 않는다.

하네스 오류는 실제 관찰한 영어 선택 버튼/응답 정정 문구로 수정했고, 재시작 보고 경로 오타를 바로잡았다. 재제출은 하지 않았다. 과거 HTTPS fixture의 읽기 검사에서는 필요한 프로세스 전용 CA/origin 변수를 복원해 통과했으며 최초 실패 로그를 보존했다. macOS 키체인 신뢰를 다시 등록하지 않았다.

[최종 품질](quality-final.json) · [소스 지문](source-fingerprints.json) · [기록 무결성](checkpoint-integrity.json)
