# 게시 문서 PDF 검증

2026-10-03. 로컬 PostgreSQL·Ego·합성 문서로 검증했다. 전체 181개 경로 구현은 계속 진행 중이다.

## 구현

- 게시 버전의 고정 본문과 SHA-256을 한국어 PDF로 렌더링한다. Noto Sans CJK KR 글꼴을 포함하여 설치된 시스템 글꼴에 의존하지 않는다.
- 최초 파일의 바이트·PDF 해시·본문 해시·페이지 수·렌더러/글꼴 버전을 DocumentPdf에 저장한다. DB는 버전/서비스 연결, 파일 시그니처·해시 및 변경/삭제 금지를 검사한다.
- 문서 버전 목록과 공개 문서에서 다운로드한다. 내부 요청은 현재 회사·역할·서비스 권한을, 공개 요청은 현재 회사/서비스/문서/링크·만료를 검사한다. 회수·보관 후에도 권한 있는 관리자는 게시 당시 파일을 볼 수 있다.
- 오류는 화면에 표시하며 JSON 오류를 PDF 파일로 저장하지 않는다. 응답은 attachment, no-store, nosniff와 본문/PDF 해시 헤더를 포함한다.

## 확인한 결과

| 확인 항목 | 결과 |
|---|---|
| 전체 실제 DB 테스트 | **180/180 통과**, PDF 10개 포함. [로그](tests-final.log) |
| PDF 파서 검사 | PDF.js로 실제 페이지 수·한글·전체 본문·스크립트/첨부 부재 확인. 바닥글만 있는 페이지 0 |
| DB/파일 대조 | 브라우저 파일 4개가 DB 바이트·SHA-256과 동일. Poppler로 전체 본문·버전·해시·한글 글꼴 포함을 독립 확인. [결과](file-verification.json) |
| Ego 다운로드 | 내부 v1/v3와 공개 v3, 90개 문단의 여러 페이지 문서. [다운로드 결과](browser-downloads.json) |
| 다시 받기 | 내부/공개 v3 해시 동일. 서버 재시작 후 공개 v3 바이트 동일. [재시작 결과](browser-restart.json) |
| 경합·권한 | 동시 최초 다운로드 1개 생성, 타회사/타서비스·권한 회수·만료/회수 링크 차단, DB 파일 변조 거부 |
| 타입·린트·빌드 | 오류 0. 린트 기존 경고 21. [타입](typecheck-final.log), [린트](lint-final.log), [빌드](build-final.log) |
| 배포용 글꼴 | 두 다운로드 경로에 글꼴과 라이선스 포함. [추적 결과](build-font-trace.json) |
| 모바일 | 공개 문서 390px에서 페이지 넘침 없음. [화면](browser-public-mobile.png) |

## 결과 파일

- [초기 게시 v1 PDF](browser-document-v1.pdf) / [렌더 이미지](render-v1.png)
- [개정 v3 PDF](browser-document-v3.pdf)
- [여러 페이지 PDF](browser-multipage.pdf) / [마지막 페이지](render-multipage-last.png)
- [수정한 바닥글 오류와 기존 시험 파일 보존 기록](before-footer-fix/README.md)

본문은 일반 텍스트이다. 지원하지 않는 글자, 50만 자·250페이지·16MB 한도를 넘는 PDF는 명시적 오류로 거부하며 파일을 저장하지 않는다. HTML·외부 URL·이미지를 실행하거나 가져오지 않는다.

폼의 문서 선택·동의 당시 영수증 PDF 연결은 [다음 계획](../form-documents/PLAN.md)에 남아 있다. P05-T04의 부분 증거이며 전체 Task 완료로 집계하지 않는다.

재실행: `npm test`, `npm run typecheck`, `npm run lint`, `ALLOW_LOCAL_MAIL=1 npm run build`. 독립 파일 대조: `node --env-file=.env.local --import tsx scripts/qa-document-pdf.ts` (로컬 Poppler 필요).

구현 자료: [PDFKit](https://pdfkit.org/docs/getting_started.html), [글꼴 포함](https://pdfkit.org/docs/text.html), [고정한 Noto CJK 출처·라이선스](../../../assets/fonts/README.md), [PDF.js 파일 검사 예제](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs).
