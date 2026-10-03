# MarketingConsentList Specification
## Overview
- Routes: /form/ad-manage
- Target: src/components/forms/MarketingConsentList.tsx
- Screenshot: docs/design-references/forms/form_ad-manage.png
- Evidence JSON: docs/research/forms/form_ad-manage.json
- Interaction model: click-driven local UI; no observed scroll-driven animation.
## DOM Structure
- Shared application sidebar/header, page heading, content region.
- Content order follows the verbatim text below; the JSON includes exact visible node classes/styles.
## Computed Styles
- 서비스 개선 제안 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "400", "lineHeight": "21px", "color": "rgb(52, 52, 52)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "6px 12px", "margin": "0px", "width": "115px", "height": "36px", "display": "flex", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "6px", "position": "static", "transition": "all"}
- 선택동의철회 — {"fontFamily": "\"Noto Sans KR\", sans-serif", "fontSize": "12px", "fontWeight": "500", "lineHeight": "16px", "color": "rgb(203, 207, 213)", "backgroundColor": "rgb(240, 241, 244)", "padding": "12px", "margin": "0px", "width": "103.281px", "height": "40px", "display": "flex", "gap": "normal", "gridTemplateColumns": "none", "border": "1px solid rgb(231, 233, 237)", "borderRadius": "4px", "position": "static", "transition": "0.15s cubic-bezier(0.4, 0, 0.2, 1)"}
- 다시보지 않기 — {"fontFamily": "\"Noto Sans KR\", sans-serif", "fontSize": "12px", "fontWeight": "500", "lineHeight": "16px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgb(255, 255, 255)", "padding": "12px", "margin": "0px", "width": "107.203px", "height": "40px", "display": "flex", "gap": "normal", "gridTemplateColumns": "none", "border": "1px solid rgb(203, 207, 213)", "borderRadius": "4px", "position": "static", "transition": "0.15s cubic-bezier(0.4, 0, 0.2, 1)"}
- 확인 — {"fontFamily": "\"Noto Sans KR\", sans-serif", "fontSize": "12px", "fontWeight": "500", "lineHeight": "16px", "color": "rgb(255, 255, 255)", "backgroundColor": "rgb(101, 88, 255)", "padding": "12px", "margin": "0px", "width": "80px", "height": "40px", "display": "flex", "gap": "normal", "gridTemplateColumns": "none", "border": "1px solid rgb(101, 88, 255)", "borderRadius": "4px", "position": "static", "transition": "0.15s cubic-bezier(0.4, 0, 0.2, 1)"}
## States & Behaviors
- Intro dialog with dismiss and do-not-show checkbox; table filters. Do not withdraw real consent.
- Additional state evidence: N/A
- Primary buttons: #6558ff, border 1px solid #6558ff, radius 4px, height40px, padding12px; transition .15s cubic-bezier(.4,0,.2,1).
- Hover observed in template-hover.json; other hover states not individually exercised.
## Assets
- Original asset URLs are in the evidence JSON assets property.
- All rendering assets should be copied locally; do not copy account information.
## Text Content (verbatim with account name replaced)

광고성 정보 수신동의 관리
각 캐치폼·개인정보 업로드에 홍보/마케팅 동의를 받아 수집된 개인정보를 모아서 확인하고 관리할 수 있습니다.
수신동의 목록
검색 필터 열기
선택동의철회
	
#
	
이름
	
이메일
	
전화번호
	
캐치폼·개인정보 업로드 명
	
동의일
	
이메일 발송 제외
	
전화/문자 발송 제외
	
철회일
	
철회

데이터가 없습니다

10
잘못된 접근입니다.
광고성 정보 수신동의 관리
각 캐치폼·개인정보 업로드에서 홍보/마케팅 동의를 받아 수집된 개인정보를 모아서 확인하고 관리할 수 있습니다.
수집·이용 동의 항목에 ‘이름’과 ‘연락 수단(이메일 or 전화번호)’가 존재하는 경우에만 목록에서 확인할 수 있습니다.
정보주체의 동의 내용, 동의 채널을 한번에 확인할 수 있어서 광고성 정보 활동에 편리하게 사용하실 수 있습니다.
캐치폼·개인정보 업로드 답변을 삭제 했거나, 정보주체가 동의를 철회하면 해당 목록에도 자동으로 반영 됩니다.
※ 베타 서비스 중으로, 기능은 변경/수정될 수 있습니다.
다시보지 않기
확인
## Responsive Behavior
- Not separately inspected at tablet/mobile; table should retain horizontal scrolling, pending QA.
- Desktop/tablet/mobile evidence uses *-detail-1440/768/390 filenames where available.
## Limits
- No server mutations were performed. Real customer names must become demo data.
