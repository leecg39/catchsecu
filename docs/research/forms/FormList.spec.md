# FormList Specification
## Overview
- Routes: /form/manage
- Target: src/components/forms/FormList.tsx
- Screenshot: docs/design-references/forms/manage-detail-1440.png
- Evidence JSON: docs/research/forms/manage-detail-1440.json
- Interaction model: click-driven local UI; no observed scroll-driven animation.
## DOM Structure
- Shared application sidebar/header, page heading, content region.
- Content order follows the verbatim text below; the JSON includes exact visible node classes/styles.
## Computed Styles
- 메모 — {"fontFamily": "\"Noto Sans KR\", sans-serif", "fontSize": "12px", "fontWeight": "700", "lineHeight": "24px", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgb(251, 251, 252)", "padding": "16px", "margin": "0px", "width": "120px", "height": "60.25px", "minWidth": "120px", "maxWidth": "none", "display": "table-cell", "gap": "normal", "gridTemplateColumns": "none", "border": "", "borderRadius": "0px", "position": "relative", "transition": "padding 0.15s ease-in-out"}
- 외부 열람0 — {"fontFamily": "\"Noto Sans KR\", sans-serif", "fontSize": "12px", "fontWeight": "700", "lineHeight": "24px", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgb(251, 251, 252)", "padding": "16px", "margin": "0px", "width": "140px", "height": "60.25px", "minWidth": "140px", "maxWidth": "none", "display": "table-cell", "gap": "normal", "gridTemplateColumns": "none", "border": "", "borderRadius": "0px", "position": "relative", "transition": "padding 0.15s ease-in-out"}
- 외부 열람 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "12px", "fontWeight": "700", "lineHeight": "24px", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "48.1719px", "height": "24px", "minWidth": "28.3028px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- URL 적용 방식 — {"fontFamily": "\"Noto Sans KR\", sans-serif", "fontSize": "12px", "fontWeight": "700", "lineHeight": "24px", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgb(251, 251, 252)", "padding": "16px", "margin": "0px", "width": "140px", "height": "60.25px", "minWidth": "140px", "maxWidth": "none", "display": "table-cell", "gap": "normal", "gridTemplateColumns": "none", "border": "", "borderRadius": "0px", "position": "relative", "transition": "padding 0.15s ease-in-out"}
- 자동 종료일 — {"fontFamily": "\"Noto Sans KR\", sans-serif", "fontSize": "12px", "fontWeight": "700", "lineHeight": "24px", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgb(251, 251, 252)", "padding": "16px", "margin": "0px", "width": "140px", "height": "60.25px", "minWidth": "140px", "maxWidth": "none", "display": "table-cell", "gap": "normal", "gridTemplateColumns": "none", "border": "", "borderRadius": "0px", "position": "relative", "transition": "padding 0.15s ease-in-out"}
- 최대 응답 수0 — {"fontFamily": "\"Noto Sans KR\", sans-serif", "fontSize": "12px", "fontWeight": "700", "lineHeight": "24px", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgb(251, 251, 252)", "padding": "16px", "margin": "0px", "width": "140px", "height": "60.25px", "minWidth": "140px", "maxWidth": "none", "display": "table-cell", "gap": "normal", "gridTemplateColumns": "none", "border": "", "borderRadius": "0px", "position": "relative", "transition": "padding 0.15s ease-in-out"}
- 최대 응답 수 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "12px", "fontWeight": "700", "lineHeight": "24px", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "62.8281px", "height": "24px", "minWidth": "28.3028px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 설정 — {"fontFamily": "\"Noto Sans KR\", sans-serif", "fontSize": "12px", "fontWeight": "700", "lineHeight": "24px", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgb(251, 251, 252)", "padding": "16px 12px", "margin": "0px", "width": "70px", "height": "60.25px", "minWidth": "70px", "maxWidth": "none", "display": "table-cell", "gap": "normal", "gridTemplateColumns": "none", "border": "", "borderRadius": "0px", "position": "sticky", "transition": "padding 0.15s ease-in-out"}
- 데이터가 없습니다 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "400", "lineHeight": "21px", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "2213.06px", "height": "204.797px", "minWidth": "0px", "maxWidth": "none", "display": "table-row-group", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "relative", "transition": "all"}
- 20 — {"fontFamily": "Roboto, Helvetica, Arial, sans-serif", "fontSize": "16px", "fontWeight": "400", "lineHeight": "23px", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "4px 24px 5px 0px", "margin": "0px", "width": "18.1094px", "height": "23px", "minWidth": "16px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px none rgba(0, 0, 0, 0.87)", "borderRadius": "0px", "position": "static", "transition": "all"}
## States & Behaviors
- click detailed-search toggle expands local filters; search/sort controls. Empty account 0 rows.
- Additional state evidence: manage-expanded.json
- Primary buttons: #6558ff, border 1px solid #6558ff, radius 4px, height40px, padding12px; transition .15s cubic-bezier(.4,0,.2,1).
- Hover observed in template-hover.json; other hover states not individually exercised.
## Assets
- Original asset URLs are in the evidence JSON assets property.
- All rendering assets should be copied locally; do not copy account information.
## Text Content (verbatim with account name replaced)

캐치폼·업로드 목록
'캐치폼'과 '개인정보 업로드' 항목을 관리할 수 있습니다.
캐치폼 생성
개인정보 업로드
캐치폼 가이드
파기확인서 가이드
생성 후 3개월 이상
​
공개중인 캐치폼 검색
검색
검색
상세 검색 열기
전체
0개
즐겨찾기만 보기
파기 확인서 발급 내역
파기 확인서 발급
	
#
	
즐겨찾기
	
공개상태
	
서비스 명
	
캐치폼·개인정보 업로드 명
	
생성자
	
구분
	
유효/철회 응답
	
생성일
	
파기확인서(최근 이력)
	
보유·이용 기간
	
메모
	
외부 열람
	
URL 적용 방식
	
자동 종료일
	
최대 응답 수
	
설정

데이터가 없습니다

20
## Responsive Behavior
- Table retains horizontal scroll; source mobile remains dense.
- Desktop/tablet/mobile evidence uses *-detail-1440/768/390 filenames where available.
## Limits
- No server mutations were performed. Real customer names must become demo data.
