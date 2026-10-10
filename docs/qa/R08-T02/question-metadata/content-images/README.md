# 문항 이미지 검증

상태: 문항 이미지의 아래 로컬 구현·검증 체크포인트를 완료했다. 전체 R08-T02와 전체 목표는 완료되지 않았다. 별도 본문 rich HTML 이미지는 이후 [BI-07 전체 수용](../../body-images/full-acceptance/README.md)까지 완료했다.

## 구현

원본 번들의 단일 `questionImageKey`, JPEG/PNG 1 MiB, 질문 제목 다음·참고 자료와 추가 설명 이전의 배치를 확인했다. 일반 질문 16종에서 유지하고 이미지가 없는 기존 DTO·영수증은 보존한다. [원본 근거](source-review.md), [원문 61개 무결성 확인](source-integrity-final.json), [상세 작업 계획](PLAN.md).

nullable FK와 migration124, 문항 전용 자산 용도·참조 pin, 실제 이미지 decode/ClamAV 검사, 현재 권한·고정된 과거 버전 읽기를 연결했다. 폼·템플릿·복사·승인·공개·응답 정정·선택 항목 공유에 같은 이미지 계약을 사용한다. 이 소유권·암호화·역사 보존 설계는 로컬 구현 결정이며 확인하지 못한 원본 서버 동작으로 표현하지 않는다.

## 현재 확인한 실행

- 최종 관련 회귀: [23파일 323개 통과](regression-first.json). 전체 애플리케이션의 모든 시험을 다시 실행한 결과는 아니다.
- 실제 HTTP 경계: [12시나리오 통과](http-first.log), [상세 요청·보존·정리 증거](http-boundaries). 잘못된 권한·scope·버전·용도·파일/MIME/hash/이미지 bytes를 거부했고 정상 PNG의 실제 검사와 inline bytes를 확인했다.
- [기존 DB 12테이블 보존](migration-after.json), [빈 스키마 124 migrations](fresh-schema.json), [dev/test 스키마 차이 0](schema-drift), [재시작 후 이전 검증 데이터 19세트 보존](legacy-preservation-after-restart.json).
- Ego에서 PNG/JPEG 추가, 실패한 교체의 기존 이미지 유지, 삭제·끄기 취소, 저장 중 변경 확인의 stale 차단, 끄고 삭제 후 다시 켰을 때 이미지가 복원되지 않음, 형식 전환과 새로고침 보존을 확인했다. [편집 동작](ego-editor-actions.json).
- [공개 화면 390/768/1440px](ego-public-layout.json), [편집 화면 같은 세 폭](ego-editor-layout.json)에서 자연 비율·가운데 정렬·가로 넘침 없음을 확인했다. [모바일 편집 화면](editor-390.png), [모바일 공개 화면](public-390.png).
- 실제 게시·제출 후 첫 이미지를 파랑에서 초록으로 교체하고 재게시했다. 이전 응답과 실제 정정 화면에는 원래 파랑/주황 이미지가 표시됐다. [정정 증거](ego-correction.json), [응답 상세 화면](historical-correction.png), [독립 DB·원본 PDF bytes 비교](flow).
- [production build](build-first.log), [전체 QI 구성 최종 타입 검사](lifecycle-helper-static-check.json), [변경 파일 lint](changed-lint-first.log), [후속 helper 최종 lint](helpers-lint-final.log). 오류는 없으며 기존 TemplateGallery lint 경고 2개가 남아 있다.

## 시험 환경

별도 QA 회사·폼을 사용하며 이전 frozen 데이터는 UI/HTTP로 열지 않았다. 로컬 이메일·결제 제공사 허용을 명시한 production build `MLIZWDu2FFMbod3QOy68r`로 실행한다. 인증 로그인은 QA bootstrap이므로 이 단위의 UI 인증 수용 증거로 세지 않는다.

검증 도중 다른 로컬 앱의 IPv6 3100 listener가 생겨 요청이 그 앱으로 전달되는 현상을 확인했다. 소유 서버만 3108로 이동했고 제품 코드는 바꾸지 않았다. 정정 저장을 재실행해 성공과 원본 보존을 확인했다. [포트 충돌·복구 기록](runtime-port-change.json). 포트 이동 이후 별도로 최종 fixture 동결 후 재시작 검증도 수행했다.

## 최종 보존·권한 검증

[16개 단계·실제 HTTP 71회](lifecycle-summary.json)에서 템플릿 등록/사용/복제/수정/삭제, 승인 무효화/재요청/게시, 선택 항목 공유·회수와 정책 복원을 확인했다. [템플릿 수정 표시](ego-template-edited.json), [삭제 후 두 복사본 보존](ego-copies-after-template-deletion.json), [무효 승인 이미지 보존](ego-approval-superseded.json), [선택 질문 표시](ego-viewer-selected.json), [회수 후 차단](ego-viewer-revoked.json)에 실제 Ego 관찰을 기록했다.

[브라우저 영수증 다운로드](ego-receipt-bytes.json)는 200, 42,202 bytes이며 원래 PDF 해시와 동일하다. 폼 3개·자산 11개·참조 14개·실제 보관 blob 3개의 데이터와 bytes를 고정하고 [같은 production build 재시작](restart.json) 후 해시 `f12cfcd75a4975a15b6b5741c6de6c3a0944e808c9afc016865a63be9f2303e4`가 유지됐다. 동결 이후에는 이 fixture를 UI/HTTP로 열지 않는다.

## 남은 범위

NLP/자동 동의 집계, 전체 원본 화면 일치와 R08 전수 수용은 별도 후속이다. 본문/페이지/완료/마감 rich 이미지와 다중 페이지 모델·화면은 별도 BI-01~07에서 구현·검증했다.

[최종 실행 기록](execution.json), [최종 품질 기록](quality-final.json), [중간 독립 검증 초안](verification-draft.md), [323개 시험 집계](test-union.json). 독립 초안은 작성 시점의 미완료 상태를 보존한다. 템플릿·승인·공유의 API 변경과 Ego 표시 검증을 구분하며 외부 제공사/전체 UI 인증/스크린리더/원본 전 화면 시각 수용을 완료로 표현하지 않는다.
