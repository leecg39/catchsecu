# A07 작성자 자산 내용 검증기

구현 담당은 `author-asset-validation.ts`, 전용 시험과 `tests/fixtures/author-assets/`만 변경한다. 이 문서 작성 시 시험·DB·브라우저·빌드는 실행하지 않았다. ClamAV, 업로드 권한, 저장, 참조, quota는 업로드 백엔드가 담당한다. 검증기는 입력 바이트를 변경하거나 파일·네트워크를 읽고 쓰지 않는다.

## 함수와 오류 계약

```ts
validateAuthorAssetName(name: string, purpose: AuthorAssetPurpose): AuthorAssetMime
validateAuthorAssetBytes(bytes: Buffer, meta: {
  name: string; purpose: AuthorAssetPurpose; size: number;
  sha256: string; mime: string;
}): Promise<void>
```

기존 `contracts/author-assets.ts`의 이름 schema, 용도별 크기, canonical MIME helper를 재사용한다. AI의 선언 MIME은 PDF 기반 파일이어도 `application/postscript`이며 JPEG는 `image/jpeg`다. 원본 이름·파일·EXIF를 그대로 보존한다. 이름 255 UTF-16, C0/C1·경로 구분자·잘못된 Unicode 거절은 원본 서버 상한이 아닌 독립 계약이다.

| 상태/코드 | 조건 |
| --- | --- |
| 422 `AUTHOR_ASSET_NAME` | 유효하지 않은 이름 |
| 415 `AUTHOR_ASSET_TYPE` | 용도/확장자/MIME 불일치 |
| 413 `AUTHOR_ASSET_SIZE` | 빈 파일 또는 용도별 1/5 MiB 초과 |
| 422 `AUTHOR_ASSET_INTEGRITY` | 선언 size/SHA-256 불일치 |
| 422 `AUTHOR_ASSET_CONTENT` | 서명·구조·CRC·XML·decode 실패 |
| 413 `AUTHOR_ASSET_COMPLEXITY` | 아래 자원/지원 범위 상한 초과 |
| 503 `AUTHOR_ASSET_VALIDATION_BUSY` | 현재 프로세스에서 이미지 디코드 2개가 이미 실행 중; 재시도 가능 |

실패 메시지는 고정 문구다. parser 오류나 파일 내용을 응답에 넣지 않는다. 백신 실패를 이 검증기의 성공으로 덮어쓰지 않으며, 백엔드는 검증 후 별도로 ClamAV clean을 요구한다.

## 숫자로 제한한 처리 범위

| 처리 | 상한/정책 |
| --- | --- |
| 입력 | 자료 5,242,880 bytes, 보기 이미지 1,048,576 bytes; 경계값 허용 |
| ZIP | 단일 disk, ZIP32, store/deflate, 512 entries; 암호화/ZIP64/분할/self-extracting/padding/중복 경로/심볼릭 링크 거절 |
| ZIP 해제 | entry 16 MiB, 합계 32 MiB; entry 해제량은 `max(1 MiB, compressedSize × 200)` 이하 |
| XML | entry 4 MiB, 전체 XML 8 MiB, 문서당 markup 50,000개·깊이128; DTD/ENTITY 금지 |
| 이미지 | JPEG/정적 PNG만, 축당8,192px·8,388,608 pixels·4 channels·1 frame 이하 |
| PNG metadata | chunk 최대2,048개. 압축된 text/ICC/iTXt는 native metadata 읽기 전에 entry1 MiB/합계2 MiB로 제한하여 별도 해제 검사 |
| 이미지 처리 | sharp `failOn: warning`, `unlimited:false`, `limitInputPixels`, `limitInputChannels:4`; 실제 raw decode 결과는 폐기. libvips processing timeout 3초 |
| 프로세스 동시성 | 활성 이미지 decode 최대2개, 내부 대기열 없음. 초과는 503으로 재시도 |

정적 PNG만 지원하며 APNG는 명시 거절한다. 이 추가 지원 범위/자원 상한은 원본에서 관측한 한계가 아니다. sharp timeout은 libuv 대기 시간을 포함한 강제 wall-clock kill이 아니므로 전체 요청 시간 상한을 보장한다고 주장하지 않는다. 2개 활성 제한과 입력/픽셀 상한을 함께 둔다.

