# 질문 추가 설명 — 구현 및 검증

2026-10-10. 승인된 F3 질문 메타데이터 중 `additionalExplanation` 범위를 검증했다. 전체 R08/107개 작업의 완료가 아니다.

## 원본과 구현 계약

[원본 근거](../source-review.json), [33개 발췌 무결성](../source-integrity.json), [사전 계획](../PLAN.md)을 기준으로 V3 description → additionalExplanation, textarea 3,000자, 공개 평문 렌더를 연결했다. 원본 서버의 제한·정규화 동작을 관측했다고 주장하지 않는다.

Question nullable TEXT와 migration118을 추가했다. 공백·개행·BOM·HTML처럼 보이는 문자열은 그대로 보존하며 3,000 UTF-16 단위, NUL·잘못된 surrogate 거절을 API/DB에 적용했다. 같은 현재 logical ID의 필드 생략은 값 보존, 명시적 빈 문자열은 제거다. null은 기존 DTO에서 생략하므로 기존 승인 지문에 빈 필드가 추가되지 않는다. 수정·복제·개정·템플릿 사용·승인 무효화·게시본 불변을 연결했다.

편집 textarea/길이 표시/설명 제거, 요약·미리보기·승인 스냅샷, 공개 응답 및 기존 응답 조회/정정에 평문 표시를 연결했다. 기존 동의 영수증은 질문 설명을 포함하지 않으므로 evidence/PDF 계약을 확장하지 않았다.

## 실제 증거

- [구현 전 실패](before.json):14개 중13실패/1통과. [첫 구현](after.json):12통과/2실패. UTF-16 이모지 길이와 마지막 소유자 보호를 잘못 건드린 시험 데이터를 고쳐 [14개 재실행](after-repair.json) 통과.
- [관련 회귀](regression.json):96통과/6실패. 9개 질문을 전제로 한 동시성 픽스처를16유형·파일/그림2개로 갱신하고 [6개 재실행](concurrency-repair.json) 통과. 잠금·승인·409·감사·파기·원래 PDF 바이트 검증을 유지했다. [최종 고유102시험/10파일](tests-final-summary.json)이며 중복 실행을 합산하지 않았다. 이전 전체시험을 이번 코드의 전수 통과로 간주하지 않는다.
- [마이그레이션 전](migration-before.json)/[후](migration-after.json): 기존8테이블 공통 컬럼 지문 유지, 새 컬럼은 모두null. [빈 스키마118개 설치](fresh-schema.json), dev/test [구조 검사](schema/catchsecu_dev-contract.json) 예상밖 차이0.
- 실제 Ego에서 [저장·새로고침·수정·제거](flow/browser-editor-crud.json), [3,000자 키보드 제한](flow/browser-text-boundary.json), [조건 숨김/표시·스크립트 평문·390/768/1440px DOM 치수](flow/browser-public-render.json), [제출](flow/browser-submitted.json), [설명 개정](flow/browser-revision.json), [새 게시본](flow/browser-new-public-version.json), [기존 응답 정정](flow/browser-correction.json)을 확인했다.
- 독립DB [제출](flow/verify-submission.json)/[정정](flow/verify-correction.json)에서1응답·정정1·최초 폼v1 설명·암호화 답변·영수증 해시를 대조했다. [실제 브라우저 PDF 다운로드](flow/browser-receipt-download.json)42,246바이트 SHA256은 정정 전 영수증과 동일하다.
- [서버 재시작](flow/restart.json) PID2393→6693, [DB 지문](flow/verify.json)과 [새 게시본 브라우저](flow/browser-after-restart.json) 일치. 폼1/게시버전2/응답1/정정1/감사17. 기존 [14개 고정 검증 데이터](frozen-fixtures-after-restart/summary.json)도 유지된다.
- [TypeScript](typecheck.log), [추가 동시성 파일 타입 검사](typecheck-concurrency.log), [ESLint](lint.log), [추가 파일 ESLint](lint-concurrency.log), [production build](build.log), [OpenAPI311경로/필드8곳](openapi-check.json), [계획 검사](plan-check.log) 통과. [프런트 정적 검토](frontend-review.json)도 보존했다.

## 남은 범위

전체 화면 스크린샷 시각 검증과 스크린리더 실측은 하지 못했다. DOM 치수 검사를 이미지 동등성으로 간주하지 않는다. 개인정보 분류/NLP 집계, 참고 LINK/FILE·이미지, 기타 답변, 패턴, 여러 페이지, 전체 번역 및 R08 전수상태 수용은 후속 범위다. 참고 자료 LINK는 별도 사전 계획부터 진행한다.
