# F3 질문 참고 자료 LINK 검증

2026-10-10. LINK의 데이터·CRUD·편집·공개·원래 응답 표시를 구현하고 검증했다. 전체 107개 목표나 F3 전체의 완료를 뜻하지 않는다. FILE 참고자료와 개인정보 분류·기타 답변·다중 페이지 등은 남아 있다.

## 원본과 구현

[사전 계획](PLAN.md), [원본 19개 발췌](source-review.json), [발췌 무결성](source-integrity.json)을 먼저 확정했다. 원본은 파일·링크 합계 3개이며 LINK는 `materialType/orderNumber/fileKey/linkLabel/linkUrl`의 5개 필드, 0 기반 연속 순서다. URL은 trim 후 원문을 유지하며 512 UTF-16 단위, 표시명은 trim 후 100단위다. 빈 이름은 주소로 대체한다. 공개 링크는 추가 설명 앞에 평문으로 표시하고 새 탭을 연다.

`Question.materialList` nullable JSON과 migration119를 추가했다. 기존 null은 DTO에서 생략한다. 같은 현재 질문 ID의 생략은 저장값을 보존하고, `[]`는 명시적으로 제거한다. 생성·수정·삭제·순서·복제·템플릿·개정·승인 snapshot과 해시를 연결했다. DB는 JSON 구조·5키·3개 상한·순서·길이·프로토콜을 제한하고 게시 질문은 불변이다. 완전한 URL 파싱은 API의 책임이다.

독립 구현에서 절대 http(s) URL만 허용하고 사용자정보·제어문자·역슬래시·잘못된 Unicode를 거절한다. URL을 서버에서 가져오거나 미리보기를 만들지 않는다. 표시명 fallback은 surrogate를 분리하지 않는다. 편집의 수정 버튼은 독립 기능 확장이다. 원본의 빈 참고자료 패널 켜짐 여부는 DB에 저장하지 않으며 자료가 있는 경우에만 새로고침 뒤 켜져 있다. 이번 단계의 FILE 입력은 명시적으로 거절한다.

## 검증 결과

- [누락 재현](before.json): 18개 중 16개 실패·2개 통과. 구현 후 [18개 통과](after.json).
- 최종 관련 회귀 [9개 파일·81개](regression.json) 전부 통과. 초기 LINK 18개와 렌더링·번역 9개는 이 결과에 포함되므로 합산하지 않는다. UTF-16 경계·URL 원문·위험 URL·FILE/4개 거절·복제/템플릿·권한 회수·409·감사 롤백·게시 불변·구 응답/PDF 등을 검증했다.
- [dev/test 스키마](schema/) 예상밖 차이 0, [기존 8테이블 보존](migration-after.json), [빈 스키마 119개 설치](fresh-schema.json) 통과. 기존 컬럼의 지문과 새 컬럼 null을 확인했다.
- [타입 검사](typecheck.log), [변경 린트](lint.log), [production 빌드](build.log), [OpenAPI 311경로](openapi.log), [계획 검사](plan-validation.log) 통과. PostgreSQL 드라이버의 동시 query 사용 경고는 회귀 로그에 남아 있다.
- [프런트 읽기 검토](frontend-review.json): 확정 결함 0건. 추가 32개 번역 leaf와 전체 1,984개 leaf를 원본 16언어 literal과 대조해 차이 0. 소스 검토는 브라우저 실행이나 전체 시각 수용을 대신하지 않는다.

## 실제 Ego·DB·재시작

격리한 합성 QA 회사에서 [등록/편집/삭제/전체 끄기/새로고침](flow/browser-editor-crud.json), [3개 제한·입력 취소·순서 변경](flow/browser-limit-cancel-order.json), [100/512 키보드 상한](flow/browser-input-limits.json), [잘못된 URL 오류](flow/browser-invalid-url.json)를 확인했다. Escape와 취소는 미적용 입력 폐기를 확인한 뒤 저장값을 유지했다.

[공개 화면](flow/browser-public-render.json)은 조건 숨김/표시, 원문 href·평문 이름·새 탭 안내·`noopener noreferrer`, 키보드 Enter 후 실제 새 탭과 `window.opener === null`, 390/768/1440px의 가로 넘침을 확인했다. 외부 example.test 링크는 이동하지 않았다. 16언어 렌더는 서버 렌더 시험이며 모든 언어를 실제 브라우저로 방문한 것은 아니다.

[실제 제출](flow/browser-submitted.json) → [DB 대조](flow/verify-submission.json) → [링크 수정](flow/browser-revision.json) → [새 게시본](flow/browser-new-public-version.json) → [구 응답 원본 링크](flow/browser-original-response.json) → [정정](flow/browser-correction.json) → [DB 대조](flow/verify-correction.json)를 통과했다. 새 게시본은 수정한 1개 링크를, 구 응답과 정정은 제출 당시 2개 링크를 표시한다.

[영수증 실제 다운로드](flow/browser-receipt-download.json)는 42,356바이트이며 원본 SHA-256 `cf5518783f8ffe19ff68a7b7a6ad1c0f3f4b5be3f4599d4f4e4d63ab35c6e3b1`과 일치했다. 동의 증거/PDF에 질문 참고자료를 새로 넣지 않았으며 기존 PDF 바이트를 보존한다.

[production 재시작](restart.json) PID20592→29341, 동일 BUILD_ID `qcdWy-ktpovId3ebiVJwZ`. [새 고정 지문](flow/verify.json)은 폼1/버전2/응답1/정정1/감사22이며 `74966e039a403b965a7821b631007b25f735591e2cbed0d6ee9079a69f996298`이다. [재시작 공개 조회](flow/browser-after-restart.json)와 [이전 15개 고정 데이터](frozen-fixtures-after-restart/summary.json)도 보존됐다. 새 null 컬럼만 검증 후 구 해시에서 제외했으며 과거 baseline은 덮어쓰지 않았다.

## 한계와 후속

전체 화면 스크린샷·스크린리더 수용은 미검증이다. 원본 서버의 내부 구현·URL 검사·정규화는 관측하지 못했으므로 현재 구현의 계약과 구분한다. 참고자료 FILE 자산·개인정보 분류·기타 직접입력·다중 페이지와 R08 전체 권한/실패/기기 수용은 계속 진행한다. 외부 제공사 수용이나 전체 목표를 통과로 집계하지 않는다.

브라우저 하네스의 세 가지 오류도 각 증거에 남겼다. 세로 스크롤바 때문에 폭 비교를 clientWidth 기준으로 수정했고, 실제 완료 문구로 대기를 수정했으며, 응답 목록에 formId가 필요한 것을 확인했다. 실패 후 재제출하지 않고 화면과 DB의 실제 상태를 확인했다.

[최종 품질 기록](quality-final.json) · [소스 지문](source-fingerprints.json) · [기록 무결성](checkpoint-integrity.json)
