# BasicLicenseGate Specification
## Overview
- Routes: all 7 /basic/* routes
- Target: src/components/forms/BasicLicenseGate.tsx
- Screenshot: docs/design-references/forms/consent-gate-detail-1440.png
- Evidence JSON: docs/research/forms/consent-gate-detail-1440.json
- Interaction model: click-driven local UI; no observed scroll-driven animation.
## DOM Structure
- Shared application sidebar/header, page heading, content region.
- Content order follows the verbatim text below; the JSON includes exact visible node classes/styles.
## Computed Styles
- 라이선스 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "500", "lineHeight": "normal", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px 0px 0px 12px", "width": "51.5312px", "height": "20px", "minWidth": "auto", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 서비스 개선 제안 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "400", "lineHeight": "21px", "color": "rgb(52, 52, 52)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "6px 12px", "margin": "0px", "width": "115px", "height": "36px", "minWidth": "auto", "maxWidth": "none", "display": "flex", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "6px", "position": "static", "transition": "all"}
- 접근할 수 없습니다. — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "20px", "fontWeight": "700", "lineHeight": "28px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px 0px 24px", "width": "317.594px", "height": "28px", "minWidth": "0px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 유료 라이선스에 제공되는 기능입니다. — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "700", "lineHeight": "22.4px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "229.594px", "height": "22.3906px", "minWidth": "0px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 라이선스 구독 후 사용하실 수 있습니다. — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "400", "lineHeight": "22.4px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "229.594px", "height": "22.3906px", "minWidth": "0px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
## States & Behaviors
- Static current-account access gate.
- Additional state evidence: N/A
- Primary buttons: #6558ff, border 1px solid #6558ff, radius 4px, height40px, padding12px; transition .15s cubic-bezier(.4,0,.2,1).
- Hover observed in template-hover.json; other hover states not individually exercised.
## Assets
- Original asset URLs are in the evidence JSON assets property.
- All rendering assets should be copied locally; do not copy account information.
## Text Content (verbatim with account name replaced)

접근할 수 없습니다.
유료 라이선스에 제공되는 기능입니다.
라이선스 구독 후 사용하실 수 있습니다.
## Responsive Behavior
- Centered gate preserved; text wraps.
- Desktop/tablet/mobile evidence uses *-detail-1440/768/390 filenames where available.
## Limits
- No server mutations were performed. Real customer names must become demo data.
