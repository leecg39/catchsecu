# mail__no-mail Specification

원본: https://app.catchsecu.com/mail/no-mail
스크린샷: docs/design-references/services/mail__no-mail-1440.png
상호작용 모델: 클릭 기반(조회 탭/필터). 결제·발송·저장 금지.

## 실제 문구
발신 주소 등록이 필요한 서비스 입니다. / 메일서비스를 이용하려면 발신 주소를 미리 등록해야 합니다. / 지금 발신 주소 관리 페이지로 이동해서 등록하시겠습니까? / 발신 주소 등록

## 실제 computed CSS (주요 노드)
폰트 Noto Sans KR. 전체 DOM/styles/rect/assets/SVG는 같은 이름 JSON에 저장.
- DIV 발신 주소 등록이 필요한 서비스 입니다.: fontSize=20px; fontWeight=700; lineHeight=28px; color=rgb(72, 78, 85); backgroundColor=rgba(0, 0, 0, 0); padding=0px; width=438.094px; height=28px; border=0px solid rgb(238, 238, 238); borderRadius=0px; rect={'x': 640.953125, 'y': 416.609375, 'width': 438.09375, 'height': 28}
- DIV 메일서비스를 이용하려면 발신 주소를 미리 등록해야 합니다.: fontSize=14px; fontWeight=700; lineHeight=22.4px; color=rgb(75, 117, 228); backgroundColor=rgba(0, 0, 0, 0); padding=0px; width=350.094px; height=22.3906px; border=0px solid rgb(238, 238, 238); borderRadius=0px; rect={'x': 712.953125, 'y': 484.609375, 'width': 350.09375, 'height': 22.390625}
- DIV 지금 발신 주소 관리 페이지로 이동해서 등록하시겠습니까?: fontSize=14px; fontWeight=400; lineHeight=22.4px; color=rgb(75, 117, 228); backgroundColor=rgba(0, 0, 0, 0); padding=0px; width=350.094px; height=22.3906px; border=0px solid rgb(238, 238, 238); borderRadius=0px; rect={'x': 712.953125, 'y': 507, 'width': 350.09375, 'height': 22.390625}
- BUTTON : fontSize=12px; fontWeight=500; lineHeight=16px; color=rgb(255, 255, 255); backgroundColor=rgb(101, 88, 255); padding=12px; width=111.125px; height=40px; border=1px solid rgb(101, 88, 255); borderRadius=4px; rect={'x': 967.921875, 'y': 569.390625, 'width': 111.125, 'height': 40}
- DIV 발신 주소 등록: fontSize=14px; fontWeight=500; lineHeight=16px; color=rgb(255, 255, 255); backgroundColor=rgba(0, 0, 0, 0); padding=0px; width=85.125px; height=16px; border=0px solid rgb(238, 238, 238); borderRadius=0px; rect={'x': 980.921875, 'y': 581.390625, 'width': 85.125, 'height': 16}

## 구조 및 자산
좌측 공통 네비게이션 280px. 콘텐츠 시작 x=312 y=88. 본문은 제목, 설명, 페이지별 카드/필터/테이블로 구성.
이미지: [{"src": "https://app.catchsecu.com/media/google-icons/question_v2.svg", "alt": ""}, {"src": "https://app.catchsecu.com/img/google-icons-v2/system/search.svg", "alt": ""}, {"src": "https://app.catchsecu.com/img/catchsecu/header/company.png", "alt": "logo"}]

## 상태 및 반응형
초기 상태 위 스크린샷/JSON 확정. 추가 상태와 768/390은 후속 state JSON으로 기록.