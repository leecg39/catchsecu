# F3 직접 그리기 검증

2026-10-10. 승인된 R08의 부분 체크포인트다. DRAW 질문을 비공개 파일 수명주기에 연결한다. 인증 서명 SIGNATURE·IDV_SIGNATURE와 전체 F3/107개 작업은 완료하지 않았다. [실행 계획](PLAN.md).

## 원본과 구현 계약

- [원본 분석](source-review.json): 보존 번들 SHA `3538d47856c6ba1b4207059dc09434066c7ca692a5907ed792dd9e27c7dba78f`, REA 증거와 UTF16 발췌62개. 유형명 ‘직접 그리기’, 흰 배경·검정 펜·높이120px, 인라인 적용/지우기/다시 입력/이전, 빈 그림 거절·점 허용, PNG `userSignImage.png`를 정적으로 확인했다.
- 답변은 strict `{s3Key,fileName,fileSize}|null`. 독립 저장소의 `s3Key`는 FileObject의 불투명 UUID다. 실제 저장 경로를 의미하지 않는다. FILE의 기존 UUID 문자열 계약은 유지한다.
- 서버는 PNG 초기화와 DB 질문 결합, 검사 결과·테넌트·서비스·게시 버전·질문·파일명·크기·공개 업로드 증명 또는 정정 권한을 확인한다. 원본 서버의 DB/MIME 검증을 관측했다고 주장하지 않는다.
- `file.read`가 없으면 read/list/history는 그림의 이름·크기를 제거하고 기존 FILE과 같은 UUID만 반환한다. 이 표시값을 DRAW 쓰기 계약으로 허용하지 않는다. UI는 파일 질문을 PATCH에서 제외해 서버의 암호화된 원문을 유지한다. 이름·다운로드는 권한 검증된 FileInfo로 표시한다.
- [UI 검토](ui-review.json): 목록의 객체/UUID 비교 오류와 재입력 후 지우기의 기존 적용값 잔존을 수정했다. 미적용 획은 임시 입력이며 정정 취소 시 폐기된다. 적용하거나 비운 값은 이탈 확인 대상이다.
- 원본 대비 독립 개선: 화면 크기 변경 시 획 보존, 처리 중 모든 그림 조작 잠금. 로컬 펜은 고정2px 선과 점을 사용하며 원본 가변 굵기 알고리즘과 시각적으로 동일하다고 주장하지 않는다.

## DB·서버

[업그레이드 전](test-before-migration.log) 1통과/14실패로 기존 질문 유형 제약을 확인했다. migration116 이후 첫 실행은14통과/1실패였으며, 파기 뒤 영수증 행이 남는다고 잘못 가정한 시험을 기존 영수증 삭제 계약에 맞춰 수정했다. [최종15개](test-final.log)는 모두 통과했다. 파기 전 영수증 존재·파기 후 파일2개/답변3개/영수증1개 삭제 및 증명 해시를 추가 확인했다. [첫 실행 기록](test-after-migration.log)을 보존한다.

[migration116](../../../../prisma/migrations/20261025006000_drawing_questions/migration.sql)은 질문 타입 CHECK와 파일 질문의 DRAW PNG 허용 조건만 확장한다. [기존 guard 비교](migration-guard-review.json), 기존8테이블 [전](migration-before.json)/[후](migration-after.json) 전체 행·컬럼 해시 일치, [새 빈 스키마116개 설치](fresh-schema.json)가 통과했다. [개발](schema-contract/catchsecu_dev-contract.json)/[시험](schema-contract/catchsecu_test-contract.json) DB의 예상 밖 구조 차이0이며 기존 SQL 전용 FK1개는 정의까지 확인했다.

[실제 ClamAV](scanner-preflight.json) 1.5.4의 정상 파일 허용·EICAR 거절을 확인했다. 새15개 통합시험은 실제 PNG/기존 FILE 업로드, 암호화·다운로드, strict/null/PNG 직접DB 제약, 변조 메타데이터·잘못된 증명·다른 질문/게시 파일 거절, 정정 교체·비움·복원·원자적 실패, 권한 마스킹, 조건부 숨김, 파일명 변경 거절, 동기/worker CSV, 외부 공유 발급자 권한 재검사, 복제/템플릿/개정, 만료파일 정리와 전체 파기를 포함한다.

