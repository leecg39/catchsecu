# 회사 기본정보 및 편집
## 대상
CompanyInfo, CompanyEdit. Interaction model: click navigation, edit local form only.
근거: set--company.json, set--company--edit.json 및 desktop/768/390 screenshot.
## 구조 / exact CSS
- content container max-width800px centered; desktop x460 y88.
- 제목 24px/700 line-height40px; 오른쪽 수정/저장 버튼80x40.
- 카드 y152 width800 padding24px radius12px white.
- 조회 카드 높이252px; 2개 열376px; 행 gap20px.
- 레이블 Noto Sans KR14px400 #484e55 margin-bottom8px, 값14px700 같은 색.
- 수정 카드 flex-column gap24px, 높이624px.
- 버튼 primary #6558ff white, border1px #6558ff radius4px padding12px.
- secondary white border1px #cbcfd5, 높이40px.
- 버튼 transition .15s cubic-bezier(.4,0,.2,1).
## 실제 내용
회사 기본 정보 / 수정.
첫 열: 회사명=중소기업발전, 회사 주소=-, 사업자 등록증=첨부파일 없음.
둘째 열: 세금계산서 담당자명=이충규, 세금계산서 발행 이메일=leecg2908@gmail.com, 추천인 코드=-.
편집 제목 회사 정보 수정 / 저장.
필드 순서 회사명*, 회사 주소(우편번호 찾기), 사업자 등록증(파일첨부), 세금계산서 담당자명, 세금계산서 발행 이메일*, 추천인 코드.
## 반응형
768: shell sidebar 숨김. 제목 x20 y100. 회사명 label x44 y188 width340.
390: 제목 x20 y100. 회사명 label x44 y188 width151. 2열 그대로 유지.
## 동작
수정 클릭 -> /set/company/edit, 저장은 mock feedback만. 원본 저장/파일선택 버튼 실행하지 않았음.
조회 페이지는 스크롤로 변하는 상태 없음. Asset 추가 없음.
