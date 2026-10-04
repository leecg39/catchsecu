# 181행 경로 매트릭스 (2026-10-04)

원본 `docs/research/route-coverage.csv` 181행 × 라이브 스윕(anonymous/owner/viewer). 동적 경로(dyn)는 무효값 통제-오류 스윝 + Task별 실fixture 게이트로 커버.

| # | 경로 | 동적 | 익명 | owner | viewer | 근거 |
|---|---|---|---|---|---|---|
| 1 | `/` |  | 307→/login?returnTo=%2F | 200 | 200 | static-sweep |
| 2 | `/two-step-setting` |  | 200 | 200 | 200 | static-sweep |
| 3 | `/file-view/:customerId` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 4 | `/file-view/:customerId/shared` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 5 | `/file-view/:customerId/:questionId/:fileId` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 6 | `/file-view/:customerId/:questionId/:fileId/shared` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 7 | `/projects/:outerToken/form` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 8 | `/project/:outerToken/form` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 9 | `/url/:outerToken` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 10 | `/test-projects/:outerToken/form` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 11 | `/customer-use-case/:outerToken` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 12 | `/infoOwner/formComplete` |  | 200 | 200 | 200 | static-sweep |
| 13 | `/infoOwner/form-interrupt` |  | 200 | 200 | 200 | static-sweep |
| 14 | `/identification/:result` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 15 | `/jap_intro` |  | 200 | 200 | 200 | static-sweep |
| 16 | `/gwloginUser/login` |  | 200 | 200 | 200 | static-sweep |
| 17 | `/login` |  | 200 | 200 | 200 | static-sweep |
| 18 | `/password-change-email` |  | 200 | 200 | 200 | static-sweep |
| 19 | `/passwordChange` |  | 200 | 200 | 200 | static-sweep |
| 20 | `/password-change-email/complete` |  | 200 | 200 | 200 | static-sweep |
| 21 | `/password-change-rule` |  | 200 | 200 | 200 | static-sweep |
| 22 | `/auth-code` |  | 200 | 200 | 200 | static-sweep |
| 23 | `/signup` |  | 200 | 200 | 200 | static-sweep |
| 24 | `/expire/code` |  | 200 | 200 | 200 | static-sweep |
| 25 | `/two-step` |  | 200 | 200 | 200 | static-sweep |
| 26 | `/not-allow-ip` |  | 200 | 200 | 200 | static-sweep |
| 27 | `/login-email` |  | 200 | 200 | 200 | static-sweep |
| 28 | `/login-otp` |  | 200 | 200 | 200 | static-sweep |
| 29 | `/login-failed` |  | 200 | 200 | 200 | static-sweep |
| 30 | `/set/authority` |  | 307→/login?returnTo=%2Fset%2Fauthority | 200 | 200 | static-sweep |
| 31 | `/log/authority` |  | 307→/login?returnTo=%2Flog%2Fauthority | 200 | 307→/access-not-allow?reason=role | static-sweep |
| 32 | `/dashboard/:serviceId` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 33 | `/dashboard` |  | 307→/login?returnTo=%2Fdashboard | 200 | 200 | static-sweep |
| 34 | `/privacy-detail` |  | 307→/login?returnTo=%2Fprivacy-detail | 200 | 200 | static-sweep |
| 35 | `/privacy-detail/:serviceId` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 36 | `/marketing-detail` |  | 307→/login?returnTo=%2Fmarketing-detail | 200 | 200 | static-sweep |
| 37 | `/marketing-detail/:serviceId` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 38 | `/compliance` |  | 307→/login?returnTo=%2Fcompliance | 200 | 200 | static-sweep |
| 39 | `/basic/info-usage-purpose` |  | 307→/login?returnTo=%2Fbasic%2Finfo-usage-purpose | 200 | 200 | static-sweep |
| 40 | `/basic/result/consent` |  | 307→/login?returnTo=%2Fbasic%2Fresult%2Fconsent | 200 | 200 | static-sweep |
| 41 | `/basic/result/consent/phrase` |  | 307→/login?returnTo=%2Fbasic%2Fresult%2Fconsent%2Fphrase | 200 | 200 | static-sweep |
| 42 | `/basic/result/consent/edit` |  | 307→/login?returnTo=%2Fbasic%2Fresult%2Fconsent%2Fedit | 200 | 200 | static-sweep |
| 43 | `/basic/result/consent/create` |  | 307→/login?returnTo=%2Fbasic%2Fresult%2Fconsent%2Fcreate | 200 | 200 | static-sweep |
| 44 | `/basic/info-usage-purpose/privacy-policy` |  | 307→/login?returnTo=%2Fbasic%2Finfo-usage-purpose%2Fprivacy-policy | 200 | 200 | static-sweep |
| 45 | `/basic/result/policy` |  | 307→/login?returnTo=%2Fbasic%2Fresult%2Fpolicy | 200 | 200 | static-sweep |
| 46 | `/form/template` |  | 307→/login?returnTo=%2Fform%2Ftemplate | 200 | 200 | static-sweep |
| 47 | `/form/ai/create` |  | 307→/login?returnTo=%2Fform%2Fai%2Fcreate | 200 | 200 | static-sweep |
| 48 | `/form/ai/recipient` |  | 307→/login?returnTo=%2Fform%2Fai%2Frecipient | 200 | 200 | static-sweep |
| 49 | `/form/ai/set` |  | 307→/login?returnTo=%2Fform%2Fai%2Fset | 200 | 200 | static-sweep |
| 50 | `/form/ai/share` |  | 307→/login?returnTo=%2Fform%2Fai%2Fshare | 200 | 200 | static-sweep |
| 51 | `/form/manage` |  | 307→/login?returnTo=%2Fform%2Fmanage | 200 | 200 | static-sweep |
| 52 | `/form/manage/applicant/:formId` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 53 | `/form/manage/applicant/:serviceId/:formId` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 54 | `/form/manage/applicant/log/:formId` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 55 | `/form/ad-manage` |  | 307→/login?returnTo=%2Fform%2Fad-manage | 200 | 200 | static-sweep |
| 56 | `/form/ai/basic-frame` |  | 307→/login?returnTo=%2Fform%2Fai%2Fbasic-frame | 200 | 200 | static-sweep |
| 57 | `/form/ai/basic-frame/v3` |  | 307→/login?returnTo=%2Fform%2Fai%2Fbasic-frame%2Fv3 | 200 | 200 | static-sweep |
| 58 | `/form/ai/agreement` |  | 307→/login?returnTo=%2Fform%2Fai%2Fagreement | 200 | 200 | static-sweep |
| 59 | `/form/ai/setting` |  | 307→/login?returnTo=%2Fform%2Fai%2Fsetting | 200 | 200 | static-sweep |
| 60 | `/form/fixed-url` |  | 307→/login?returnTo=%2Fform%2Ffixed-url | 200 | 200 | static-sweep |
| 61 | `/form/info-upload` |  | 307→/login?returnTo=%2Fform%2Finfo-upload | 200 | 200 | static-sweep |
| 62 | `/form/info-upload/agreement` |  | 307→/login?returnTo=%2Fform%2Finfo-upload%2Fagreement | 200 | 200 | static-sweep |
| 63 | `/form/info-upload/recipient` |  | 307→/login?returnTo=%2Fform%2Finfo-upload%2Frecipient | 200 | 200 | static-sweep |
| 64 | `/integration/message` |  | 307→/login?returnTo=%2Fintegration%2Fmessage | 200 | 200 | static-sweep |
| 65 | `/alimtalk` |  | 307→/login?returnTo=%2Falimtalk | 200 | 200 | static-sweep |
| 66 | `/alimtalk/channels` |  | 307→/login?returnTo=%2Falimtalk%2Fchannels | 200 | 200 | static-sweep |
| 67 | `/alimtalk/templates` |  | 307→/login?returnTo=%2Falimtalk%2Ftemplates | 200 | 200 | static-sweep |
| 68 | `/alimtalk/templates/register` |  | 307→/login?returnTo=%2Falimtalk%2Ftemplates%2Fregister | 200 | 200 | static-sweep |
| 69 | `/alimtalk/templates/:templateId` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 70 | `/alimtalk/templates/:templateId/edit` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 71 | `/alimtalk/send` |  | 307→/login?returnTo=%2Falimtalk%2Fsend | 200 | 200 | static-sweep |
| 72 | `/alimtalk/history` |  | 307→/login?returnTo=%2Falimtalk%2Fhistory | 200 | 200 | static-sweep |
| 73 | `/kakao-playground` |  | 307→/login?returnTo=%2Fkakao-playground | 200 | 200 | static-sweep |
| 74 | `/mail` |  | 307→/login?returnTo=%2Fmail | 200 | 200 | static-sweep |
| 75 | `/mail/catchform` |  | 307→/login?returnTo=%2Fmail%2Fcatchform | 200 | 200 | static-sweep |
| 76 | `/mail/direct` |  | 307→/login?returnTo=%2Fmail%2Fdirect | 200 | 200 | static-sweep |
| 77 | `/mail/number` |  | 307→/login?returnTo=%2Fmail%2Fnumber | 200 | 200 | static-sweep |
| 78 | `/mail/history` |  | 307→/login?returnTo=%2Fmail%2Fhistory | 200 | 200 | static-sweep |
| 79 | `/mail/no-mail` |  | 307→/login?returnTo=%2Fmail%2Fno-mail | 200 | 200 | static-sweep |
| 80 | `/log/info-monitoring` |  | 307→/login?returnTo=%2Flog%2Finfo-monitoring | 200 | 307→/access-not-allow?reason=role | static-sweep |
| 81 | `/log/ad-monitoring` |  | 307→/login?returnTo=%2Flog%2Fad-monitoring | 200 | 307→/access-not-allow?reason=role | static-sweep |
| 82 | `/log/customer` |  | 307→/login?returnTo=%2Flog%2Fcustomer | 200 | 307→/access-not-allow?reason=role | static-sweep |
| 83 | `/log/service` |  | 307→/login?returnTo=%2Flog%2Fservice | 200 | 307→/access-not-allow?reason=role | static-sweep |
| 84 | `/log/collect-destruction` |  | 307→/login?returnTo=%2Flog%2Fcollect-destruction | 200 | 200 | static-sweep |
| 85 | `/log/destruction_certificate` |  | 307→/login?returnTo=%2Flog%2Fdestruction_certificate | 200 | 200 | static-sweep |
| 86 | `/log/form-approval` |  | 307→/login?returnTo=%2Flog%2Fform-approval | 200 | 200 | static-sweep |
| 87 | `/log/destruction-schedule` |  | 307→/login?returnTo=%2Flog%2Fdestruction-schedule | 200 | 200 | static-sweep |
| 88 | `/log/mail` |  | 307→/login?returnTo=%2Flog%2Fmail | 200 | 307→/access-not-allow?reason=role | static-sweep |
| 89 | `/log/month-monitoring` |  | 307→/login?returnTo=%2Flog%2Fmonth-monitoring | 200 | 200 | static-sweep |
| 90 | `/log/access-history` |  | 307→/login?returnTo=%2Flog%2Faccess-history | 200 | 307→/access-not-allow?reason=role | static-sweep |
| 91 | `/log/external-viewer` |  | 307→/login?returnTo=%2Flog%2Fexternal-viewer | 200 | 307→/access-not-allow?reason=role | static-sweep |
| 92 | `/my-page` |  | 307→/login?returnTo=%2Fmy-page | 200 | 200 | static-sweep |
| 93 | `/my-page/info` |  | 307→/login?returnTo=%2Fmy-page%2Finfo | 200 | 200 | static-sweep |
| 94 | `/my-page/info/edit` |  | 307→/login?returnTo=%2Fmy-page%2Finfo%2Fedit | 200 | 200 | static-sweep |
| 95 | `/my-page/delete` |  | 307→/login?returnTo=%2Fmy-page%2Fdelete | 200 | 200 | static-sweep |
| 96 | `/my-page/activity-log` |  | 307→/login?returnTo=%2Fmy-page%2Factivity-log | 200 | 200 | static-sweep |
| 97 | `/my-page/info-activity-log` |  | 307→/login?returnTo=%2Fmy-page%2Finfo-activity-log | 200 | 200 | static-sweep |
| 98 | `/notice` |  | 307→/login?returnTo=%2Fnotice | 200 | 200 | static-sweep |
| 99 | `/notice/:admNotiId` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 100 | `/pay/membership/detail` |  | 307→/login?returnTo=%2Fpay%2Fmembership%2Fdetail | 200 | 200 | static-sweep |
| 101 | `/pay/billing-policy` |  | 307→/login?returnTo=%2Fpay%2Fbilling-policy | 200 | 200 | static-sweep |
| 102 | `/pay/license-service` |  | 307→/login?returnTo=%2Fpay%2Flicense-service | 200 | 200 | static-sweep |
| 103 | `/pay/service-asset` |  | 307→/login?returnTo=%2Fpay%2Fservice-asset | 200 | 200 | static-sweep |
| 104 | `/pay/method` |  | 307→/login?returnTo=%2Fpay%2Fmethod | 200 | 200 | static-sweep |
| 105 | `/pay/cancel` |  | 307→/login?returnTo=%2Fpay%2Fcancel | 200 | 200 | static-sweep |
| 106 | `/pay/history` |  | 307→/login?returnTo=%2Fpay%2Fhistory | 200 | 200 | static-sweep |
| 107 | `/pay/usage/history` |  | 307→/login?returnTo=%2Fpay%2Fusage%2Fhistory | 200 | 200 | static-sweep |
| 108 | `/pay/result/success/:purchaseId` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 109 | `/pay/credit/success/:purchaseId` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 110 | `/pay/plus/success/:purchaseId` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 111 | `/pay/plus/success/:purchasedId/:type` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 112 | `/pay/result/fail` |  | 307→/login?returnTo=%2Fpay%2Fresult%2Ffail | 200 | 200 | static-sweep |
| 113 | `/pay/plus/fail/:errorCode` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 114 | `/creditBill/:id` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 115 | `/bill/:id` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 116 | `/bill/:id/refund` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 117 | `/security` |  | 307→/login?returnTo=%2Fsecurity | 200 | 200 | static-sweep |
| 118 | `/security/compliance` |  | 307→/login?returnTo=%2Fsecurity%2Fcompliance | 200 | 200 | static-sweep |
| 119 | `/security/sso` |  | 307→/login?returnTo=%2Fsecurity%2Fsso | 200 | 200 | static-sweep |
| 120 | `/security/sso/setting` |  | 307→/login?returnTo=%2Fsecurity%2Fsso%2Fsetting | 200 | 200 | static-sweep |
| 121 | `/security/ip` |  | 307→/login?returnTo=%2Fsecurity%2Fip | 200 | 200 | static-sweep |
| 122 | `/security/ip/setting` |  | 307→/login?returnTo=%2Fsecurity%2Fip%2Fsetting | 200 | 200 | static-sweep |
| 123 | `/security/two-factor` |  | 307→/login?returnTo=%2Fsecurity%2Ftwo-factor | 200 | 200 | static-sweep |
| 124 | `/security/two-factor/setting` |  | 307→/login?returnTo=%2Fsecurity%2Ftwo-factor%2Fsetting | 200 | 200 | static-sweep |
| 125 | `/set/company` |  | 307→/login?returnTo=%2Fset%2Fcompany | 200 | 200 | static-sweep |
| 126 | `/set/company/edit` |  | 307→/login?returnTo=%2Fset%2Fcompany%2Fedit | 200 | 200 | static-sweep |
| 127 | `/set/company/policy` |  | 307→/login?returnTo=%2Fset%2Fcompany%2Fpolicy | 200 | 200 | static-sweep |
| 128 | `/set/company/policy/setting` |  | 307→/login?returnTo=%2Fset%2Fcompany%2Fpolicy%2Fsetting | 200 | 200 | static-sweep |
| 129 | `/set/service` |  | 307→/login?returnTo=%2Fset%2Fservice | 200 | 200 | static-sweep |
| 130 | `/set/service/modification` |  | 307→/login?returnTo=%2Fset%2Fservice%2Fmodification | 200 | 200 | static-sweep |
| 131 | `/set/service/consent` |  | 307→/login?returnTo=%2Fset%2Fservice%2Fconsent | 200 | 200 | static-sweep |
| 132 | `/set/service/consigment/mail` |  | 307→/login?returnTo=%2Fset%2Fservice%2Fconsigment%2Fmail | 200 | 200 | static-sweep |
| 133 | `/set/member` |  | 307→/login?returnTo=%2Fset%2Fmember | 200 | 200 | static-sweep |
| 134 | `/log/member` |  | 307→/login?returnTo=%2Flog%2Fmember | 200 | 307→/access-not-allow?reason=role | static-sweep |
| 135 | `/sms` |  | 307→/login?returnTo=%2Fsms | 200 | 200 | static-sweep |
| 136 | `/sms/catchform` |  | 307→/login?returnTo=%2Fsms%2Fcatchform | 200 | 200 | static-sweep |
| 137 | `/sms/direct` |  | 307→/login?returnTo=%2Fsms%2Fdirect | 200 | 200 | static-sweep |
| 138 | `/sms/number` |  | 307→/login?returnTo=%2Fsms%2Fnumber | 200 | 200 | static-sweep |
| 139 | `/sms/history` |  | 307→/login?returnTo=%2Fsms%2Fhistory | 200 | 200 | static-sweep |
| 140 | `/sms/nonumber` |  | 307→/login?returnTo=%2Fsms%2Fnonumber | 200 | 200 | static-sweep |
| 141 | `/services/:serviceId/catchforms/category/:category/agree/:agree` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 142 | `/services/:serviceId/catchforms/recipients/agree/:agree` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 143 | `/services/:serviceId/oversea/catchforms/agree/:agree` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 144 | `/services/:serviceId/catchforms` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 145 | `/services/:serviceId/catchforms/recipients` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 146 | `/services/:serviceId/oversea/catchforms` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 147 | `/services/:serviceId/catchforms/:isDomestic/resident/agree/:agree` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 148 | `/service/none` |  | 307→/login?returnTo=%2Fservice%2Fnone | 200 | 200 | static-sweep |
| 149 | `/company-info` |  | 307→/login?returnTo=%2Fcompany-info | 200 | 200 | static-sweep |
| 150 | `/login/oauth2` |  | 200 | 200 | 200 | static-sweep |
| 151 | `/login/oauth2/verified` |  | 200 | 200 | 200 | static-sweep |
| 152 | `/login/gpki` |  | 200 | 200 | 200 | static-sweep |
| 153 | `/login/saeol` |  | 200 | 200 | 200 | static-sweep |
| 154 | `/gpki/fail` |  | 200 | 200 | 200 | static-sweep |
| 155 | `/gpki/email-register` |  | 200 | 200 | 200 | static-sweep |
| 156 | `/saeol/fail/:org` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 157 | `/link/oauth2` |  | 200 | 200 | 200 | static-sweep |
| 158 | `/link/oauth2/verified` |  | 200 | 200 | 200 | static-sweep |
| 159 | `/oauth2/fail` |  | 200 | 200 | 200 | static-sweep |
| 160 | `/oauth2/signup` |  | 200 | 200 | 200 | static-sweep |
| 161 | `/oauth2/invite/signup` |  | 200 | 200 | 200 | static-sweep |
| 162 | `/document/P/:token` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 163 | `/document/C/:token` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 164 | `/document/OC/:token` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 165 | `/login/saml` |  | 200 | 200 | 200 | static-sweep |
| 166 | `/login/saml/start` |  | 200 | 200 | 200 | static-sweep |
| 167 | `/login/saml/verified` |  | 200 | 200 | 200 | static-sweep |
| 168 | `/login/saml/fail` |  | 200 | 200 | 200 | static-sweep |
| 169 | `/shared-privacy/verify` |  | 200 | 200 | 200 | static-sweep |
| 170 | `/shared-privacy/email-verify` |  | 200 | 200 | 200 | static-sweep |
| 171 | `/shared-privacy/view` |  | 200 | 200 | 200 | static-sweep |
| 172 | `/IE` |  | 307→/login?returnTo=%2FIE | 200 | 200 | static-sweep |
| 173 | `/infoOwner/find` |  | 200 | 200 | 200 | static-sweep |
| 174 | `/infoOwner/find/complete` |  | 200 | 200 | 200 | static-sweep |
| 175 | `/infoOwner/agree-history/:infoOwnerToken` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 176 | `/infoOwner/action-history/:infoOwnerToken` | Y | dyn | dyn | dyn | dyn-sweep+task |
| 177 | `/expert/select-company` |  | 307→/login?returnTo=%2Fexpert%2Fselect-company | 200 | 200 | static-sweep |
| 178 | `/access-not-allow` |  | 307→/login?returnTo=%2Faccess-not-allow | 200 | 200 | static-sweep |
| 179 | `/loading` |  | 307→/login?returnTo=%2Floading | 200 | 200 | static-sweep |
| 180 | `/help-center` |  | 307→/login?returnTo=%2Fhelp-center | 200 | 200 | static-sweep |
| 181 | `/logout` |  | 200 | 200 | 200 | static-sweep |
