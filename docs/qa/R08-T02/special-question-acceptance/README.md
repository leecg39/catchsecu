# R08-T02 응답 PDF 표현 체크포인트

검증 시각: 2026-10-11 01:12 KST

## 구현 범위

- `GET /api/v1/submissions/{id}/pdf`가 현재 응답의 폼·응답 버전, 상태, 수집 방식, 제출·보유 시각과 질문별 유형·필수 여부·표시값을 PDF로 만든다.
- 단문·장문·객관식·체크박스·드롭다운·날짜·FILE·행렬 단/복수·CONTACT·EMAIL·EMAIL_DIRECT·BIRTH·ADDRESS·FOREIGN_ADDRESS·DRAW 16종을 화면과 같은 표시 계약으로 출력한다.
- FILE/DRAW는 현재 `file.read`가 있으면 검사 완료된 현재 첨부파일 이름을 표시한다. 해당 권한이 없거나 현재 첨부를 확인할 수 없으면 `열람할 수 없는 첨부파일`만 표시하며 파일 ID·저장소 키를 포함하지 않는다.
- PDF 생성 전후에 현재 세션·회사·서비스 grant·응답 보유 기한·응답 버전·파일 열람 권한을 다시 확인한다. 중간 변경은 `409 SUBMISSION_CHANGED`, 만료·파기 중 응답은 `410 SUBMISSION_EXPIRED`로 차단한다.
- 성공한 다운로드만 `submission.pdf_downloaded` 감사 이벤트를 남기며 응답 원문은 감사 detail에 저장하지 않는다.
- 응답 상세 화면은 원문을 읽을 수 있을 때만 `응답 PDF 다운로드`를 표시한다.

## 자동 검증

- 실제 PostgreSQL 관련 시험 8파일 84개 통과:
  - `form-module-flow`, `form-module-concurrency`, `form-documents`
  - `question-special-types`, `question-address-types`, `question-drawing-types`, `question-international-contact`
  - `submission-export`
- 16종 실제 게시·제출 통합 시험에서 PDF 바이트와 `X-PDF-SHA256` 일치, 64자리 `X-Document-SHA256`, `private, no-store`, PDF.js 파싱, 무첨부 권한 가림, 만료 410, 감사 2건을 확인했다.
- TypeScript와 변경 파일 ESLint가 통과했다.
- OpenAPI 329경로·466작업, 정책45개, 누락 권한·입력 스키마·미매핑 작업 0으로 계약 검증을 통과했다.
- 빌드 전용 `ALLOW_LOCAL_MAIL/KAKAO/PAYMENT=1`에서 production 정적 페이지 82개 빌드를 통과했다. 첫 실행은 로컬 공급자 명시가 없어 환경 보호 장치가 정상 중단했다.

## Ego Lite·실제 개발 DB 검증

- 합성 QA 계정으로 `/form/manage/applicant/{formId}`의 응답 상세를 열어 `응답 PDF 다운로드` 버튼을 확인했다.
- 브라우저 저장 패널과 완료된 다운로드를 확인했다: [화면](ego-response-pdf-download.png).
- 저장 파일 [ego-response.pdf](ego-response.pdf)은 39,684바이트, SHA-256 `1ca8bcf9571a268ac41552e4c824fca51f94e8dee62b5802365d58b13314e125`, 1페이지다.
- PDF.js로 폼 제목, 현재 정정값, 이메일, 본문 해시를 확인했다.
- 개발 PostgreSQL에서 같은 응답의 `submission.pdf_downloaded` 감사 이벤트 1건과 빈 `changedFields`를 확인했다.

## 상태 판정

이 체크포인트는 기존 질문 구조·검증·정정·CSV 증거에 빠져 있던 현재 응답 PDF 표현을 구현했다. F3 통합 항목은 외부 공급자의 공식 본인확인·전자서명 자격증명과 공식 sandbox/production 검증, 남은 전체 수용 항목 때문에 계속 진행 중이다. 로컬 합성 인증을 외부 공급자 완료로 계산하지 않는다.

구조화 결과: [verification-final.json](verification-final.json)