고유11파일201개 시험이 통과했다: 새15개와 [회귀10파일186개](regression.log). 실제 목록에서 발견한 질문 순서 결함은 [실패 재현](list-order-before.log) 후 질문 순서로 정렬하도록 수정하고 [3파일35개](list-order-final.log)를 다시 통과했다. 이35개는 앞선201개와 중복이며 합산하지 않는다. [시험 요약](test-summary.json). 과거 전체1834개 결과는 이전 체크포인트의 이력이며 이번 전체 실행 결과가 아니다. 시험 로그의 pg 동시 query 사용 중단 예정 경고는 남아 있다.

## Ego 실행 증거

[편집](flow/browser-editor.json)에서 실제로 질문 유형을 변경해 서버에 저장했다. [준비HTTP](flow/prepare-http.json)4개와 [게시/거절HTTP](flow/publish-http.json)6개를 실행했다. [필수·빈 그림](flow/browser-validation.json), [점 적용·재입력/이전·지우기](flow/browser-reentry.json)를 확인했으며 거절 시 제출 요청은0이다.

[마우스 그림](flow/browser-canvas.json)은 실제 포인터 입력으로 생성했다. [캔버스 PNG](flow/submitted-canvas.png)를 직접 열어 흰 배경과 검은 연결선을 확인했다. 첫 resize 관측은 ResizeObserver가 완료되기 전이어서 별도로 표시했다. [후속 터치/resize](flow/browser-touch-resize.json)는 실제 터치 입력 후 observer 완료를 기다려390·768·1440px의 bitmap 폭287·665·672와 획 보존·가로넘침0을 확인했다. 선택 그림 적용 후 비우기도 통과했다.

전체 화면 캡처는 이전 Ego 캡처의 알려진 문제 때문에 시각 일치 통과로 집계하지 않는다. 이번 캔버스 PNG는 실제 제어 페이지의 캔버스에서 내보낸 이미지이며 전체 페이지 screenshot을 대체하지 않는다.

[실제 제출](flow/browser-submit.json)은 업로드3요청·제출1요청과 처리 중 버튼/캔버스 잠금을 확인했다. [DB 대조](flow/verify-flow.json)는 암호화 응답·PNG 검사·파일 결합을 확인했다. 최초 적용 전 PNG와 다운로드의 바이트 비교는 resize 완료 전 캡처 때문에 실패했다. 이를 [캡처 시점 한계](flow/capture-timing-limit.json)에 보존하고, 최초 파일은 실제 다운로드와 비공개 저장 파일의 해시를 대조했다. 적용 전 이미지와 바이트가 같았다고 주장하지 않는다.

[정정 입력](flow/browser-correction-input.json)에서 기존 이미지 표시·필수값 비움 거절·취소 후 값 복원·다시 그리기를 확인했다. [정정 실행](flow/browser-correction.json)과 [DB 대조](flow/verify-correction.json)에서 버전2·정정1건·파일2개, 그림/메모만 변경, 선택 그림 null과 기존 FILE 빈 값 보존을 확인했다. 이번에는 적용된 Blob을 제출 전에 보존했으며 [정정 PNG](flow/corrected-canvas.png)·서버 저장·[실제 다운로드](flow/browser-downloads.json)의 SHA256이 `163145724ec2b9672c44d117e7660478ee6e9d5618884e422c452aa64c8c7e8f`로 일치했다. 이전 그림도 정정 이력에서 다운로드해 원본과 일치했다. [CSV](flow/csv.json)는 권한 있는 파일명·빈 값·정정 메모를 대조했다.

응답 목록 질문 순서의 [수정 전](flow/list-order-before.json)/[수정 후](flow/list-order-after.json)를 실제 Ego에서 확인했다. [최종 빌드](build-final.log), [타입검사](typecheck-final.log), 변경 파일 린트 [1차](lint-final.log)/[후속](lint-followup.log), [OpenAPI311경로](openapi-generation.log)가 통과했다. 린트 오류/경고는0이다.

[실제 프로세스 재시작](flow/restart.json) PID34453→34978 후 [화면](flow/browser-after-restart.json)과 [고정 데이터](flow/verify.json)를 다시 확인했다. 폼1·응답1·정정1·파일2·감사30건의 해시는 `ddf2df1f4c9fb7d6f467798037d6e1bddc221c32e64966fa0a686325eecf2351`로 유지됐다. [기존12세트](frozen-fixtures/summary.json)도 변경 없이 유지됐다.

국제 연락처와 폼 언어·인증 서명·부가 필드·여러 페이지·전체 화면 시각 대조 및 전 페이지 수용은 남아 있다. 이 결과는 직접 그리기의 부분 검증이며 전체 F3/R08 또는107개 작업의 완료가 아니다.
