# 공통 UI

## 구조와 스타일
대시보드의 실제 계산 스타일(dashboard-1440.json)과 원본 SVG를 기반으로 한다.
Panel: padding24px, radius12px, white, shadow 0 2px 4px #00000026 + 0 0 2px #00000014.
버튼: primary #6558ff, white text, radius6px, font14px 500, transition .15s cubic-bezier(.4,0,.2,1).
입력: height40px, padding10px 12px, border #cbcfd5 1px, radius4px. focus ring #e7e9ed.
Empty: 원본 SVG icon-38.svg 120×120, padding60px, text14px #838991.
Table: 데이터 컬럼을 props로 전달, 실제 테이블 태그. 페이지당 행 수 선택 및 이전/다음 동작.
Modal: 백드롭, 닫기/Escape 처리, 원본 기반 white container with 8px radius.
인터랙션: 클릭 기반. 실제 서버 호출 대신 로컬 상태.
반응형: 공통 컨테이너 max-width100%, 원본 앱 가로 스크롤 유지. 도표와 표는 스크롤.
이미지: public/assets/icons/icon-*.svg; 실제 원본 SVG를 추출.
