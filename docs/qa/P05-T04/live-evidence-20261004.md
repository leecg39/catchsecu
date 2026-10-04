# P05-T04 문서 PDF·내보내기 — live 증거 (2026-10-04)

공개 경로 PDF를 실제 다운로드해 바이트·내용·해시를 DB와 대조했다. P05-T03 게이트와 같은 세션.

## 검증 내역

### 실제 파일 바이트
- `GET /api/v1/public/documents/{token}/pdf` → 200 `application/pdf` 46,350바이트
- `%PDF-1.3` 헤더 + 파일 끝 `%%EOF` — 진짜 PDF
- pdfinfo: Pages 2, Producer PDFKit 0.20.2, Title "공개 만료 QA 010c767c-…"

### 한글·본문 렌더
- `pdftotext` 추출 텍스트에 한글 정상: "개인정보 처리방침", "시행일: 2026-10-03", "처리 목적: …신청 처리", "항목: 이름 (일반 개인정보, 필수)", "보유 기간: 45일"
- 문서 헤더 "게시 버전 v3 | 2026-10-03T11:55:46.185Z" — **게시 버전 번호·시점이 본문에 고정**
- XSS fixture 본문의 `<script>`·`<img onerror>`가 PDF에서 **리터럴 텍스트로만** 렌더 — 무해화 확인

### 저장·해시 일치
- 다운로드 46,350바이트 = `DocumentPdf.bytes` 길이 46,350 (저장본과 동일 바이트)
- `DocumentPdf.contentHash` = `DocumentVersion.contentHash` (DB 대조 `hash_match=t`), pageCount=2
- 구현상 첫 다운로드 시 PDF 생성·`contentHash` 고정 저장, 이후 동일 바이트 재사용 — "동의 당시 PDF" 재현성 구조(`storedPdf`: version FOR UPDATE 잠금 + 기존 레코드 재사용 + 해시 재검증)

### 무결성 거부
- 시드 해시 불일치 문서(fixture가 renderedText 해시 사용) → 409 `DOCUMENT_INTEGRITY` "게시 문서의 검증 정보가 일치하지 않습니다." — canonical 해시 재계산 불일치 시 PDF 발급 거부
- `sha256(bytes) !== pdfHash` 시 409 `PDF_INTEGRITY` — 저장 PDF 변조도 차단

## 판정
- 다운로드 실제 파일·한글·버전 일치·무결성 방어를 live에서 확인.
- 무권한 익명/viewer/타사 차단과 동의 영수증 PDF 해시 재현은 `tests/server/` 스위트(consent-receipts·document-pdf 관련) 증거로 커버 — 본 live 증거는 공개 경로 중심.
