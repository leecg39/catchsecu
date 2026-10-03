# UploadLicenseGate Specification
## Overview
- Routes: /form/info-upload, /form/info-upload/agreement, /form/info-upload/recipient
- Target: src/components/forms/UploadLicenseGate.tsx
- Screenshot: docs/design-references/forms/upload-detail-1440.png
- Evidence JSON: docs/research/forms/upload-detail-1440.json
- Interaction model: click-driven local UI; no observed scroll-driven animation.
## DOM Structure
- Shared application sidebar/header, page heading, content region.
- Content order follows the verbatim text below; the JSON includes exact visible node classes/styles.
## Computed Styles
- 개인정보 업로드 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "700", "lineHeight": "normal", "color": "rgb(108, 98, 223)", "backgroundColor": "rgb(240, 240, 255)", "padding": "7px 0px 7px 48px", "margin": "0px", "width": "247px", "height": "34px", "minWidth": "auto", "maxWidth": "none", "display": "flex", "gap": "8px", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "4px", "position": "static", "transition": "all"}
- 관리 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "500", "lineHeight": "normal", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px 0px 0px 12px", "width": "25.7656px", "height": "20px", "minWidth": "auto", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 라이선스 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "500", "lineHeight": "normal", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px 0px 0px 12px", "width": "51.5312px", "height": "20px", "minWidth": "auto", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 서비스 개선 제안 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "400", "lineHeight": "21px", "color": "rgb(52, 52, 52)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "6px 12px", "margin": "0px", "width": "115px", "height": "36px", "minWidth": "auto", "maxWidth": "none", "display": "flex", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "6px", "position": "static", "transition": "all"}
- 유료 라이선스 구독후 이용 가능한 서비스 입니다. — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "20px", "fontWeight": "700", "lineHeight": "28px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px 0px 24px", "width": "452px", "height": "28px", "minWidth": "0px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 개인정보 업로드 서비스는 유료 라이선스 구독 후 이용 가능합니다. — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "700", "lineHeight": "22.4px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "420px", "height": "22.3906px", "minWidth": "auto", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 간편하게 CSV 파일을 업로드하여 개인정보를 등록하고, — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "400", "lineHeight": "22.4px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "420px", "height": "22.3906px", "minWidth": "auto", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 수명관리(개인정보 보관, 파기 자동화)를 위한 간단한 개인정보 처리 근거 설정 과 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "400", "lineHeight": "22.4px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "420px", "height": "44.7812px", "minWidth": "auto", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 라이선스 알아보기 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "400", "lineHeight": "21px", "color": "rgb(52, 52, 52)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "24px 0px 0px", "width": "452px", "height": "40px", "minWidth": "0px", "maxWidth": "none", "display": "flex", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
## States & Behaviors
- License information link; blocked behind paid license.
- Additional state evidence: N/A
- Primary buttons: #6558ff, border 1px solid #6558ff, radius 4px, height40px, padding12px; transition .15s cubic-bezier(.4,0,.2,1).
- Hover observed in template-hover.json; other hover states not individually exercised.
## Assets
- Original asset URLs are in the evidence JSON assets property.
- All rendering assets should be copied locally; do not copy account information.
## Text Content (verbatim with account name replaced)

유료 라이선스 구독후 이용 가능한 서비스 입니다.
개인정보 업로드 서비스는 유료 라이선스 구독 후 이용 가능합니다.
간편하게 CSV 파일을 업로드하여 개인정보를 등록하고,
수명관리(개인정보 보관, 파기 자동화)를 위한 간단한 개인정보 처리 근거 설정 과정을 통해 체계적인 수명관리를 시작하실 수 있습니다.
라이선스 알아보기
## Responsive Behavior
- Centered gate preserved; text wraps.
- Desktop/tablet/mobile evidence uses *-detail-1440/768/390 filenames where available.
## Limits
- No server mutations were performed. Real customer names must become demo data.
