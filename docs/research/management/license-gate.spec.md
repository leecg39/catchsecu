# 관리·로그 라이선스 제한 화면
## 대상
LicenseGate 컴포넌트. 클릭 상호작용 없음. 원본 제한화면 그대로 구현.
근거: set--company--policy.json, log--authority.json 및 같은 이름 screenshot.
## 구조 및 exact CSS
- 페이지: x280 y80 width1160 height898, padding 8px 32px 40px; #fbfbfc.
- 중앙 카드: x636.609375 y424.609375 width446.78125 height176.78125.
- 카드 padding24px; background white; border-radius12px.
- 제목 '접근할 수 없습니다.': Noto Sans KR 20px/700/28px, #484e55; margin-bottom24px.
- 설명 wrapper: #f7f8fa padding16px radius8px display:block; width398.781px.
- 원형 느낌표: 40x40 background rgba(63,64,65,.15) radius50%; margin-right16px.
- 설명 1: 14px/700/22.4px #484e55.
- 설명 2: 14px/400/22.4px #484e55.
## 실제 문구
엔터프라이즈: 해당 라이선스에 제공되지 않는 기능입니다. / 엔터프라이즈 라이선스 구독 후 사용하실 수 있습니다.
유료: 유료 라이선스에 제공되는 기능입니다. / 라이선스 구독 후 사용하실 수 있습니다.
## 경로
엔터프라이즈: /set/company/policy, /log/authority, /log/destruction_certificate, /log/form-approval, /log/destruction-schedule, /log/month-monitoring, /log/access-history, /security/compliance, /security/sso, /security/sso/setting, /security/ip, /security/ip/setting.
유료: /log/mail, /log/member, /log/external-viewer.
## 상태 및 반응형
static; 데이터/설정 편집 없음. sidebar 반응형은 공통 shell.
768/390 기준 set--company--policy--768/390.json과 png 추출 중.
## 자산
보안 아이콘은 inline SVG. 배경 영상/이미지 없음.
