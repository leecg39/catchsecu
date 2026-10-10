# 작성자 참고자료 파일·보기 이미지 — 로컬 검증 체크포인트

2026-10-10. R08/F3의 FILE 참고자료와 객관식·체크박스 보기 이미지를 백엔드부터 실제 Ego 화면까지 구현·검증했다. **전체 107개 작업 완료가 아니다.** [25단계 계획](PLAN.md), [실행 상태](execution.json), [원본 근거](source-review.json), [40개 발췌 재검증](source-verification.json)을 따른다.

## 구현한 동작

- FILE+LINK 합계 문항당3개, FILE당5MiB PDF/DOCX/AI, 일반 보기당1개·문항당20개·이미지당1MiB JPEG/PNG를 지원한다. 원본 wire·옵션 ID와 기존 LINK/기타 답변을 보존한다.
- 암호화한 불변 blob과 소유 자산을 분리했다. 예약·바이트 전송·내용 검사·ClamAV 검사·참조 연결·정리를 서버에서 처리한다. 회사 용량에는 일반 파일·사업자 서류·삭제 전 작성자 자산을 모두 포함한다.
- 게시본·응답·승인 기록의 참조는 현재 초안에서 제거해도 유지된다. 복사·템플릿 사용은 독립 소유 ID와 원래 바이트를 사용한다. 시스템 자산은 신뢰된 서버 입력만 허용한다.
- 회원·공개·응답·승인·템플릿·외부 열람자 문맥마다 현재 권한·기한·부모 버전을 확인한다. 공유 회수 후 이전 URL도 차단하며 모든 자산 응답은 no-store다.
- 업로드와 자동저장을 조정하고 늦은 결과의 잘못된 연결을 막는다. 파일 순서·교체·삭제, 이미지 확대·키보드·유형 변경 확인과 16언어 읽기 문구를 연결했다.

## 검증 근거

| 범위 | 결과 | 근거 |
| --- | --- | --- |
| 최종 관련 시험 | **중복 제거 24파일314개 통과** | [집계 방식](test-union.json) |
| 계약/DB | 계약 RED12→GREEN15, DB21, dev8테이블 기존 행 보존, 빈 schema123개 migration | [계약](contract-green.json), [DB](database-green.json), [이관](migration-after.json), [빈 설치](fresh-schema.json) |
| 통합 회귀 | 19파일254개 통과 | [원 결과](integration-regression-first.json) |
| API·감사 | API 계약12개, 실제 감사 포함 회귀55개 | [계약/UI](api-ui-contract-first.json), [감사](audit-regression-first.json) |
| 실제 HTTP 경계 | 12개 통과, 정상 PDF·EICAR DOCX 실제 ClamAV, 시험 예약 API 정리 | [결과](http-boundaries/run-e945ba32-31fd-499d-a8eb-fa914a423a32.json) |
| DB 구조 | dev/test 예상밖 차이0, migration122/123 | [dev](schema/catchsecu_dev-contract.json), [test](schema/catchsecu_test-contract.json) |
| 정적/빌드 | TypeScript0·변경 린트 오류0·production 빌드 통과 | [타입](typecheck-final.log), [후속 QA 린트](acceptance-helpers-lint-final.log), [빌드](build-first.log), [빌드 이후 제품소스 불변](build-continuity.json) |
| 실제 파일 읽기 | 현재 회원·공개·과거 응답 7개 다운로드 바이트 일치 | [HTTP 다운로드](flow/downloads-cf963495-07a4-4865-9a30-a51242b99ec2.json) |
| 재시작 | PID39075→61290, 실제 파일5종 포함 DB 지문 동일 | [결과](flow/verified-after-restart.json) |
| 기존 자료 보존 | 이전18세트 해시 유지, baseline 교체 없음 | [결과](legacy-preservation.json) |

314개는 세 실행의 파일명+시험명 합집합이며 단일 전체 시험 실행이 아니다. 앞선 개별 RED/GREEN 결과를 더하지 않는다. 저장소 전체시험1,834개는 예전 체크포인트이며 이번 변경의 전체 회귀 수치로 사용하지 않는다. 기존 TemplateGallery의 img 경고2건은 별도 [통합 린트 로그](integration-surfaces-lint-second.log)에 남아 있다.

## 실제 Ego 여정

