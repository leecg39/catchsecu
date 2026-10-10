# BI-06 rich 동의 증거와 PDF 영수증 v2

2026-10-10에 BI-06을 구현하고 `catchsecu_test` PostgreSQL, 실제 ClamAV, PDF.js, Ego Lite 브라우저에서 검증했다. 이 체크포인트는 rich 폼의 동의 영수증을 닫은 결과이며 BI-07과 R08-T02 전체 수용, 전체 107개 작업의 완료를 뜻하지 않는다.

## 구현 범위

- 기존 평문 폼의 `ConsentEvidenceV1`과 저장된 PDF 읽기를 그대로 유지한다.
- 본문 rich 문서 또는 페이지가 있는 새 폼은 `ConsentEvidenceV2`를 사용한다.
- 증거 v2에는 루트 본문, 실제 방문 페이지의 평문과 rich 문서, 방문 page ID, 종료 단계, 이미지 자산 ID·용도·표시 메타데이터를 넣는다.
- 완료 및 마감 안내는 제출 전 동의 화면에 제시된 본문이 아니므로 증거와 PDF에서 제외한다.
- 각 이미지는 게시 버전의 ready/clean 자산만 읽는다. 저장된 원본 크기와 SHA-256을 확인한 뒤 제한된 PNG로 변환하고 원본 hash와 PDF 변환 hash를 별도로 기록한다.
- 서버는 원격 이미지 URL이나 현재 초안을 가져오지 않는다. 게시 버전의 암호화 저장 bytes만 사용한다.
- 전체 해독 예산은 96 MiPixels, 변환 이미지 합계는 16 MiB, 단일 이미지는 24 MiPixels·한 변 16,384px다. PDF는 기존 v2 렌더러의 250페이지·16 MiB 제한을 유지한다.
- 게시 및 승인 전에 모든 페이지를 포함한 가장 큰 동의 조합을 렌더링한다. 상한 초과 시 게시 트랜잭션을 롤백한다.
- 제출 시 완성된 PDF bytes를 암호화 저장한다. 다운로드는 PDF를 다시 만들지 않고 저장된 bytes와 hash를 검증해 반환한다.
- 응답 정정으로 방문 경로가 바뀌어도 기존 증거 암호문, 문서 hash, PDF 암호문과 PDF hash는 바뀌지 않는다.

## 자동 검증

관련 7개 시험 파일에서 68개 시험이 통과했다.

| 범위 | 시험 |
|---|---:|
| rich v2 실제 자산·분기·정정·상한 | 3 |
| 다국어 PDF v2와 고정 출력 | 19 |
| 기존 v1 동의 문서·영수증 | 18 |
| 페이지 저장 | 7 |
| 공개 제출 상태 | 6 |
| 공개 제출 gate | 10 |
| 페이지 분기·정정 | 5 |

집중 시험은 두 분기 중 실제 방문 페이지의 문서와 이미지만 증거에 들어가는지, 게시 preflight가 두 분기의 최대 조합을 읽는지, 25개의 2,048×2,048 이미지 배치가 96 MiPixels 상한에서 게시를 롤백하는지 확인한다. PDF.js로 실제 PDF의 텍스트와 이미지 연산자 2개를 읽었고, 다국어 PDF 회귀 19개로 기존 고정 bytes가 바뀌지 않았음을 확인했다.

전체 TypeScript, 관련 ESLint, Prisma schema, 계획 107작업·186원본 경로, API 계약 323경로·458작업·45정책, `git diff --check`, production build 82페이지가 통과했다.

## 마이그레이션과 기존 v1 보존

임시 PostgreSQL schema 두 개에서 빈 설치와 업그레이드를 실제로 실행했다.

- 빈 설치: migration 139개를 적용하고 완전한 v2 FormVersion·ConsentReceipt를 저장했다.
- 잘못된 v2: PDF 암호문이 없는 v2 receipt를 CHECK가 SQLSTATE 23514로 거절했다.
- 업그레이드: migration 138 상태에서 실제 암호화한 v1 증거와 PDF bytes를 저장한 뒤 139로 올렸다.
- 업그레이드 전후 v1 증거 암호문, PDF 암호문, 복호화 PDF bytes, 문서 hash, PDF hash가 모두 같았다.
- 문서 동의 binding guard가 v1과 v2를 허용하는지 함수 본문도 대조했다.
- 현재 `catchsecu_test`의 예상하지 않은 schema 차이는 0이고, 기존 SQL-only FK 1개만 의도된 차이로 남는다.

- [빈 설치·138→139 업그레이드](migration-install-final.json)
- [현재 DB 스키마 계약](schema-current/catchsecu_test-contract.json)
- [예상 SQL-only 차이](schema-current/catchsecu_test-checked-diff.sql)

## 실제 Ego Lite·PostgreSQL·PDF 검증

localhost:3114의 새 격리 회사와 합성 계정에서 다음 흐름을 실행했다.

1. 루트와 두 번째 페이지에 서로 다른 PNG를 연결했다. 두 파일은 실제 ClamAV 검사를 통과했다.
2. 2페이지 폼을 게시하고 Ego Lite에서 각 페이지 질문을 입력했다.
3. 동의 단계에서 필수 동의를 선택하고 응답을 제출했다.
4. 완료 화면에 게시 버전의 완료 안내와 접수 번호가 표시됐다.
5. 관리자 응답 상세에서 `증거 v2`, 고정 본문 3개, 이미지 2개, 실제 방문 page ID 2개, 동의 단계와 두 hash가 표시됐다.
6. PDF 다운로드 버튼이 실제 `GET /submissions/{id}/receipts/{receiptId}/pdf` 200을 반환해 macOS 저장 대화상자까지 도달했다. 검증용 추가 파일 저장은 취소했다.
7. DB의 암호화 PDF를 복호화한 56,669바이트와 권한 경계를 통과한 다운로드 bytes가 정확히 같았다. SHA-256은 `24e71a0a17d572cce95cc586957225850027f24f1059156b4510516b7f5b5899`다.
8. PDF는 2페이지이고 PDF.js 이미지 연산자는 2개다. 루트·페이지 문구는 추출됐고 완료·마감 문구는 증거와 PDF 모두에 없었다.

- [브라우저 준비 기록](browser/prepare.json)
- [브라우저·DB·PDF 대조](browser/browser-db.json)
- [실제 저장 PDF 사본](browser/receipt-v2-browser.pdf)
- [최종 검증 요약](verification-final.json)

공개 token과 합성 계정 비밀번호는 ignored `.local/rea-fullstack/rich-receipt-v2/fixture.json`에만 저장했다. 문서 증거에는 포함하지 않았다.

## 남은 범위

다음 실행 단위는 BI-07a 전체 4슬롯 수명주기와 BI-07b 3폭·RTL·키보드·지연/실패·재시작 수용이다. 외부 공급자 계정이나 승인은 BI-06 내부 검증에 필요하지 않았다. 전체 목표는 active이며 공식 완료0·진행53·계획54를 유지한다.
