# mail__catchform Specification

원본: https://app.catchsecu.com/mail/catchform
스크린샷: docs/design-references/services/mail__catchform-1440.png
상호작용 모델: 클릭 기반(조회 탭/필터). 결제·발송·저장 금지.

## 실제 문구
유료 라이선스 구독후 이용 가능한 서비스 입니다. / 이메일 서비스는 유료 라이선스 구독 후 이용 가능합니다. / 다음 두 가지 방식으로 이메일을 발송하실 수 있습니다. / 수집된 개인정보 연동: '캐치폼' 및 '개인정보 업로드'를 통해 수집된 정보주체에게 이메일을 발송할 수 있습니다. / 직접 등록 발송: 이메일 주소를 직접 수기 입력하거나 CSV 파일로 업로드하여 정보주체에게 이메일을 발송할 수 있습니다 / 라이선스 알아보기

## 실제 computed CSS (주요 노드)
폰트 Noto Sans KR. 전체 DOM/styles/rect/assets/SVG는 같은 이름 JSON에 저장.
- DIV 유료 라이선스 구독후 이용 가능한 서비스 입니다.: fontSize=20px; fontWeight=700; lineHeight=28px; color=rgb(72, 78, 85); backgroundColor=rgba(0, 0, 0, 0); padding=0px; width=452px; height=28px; border=0px solid rgb(238, 238, 238); borderRadius=0px; rect={'x': 634, 'y': 363.828125, 'width': 452, 'height': 28}
- DIV 이메일 서비스는 유료 라이선스 구독 후 이용 가능합니다.: fontSize=14px; fontWeight=700; lineHeight=22.4px; color=rgb(72, 78, 85); backgroundColor=rgba(0, 0, 0, 0); padding=0px; width=420px; height=22.3906px; border=0px solid rgb(238, 238, 238); borderRadius=0px; rect={'x': 650, 'y': 431.828125, 'width': 420, 'height': 22.390625}
- DIV 다음 두 가지 방식으로 이메일을 발송하실 수 있습니다.: fontSize=14px; fontWeight=400; lineHeight=22.4px; color=rgb(72, 78, 85); backgroundColor=rgba(0, 0, 0, 0); padding=0px; width=420px; height=22.3906px; border=0px solid rgb(238, 238, 238); borderRadius=0px; rect={'x': 650, 'y': 454.21875, 'width': 420, 'height': 22.390625}
- DIV 수집된 개인정보 연동: '캐치폼' 및 '개인정보 업로드'를 통해 수집된 정보주체에게 이메일을 발송할 수 있습니다.: fontSize=14px; fontWeight=400; lineHeight=22.4px; color=rgb(72, 78, 85); backgroundColor=rgba(0, 0, 0, 0); padding=0px; width=406px; height=44.7812px; border=0px solid rgb(238, 238, 238); borderRadius=0px; rect={'x': 664, 'y': 492.609375, 'width': 406, 'height': 44.78125}
- DIV 직접 등록 발송: 이메일 주소를 직접 수기 입력하거나 CSV 파일로 업로드하여 정보주체에게 이메일을 발송할 수 있습니: fontSize=14px; fontWeight=400; lineHeight=22.4px; color=rgb(72, 78, 85); backgroundColor=rgba(0, 0, 0, 0); padding=0px; width=406px; height=44.7812px; border=0px solid rgb(238, 238, 238); borderRadius=0px; rect={'x': 664, 'y': 537.390625, 'width': 406, 'height': 44.78125}
- BUTTON : fontSize=12px; fontWeight=500; lineHeight=16px; color=rgb(255, 255, 255); backgroundColor=rgb(101, 88, 255); padding=12px; width=132.969px; height=40px; border=1px solid rgb(101, 88, 255); borderRadius=4px; rect={'x': 953.03125, 'y': 622.171875, 'width': 132.96875, 'height': 40}
- DIV 라이선스 알아보기: fontSize=14px; fontWeight=500; lineHeight=16px; color=rgb(255, 255, 255); backgroundColor=rgba(0, 0, 0, 0); padding=0px; width=106.969px; height=16px; border=0px solid rgb(238, 238, 238); borderRadius=0px; rect={'x': 966.03125, 'y': 634.171875, 'width': 106.96875, 'height': 16}

## 구조 및 자산
좌측 공통 네비게이션 280px. 콘텐츠 시작 x=312 y=88. 본문은 제목, 설명, 페이지별 카드/필터/테이블로 구성.
이미지: [{"src": "https://app.catchsecu.com/media/google-icons/question_v2.svg", "alt": ""}, {"src": "https://app.catchsecu.com/img/google-icons-v2/system/search.svg", "alt": ""}, {"src": "https://app.catchsecu.com/img/catchsecu/header/company.png", "alt": "logo"}]

## 상태 및 반응형
초기 상태 위 스크린샷/JSON 확정. 추가 상태와 768/390은 후속 state JSON으로 기록.