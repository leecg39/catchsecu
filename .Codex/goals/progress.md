# 구현 진행 현황

P00-T04까지 완료. 마지막 갱신: 2026-10-03.

## 전체 구현 진행률: 9.7% (7/72)

기존 UI 클론 완료 항목은 서버 구현 완료로 집계하지 않는다. 외부 미검증과 진행 중 항목은 완료에 포함하지 않는다.

| 마일스톤 | 완료/전체 | 상태 |
|---|---:|---|
| M1 | 7/14 | 진행 중 |
| M2 | 0/14 | 대기 |
| M3 | 0/11 | 대기 |
| M4 | 0/15 | 대기 |
| M5 | 0/13 | 대기 |
| M6 | 0/5 | 대기 |

## 현재 작업

- P01-T03 완료. 다음은 P01-T04 outbox 경합·재시작이다. 아래 항목은 게이트 전 부분 구현이다.
- P13-T01: 공지·가이드/PDF·문의/개선 제안·공지 첨부 부분 구현. 원본 화면 대조와 전체 수용 게이트 미완료
- P03-T02/P13-T02: 서비스 접근 요청/승인과 전문가 배정·회사 선택·회수, 빈 권한·접근 오류 화면·로딩 상태 연결. 원본 배정 화면 대조·전체 브라우저 게이트 미완료
- P12-T01: 감사 조회 API·역할/서비스 범위·마스킹과 10개 로그 화면을 실제 데이터에 연결. 동일 필터 CSV·성공 다운로드 감사, CSV 가져오기/문의 민감 열람 감사, 종료 시각 경계와 DB 불변 트리거 검증 완료. 전체 이벤트 수집·운영 보존·브라우저 게이트 미완료
- P12-T02: 대시보드·개인정보 상세의 실제 폼/문서/보유 응답/기간별 파기, 마케팅 동의 변경·실제 수신 차단 집계와 서비스·기간 필터 연결. 한국 시간 월 경계를 검증하고 준수 화면의 임의 점수·과태료·데모 다운로드를 제거. 전체 PostgreSQL 407건, production 빌드, 7경로 HTTP/독립 DB 대조, 로컬 headless Chromium 통과. 원장·월마감·준수 판정·원본 브라우저 게이트 미완료
- P10-T05: `/pay/history`의 무료 체험 이력을 실제 구독 DB에 연결. 한국 시간 월 필터·페이지, 회사/역할 격리, 미승인 구매 요청 제외. 전체 PostgreSQL 408건·production 빌드·독립 DB와 브라우저 대조 통과. PG·원장·환불·문자/본인인증 원천과 17경로 전체 게이트 미완료
- P10-T03: 회사·통화별 크레딧 계정과 균형 원장, 예약/확정/실패 해제, 조회 API·잔액 화면의 부분 구현. 동시 예약·중복 원천·정산 격리와 독립 DB·브라우저를 검증하고 전체 PostgreSQL 414건·빌드 통과. PG 승인과 실제 사용량/실패 정산 연결은 남아 있어 완료 게이트 미충족

## 완료 근거

- [P00-T01](../../docs/qa/P00-T01/README.md)
- [P00-T02](../../docs/qa/P00-T02/README.md)
- [P00-T03](../../docs/qa/P00-T03/README.md)
- [P00-T04](../../docs/qa/P00-T04/README.md)
- [P01-T01](../../docs/qa/P01-T01/README.md)
- [P01-T02](../../docs/qa/P01-T02/README.md)
- [P01-T03](../../docs/qa/P01-T03/README.md)

## 구현 중인 기능과 검증

완료 게이트 전의 부분 구현은 [현재 구현 현황](../../docs/IMPLEMENTATION-STATUS.md), [폼·응답 검증](../../docs/qa/forms/README.md), [구성원·초대 검증](../../docs/qa/members/README.md), [템플릿 검증](../../docs/qa/templates/README.md), [정책·승인 검증](../../docs/qa/policy-approvals/README.md), [비밀번호 정책 검증](../../docs/qa/password-policy/README.md), [첨부파일 검증](../../docs/qa/files/README.md), [실제 파기 검증](../../docs/qa/destruction/README.md), [수집 근거 CRUD 검증](../../docs/qa/processing-catalog/README.md), [CSV 수집 검증](../../docs/qa/imports/README.md), [문서 검증](../../docs/qa/documents/README.md), [게시 문서 PDF 검증](../../docs/qa/document-pdf/README.md), [폼 문서·영수증 검증](../../docs/qa/form-documents/README.md), [외부 공유 검증](../../docs/qa/sharing/README.md), [정보주체 조회·철회 검증](../../docs/qa/subjects/README.md), [공지 검증](../../docs/qa/notices/README.md), [가이드 검증](../../docs/qa/guides/README.md)에 별도로 기록한다.

최근 검증: 감사 조회·CSV의 동일 필터, 회사/서비스 격리·역할별 마스킹·원문/토큰 비노출·기간/검색/페이지를 실제 PostgreSQL과 로컬 HTTP에서 시험했다. CSV 200·다운로드 DB 이벤트, viewer 403, 타 회사 서비스 404, 감사 API PATCH/DELETE 405, DB 원장 UPDATE/DELETE 거부를 확인했다. CSV 가져오기·문의 민감 열람 이벤트를 시험했다. 집계·대시보드는 관련 PostgreSQL 83건과 한국 시간 월 경계·실제 수신거부 후 재집계, 독립 DB 대조·7개 화면 HTTP 200·headless Chromium의 기간 필터와 390px 화면을 확인했다. 결제 이력은 실제 무료 체험과 `pending` 제외, 회사/권한 경계·월 검색을 검증했다. 크레딧 원장은 동시 예약·중복 원천·서비스/통화 격리와 수정 거부, 로컬 production API/독립 DB/390px 화면을 검증했다. P00-T03은 ERD/DDL·DTO·역할/상태 전이와 OpenAPI 243경로·354작업의 정책 누락 0을 확인했다. 전체 회귀 26개 파일·414개, 타입·변경 파일 린트 오류 0·production build 통과. [P00-T03 검증](../../docs/qa/P00-T03/README.md), [P12-T01 검증](../../docs/qa/P12-T01/README.md), [P12-T02 검증](../../docs/qa/P12-T02/README.md), [P10-T03 검증](../../docs/qa/P10-T03/README.md), [P10-T05 검증](../../docs/qa/P10-T05/README.md). 실제 PG 충전·사용량/실패 정산·월마감·원본 브라우저 게이트가 남아 그 회귀 시점의 정식 완료는 3/72였다.

P00-T04는 181개 주소를 owner 세션에서 HTTP 200으로 확인했다. P01-T01은 shadow DB에서 빈 설치 50건, 49건에서 업그레이드, 실패 migration 롤백, 회사 교차 23503, 이메일 중복 23505, seed를 확인했다. P01-T02는 200·201·204·400·401·403·404·409·422·429, 같은 키의 다른 본문 거부, 이름순 목록의 반복 일치를 확인했다. P01-T03은 파일 테스트 19건과 S3 서명 왕복을 확인했다. 정식 완료는 7/72다.
