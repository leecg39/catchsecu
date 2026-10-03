# TemplateGallery Specification
## Overview
- Routes: /form/template
- Target: src/components/forms/TemplateGallery.tsx
- Screenshot: docs/design-references/forms/template-detail-1440.png
- Evidence JSON: docs/research/forms/template-detail-1440.json
- Interaction model: click-driven local UI; no observed scroll-driven animation.
## DOM Structure
- Shared application sidebar/header, page heading, content region.
- Content order follows the verbatim text below; the JSON includes exact visible node classes/styles.
## Computed Styles
- 용역 대금 지급을 위한 주민등록번호 처리 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "16px", "fontWeight": "700", "lineHeight": "22.4px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px 0px 8px", "width": "286.344px", "height": "44px", "minWidth": "0px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 프로젝트에 참여한 프리랜서 또는 외부 위원에게 용역 대금 지급을 위해 금융 정보와 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "13px", "fontWeight": "400", "lineHeight": "19.5px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "286.344px", "height": "80px", "minWidth": "0px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- SNS 체험단 모집 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "16px", "fontWeight": "700", "lineHeight": "22.4px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px 0px 8px", "width": "286.328px", "height": "44px", "minWidth": "0px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 신규 서비스 또는 제품의 체험단/서포터즈를 모집하기 위해 사용되며, 지원자의 참여 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "13px", "fontWeight": "400", "lineHeight": "19.5px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "286.328px", "height": "80px", "minWidth": "0px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- SNS 이벤트 참여자 정보 수집 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "16px", "fontWeight": "700", "lineHeight": "22.4px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px 0px 8px", "width": "286.328px", "height": "44px", "minWidth": "0px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 소액 경품 당첨자 정보 수집(본인인증) — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "16px", "fontWeight": "700", "lineHeight": "22.4px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px 0px 8px", "width": "286.344px", "height": "44px", "minWidth": "0px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 경품이 5만 원 미만일 때 제세공과금 관련 정보(주민등록번호 등)를 수집하지 않음 — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "13px", "fontWeight": "400", "lineHeight": "19.5px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "286.344px", "height": "80px", "minWidth": "0px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 고액 경품 당첨자 정보 수집(제세공과금 처리) — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "16px", "fontWeight": "700", "lineHeight": "22.4px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px 0px 8px", "width": "286.328px", "height": "44.7812px", "minWidth": "0px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 경품 발송을 위한 기본 정보와 고액 경품(5만 원 초과)에 대한 제세공과금 대리  — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "13px", "fontWeight": "400", "lineHeight": "19.5px", "color": "rgb(72, 78, 85)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "286.328px", "height": "80px", "minWidth": "0px", "maxWidth": "none", "display": "block", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "static", "transition": "all"}
- 유료 라이선스 고객에게 제공되는 기능입니다. — {"fontFamily": "\"Noto Sans KR\"", "fontSize": "14px", "fontWeight": "400", "lineHeight": "21px", "color": "rgb(52, 52, 52)", "backgroundColor": "rgba(0, 0, 0, 0)", "padding": "0px", "margin": "0px", "width": "400px", "height": "56px", "minWidth": "400px", "maxWidth": "none", "display": "flex", "gap": "normal", "gridTemplateColumns": "none", "border": "0px solid rgb(238, 238, 238)", "borderRadius": "0px", "position": "fixed", "transition": "all"}
## States & Behaviors
- click tabs; scroll does not change active tab. Company tab shows empty message. Use button not clicked because it could create a remote form.
- Additional state evidence: template-company-tab.json
- Primary buttons: #6558ff, border 1px solid #6558ff, radius 4px, height40px, padding12px; transition .15s cubic-bezier(.4,0,.2,1).
- Hover observed in template-hover.json; other hover states not individually exercised.
## Assets
- Original asset URLs are in the evidence JSON assets property.
- All rendering assets should be copied locally; do not copy account information.
## Text Content (verbatim with account name replaced)

캐치폼 템플릿
상황과 목적에 따라 '캐치폼 템플릿' 혹은 '데모 서비스 템플릿'을 선택하여 캐치폼을 생성해 보세요.
템플릿 사용방법
캐치폼 템플릿
데모 서비스 템플릿
이벤트 당첨 경품 선택
다양한 문항 편집 기능 적용
- 객관식 답변(복수선택) 문항 선택개수 제한 설정
- 문항 설명 이미지 추가 / 참고 자료(&링크) 등록
- 객관식 문항 답변별 이미지 추가
미리보기
사용하기
교육 참가 신청
다양한 문항 편집 기능 적용
- 객관식,행렬형(복수선택) 문항 선택개수 제한 설정
- 문항 설명 이미지 추가 / 참고 자료(&링크) 등록
- 객관식 문항 답변별 이미지 추가
미리보기
사용하기
분기형(본인인증 + 드롭다운 + 파일 업로드 + 행렬형)
본인 인증을 통해 당첨자를 확인하고, 수령 방식에 따라 페이지를 분기하여 민감한 정보를 안전하게 수집하는 데 사용됩니다.

미리보기
사용하기
분기형(본인인증 + 파일 업로드 + 행렬형)
본인 인증을 통해 자격을 확인하고, 파일 업로드 및 이용 동의를 한 번에 수집합니다. 세부 조건에 따라 페이지를 분기하여 정보를 체계적으로 취합할 수 있습니다.
미리보기
사용하기
분기형(개인정보 + 드롭다운 + 행렬형 + 장문형)
분기 기능을 활용하여 이용 경험에 따른 맞춤형 만족도 피드백을 수집합니다. 행렬형/드롭다운 문항으로 사용 경험과 이탈 사유를 정량적으로 파악할 수 있습니다.