1. PDF·PNG·JPEG 파일 선택→실제 검사→자동저장, FILE+LINK 혼합3개·순서 변경·상한을 확인했다. 잘못된 이미지 형식 교체는 기존 이미지를 보존했다. [작성](flow/browser-authoring.json), [보존](flow/browser-editor-preservation.json).
2. 공개 게시 후 PDF 다운로드·응답 제출을 수행했다. 390/768/1440px에서 가로 넘침 없고 이미지2개가 정상 로드됐다. Enter/Space 확대와 Escape·초점 복귀도 확인했다. [공개 상호작용](flow/browser-public-interactions.json), [키보드](flow/browser-editor-keyboard.json), [공개 제출](flow/browser-submission.json).
3. 새 버전에서 PDF·이미지를 교체했다. 이전 응답과 정정 화면은 v1 자료를 유지했고 원래 파일·동의 영수증 PDF의 실제 다운로드 해시도 동일했다. [역사 다운로드](flow/browser-historical-downloads.json), [정정](flow/browser-correction.json).
4. 실제 승인 요청 후 이미지 설정 제거→기존 승인 무효화를 확인했다. 과거 승인 자료3개는 그대로 다운로드·표시됐고 새 요청을 승인한 뒤 게시했다. 게시한 승인 상태는 consumed다. [과거 승인](flow/browser-approval-history.json), [최종 DB 대조](flow/verified-after-restart.json).
5. HTTP로 폼 복사와 템플릿 등록·사용을 수행하고 실제 화면에서 확인했다. 템플릿은 Ego에서 삭제했다. 기존 복사본의 자료도 Ego에서 제거한 뒤 API로 소유 자산2개를 삭제했으며, 원래 폼·템플릿 사용 결과의 공유 blob과 바이트는 유지됐다. [템플릿 미리보기](flow/browser-template-preview.json), [삭제 뒤 생성 폼](flow/browser-template-deleted-copy.json), [복사 자산 정리](flow/copy-assets-discarded.json).
6. 로컬 인증 메일 job의 코드를 이용해 외부 열람자 이메일 인증을 실제 UI에서 수행했다. Q1만 표시·PDF 다운로드 성공, Q2 이미지404, 회수 뒤 이전 URL401·화면 접근 거절을 확인했다. [열람](flow/browser-viewer.json), [회수](flow/browser-viewer-revoked.json).
7. 참고자료 전체 끄기 취소·확정·재활성화와 이미지 전체 끄기를 확인했다. 제거한 값은 다시 켜도 복구되지 않는다. [자료](flow/browser-materials-off.json), [이미지](flow/browser-images-off.json), [유형 전환](flow/browser-type-clear.json).

편집 자료/이미지6장·공개3장·열람자3장과 승인/응답/템플릿/확대 캡처를 실제로 열어 확인했다. [화면 및 다운로드 폴더](flow). 이전 체크포인트의 캡처 실패를 소급해 시각 합격으로 바꾸지 않는다.

## 보존 상태와 한계

재시작 보존 지문: `610d9f3893a8ea490fbb36bdd39e2d9cac570b748d52119c38bf6fa224bc3adb`. 폼3·응답1·정정1·승인2·공유 회수2·자산11(삭제 tombstone 포함)·참조12·실제 blob5·감사171건을 보존했다. fixture가 동결됐으므로 이후 해당 회사의 HTTP/UI 조회도 감사행을 추가할 수 있어 금지하고 기존 read-only verify만 사용한다. 비밀 파일은 ignored .local의600 권한으로 보관한다.

승인 정책은 격리 QA 회사에 직접 설정한 시험 전제다. 정책 CRUD·유료 권한 수용 증거가 아니다. [명시 기록](flow/approval-policy-fixture.json). 로컬 인증 job 읽기는 외부 SMTP 전달 증거가 아니다. DB 모델/경합 시험의 합성 AV 메타데이터와 실제 ClamAV 검사를 구분한다.

최초 최종 검사에서 게시 후 승인 상태를 approved로 잘못 기대한 실패를 보존하고 consumed로 고쳤다. 첫 열람자 다운로드 관측은 순간적으로 사라진 DOM 요소 때문에 중단되어 성공으로 집계하지 않았다. 별도 두 번째 초대로 다운로드·범위·화면폭·회수를 완료했다. 잘못된 QA origin/URL/선택자 대기와 공개 화면 파일 개수 선택자의 정정도 [실행 기록](execution.json)에 남겼다.

문항 설명/본문 이미지, NLP와 자동 동의 항목 집계, 다중 페이지/분기·질문/페이지 복제, 모든 원본 시각 상태·스크린리더·외부 S3/SMTP 등은 전체 목표의 잔여 작업이다. 이번 파일 단위 검증이 전 페이지 CRUD 완성을 뜻하지 않는다.
