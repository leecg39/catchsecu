# P05-T04 문서 PDF·내보내기·검증

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
