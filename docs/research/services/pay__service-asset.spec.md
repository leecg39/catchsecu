# pay__service-asset Specification

원본: https://app.catchsecu.com/pay/service-asset
스크린샷: docs/design-references/services/pay__service-asset-1440.png
상호작용 모델: 클릭 기반(조회 탭/필터). 결제·발송·저장 금지.

## 실제 문구
권한이 없습니다. / 접근 권한이 없는 메뉴입니다. / 구성원 관리 권한이 있는 사용자에게 권한을 요청해주세요.

## 실제 computed CSS (주요 노드)
폰트 Noto Sans KR. 전체 DOM/styles/rect/assets/SVG는 같은 이름 JSON에 저장.
- DIV 권한이 없습니다.: fontSize=20px; fontWeight=700; lineHeight=28px; color=rgb(72, 78, 85); backgroundColor=rgba(0, 0, 0, 0); padding=0px; width=424.547px; height=28px; border=0px solid rgb(238, 238, 238); borderRadius=0px; rect={'x': 647.71875, 'y': 448.609375, 'width': 424.546875, 'height': 28}
- DIV 접근 권한이 없는 메뉴입니다.: fontSize=14px; fontWeight=700; lineHeight=22.4px; color=rgb(72, 78, 85); backgroundColor=rgba(0, 0, 0, 0); padding=0px; width=336.547px; height=22.3906px; border=0px solid rgb(238, 238, 238); borderRadius=0px; rect={'x': 719.71875, 'y': 516.609375, 'width': 336.546875, 'height': 22.390625}
- DIV 구성원 관리 권한이 있는 사용자에게 권한을 요청해주세요.: fontSize=14px; fontWeight=400; lineHeight=22.4px; color=rgb(72, 78, 85); backgroundColor=rgba(0, 0, 0, 0); padding=0px; width=336.547px; height=22.3906px; border=0px solid rgb(238, 238, 238); borderRadius=0px; rect={'x': 719.71875, 'y': 539, 'width': 336.546875, 'height': 22.390625}

## 구조 및 자산
좌측 공통 네비게이션 280px. 콘텐츠 시작 x=312 y=88. 본문은 제목, 설명, 페이지별 카드/필터/테이블로 구성.
이미지: [{"src": "https://app.catchsecu.com/media/google-icons/question_v2.svg", "alt": ""}, {"src": "https://app.catchsecu.com/img/google-icons-v2/system/search.svg", "alt": ""}, {"src": "https://app.catchsecu.com/img/catchsecu/header/company.png", "alt": "logo"}]

## 상태 및 반응형
초기 상태 위 스크린샷/JSON 확정. 추가 상태와 768/390은 후속 state JSON으로 기록.