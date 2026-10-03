# P00-T01 경로·계약 대조
원본 CSV, 라우트 manifest, 조사 근거 CSV, 구현 계획 CSV의 181개 경로가 정확히 일치한다. 메뉴 항목은 모두 이 집합에 포함된다. 각 행에 모델·API·권한·정상/오류/권한 거부 검증 조건과 고유 E2E ID가 있다.

실행: `python3 scripts/verify-plan.py`. 결과: `route-contract-check.json`.
이 검사는 경로와 계약의 완전성을 검사한다. 181개 CRUD 동작 시험을 통과했다는 의미는 아니다.

## 원본 상태가 확인되지 않은 범위
기존 조사자료를 재검토했다. 아래 경로의 정상 동작은 관찰하지 못했으며, 계획 CSV의 독립 구현 계약을 사용한다. 기능을 실제 시험할 때까지 완료로 표시하지 않는다. 문서 P/C/OC 약어의 원본 의미, 기관 인증과 결제 공급자 계약은 별도 결정이 필요하다.

| 경로 | 관찰 분류 | 독립 구현 작업 |
|---|---|---|
| `/` | 로컬 데모·원본 정상 화면 미검증 | P13-T02 |
| `/service/none` | 권한·이용조건 제한 화면 | P13-T02 |
| `/company-info` | 리디렉션 대상 대응 | P03-T01 |
| `/IE` | 리디렉션 대상 대응 | P13-T02 |
| `/access-not-allow` | 권한·이용조건 제한 화면 | P13-T02 |
| `/logout` | 로컬 데모·원본 정상 화면 미검증 | P02-T01 |
| `/identification/:result` | 로컬 데모·원본 정상 화면 미검증 | P06-T06 |
| `/gwloginUser/login` | 로컬 데모·원본 정상 화면 미검증 | P02-T01 |
| `/password-change-email` | 로컬 데모·원본 정상 화면 미검증 | P02-T02 |
| `/passwordChange` | 로컬 데모·원본 정상 화면 미검증 | P02-T02 |
| `/auth-code` | 로컬 데모·원본 정상 화면 미검증 | P02-T02 |
| `/signup` | 로컬 데모·원본 정상 화면 미검증 | P02-T04 |
| `/expire/code` | 로컬 데모·원본 정상 화면 미검증 | P02-T02 |
| `/two-step` | 리디렉션 대상 대응 | P02-T02 |
| `/login/oauth2` | 로컬 데모·원본 정상 화면 미검증 | P11-T03 |
| `/login/oauth2/verified` | 로컬 데모·원본 정상 화면 미검증 | P11-T03 |
| `/login/gpki` | 로컬 데모·원본 정상 화면 미검증 | P11-T04 |
| `/login/saeol` | 로컬 데모·원본 정상 화면 미검증 | P11-T04 |
| `/gpki/fail` | 로컬 데모·원본 정상 화면 미검증 | P11-T04 |
| `/gpki/email-register` | 로컬 데모·원본 정상 화면 미검증 | P11-T04 |
| `/saeol/fail/:org` | 로컬 데모·원본 정상 화면 미검증 | P11-T04 |
| `/link/oauth2` | 로컬 데모·원본 정상 화면 미검증 | P11-T03 |
| `/link/oauth2/verified` | 로컬 데모·원본 정상 화면 미검증 | P11-T03 |
| `/oauth2/fail` | 로컬 데모·원본 정상 화면 미검증 | P11-T03 |
| `/oauth2/signup` | 로컬 데모·원본 정상 화면 미검증 | P02-T04 |
| `/oauth2/invite/signup` | 로컬 데모·원본 정상 화면 미검증 | P02-T04 |
| `/login/saml` | 로컬 데모·원본 정상 화면 미검증 | P11-T03 |
| `/login/saml/start` | 로컬 데모·원본 정상 화면 미검증 | P11-T03 |
| `/login/saml/verified` | 로컬 데모·원본 정상 화면 미검증 | P11-T03 |
| `/login/saml/fail` | 로컬 데모·원본 정상 화면 미검증 | P11-T03 |
| `/file-view/:customerId` | 데이터 없음·접근 불가 대체 | P06-T03 |
| `/file-view/:customerId/shared` | 데이터 없음·접근 불가 대체 | P06-T03 |
| `/file-view/:customerId/:questionId/:fileId` | 데이터 없음·접근 불가 대체 | P06-T03 |
| `/file-view/:customerId/:questionId/:fileId/shared` | 데이터 없음·접근 불가 대체 | P06-T03 |
| `/projects/:outerToken/form` | 로컬 데모·원본 정상 화면 미검증 | P06-T01 |
| `/project/:outerToken/form` | 로컬 데모·원본 정상 화면 미검증 | P06-T01 |
| `/url/:outerToken` | 로컬 데모·원본 정상 화면 미검증 | P04-T03 |
| `/test-projects/:outerToken/form` | 로컬 데모·원본 정상 화면 미검증 | P06-T01 |
| `/customer-use-case/:outerToken` | 로컬 데모·원본 정상 화면 미검증 | P06-T01 |
| `/infoOwner/formComplete` | 데이터 없음·접근 불가 대체 | P06-T05 |
| `/infoOwner/form-interrupt` | 데이터 없음·접근 불가 대체 | P06-T05 |
| `/services/:serviceId/catchforms/category/:category/agree/:agree` | 로컬 데모·원본 정상 화면 미검증 | P05-T03 |
| `/services/:serviceId/catchforms/recipients/agree/:agree` | 로컬 데모·원본 정상 화면 미검증 | P05-T03 |
| `/services/:serviceId/oversea/catchforms/agree/:agree` | 로컬 데모·원본 정상 화면 미검증 | P05-T03 |
| `/services/:serviceId/catchforms` | 로컬 데모·원본 정상 화면 미검증 | P05-T03 |
| `/services/:serviceId/catchforms/recipients` | 로컬 데모·원본 정상 화면 미검증 | P05-T03 |
| `/services/:serviceId/oversea/catchforms` | 로컬 데모·원본 정상 화면 미검증 | P05-T03 |
| `/services/:serviceId/catchforms/:isDomestic/resident/agree/:agree` | 로컬 데모·원본 정상 화면 미검증 | P05-T03 |
| `/document/P/:token` | 데이터 없음·접근 불가 대체 | P05-T03 |
| `/document/C/:token` | 데이터 없음·접근 불가 대체 | P05-T03 |
| `/document/OC/:token` | 데이터 없음·접근 불가 대체 | P05-T03 |
| `/shared-privacy/email-verify` | 로컬 데모·원본 정상 화면 미검증 | P06-T04 |
| `/shared-privacy/view` | 로컬 데모·원본 정상 화면 미검증 | P06-T04 |
| `/infoOwner/agree-history/:infoOwnerToken` | 데이터 없음·접근 불가 대체 | P06-T05 |
| `/infoOwner/action-history/:infoOwnerToken` | 데이터 없음·접근 불가 대체 | P06-T05 |
| `/set/authority` | 리디렉션 대상 대응 | P03-T02 |
| `/set/company/policy` | 권한·이용조건 제한 화면 | P11-T01 |
| `/set/service/modification` | 권한·이용조건 제한 화면 | P03-T01 |
| `/set/member` | 권한·이용조건 제한 화면 | P03-T02 |
| `/log/authority` | 권한·이용조건 제한 화면 | P12-T01 |
| `/log/destruction_certificate` | 권한·이용조건 제한 화면 | P12-T01 |
| `/log/form-approval` | 권한·이용조건 제한 화면 | P12-T01 |
| `/log/destruction-schedule` | 권한·이용조건 제한 화면 | P12-T01 |
| `/log/mail` | 권한·이용조건 제한 화면 | P12-T01 |
| `/log/month-monitoring` | 권한·이용조건 제한 화면 | P12-T01 |
| `/log/access-history` | 권한·이용조건 제한 화면 | P12-T01 |
| `/log/external-viewer` | 권한·이용조건 제한 화면 | P12-T01 |
| `/log/member` | 권한·이용조건 제한 화면 | P12-T01 |
| `/dashboard/:serviceId` | 로컬 데모·원본 정상 화면 미검증 | P12-T02 |
| `/privacy-detail/:serviceId` | 로컬 데모·원본 정상 화면 미검증 | P12-T02 |
| `/marketing-detail/:serviceId` | 로컬 데모·원본 정상 화면 미검증 | P12-T02 |
| `/basic/info-usage-purpose` | 권한·이용조건 제한 화면 | P05-T01 |
| `/basic/result/consent` | 권한·이용조건 제한 화면 | P05-T02 |
| `/basic/result/consent/phrase` | 권한·이용조건 제한 화면 | P05-T02 |
| `/basic/result/consent/edit` | 권한·이용조건 제한 화면 | P05-T02 |
| `/basic/result/consent/create` | 권한·이용조건 제한 화면 | P05-T02 |
| `/basic/info-usage-purpose/privacy-policy` | 권한·이용조건 제한 화면 | P05-T01 |
| `/basic/result/policy` | 권한·이용조건 제한 화면 | P05-T02 |
| `/form/ai/recipient` | 로컬 데모·원본 정상 화면 미검증 | P04-T02 |
| `/form/ai/set` | 로컬 데모·원본 정상 화면 미검증 | P04-T02 |
| `/form/ai/share` | 로컬 데모·원본 정상 화면 미검증 | P04-T02 |
| `/form/manage/applicant/:formId` | 로컬 데모·원본 정상 화면 미검증 | P06-T02 |
| `/form/manage/applicant/:serviceId/:formId` | 로컬 데모·원본 정상 화면 미검증 | P06-T02 |
| `/form/manage/applicant/log/:formId` | 로컬 데모·원본 정상 화면 미검증 | P12-T01 |
| `/form/ai/basic-frame/v3` | 로컬 데모·원본 정상 화면 미검증 | P04-T02 |
| `/form/ai/agreement` | 로컬 데모·원본 정상 화면 미검증 | P04-T02 |
| `/form/ai/setting` | 로컬 데모·원본 정상 화면 미검증 | P04-T02 |
| `/form/info-upload` | 권한·이용조건 제한 화면 | P07-T01 |
| `/form/info-upload/agreement` | 권한·이용조건 제한 화면 | P07-T01 |
| `/form/info-upload/recipient` | 권한·이용조건 제한 화면 | P07-T01 |
| `/alimtalk` | 원본 오류 화면 대응 | P09-T03 |
| `/alimtalk/channels` | 리디렉션 대상 대응 | P09-T03 |
| `/alimtalk/templates` | 리디렉션 대상 대응 | P09-T03 |
| `/alimtalk/templates/register` | 리디렉션 대상 대응 | P09-T03 |
| `/alimtalk/templates/:templateId` | 데이터 없음·접근 불가 대체 | P09-T03 |
| `/alimtalk/templates/:templateId/edit` | 데이터 없음·접근 불가 대체 | P09-T03 |
| `/alimtalk/send` | 리디렉션 대상 대응 | P09-T04 |
| `/alimtalk/history` | 리디렉션 대상 대응 | P09-T04 |
| `/mail` | 원본 빈 화면 대응 | P08-T01 |
| `/mail/catchform` | 권한·이용조건 제한 화면 | P09-T01 |
| `/mail/direct` | 권한·이용조건 제한 화면 | P09-T01 |
| `/mail/no-mail` | 권한·이용조건 제한 화면 | P08-T01 |
| `/my-page` | 로컬 데모·원본 정상 화면 미검증 | P03-T03 |
| `/pay/billing-policy` | 리디렉션 대상 대응 | P10-T01 |
| `/pay/service-asset` | 권한·이용조건 제한 화면 | P10-T01 |
| `/pay/method` | 리디렉션 대상 대응 | P10-T02 |
| `/pay/cancel` | 데이터 없음·접근 불가 대체 | P10-T04 |
| `/pay/usage/history` | 리디렉션 대상 대응 | P10-T03 |
| `/pay/result/success/:purchaseId` | 데이터 없음·접근 불가 대체 | P10-T02 |
| `/pay/credit/success/:purchaseId` | 데이터 없음·접근 불가 대체 | P10-T02 |
| `/pay/plus/success/:purchaseId` | 데이터 없음·접근 불가 대체 | P10-T02 |
| `/pay/plus/success/:purchasedId/:type` | 데이터 없음·접근 불가 대체 | P10-T02 |
| `/pay/plus/fail/:errorCode` | 데이터 없음·접근 불가 대체 | P10-T02 |
| `/creditBill/:id` | 데이터 없음·접근 불가 대체 | P10-T04 |
| `/bill/:id` | 데이터 없음·접근 불가 대체 | P10-T04 |
| `/bill/:id/refund` | 데이터 없음·접근 불가 대체 | P10-T04 |
| `/security` | 데이터 없음·접근 불가 대체 | P11-T02 |
| `/security/compliance` | 권한·이용조건 제한 화면 | P11-T02 |
| `/security/sso` | 권한·이용조건 제한 화면 | P11-T03 |
| `/security/sso/setting` | 권한·이용조건 제한 화면 | P11-T03 |
| `/security/ip` | 권한·이용조건 제한 화면 | P11-T02 |
| `/security/ip/setting` | 권한·이용조건 제한 화면 | P11-T02 |
| `/security/two-factor` | 리디렉션 대상 대응 | P11-T02 |
| `/security/two-factor/setting` | 리디렉션 대상 대응 | P11-T02 |
| `/sms` | 원본 빈 화면 대응 | P08-T01 |
| `/sms/catchform` | 리디렉션 대상 대응 | P08-T02 |
| `/sms/direct` | 리디렉션 대상 대응 | P08-T02 |
| `/sms/nonumber` | 권한·이용조건 제한 화면 | P08-T01 |
