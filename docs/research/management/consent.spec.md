# consent 페이지 사양

## 근거 및 범위
원본 DOM/computed CSS는 경로 이름 JSON, 화면은 docs/design-references/management/ 동명 PNG. 입력·저장·발송은 실제 API 호출 없이 데모 상태.

## 공통 exact CSS
Noto Sans KR; 글자 #484e55; 제목24px700; 내용14px/22.4px. white card padding24px radius12px. primary #6558ff button40px radius4px; secondary border #cbcfd5. 테이블 헤더12px700; empty13px/20.8px #a5abb2.

## 동작 및 상태
클릭 기반 화면. tab은 클릭으로 변경. 검색/초기화/선택/페이지 크기 조절은 local state. 영구 원본 변경 버튼은 조사에서 클릭하지 않음. 호버 transition .15s cubic-bezier(.4,0,.2,1).

## 반응형
768/390 sidebar 숨김, main padding20px. 회사/프로필 정보 두 열 유지; 표 가로 스크롤. JSON에 실측값 저장.

## 페이지별 실제 내용
### /set/service/consent
서비스 내 동의서 표시 설정
개인정보 수집·이용 동의서
개인정보 제3자 제공 동의서 / 서비스명(회사명) 표시 방식 / * / 서비스명(회사명) / 회사명(서비스명) / 서비스명만 표시  
회사명만 표시 / 동의서 시작 문구* / ​ / 0 / 200 / 수탁사 안내 문구 (수탁사를 설정했을 경우 노출됩니다)* / ​  
0 / 200 / 개인정보 처리방침 안내 문구* / ​ / 0 / 200 / 처리방침 링크 / *  
캐치시큐 처리방침 / 외부 처리방침 링크 연결 / 없음 / 거부권 및 거부시 불이익 문구 (필수 동의서에 노출됩니다)* / ​ / 0 / 200  
거부권 및 거부시 불이익 문구 (선택 동의서에 노출됩니다)* / ​ / 0 / 200 / 동의서 미리보기 / 수정사항 적용