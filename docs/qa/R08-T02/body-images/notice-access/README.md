# BI-05c 완료·마감 편집과 읽기 권한

2026-10-10에 BI-05c를 구현하고 `catchsecu_test` PostgreSQL과 Ego Lite 실제 브라우저에서 검증했다. 이 체크포인트는 완료·마감 안내와 네 가지 읽기 surface를 닫은 결과이며 R08-T02 또는 전체 107개 작업의 완료를 뜻하지 않는다.

## 구현 범위

- 폼 편집기에 완료 안내와 마감 안내의 기본/직접 작성 모드, rich text, 소유 이미지를 연결했다.
- 정상 제출 응답은 정확한 게시본의 완료 안내와 30분 수명의 암호화된 읽기 증명을 반환한다.
- 활성, 완료, 마감 surface의 자산 manifest와 byte 읽기를 분리했다. 서로 다른 surface의 이미지는 노출하지 않는다.
- 일시중지, 기간 종료, 응답 한도 도달은 마감 안내만 반환한다. 회수, 보관, 삭제, 비활성 회사/서비스는 기존 비공개 오류를 유지한다.
- 선택 공유 viewer는 선택한 질문과 그 질문이 속한 페이지 안내만 읽는다. 폼 본문은 `shareFormBody=true`를 명시한 grant에서만 읽는다.
- 공유 생성/수정 감사에는 `shareFormBody` 변경 필드를 기록한다.

## 자동 검증

관련 9개 시험 파일에서 83개 시험이 통과했다.

| 범위 | 시험 |
|---|---:|
| 완료·마감·viewer 4-surface 통합 | 16 |
| 작성자 자산 읽기 경계 | 8 |
| 외부 공유 권한·감사 | 22 |
| 페이지/안내 저장 | 7 |
| 공개 제출 상태 | 6 |
| 공개 제출 gate | 10 |
| 자산 API/OpenAPI 계약 | 14 |

검증에는 활성/완료/마감/viewer manifest와 실제 byte hash, 응답 한도·일시중지·기간 종료·토큰 회수, 선택하지 않은 질문·페이지·본문 비노출, 완료 증명과 게시본 결합, 회수 경합이 포함된다. 공유 회수는 이미 잠금을 얻어 승인된 읽기를 완료한 뒤 적용되며, 회수 이후 새 읽기는 거절한다.

전체 typecheck와 관련 ESLint, OpenAPI 323경로, 계획 107작업/186원본 경로/21부가 경로, diff check가 통과했다. 로컬 메일·카카오·결제 어댑터를 명시적으로 허용한 production build에서 82개 페이지 생성이 통과했다. 이 허용 플래그는 검증 프로세스에만 사용했으며 운영 provider gate를 바꾸지 않았다.

## 실제 PostgreSQL·브라우저 검증

Ego Lite에서 다음 흐름을 실제로 실행했다.

1. 합성 소유자 계정으로 로그인하고 완료·마감 안내를 직접 작성 모드로 변경했다.
2. 각 안내에 서로 다른 PNG를 업로드하고 대체 텍스트를 저장했다. 두 파일 모두 실제 ClamAV 검사를 통과했다.
3. 폼을 게시했다. 활성 공개 화면에는 질문만 보이고 완료·마감 안내는 보이지 않았다.
4. 공개 응답을 제출했다. 영수증 화면에는 정확한 완료 문구와 파란 이미지가 보였다.
5. 관리자 화면에서 폼을 일시중지했다. 같은 공개 URL은 질문과 제출 UI를 숨기고 마감 문구와 주황 이미지만 표시했다.
6. DB에서 폼 version 11, 활성 상태로 고정된 게시본, 응답 1건, `END_PAGE_CONTENT_IMAGE`와 `PRIVATE_PAGE_CONTENT_IMAGE`의 clean 자산 및 각 pin 1개를 대조했다.
7. production HTTP에서 마감 DTO가 질문·완료 안내를 내보내지 않는지 확인했다. 마감 manifest의 한 자산과 실제 PNG 4,787바이트 SHA-256가 일치했고, 일시중지 후 active surface는 410으로 거절됐다.

- [브라우저 준비 기록](browser/prepare.json)
- [브라우저·DB 대조](browser/browser-db.json)
- [마감 production HTTP·byte 대조](browser/closed-http.json)
- [현재 test DB 스키마 계약](schema/catchsecu_test-contract.json)
- [예상 SQL-only 차이](schema/catchsecu_test-checked-diff.sql)
- [최종 검증 요약](verification-final.json)

## 남은 범위

다음 실행 단위는 BI-06 rich 완료/영수증/PDF 증거 v2와 과거 증거 호환이다. 이후 BI-07 전체 상태·복제·템플릿·승인·게시 이력·접근성·성능 수용을 수행한다. 실제 외부 공급자 자격증명은 BI-05c 내부 검증에 필요하지 않았다.
