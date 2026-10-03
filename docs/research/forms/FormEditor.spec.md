# FormEditor Specification
## Overview
- Routes: /form/ai/create, /form/ai/basic-frame
- Target: src/components/forms/FormEditor.tsx
- Screenshot: docs/design-references/forms/basic-frame-detail-1440.png
- Evidence JSON: docs/research/forms/basic-frame-detail-1440.json
- Interaction model: click-driven local UI; no observed scroll-driven animation.
## DOM Structure
- Shared application sidebar/header, page heading, content region.
- Content order follows the verbatim text below; the JSON includes exact visible node classes/styles.
## Computed Styles
- 예 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "400", "lineHeight": "21px", "color": "rgb(52, 52, 52)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "54.0312px", "height": "32px", "minWidth": "auto", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 아니요 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "400", "lineHeight": "21px", "color": "rgb(52, 52, 52)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "80.0938px", "height": "32px", "minWidth": "auto", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 단문형 답변 — {"fontFamily": "Roboto, Helvetica, Arial, sans-serif", "fontSize": "16px", "fontWeight": "400", "lineHeight": "23px", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "16.5px 32px 16.5px 14px", "margin": "0px", "width": "194px", "height": "23px", "minWidth": "0px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px none rgba(0, 0, 0, 0.87)", "borderRadius": "4px", "position": "static", "transition": "all"}
- ​ — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "16px", "fontWeight": "400", "lineHeight": "23px", "color": "rgba(0, 0, 0, 0.87)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px 8px", "margin": "0px", "width": "240px", "height": "45px", "minWidth": "0%", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "1px solid rgba(0, 0, 0, 0.23)", "borderRadius": "4px", "position": "absolute", "transition": "all"}
- Q1 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "20px", "fontWeight": "700", "lineHeight": "28px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px 0px 4px", "width": "27.2031px", "height": "28px", "minWidth": "auto", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 필수항목 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "20px", "fontWeight": "700", "lineHeight": "28px", "color": "rgb(52, 52, 52)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "75.8438px", "height": "28px", "minWidth": "auto", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 0 / 3000 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "400", "lineHeight": "normal", "color": "rgb(165, 171, 178)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "8px 0px 0px", "width": "1033px", "height": "20px", "minWidth": "0px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- + 항목 추가하기 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "400", "lineHeight": "21px", "color": "rgb(52, 52, 52)", "backgroundColor": "rgb(255, 255, 255)", "padding": "24px", "margin": "16px 0px 0px", "width": "1081px", "height": "76px", "minWidth": "0px", "maxWidth": "none", "display": "flex", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "12px", "position": "static", "transition": "all"}
- 임시저장 — {"fontFamily": "\"Noto Sans KR\", sans-serif", "fontSize": "14px", "fontWeight": "500", "lineHeight": "20px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgb(255, 255, 255)", "padding": "16px", "margin": "0px", "width": "225px", "height": "48px", "minWidth": "80px", "maxWidth": "none", "display": "flex", "gap": "12px", "gridTemplateColumns": "none", "border": "1px solid rgb(203, 207, 213)", "borderRadius": "4px", "position": "static", "transition": "0.15s cubic-bezier(0.4, 0, 0.2, 1)"}
- 다음으로 — {"fontFamily": "\"Noto Sans KR\", sans-serif", "fontSize": "14px", "fontWeight": "500", "lineHeight": "20px", "color": "rgb(255, 255, 255)", "backgroundColor": "rgb(101, 88, 255)", "padding": "16px", "margin": "0px", "width": "225px", "height": "48px", "minWidth": "80px", "maxWidth": "none", "display": "flex", "gap": "12px", "gridTemplateColumns": "none", "border": "1px solid rgb(101, 88, 255)", "borderRadius": "4px", "position": "static", "transition": "0.15s cubic-bezier(0.4, 0, 0.2, 1)"}
## States & Behaviors
- Local editor toolbar, text fields, question dropdown; no save/next operations executed.
- Additional state evidence: create-detail.json
- Primary buttons: #6558ff, border 1px solid #6558ff, radius 4px, height40px, padding12px; transition .15s cubic-bezier(.4,0,.2,1).
- Hover observed in template-hover.json; other hover states not individually exercised.
## Assets
- Original asset URLs are in the evidence JSON assets property.
- All rendering assets should be copied locally; do not copy account information.
## Text Content (verbatim with account name replaced)

캐치폼 생성
개인정보 보호관련 규제를 준수할 수 있는 폼을 생성하세요.
캐치폼 제목
캐치폼의 상단과 링크 공유 시 노출됩니다.
캐치폼 본문
캐치폼의 본문 내용을 편집할 수 있습니다.
Paragraph
폰트 크기
12px
14px
15px
16px
20px
24px
32px
A

본인인증 및 전자서명 설정
유료 라이선스 구독이 필요한 기능입니다.
법적 효력이 있는 인증된 개인정보, 전자서명을 수집할 수 있습니다.
본인인증/전자서명은 언제 사용하나요
답변 제출자의 본인인증/전자서명을 수집합니다.
예
아니요
단문형 답변
​
Q1
필수항목
0 / 3000
+ 항목 추가하기
임시저장
다음으로
## Responsive Behavior
- Editor toolbar wraps; desktop content column becomes narrow on mobile.
- Desktop/tablet/mobile evidence uses *-detail-1440/768/390 filenames where available.
## Limits
- No server mutations were performed. Real customer names must become demo data.

## 저장 복원 계약
- 기본 재진입은 활성 폼 복원, ?new=1은 신규 폼, ?edit=id는 지정 폼, ?template=n은 템플릿 신규 폼.
- 편집 저장은 기존 ID/생성일/공개 상태/동의 설정을 보존.
- 객관식/체크박스/드롭다운은 한 줄당 하나의 선택지를 options 배열로 저장.
- 신규/템플릿 임시저장 후 현재 URL을 ?edit=id로 대체하여 새로고침 복원.
- 다음 이동 전에도 현재 history entry를 edit URL로 교체하여 뒤로가기 복원.
