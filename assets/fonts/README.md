# PDF 한국어 글꼴

Noto Sans CJK KR Regular. 공식 저장소 고정 commit f8d157532fbfaeda587e826d4cd5b21a49186f7c의 글꼴을 포함한다. OFL.txt 라이선스를 함께 배포한다.

출처: https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/OTF/Korean/NotoSansCJKkr-Regular.otf

## 다국어 PDF 렌더러 v2

기존 글꼴로 지원되던 문서는 계속 렌더러 v1을 사용한다. 새 문자 지원이 필요한 문서만
Noto Sans, Noto Sans Arabic, Noto Sans Thai와 기존 CJK 글꼴을 함께 사용한다.
각 static Regular TTF는 공식 Noto 저장소의 고정 릴리스에서 추출했고, 각 글꼴의 OFL을 함께 배포한다.
릴리스 URL, 태그, 커밋, 아카이브 내부 경로, 아카이브/개별 파일 SHA-256은 `pdf-v2-manifest.json`에 기록했다.
서버는 실제 글꼴 바이트의 해시를 검사하고, 네 글꼴의 family/file/SHA-256 배열에 대한 해시를 v2 `fontHash`로 사용한다.
시스템 글꼴 또는 실행 시 외부 글꼴 다운로드는 사용하지 않는다.

| 글꼴 | 고정 릴리스 | 라이선스 |
| --- | --- | --- |
| Noto Sans | [v2.015](https://github.com/notofonts/latin-greek-cyrillic/releases/tag/NotoSans-v2.015) | NotoSans-OFL.txt |
| Noto Sans Arabic | [v2.013](https://github.com/notofonts/arabic/releases/tag/NotoSansArabic-v2.013) | NotoSansArabic-OFL.txt |
| Noto Sans Thai | [v2.002](https://github.com/notofonts/thai/releases/tag/NotoSansThai-v2.002) | NotoSansThai-OFL.txt |

v2 레이아웃은 PDFKit 0.20.2/fontkit 2.0.4의 shaping, bidi-js 1.1.0(Unicode 13)의
양방향 처리, linebreak 1.1.0과 실행 Node의 ICU Thai word segmentation을 사용한다.
문단은 입력의 방향 제어 문자를 보존하고 원문에 LTR 격리를 임의로 삽입하지 않는다.
논리 원문은 각 줄의 PDF `/ActualText`에 저장한다. PDF.js 6.3.289는 이를 텍스트 추출에
사용하지 않아 일부 Arabic 결합 문자/중립 문자 추출 순서를 바꾸므로, 모든 PDF 뷰어의
복사·검색 결과가 동일하다고 보장하지 않는다. 실제 글리프 배치와 표준 원문 보존은 별도로 검증한다.

자원 제한: 본문 500,000 UTF-16 단위, 250페이지, 16MiB, 한 grapheme 256단위,
한 번에 shaping하는 줄 8,192단위. 문서의 문단 전처리 및 실제 줄 후보 측정의
UTF-16 단위를 누적하여 2,000,000을 넘으면 `PDF_TOO_COMPLEX`로 원자적으로 거절한다.
shaping 메모는 한 문단당 key 65,536단위로 제한하며, PDFKit에 전달할 때 위치 배열을 복사한다.
원문 길이와 별도로 계산 비용을 제한하므로 최대 길이 이하인 복잡한 입력도 거절될 수 있다.

기존 동의 증거 JSON/해시와 저장 PDF bytes는 변경하지 않는다. 문서 PDF는 DB의
rendererVersion/fontHash에 v2 메타데이터를 저장하고, 동의 영수증은 저장 PDF 안의 Creator/Keywords에
렌더러·글꼴·Node/ICU 버전을 기록한다. 다운로드는 해당 저장 bytes를 반환한다.
