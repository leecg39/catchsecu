# FixedUrlList Specification
## Overview
- Routes: /form/fixed-url
- Target: src/components/forms/FixedUrlList.tsx
- Screenshot: docs/design-references/forms/fixed-url-detail-1440.png
- Evidence JSON: docs/research/forms/fixed-url-detail-1440.json
- Interaction model: click-driven local UI; no observed scroll-driven animation.
## DOM Structure
- Shared application sidebar/header, page heading, content region.
- Content order follows the verbatim text below; the JSON includes exact visible node classes/styles.
## Computed Styles
- URL0 — {"fontFamily": "\"Noto Sans KR\", sans-serif", "fontSize": "12px", "fontWeight": "700", "lineHeight": "normal", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgb(251, 251, 252)", "padding": "16px", "margin": "0px", "width": "125.781px", "height": "51px", "minWidth": "100px", "maxWidth": "none", "display": "table-cell", "gap": "normal", "gridTemplateColumns": "none", "border": "", "borderRadius": "0px", "position": "relative", "transition": "padding 0.15s ease-in-out"}
- URL — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "12px", "fontWeight": "700", "lineHeight": "normal", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "24.4844px", "height": "17px", "minWidth": "21.2271px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 연결된 캐치폼0 — {"fontFamily": "\"Noto Sans KR\", sans-serif", "fontSize": "12px", "fontWeight": "700", "lineHeight": "normal", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgb(251, 251, 252)", "padding": "16px", "margin": "0px", "width": "226.406px", "height": "51px", "minWidth": "180px", "maxWidth": "none", "display": "table-cell", "gap": "normal", "gridTemplateColumns": "none", "border": "", "borderRadius": "0px", "position": "relative", "transition": "padding 0.15s ease-in-out"}
- 연결된 캐치폼 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "12px", "fontWeight": "700", "lineHeight": "normal", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "70.5px", "height": "17px", "minWidth": "28.3028px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 생성일0 — {"fontFamily": "\"Noto Sans KR\", sans-serif", "fontSize": "12px", "fontWeight": "700", "lineHeight": "normal", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgb(251, 251, 252)", "padding": "16px", "margin": "0px", "width": "176.094px", "height": "51px", "minWidth": "140px", "maxWidth": "none", "display": "table-cell", "gap": "normal", "gridTemplateColumns": "none", "border": "", "borderRadius": "0px", "position": "relative", "transition": "padding 0.15s ease-in-out"}
- 생성일 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "12px", "fontWeight": "700", "lineHeight": "normal", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "33.5156px", "height": "17px", "minWidth": "21.2271px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- QR코드0 — {"fontFamily": "\"Noto Sans KR\", sans-serif", "fontSize": "12px", "fontWeight": "700", "lineHeight": "normal", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgb(251, 251, 252)", "padding": "16px", "margin": "0px", "width": "137.484px", "height": "51px", "minWidth": "100px", "maxWidth": "none", "display": "table-cell", "gap": "normal", "gridTemplateColumns": "none", "border": "", "borderRadius": "0px", "position": "sticky", "transition": "padding 0.15s ease-in-out"}
- QR코드 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "12px", "fontWeight": "700", "lineHeight": "normal", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "40.0312px", "height": "17px", "minWidth": "28.3028px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 데이터가 없습니다 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "400", "lineHeight": "21px", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "1046px", "height": "204.797px", "minWidth": "0px", "maxWidth": "none", "display": "table-row-group", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "relative", "transition": "all"}
- 10 — {"fontFamily": "Roboto, Helvetica, Arial, sans-serif", "fontSize": "16px", "fontWeight": "400", "lineHeight": "23px", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "4px 24px 5px 0px", "margin": "0px", "width": "18.1094px", "height": "23px", "minWidth": "16px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px none rgba(0, 0, 0, 0.87)", "borderRadius": "0px", "position": "static", "transition": "all"}
## States & Behaviors
- Create click displays paid-license toast; no data created.
- Additional state evidence: fixed-url-modal.json
- Primary buttons: #6558ff, border 1px solid #6558ff, radius 4px, height40px, padding12px; transition .15s cubic-bezier(.4,0,.2,1).
- Hover observed in template-hover.json; other hover states not individually exercised.
## Assets
- Original asset URLs are in the evidence JSON assets property.
- All rendering assets should be copied locally; do not copy account information.
## Text Content (verbatim with account name replaced)

고정URL 관리
캐치폼 내용이 자주 변경되는 경우 고정URL을 연결해보세요. 캐치폼이 변경될 때 마다 정보주체에게 다시 안내하지 않아도 됩니다.
고정URL 생성
#
	
URL 명
	
URL
	
연결된 캐치폼
	
생성일
	
관리
	
QR코드

데이터가 없습니다

10
## Responsive Behavior
- Table retains horizontal scroll.
- Desktop/tablet/mobile evidence uses *-detail-1440/768/390 filenames where available.
## Limits
- No server mutations were performed. Real customer names must become demo data.