미리보기
사용하기
개인정보(본인인증) + 단문형 + 파일 업로드
본인 인증을 통해 당첨자 신뢰성을 확보하고, 경품 발송에 필수적인 계정 ID와 인증 파일을 파일 업로드 기능으로 편리하게 수집하는 데 활용할 수 있습니다.
미리보기
사용하기
개인정보 + 행렬형(단일) + 장문형
참석자 개인정보 수집과 함께, 행렬형 문항으로 행사 만족도를 상세히 측정하고, 장문형 문항으로 자유로운 의견 및 건의 사항을 수렴하는 데 활용할 수 있습니다
미리보기
사용하기
GA (보험대리점) 상담 신청
GA 보험 설계 및 상담을 위한 최소 필수 정보(성명, 연락처) 및 개인정보 수집할때 활용할 수 있습니다.
미리보기
사용하기
임직원 단체 상해보험 가입 동의 및 정보 수집
임직원 복지 향상을 위한 단체보험 가입 안내입니다. 보험 가입 및 보험금 청구를 위해 필요한 정보를 수집할 때 활용할 수 있습니다.
미리보기
사용하기
임직원 가족 복지 혜택 신청 및 정보 수집
가족 복지 프로그램(가족 명절 선물, 단체 보험 확대 등) 제공을 위한 정보 수집
미리보기
사용하기
사내 행사 참가 신청 및 사전 조사
워크숍, 노조 여행, 연수 등 회사 내부 행사 참여 의사를 조사하거나 기본 정보를 수집할 때 활용할 수 있습니다.
미리보기
사용하기
회사 내부 직무 교육 만족도 조사
회사 내부 직무 교육의 효과와 만족도를 측정하고, 향후 교육 계획을 수립하는 데 활용됩니다.
미리보기
사용하기
서비스 관련 만족도 조사
기존 고객에게 서비스 이용 경험에 대한 피드백을 요청하고, 수집된 만족도 조사를 바탕으로 서비스 품질 및 고객 경험을 개선하는 데 활용됩니다
미리보기
사용하기
행사 관련 만족도 조사
채용설명회, 간담회, 전시회 등 다양한 행사에 참석한 잠재적 지원자의 행사 만족도와 솔직한 피드백을 수집하는 데 사용됩니다.
미리보기
사용하기
사전 안내 문자 수신 동의서
진행 예정인 교육 및 프로그램 관련 사전 정보를 문자(SMS) 발송하기 위한 수신 동의 및 연락처를 수집하는 데 사용됩니다.
미리보기
사용하기
채용설명회 개최 안내 및 참가 신청
기업에 관심 있는 잠재적 지원자에게 채용 설명회의 일정, 장소, 프로그램 내용을 안내하고, 사전 참가 신청을 유도하는 데 사용합니다.
미리보기
사용하기
스터디/모임 참석 신청
참석 의사를 회신 받아, 자료 및 좌석 준비를 위한 정확한 인원 규모를 확정하는 데 사용합니다.
미리보기
사용하기
광고성 수신 동의 수집
솔루션 또는 커머스 서비스의 홍보마케팅 컨텐츠 발송을 위한 개인정보 수집폼입니다. 연락처/이메일을 수집하여 홍보성 메지시 발송에 활용할 수 있습니다.
미리보기
사용하기
기업 대상 상담 신청
상담 신청을 접수하고, 담당자 정보와 상담 가능 시간대를 파악하여 상담 일정을 조율하는 데 사용합니다.
미리보기
사용하기
이벤트(행사) 관련 문의 접수
진행 중인 각종 이벤트에 대한 고객의 질문을 접수하고, 신속한 답변을 위해 필수 연락처를 수집하는 데 사용합니다.
미리보기
사용하기
용역 대금 지급을 위한 주민등록번호 처리
프로젝트에 참여한 프리랜서 또는 외부 위원에게 용역 대금 지급을 위해 금융 정보와 세금 처리 필수 정보를 수집하는 데 사용합니다.
미리보기
사용하기
SNS 체험단 모집
신규 서비스 또는 제품의 체험단/서포터즈를 모집하기 위해 사용되며, 지원자의 참여 의지와 SNS 활동 정보를 수집하는 데 사용합니다.
미리보기
사용하기
SNS 이벤트 참여자 정보 수집
이벤트 참여자 전원에게 당첨 시 경품 수령에 필요한 참여 계정 정보를 제출하도록 요청하고, 만 14세 이상 본인 인증 의무 등 주요 유의사항을 미리 고지할 때 사용합니다.
미리보기
사용하기
소액 경품 당첨자 정보 수집(본인인증)
경품이 5만 원 미만일 때 제세공과금 관련 정보(주민등록번호 등)를 수집하지 않음을 명시하고, 본인인증 절차를 거쳐 안전하게 확인된 개인정보를 수집합니다.
미리보기
사용하기
고액 경품 당첨자 정보 수집(제세공과금 처리)
경품 발송을 위한 기본 정보와 고액 경품(5만 원 초과)에 대한 제세공과금 대리 신고 및 납부를 위한 필수 개인 정보(주민등록번호, 신분증 등)를 수집하는 데 사용합니다.
미리보기
사용하기
유료 라이선스 고객에게 제공되는 기능입니다.
## Responsive Behavior
- 3 columns at 1440, 2 at 768, 1 at 390; gap 24px.
- Desktop/tablet/mobile evidence uses *-detail-1440/768/390 filenames where available.
## Limits
- No server mutations were performed. Real customer names must become demo data.