## 내용별 검사

- PDF: `%PDF-1.x`/`%PDF-2.0` 시작, 마지막 1,024bytes의 `%%EOF` 및 뒤의 공백을 확인한다. 전체 PDF 의미 분석·스크립트 제거·안전 렌더러라는 주장은 하지 않는다.
- AI: PDF-compatible 또는 `%!PS-Adobe-` 시작과 `%%EOF` 끝을 확인한다. PostScript 실행·렌더링·완전한 Illustrator 의미 검증은 하지 않는다. 다운로드는 별도 백엔드에서 attachment로 고정한다.
- DOCX: 중앙 디렉터리와 모든 local header 이름/flags/method/CRC/크기를 대조한다. descriptor 사용 시 optional signature와 CRC/크기까지 대조한다. 원래 순서가 다른 중앙 directory는 허용하되 local records의 빈틈·겹침은 거절한다. 실제 inflate 결과의 길이/CRC와 선언 크기를 대조한다. 내장 zlib의 `maxOutputLength`로 거짓 선언에 따른 과대 할당을 차단한다.
- DOCX XML: UTF-8/UTF-16 BOM/선언을 허용하고 모든 XML/relationship을 한정된 parser로 읽는다. package content-types, root relationship의 officeDocument, `word/document.xml`의 WordprocessingML document/body를 확인한다. macro-enabled/vba/ActiveX 표시를 거절한다. 정상 external hyperlink relationship 자체는 허용하며 해석하거나 fetch하지 않는다. 전체 OOXML schema 유효성 검증을 주장하지 않는다.
- PNG: signature/IHDR/IDAT/IEND, chunk boundary/CRC, APNG 금지를 확인하고 실제 디코드한다. JPEG는 SOI/EOI와 실제 디코드를 확인한다. EXIF/ICC를 원본에서 제거하지 않는다.

## 문서와 의존성

- 로컬 `sharp@0.35.5`의 `lib/index.d.ts`, `dist/constructor.mjs`, 공식 [constructor](https://sharp.pixelplumbing.com/api-constructor/), [timeout](https://sharp.pixelplumbing.com/api-output/#timeout)을 확인했다. root에게 direct `sharp: 0.35.5` 고정을 요청했다.
- [Node zlib](https://nodejs.org/docs/latest-v22.x/api/zlib.html)의 bounded inflate와 CRC를 사용한다. 기존 `fflate@0.8.3`의 고정 출력 버퍼는 초과 내용을 자르므로 이 검증에 사용하지 않으며 direct dependency 추가도 요청하지 않았다.
- 기존 direct `@xmldom/xmldom@0.8.15`의 local type/docs를 재사용한다. 오류/경고 handler를 엄격하게 처리하고 파싱 전에 DTD/ENTITY 및 복잡도 상한을 검사한다.
- ZIP32 헤더/descriptor/CRC는 [PKWARE APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT), DOCX 부품과 본문 구조는 [Microsoft Open XML 문서](https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document)를 대조했다. 이 구현은 기본 `word/document.xml` main-part 배치를 지원하며 모든 OOXML 변형을 지원한다고 주장하지 않는다.
- 저장소 AGENTS가 지정한 Next route handler 문서를 읽었다. 이번 파일은 Node 서버 모듈이고 새 route를 만들지 않는다.

## root 실행용 검증

전용 시험은 정상 PDF·PDF/PS AI·DOCX(압축/비압축/descriptor, 외부 링크, UTF-16 XML)·PNG/JPEG/EXIF 원문 보존, 각종 위조·압축 과장·CRC/경로/헤더·XXE/깊이·픽셀·상한·MIME/hash·이름을 포함한다. fixture는 로컬 작성한 최소 문서/이미지이며 실제 외부 고객 자료를 포함하지 않는다. 라이브 ClamAV와 실제 Office/Illustrator 작성 파일의 호환성은 root 통합 검증으로 별도 확인한다. 시험 통과 전 완료로 표시하지 않는다.
