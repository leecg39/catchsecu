# BI-07 본문 이미지 전체 수용

상태: **통과**. 신규 격리 회사와 폼에서 폼 본문·페이지·완료·마감의 네 rich 문서 이미지 수명주기, 반응형·RTL·키보드, 장애 회귀, production 재시작과 기존 frozen fixture 보존을 확인했다.

## 실제 수명주기

- Ego Lite에서 JPEG/PNG 4개를 실제 HTTP 업로드와 ClamAV 검사로 준비하고, 각 문서에 서로 다른 alt·caption·정렬·폭과 RTL 문단을 저장했다.
- 게시본은 문서 4개·검사 완료 자산 4개를 가졌고 폼 복제 2개는 독립 소유 자산을 만들었다. 템플릿 생성·수정·사용·삭제 후 사용한 폼의 자산은 유지됐다.
- 실제 공개 2페이지 흐름을 제출했다. 증거 v2는 방문한 루트/페이지 이미지 2개만 포함했고 완료·마감 이미지는 제외했다. 저장 PDF 해시는 `1e6ab8496953d53cbd41c0ea1b6d1e98797d173211756d0918c6af4f8da03593`다.
- 원본 게시본의 이미지 4개를 제거해 개정·재게시했다. 원본 버전·pin·기존 영수증/PDF는 그대로였고 개정본 이미지는 0개였다.
- 별도 반응형 복제 폼에서 active·completion·closed 표시를 실제로 확인하고 일시중지 후 재개했다.

## 접근성·화면

- 390×844, 768×1024, 1440×900에서 문서 너비와 viewport 너비가 같아 가로 넘침이 없었다.
- 390px에서 75% 루트 이미지 227px, 50% 페이지 이미지 151px, 50% 마감 이미지 151px로 렌더됐다.
- 계산된 문서 방향은 RTL이었다. Tab 순서는 첫 입력 필드에서 다음 페이지 버튼으로 이동했다.

## 실패·재시작·호환성

- 업로드/이미지 표시 지연·실패 관련 서버 시험 2파일 22개가 통과했다. 공개 이미지 URL에 현재 허가 surface가 포함되는 실제 계약에 맞춰 회귀 기대값 1개를 수정했다.
- production build는 82페이지를 생성했다. 재시작 뒤 고정 해시 `7049fafdf24317fcbf9c853915588cda9837a653c37e8afc8cbf422d230e267f`가 다시 일치했다.
- 기존 19개 frozen verify와 질문 이미지 수명주기 1개가 모두 통과했다. migration 125~139의 새 nullable/default 필드는 중립값임을 먼저 단언한 뒤 기존 해시 입력에서만 제외했다. baseline과 fixture는 수정하지 않았다.

## 증거

- [최종 게이트 요약](verification-final.json)
- [원본 게시본](capture-original.json)
- [실제 제출·영수증](capture-submission.json)
- [개정 이력](history.json)
- [반응형·RTL·키보드](responsive-browser.json)
- [재시작 고정 해시](verify.json)
- [기존 fixture 20/20](legacy-preservation.json)
- [장애 회귀 로그](delay-failure-tests.log)
- [production build 로그](production-build.log)

공개 토큰·쿠키·업로드 원본은 ignored `.local`에만 저장했다. 외부 공급자 자격증명은 이 수용 범위에 필요하지 않았으며 원본 서버의 내부 sanitizer·자산 보존 구현과 wire 동등성은 주장하지 않는다.
