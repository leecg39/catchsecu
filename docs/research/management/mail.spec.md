# mail 페이지 사양

## 근거 및 범위
원본 DOM/computed CSS는 경로 이름 JSON, 화면은 docs/design-references/management/ 동명 PNG. 입력·저장·발송은 실제 API 호출 없이 데모 상태.

## 공통 exact CSS
Noto Sans KR; 글자 #484e55; 제목24px700; 내용14px/22.4px. white card padding24px radius12px. primary #6558ff button40px radius4px; secondary border #cbcfd5. 테이블 헤더12px700; empty13px/20.8px #a5abb2.

## 동작 및 상태
클릭 기반 화면. tab은 클릭으로 변경. 검색/초기화/선택/페이지 크기 조절은 local state. 영구 원본 변경 버튼은 조사에서 클릭하지 않음. 호버 transition .15s cubic-bezier(.4,0,.2,1).

## 반응형
768/390 sidebar 숨김, main padding20px. 회사/프로필 정보 두 열 유지; 표 가로 스크롤. JSON에 실측값 저장.

## 페이지별 실제 내용
### /set/service/consigment/mail
재위탁 안내 메일 발송
메일 발송 이력
위탁사 담당자에게 개인정보 재위탁 안내 메일을 발송할 수 있습니다. / 재위탁 안내 메일을 왜 발송해야 하나요? / 수신인 정보 설정 / 발신인* / 수신인 정보* / (위탁사 담당자)  
참조 / 메일 본문 작성 / 재위탁 동의를 위한 필수적인 내용입니다. 필요한 부분을 수정/추가해서 발송할 수 있습니다. / 제목* / 본문* / Paragraph  
폰트 크기 / 12px / 14px / 15px / 16px / 20px  
24px / 32px / A /  /  /   
 / 임시저장 / 메일 미리보기 / 메일 발송