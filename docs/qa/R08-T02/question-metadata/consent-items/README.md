# 문항 개인정보 자동 집계 검증

2026-10-10에 원본에서 확인한 문항 개인정보 분류 결과를 폼 동의 항목으로 집계하는 규칙을 구현하고 실제 PostgreSQL·Ego Lite·production 재시작으로 검증했다. 이 체크포인트는 수동 분류 결과의 자동 집계 범위다. NLP/AI 자동 분류와 법정 동의서 문안 전체 생성은 포함하지 않는다.

## 구현 계약

- 문항 순서와 문항 안의 분류 순서를 그대로 유지한다.
- `NON_PERSONAL_INFORMATION`은 동의 항목에서 제외한다.
- 같은 이름과 유형이 반복되어도 합치지 않는다.
- 새로 저장하거나 편집한 폼 버전은 `consentItemSchemaVersion=1`과 계산된 `consentItems`를 함께 고정한다.
- 기존 196개 폼 버전은 `schema 0 / NULL`로 유지한다. 기존 수동 분류가 있는 2개 버전·4개 문항도 소급 집계하지 않아 과거 승인 지문과 영수증을 바꾸지 않는다.
- 지연 제약 트리거가 문항 분류와 폼 버전 집계의 불일치를 트랜잭션 커밋에서 거절한다.
- 편집 동의 단계, 승인 스냅샷, 공개 제출 화면, 동의 영수증 증거와 PDF가 같은 버전 고정 항목을 사용한다.
- 공개 질문 JSON에는 관리용 수동 분류 메타데이터를 노출하지 않는다.

## 검증 결과

- PostgreSQL migration 141개를 새 격리 스키마에 설치하고 JSON CHECK와 지연 트리거 2개를 확인했다.
- 개발 DB 기존 폼 버전 196개의 기존 컬럼 지문과 `schema 0 / NULL`을 확인했다.
- 구현 중 집중 24개, 3파일 통합 25개, 5파일 확장 43개 시험이 통과했다. 마지막 문구 변경 뒤 렌더 시험 3개와 TypeScript·변경 파일 ESLint를 다시 통과했다.
- Ego Lite에서 편집 화면과 공개 화면에 `민감정보 · 건강정보`, `고유식별정보 · 운전면허번호`, `민감정보 · 건강정보` 순서가 보였고 중복이 유지됐다.
- 공개 제출 1건 뒤 영수증 증거와 43,713바이트 PDF에서 같은 세 항목을 확인했다.
- production 서버 PID를 바꿔 재시작한 뒤 DB 고정 해시 `8a2f82b5c2cccab11ef071663d2b5e8183774c2a8547ca091dc1f30b491d9c64`와 공개 화면이 그대로 유지됐다.
- production build 82페이지, OpenAPI 323경로·458작업, API 감사 458작업·누락0, 계획 107작업·의존 순환0, 스키마 예상 밖 차이0을 확인했다.

## 증거

- 전체 판정: [verification-final.json](verification-final.json)
- 편집 화면: [browser-editor.json](browser-editor.json)
- 공개 화면: [browser-public.json](browser-public.json)
- 제출·영수증: [browser-submit.json](browser-submit.json), [browser-freeze.json](browser-freeze.json)
- 재시작: [restart.json](restart.json), [browser-after-restart.json](browser-after-restart.json)
- migration: [fresh-schema.json](fresh-schema.json), [upgrade-preservation.json](upgrade-preservation.json)
- 품질 게이트: [render.json](render.json), [typecheck.log](typecheck.log), [lint.log](lint.log), [build.log](build.log)

## 남은 범위

- 질문 문구를 분석해 분류를 제안하는 NLP/AI 기능
- 분류 항목과 처리 목적·보유 기간을 사용해 법정 동의 문안을 자동 작성하는 기능
- R08 전체 경로의 빈 상태·오류·권한·동시성·접근성 전수 수용

따라서 R08-T01~T04와 전체 목표 상태는 계속 `in_progress`다.
