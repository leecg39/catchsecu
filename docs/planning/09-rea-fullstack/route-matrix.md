# 모든 경로의 구현 추적표

186개 정적 경로 선언 집합(구체 경로184 + wildcard2). 동적 경로는 실제 DB ID/토큰 fixture로 시험한다. 각 행 상세 모델·API·화면·수용조건은 `route-matrix.csv/json`에 있다. 이전 페이지별 수용조건은 목표로만 계승했으며 현재 성공 근거가 아니다.

| ID | 경로 | 도메인 | 원본 관찰 상태 | 실행 Task |
|---|---|---|---|---|
| RR001 | `/` | 공지·도움말·문의·공통 경로 | 정적 선언만 확인 | R24-T01~T04 |
| RR002 | `/*` | 공지·도움말·문의·공통 경로 | 정적 선언만 확인 | R24-T01~T04 |
| RR003 | `/IE` | 공지·도움말·문의·공통 경로 | 정적 선언만 확인 | R24-T01~T04 |
| RR004 | `/access-not-allow` | 공지·도움말·문의·공통 경로 | 정적 선언만 확인 | R24-T01~T04 |
| RR005 | `/alimtalk` | 알림톡 채널·템플릿·발송 | 본문 미확인 | R19-T01~T04 |
| RR006 | `/alimtalk/channels` | 알림톡 채널·템플릿·발송 | 리디렉션 관찰 | R19-T01~T04 |
| RR007 | `/alimtalk/history` | 알림톡 채널·템플릿·발송 | 리디렉션 관찰 | R19-T01~T04 |
| RR008 | `/alimtalk/send` | 알림톡 채널·템플릿·발송 | 리디렉션 관찰 | R19-T01~T04 |
| RR009 | `/alimtalk/templates` | 알림톡 채널·템플릿·발송 | 리디렉션 관찰 | R19-T01~T04 |
| RR010 | `/alimtalk/templates/:templateId` | 알림톡 채널·템플릿·발송 | 정적 선언만 확인 | R19-T01~T04 |
| RR011 | `/alimtalk/templates/:templateId/edit` | 알림톡 채널·템플릿·발송 | 정적 선언만 확인 | R19-T01~T04 |
| RR012 | `/alimtalk/templates/register` | 알림톡 채널·템플릿·발송 | 정적 선언만 확인 | R19-T01~T04 |
| RR013 | `/auth-code` | 계정 인증·세션·복구 | 정적 선언만 확인 | R02-T01~T04 |
| RR014 | `/basic/info-usage-purpose` | 처리 목적·동의서·처리방침·서비스 공개문서 | 유료 제한 | R10-T01~T04 |
| RR015 | `/basic/info-usage-purpose/privacy-policy` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR016 | `/basic/result/consent` | 처리 목적·동의서·처리방침·서비스 공개문서 | 유료 제한 | R10-T01~T04 |
| RR017 | `/basic/result/consent/create` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR018 | `/basic/result/consent/edit` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR019 | `/basic/result/consent/phrase` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR020 | `/basic/result/policy` | 처리 목적·동의서·처리방침·서비스 공개문서 | 유료 제한 | R10-T01~T04 |
| RR021 | `/bill/:id` | 라이선스·결제수단·주문·원장·환불 | 정적 선언만 확인 | R21-T01~T04 |
| RR022 | `/bill/:id/refund` | 라이선스·결제수단·주문·원장·환불 | 정적 선언만 확인 | R21-T01~T04 |
| RR023 | `/company-info` | 회사·서비스·초기 설정 | 정적 선언만 확인 | R03-T01~T04 |
| RR024 | `/compliance` | 대시보드·통계·준수·월마감 | 화면 관찰 · 403 동반 | R23-T01~T04 |
| RR025 | `/creditBill/:id` | 라이선스·결제수단·주문·원장·환불 | 정적 선언만 확인 | R21-T01~T04 |
| RR026 | `/customer-use-case/:outerToken` | 공개 폼·응답·첨부·정정 | 정적 선언만 확인 | R11-T01~T04 |
| RR027 | `/dashboard` | 대시보드·통계·준수·월마감 | 화면 관찰 | R23-T01~T04 |
| RR028 | `/dashboard/:serviceId` | 대시보드·통계·준수·월마감 | 정적 선언만 확인 | R23-T01~T04 |
| RR029 | `/document/C/:token` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR030 | `/document/OC/:token` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR031 | `/document/P/:token` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR032 | `/expert/select-company` | 구성원·초대·권한·전문가 | 정적 선언만 확인 | R04-T01~T04 |
| RR033 | `/expire/code` | 계정 인증·세션·복구 | 정적 선언만 확인 | R02-T01~T04 |
| RR034 | `/file-view/:customerId` | 공개 폼·응답·첨부·정정 | 정적 선언만 확인 | R11-T01~T04 |
| RR035 | `/file-view/:customerId/:questionId/:fileId` | 공개 폼·응답·첨부·정정 | 정적 선언만 확인 | R11-T01~T04 |
| RR036 | `/file-view/:customerId/:questionId/:fileId/shared` | 공개 폼·응답·첨부·정정 | 정적 선언만 확인 | R11-T01~T04 |
| RR037 | `/file-view/:customerId/shared` | 공개 폼·응답·첨부·정정 | 정적 선언만 확인 | R11-T01~T04 |
| RR038 | `/form/ad-manage` | 광고 동의·수신거부 | 화면 관찰 | R15-T01~T04 |
| RR039 | `/form/ai/agreement` | 캐치폼·질문·템플릿·단계 편집 | 정적 선언만 확인 | R08-T01~T04 |
| RR040 | `/form/ai/basic-frame` | 캐치폼·질문·템플릿·단계 편집 | 정적 선언만 확인 | R08-T01~T04 |
| RR041 | `/form/ai/basic-frame/v3` | 캐치폼·질문·템플릿·단계 편집 | 정적 선언만 확인 | R08-T01~T04 |
| RR042 | `/form/ai/create` | 캐치폼·질문·템플릿·단계 편집 | 본문 미확인 | R08-T01~T04 |
| RR043 | `/form/ai/recipient` | 캐치폼·질문·템플릿·단계 편집 | 정적 선언만 확인 | R08-T01~T04 |
| RR044 | `/form/ai/set` | 캐치폼·질문·템플릿·단계 편집 | 정적 선언만 확인 | R08-T01~T04 |
| RR045 | `/form/ai/setting` | 캐치폼·질문·템플릿·단계 편집 | 정적 선언만 확인 | R08-T01~T04 |
| RR046 | `/form/ai/share` | 폼 승인·게시·고정 URL | 정적 선언만 확인 | R09-T01~T04 |
| RR047 | `/form/fixed-url` | 폼 승인·게시·고정 URL | 화면 관찰 · 401 동반 | R09-T01~T04 |
| RR048 | `/form/info-upload` | 개인정보 업로드·이관 | 유료 제한 | R14-T01~T04 |
| RR049 | `/form/info-upload/agreement` | 개인정보 업로드·이관 | 정적 선언만 확인 | R14-T01~T04 |
| RR050 | `/form/info-upload/recipient` | 개인정보 업로드·이관 | 정적 선언만 확인 | R14-T01~T04 |
| RR051 | `/form/manage` | 캐치폼·질문·템플릿·단계 편집 | 화면 관찰 | R08-T01~T04 |
| RR052 | `/form/manage/applicant/:formId` | 공개 폼·응답·첨부·정정 | 정적 선언만 확인 | R11-T01~T04 |
| RR053 | `/form/manage/applicant/:serviceId/:formId` | 공개 폼·응답·첨부·정정 | 정적 선언만 확인 | R11-T01~T04 |
| RR054 | `/form/manage/applicant/log/:formId` | 개인정보·권한·활동 감사로그 | 정적 선언만 확인 | R22-T01~T04 |
| RR055 | `/form/template` | 캐치폼·질문·템플릿·단계 편집 | 403 동반 빈 목록 | R08-T01~T04 |
| RR056 | `/gpki/email-register` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR057 | `/gpki/fail` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR058 | `/gwloginUser/login` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR059 | `/help-center` | 공지·도움말·문의·공통 경로 | 화면 관찰 | R24-T01~T04 |
| RR060 | `/identification/:result` | 정보주체·동의이력·본인인증 | 정적 선언만 확인 | R13-T01~T04 |
| RR061 | `/infoOwner/action-history/:infoOwnerToken` | 정보주체·동의이력·본인인증 | 정적 선언만 확인 | R13-T01~T04 |
| RR062 | `/infoOwner/agree-history/:infoOwnerToken` | 정보주체·동의이력·본인인증 | 정적 선언만 확인 | R13-T01~T04 |
| RR063 | `/infoOwner/find` | 정보주체·동의이력·본인인증 | 정적 선언만 확인 | R13-T01~T04 |
| RR064 | `/infoOwner/find/complete` | 정보주체·동의이력·본인인증 | 정적 선언만 확인 | R13-T01~T04 |
| RR065 | `/infoOwner/form-interrupt` | 정보주체·동의이력·본인인증 | 정적 선언만 확인 | R13-T01~T04 |
| RR066 | `/infoOwner/formComplete` | 정보주체·동의이력·본인인증 | 정적 선언만 확인 | R13-T01~T04 |
| RR067 | `/integration/message` | 알림 받기·웹훅·이메일 알림 | 화면 관찰 | R20-T01~T04 |
| RR068 | `/jap_intro` | 공개 폼·응답·첨부·정정 | 정적 선언만 확인 | R11-T01~T04 |
| RR069 | `/kakao-playground` | 알림톡 채널·템플릿·발송 | 정적 선언만 확인 | R19-T01~T04 |
| RR070 | `/link/oauth2` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR071 | `/link/oauth2/verified` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR072 | `/loading` | 공지·도움말·문의·공통 경로 | 정적 선언만 확인 | R24-T01~T04 |
| RR073 | `/log/access-history` | 개인정보·권한·활동 감사로그 | 정적 선언만 확인 | R22-T01~T04 |
| RR074 | `/log/ad-monitoring` | 개인정보·권한·활동 감사로그 | 화면 관찰 | R22-T01~T04 |
| RR075 | `/log/authority` | 개인정보·권한·활동 감사로그 | 엔터프라이즈 제한 | R22-T01~T04 |
| RR076 | `/log/collect-destruction` | 보유기간·파기 일정·증명서 | 정적 선언만 확인 | R16-T01~T04 |
| RR077 | `/log/customer` | 개인정보·권한·활동 감사로그 | 정적 선언만 확인 | R22-T01~T04 |
| RR078 | `/log/destruction-schedule` | 보유기간·파기 일정·증명서 | 정적 선언만 확인 | R16-T01~T04 |
| RR079 | `/log/destruction_certificate` | 보유기간·파기 일정·증명서 | 정적 선언만 확인 | R16-T01~T04 |
| RR080 | `/log/external-viewer` | 개인정보·권한·활동 감사로그 | 유료 제한 | R22-T01~T04 |
| RR081 | `/log/form-approval` | 폼 승인·게시·고정 URL | 정적 선언만 확인 | R09-T01~T04 |
| RR082 | `/log/info-monitoring` | 개인정보·권한·활동 감사로그 | 화면 관찰 | R22-T01~T04 |
| RR083 | `/log/mail` | 개인정보·권한·활동 감사로그 | 유료 제한 | R22-T01~T04 |
| RR084 | `/log/member` | 개인정보·권한·활동 감사로그 | 유료 제한 | R22-T01~T04 |
| RR085 | `/log/month-monitoring` | 대시보드·통계·준수·월마감 | 엔터프라이즈 제한 | R23-T01~T04 |
| RR086 | `/log/retention` | 보유기간·파기 일정·증명서 | 유료 제한 | R16-T01~T04 |
| RR087 | `/log/service` | 개인정보·권한·활동 감사로그 | 화면 관찰 | R22-T01~T04 |
| RR088 | `/login` | 계정 인증·세션·복구 | 정적 선언만 확인 | R02-T01~T04 |
| RR089 | `/login-email` | 계정 인증·세션·복구 | 정적 선언만 확인 | R02-T01~T04 |
| RR090 | `/login-failed` | 계정 인증·세션·복구 | 정적 선언만 확인 | R02-T01~T04 |
| RR091 | `/login-otp` | 계정 인증·세션·복구 | 정적 선언만 확인 | R02-T01~T04 |
| RR092 | `/login/gpki` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR093 | `/login/gpki/callback` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR094 | `/login/oauth2` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR095 | `/login/oauth2/verified` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR096 | `/login/saeol` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR097 | `/login/saeol/callback` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR098 | `/login/saml` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR099 | `/login/saml/fail` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR100 | `/login/saml/start` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR101 | `/login/saml/verified` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR102 | `/logout` | 계정 인증·세션·복구 | 정적 선언만 확인 | R02-T01~T04 |
| RR103 | `/mail` | 발신메일·이메일 발송·수신거부 | 정적 선언만 확인 | R18-T01~T04 |
| RR104 | `/mail/catchform` | 발신메일·이메일 발송·수신거부 | 유료 제한 | R18-T01~T04 |
| RR105 | `/mail/direct` | 발신메일·이메일 발송·수신거부 | 유료 제한 | R18-T01~T04 |
| RR106 | `/mail/history` | 발신메일·이메일 발송·수신거부 | 화면 관찰 · 401 동반 | R18-T01~T04 |
| RR107 | `/mail/no-mail` | 발신메일·이메일 발송·수신거부 | 정적 선언만 확인 | R18-T01~T04 |
| RR108 | `/mail/number` | 발신메일·이메일 발송·수신거부 | 화면 관찰 | R18-T01~T04 |
| RR109 | `/marketing-detail` | 대시보드·통계·준수·월마감 | 화면 관찰 | R23-T01~T04 |
| RR110 | `/marketing-detail/:serviceId` | 대시보드·통계·준수·월마감 | 정적 선언만 확인 | R23-T01~T04 |
| RR111 | `/my-page` | MY·프로필·활동 검토·탈퇴 | 본문 미확인 | R05-T01~T04 |
| RR112 | `/my-page/activity-log` | MY·프로필·활동 검토·탈퇴 | 화면 관찰 | R05-T01~T04 |
| RR113 | `/my-page/delete` | MY·프로필·활동 검토·탈퇴 | 정적 선언만 확인 | R05-T01~T04 |
| RR114 | `/my-page/info` | MY·프로필·활동 검토·탈퇴 | 화면 관찰 · 403 동반 | R05-T01~T04 |
| RR115 | `/my-page/info-activity-log` | MY·프로필·활동 검토·탈퇴 | 화면 관찰 · 403 동반 | R05-T01~T04 |
| RR116 | `/my-page/info/edit` | MY·프로필·활동 검토·탈퇴 | 정적 선언만 확인 | R05-T01~T04 |
| RR117 | `/not-allow-ip` | 계정 인증·세션·복구 | 정적 선언만 확인 | R02-T01~T04 |
| RR118 | `/notice` | 공지·도움말·문의·공통 경로 | 화면 관찰 | R24-T01~T04 |
| RR119 | `/notice/:admNotiId` | 공지·도움말·문의·공통 경로 | 정적 선언만 확인 | R24-T01~T04 |
| RR120 | `/oauth2/fail` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR121 | `/oauth2/invite/signup` | 구성원·초대·권한·전문가 | 정적 선언만 확인 | R04-T01~T04 |
| RR122 | `/oauth2/signup` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR123 | `/password-change-email` | 계정 인증·세션·복구 | 정적 선언만 확인 | R02-T01~T04 |
| RR124 | `/password-change-email/complete` | 계정 인증·세션·복구 | 정적 선언만 확인 | R02-T01~T04 |
| RR125 | `/password-change-rule` | 계정 인증·세션·복구 | 정적 선언만 확인 | R02-T01~T04 |
| RR126 | `/passwordChange` | 계정 인증·세션·복구 | 정적 선언만 확인 | R02-T01~T04 |
| RR127 | `/pay/billing-policy` | 라이선스·결제수단·주문·원장·환불 | 정적 선언만 확인 | R21-T01~T04 |
| RR128 | `/pay/cancel` | 라이선스·결제수단·주문·원장·환불 | 정적 선언만 확인 | R21-T01~T04 |
| RR129 | `/pay/credit/success/:purchaseId` | 라이선스·결제수단·주문·원장·환불 | 정적 선언만 확인 | R21-T01~T04 |
| RR130 | `/pay/history` | 라이선스·결제수단·주문·원장·환불 | 화면 관찰 | R21-T01~T04 |
| RR131 | `/pay/license-service` | 라이선스·결제수단·주문·원장·환불 | 화면 관찰 | R21-T01~T04 |
| RR132 | `/pay/membership/detail` | 라이선스·결제수단·주문·원장·환불 | 정적 선언만 확인 | R21-T01~T04 |
| RR133 | `/pay/method` | 라이선스·결제수단·주문·원장·환불 | 리디렉션 관찰 | R21-T01~T04 |
| RR134 | `/pay/plus/fail/:errorCode` | 라이선스·결제수단·주문·원장·환불 | 정적 선언만 확인 | R21-T01~T04 |
| RR135 | `/pay/plus/success/:purchaseId` | 라이선스·결제수단·주문·원장·환불 | 정적 선언만 확인 | R21-T01~T04 |
| RR136 | `/pay/plus/success/:purchasedId/:type` | 라이선스·결제수단·주문·원장·환불 | 정적 선언만 확인 | R21-T01~T04 |
| RR137 | `/pay/result/fail` | 라이선스·결제수단·주문·원장·환불 | 정적 선언만 확인 | R21-T01~T04 |
| RR138 | `/pay/result/success/:purchaseId` | 라이선스·결제수단·주문·원장·환불 | 정적 선언만 확인 | R21-T01~T04 |
| RR139 | `/pay/service-asset` | 라이선스·결제수단·주문·원장·환불 | 권한 제한 | R21-T01~T04 |
| RR140 | `/pay/usage/history` | 라이선스·결제수단·주문·원장·환불 | 리디렉션 관찰 | R21-T01~T04 |
| RR141 | `/privacy-detail` | 대시보드·통계·준수·월마감 | 화면 관찰 | R23-T01~T04 |
| RR142 | `/privacy-detail/:serviceId` | 대시보드·통계·준수·월마감 | 정적 선언만 확인 | R23-T01~T04 |
| RR143 | `/project/:outerToken/form` | 공개 폼·응답·첨부·정정 | 정적 선언만 확인 | R11-T01~T04 |
| RR144 | `/projects/:outerToken/form` | 공개 폼·응답·첨부·정정 | 정적 선언만 확인 | R11-T01~T04 |
| RR145 | `/saeol/fail/:org` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR146 | `/security` | 회사 보안정책·IP·MFA | 본문 미확인 | R06-T01~T04 |
| RR147 | `/security/*` | 공지·도움말·문의·공통 경로 | 정적 선언만 확인 | R24-T01~T04 |
| RR148 | `/security/compliance` | 회사 보안정책·IP·MFA | 엔터프라이즈 제한 | R06-T01~T04 |
| RR149 | `/security/ip` | 회사 보안정책·IP·MFA | 엔터프라이즈 제한 | R06-T01~T04 |
| RR150 | `/security/ip/setting` | 회사 보안정책·IP·MFA | 정적 선언만 확인 | R06-T01~T04 |
| RR151 | `/security/sso` | SSO·OAuth·기관 인증 | 엔터프라이즈 제한 | R07-T01~T04 |
| RR152 | `/security/sso/setting` | SSO·OAuth·기관 인증 | 정적 선언만 확인 | R07-T01~T04 |
| RR153 | `/security/two-factor` | 회사 보안정책·IP·MFA | 리디렉션 관찰 | R06-T01~T04 |
| RR154 | `/security/two-factor/setting` | 회사 보안정책·IP·MFA | 정적 선언만 확인 | R06-T01~T04 |
| RR155 | `/service/none` | 회사·서비스·초기 설정 | 정적 선언만 확인 | R03-T01~T04 |
| RR156 | `/services/:serviceId/catchforms` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR157 | `/services/:serviceId/catchforms/:isDomestic/resident/agree/:agree` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR158 | `/services/:serviceId/catchforms/category/:category/agree/:agree` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR159 | `/services/:serviceId/catchforms/recipients` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR160 | `/services/:serviceId/catchforms/recipients/agree/:agree` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR161 | `/services/:serviceId/oversea/catchforms` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR162 | `/services/:serviceId/oversea/catchforms/agree/:agree` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR163 | `/set/authority` | 구성원·초대·권한·전문가 | 리디렉션 관찰 | R04-T01~T04 |
| RR164 | `/set/company` | 회사·서비스·초기 설정 | 화면 관찰 | R03-T01~T04 |
| RR165 | `/set/company/edit` | 회사·서비스·초기 설정 | 정적 선언만 확인 | R03-T01~T04 |
| RR166 | `/set/company/policy` | 회사 보안정책·IP·MFA | 엔터프라이즈 제한 | R06-T01~T04 |
| RR167 | `/set/company/policy/setting` | 회사 보안정책·IP·MFA | 정적 선언만 확인 | R06-T01~T04 |
| RR168 | `/set/member` | 구성원·초대·권한·전문가 | 유료 제한 | R04-T01~T04 |
| RR169 | `/set/service` | 회사·서비스·초기 설정 | 화면 관찰 | R03-T01~T04 |
| RR170 | `/set/service/consent` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR171 | `/set/service/consigment/mail` | 처리 목적·동의서·처리방침·서비스 공개문서 | 정적 선언만 확인 | R10-T01~T04 |
| RR172 | `/set/service/modification` | 회사·서비스·초기 설정 | 정적 선언만 확인 | R03-T01~T04 |
| RR173 | `/shared-privacy/email-verify` | 외부 공유·열람자 인증 | 정적 선언만 확인 | R12-T01~T04 |
| RR174 | `/shared-privacy/verify` | 외부 공유·열람자 인증 | 화면 관찰 | R12-T01~T04 |
| RR175 | `/shared-privacy/view` | 외부 공유·열람자 인증 | 정적 선언만 확인 | R12-T01~T04 |
| RR176 | `/signup` | 계정 인증·세션·복구 | 정적 선언만 확인 | R02-T01~T04 |
| RR177 | `/sms` | 발신번호·문자 캠페인 | 정적 선언만 확인 | R17-T01~T04 |
| RR178 | `/sms/catchform` | 발신번호·문자 캠페인 | 리디렉션 관찰 | R17-T01~T04 |
| RR179 | `/sms/direct` | 발신번호·문자 캠페인 | 리디렉션 관찰 | R17-T01~T04 |
| RR180 | `/sms/history` | 발신번호·문자 캠페인 | 화면 관찰 | R17-T01~T04 |
| RR181 | `/sms/nonumber` | 발신번호·문자 캠페인 | 정적 선언만 확인 | R17-T01~T04 |
| RR182 | `/sms/number` | 발신번호·문자 캠페인 | 화면 관찰 | R17-T01~T04 |
| RR183 | `/test-projects/:outerToken/form` | 공개 폼·응답·첨부·정정 | 정적 선언만 확인 | R11-T01~T04 |
| RR184 | `/two-step` | 계정 인증·세션·복구 | 정적 선언만 확인 | R02-T01~T04 |
| RR185 | `/two-step-setting` | 계정 인증·세션·복구 | 정적 선언만 확인 | R02-T01~T04 |
| RR186 | `/url/:outerToken` | 공개 폼·응답·첨부·정정 | 정적 선언만 확인 | R11-T01~T04 |
