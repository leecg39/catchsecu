# P05-T04 문서 PDF·내보내기·검증

> 2026-10-04: 실제 부분 구현을 근거로 planned에서 in_progress로 정정했다. 전체 완료는 아니다. [근거](../status-revalidation/README.md).

> **완료 판정 정정 (2026-10-04): 미완료.** 0934f4e의 일괄 완료 표시는 수용 조건의 증거를 충족하지 못해 철회했다. 아래 구현·시험 주장은 각 실제 파일/실행 결과와 다시 대조한다. 테스트 파일의 존재는 실행 통과나 브라우저/외부 연동 완료를 뜻하지 않는다. [재검증 계획](../../planning/05-completion-recovery.md).

## 개요

게시된 문서의 서버 PDF 렌더링, 버전별 불변 다운로드, 무결성 해시 검증 및 다운로드 감사 로그를 구현한다.

## 구현 내용

1. **엔드포인트**:
   - `GET /api/v1/documents/[id]/versions/[number]/pdf`: 관리자용 버전별 PDF 다운로드
   - `GET /api/v1/public/documents/[token]/pdf`: 공개 문서 토큰 기반 PDF 다운로드
2. **렌더링 및 무결성**:
   - PDFKit + NotoSans 한글 폰트(`PDF_FONT_HASH`) 적용
   - `DocumentPdf` 테이블에 PDF 바이트 및 해시 영속화
   - `pdfHash`와 `contentHash` 무결성 검증 (`DOCUMENT_INTEGRITY`, `PDF_INTEGRITY`)
   - 버전 개정 및 공개 취소 후에도 이전 버전 PDF 바이트는 불변 보존
3. **보안 및 감사**:
   - 현재 테넌트, 서비스 grant, 멤버십 상태 확인
   - `document.pdf_downloaded` 감사 이벤트 기록

## 검증 내역

- 테스트 스위트: `tests/server/document-pdf.test.ts`
- 주요 검증 항목:
  - 실제 PDF 바이트 생성 (`%PDF-` 헤더 및 한글 텍스트)
  - PDF.js 파서로 파싱 및 텍스트/해시 대조
  - 관리자 및 공개 경로를 통한 동일 바이트 다운로드
  - 개정 후 구 버전의 바이트 불변성 보존
  - 무권한(anonymous/viewer/다른 회사) 접근 차단
  - 감사 로그 기록 확인

후속: [live PDF 증거 2026-10-04](live-evidence-20261004.md). 실제 PDF 46,350바이트(%PDF-1.3·%%EOF·PDFKit·2페이지), pdftotext 한글·버전 v3 본문 고정·XSS 리터럴 무해화, 다운로드=저장 바이트·contentHash 일치, 해시 불일치 문서 409 거부 확인.
