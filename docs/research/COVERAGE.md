# 경로별 구현·원본 조사 범위

기준일: 2026-10-02 (한국 시간). CSV의 181개 경로를 모두 분류했다. **181개 페이지의 픽셀 단위 클론이 완료됐다는 뜻은 아니다.** 이 문서는 디스크의 조사 JSON과 구현 분기를 대조한 결과이며 HTTP 점검이나 브라우저 시각 QA 결과를 대체하지 않는다.

## 분류 집계

| 분류 | 경로 수 | 의미 |
|---|---:|---|
| 원본 화면 기반 | 53 | 원본 표시 화면의 텍스트/DOM/CSS 증거가 있음. 기능은 로컬 데모. |
| 권한·이용조건 제한 화면 | 34 | 권한·라이선스·발신자 등 이용조건 제한 화면만 관찰함. |
| 리디렉션 대상 대응 | 16 | 원본의 이동 대상/상태에 대응함. |
| 로컬 데모·원본 정상 화면 미검증 | 52 | 원본 정상 화면이 미확인인 경로를 로컬 흐름/공통 화면으로 대체함. |
| 데이터 없음·접근 불가 대체 | 23 | 실제 ID·데이터·원본 증거 부족으로 안내/빈 상태를 제공함. |
| 원본 빈 화면 대응 | 2 | 원본 본문이 비어 있는 상태를 관찰함. |
| 원본 오류 화면 대응 | 1 | 원본 오류·잘못된 접근 상태를 관찰함. |
| 합계 | 181 | 정적 경로와 동적 경로 패턴을 포함함. |

## 증거와 검증 경계

- [경로별 CSV](route-coverage.csv): 상태, 원본 URL, 관찰 URL, 실제 증거 파일, 제약을 181개 행에 기록했다.
- [라우트 매니페스트](../../src/data/route-manifest.json): 동일 분류로 `status`를 갱신했다. `pending-inspection`은 최종 매니페스트에 남아 있지 않다.
- 모듈별 coverage JSON은 조사 당시의 기록이다. 일부 `pending-inspection`/시각 QA 대기 문구가 남아 있어도 이 문서의 최종 분류와 혼동하지 않는다. 원본 JSON은 덮어쓰지 않았다.
- 파일이 존재한다는 이유만으로 검증 처리하지 않았다. 로그인 리디렉션, 빈 본문, 오류 경계, 토큰 없는 동적 경로는 각각 구분했다.
- `/login`은 로그인 전 별도 수집 자료를 사용했다. 로그인 후 `/login` 재방문 자료는 대시보드이므로 이를 로그인 화면 근거로 사용하지 않았다.
- 폼 후속 단계·공개 폼·실제 응답·서비스별 상세·결제 결과·SSO의 정상 상태는 유효 데이터/권한이 부족한 경우 미검증이다.
- 원본 화면 기반 분류도 전체 인터랙션·모든 탭·반응형·픽셀 일치 완료를 의미하지 않는다. 대표 화면 QA와 전체 URL HTTP 점검은 메인 작업의 별도 결과를 참고한다.
- 사용자 이름·이메일 등 계정 표시값은 데모 값으로 치환했다. 실제 원본 서비스에 저장/발송/결제/회원탈퇴를 수행하지 않는다.

공지 상세 `/notice/:admNotiId`는 ID 59, 58, 56, 55, 54, 53, 52, 51, 50, 49의 실제 본문 10개를 [수집 자료](public/notice-details.json)로 확인했다. 다른 ID의 본문은 미수집이며 안내 화면으로 대체한다.

## 전체 경로

| 경로 | 분류 | 원본 정상 화면 증거 |
|---|---|---|
| `/` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/jap_intro` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/notice` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/notice/:admNotiId` | 원본 화면 기반 | 있음(10개 표본) |
| `/service/none` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/company-info` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/IE` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/expert/select-company` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/access-not-allow` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/loading` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/help-center` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/logout` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/two-step-setting` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/identification/:result` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/gwloginUser/login` | 로컬 데모·원본 정상 화면 미검증 | 있음(해당 표시 상태) |
| `/login` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/password-change-email` | 로컬 데모·원본 정상 화면 미검증 | 있음(해당 표시 상태) |
| `/passwordChange` | 로컬 데모·원본 정상 화면 미검증 | 있음(해당 표시 상태) |
| `/password-change-email/complete` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/password-change-rule` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/auth-code` | 로컬 데모·원본 정상 화면 미검증 | 있음(해당 표시 상태) |
| `/signup` | 로컬 데모·원본 정상 화면 미검증 | 있음(해당 표시 상태) |
| `/expire/code` | 로컬 데모·원본 정상 화면 미검증 | 있음(해당 표시 상태) |
| `/two-step` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/not-allow-ip` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/login-email` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/login-otp` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/login-failed` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/login/oauth2` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/login/oauth2/verified` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/login/gpki` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/login/saeol` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/gpki/fail` | 로컬 데모·원본 정상 화면 미검증 | 있음(해당 표시 상태) |
| `/gpki/email-register` | 로컬 데모·원본 정상 화면 미검증 | 있음(해당 표시 상태) |
| `/saeol/fail/:org` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/link/oauth2` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/link/oauth2/verified` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/oauth2/fail` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/oauth2/signup` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/oauth2/invite/signup` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/login/saml` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/login/saml/start` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/login/saml/verified` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/login/saml/fail` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/file-view/:customerId` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/file-view/:customerId/shared` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/file-view/:customerId/:questionId/:fileId` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/file-view/:customerId/:questionId/:fileId/shared` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/projects/:outerToken/form` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/project/:outerToken/form` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/url/:outerToken` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/test-projects/:outerToken/form` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/customer-use-case/:outerToken` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/infoOwner/formComplete` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/infoOwner/form-interrupt` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/services/:serviceId/catchforms/category/:category/agree/:agree` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/services/:serviceId/catchforms/recipients/agree/:agree` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/services/:serviceId/oversea/catchforms/agree/:agree` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/services/:serviceId/catchforms` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/services/:serviceId/catchforms/recipients` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/services/:serviceId/oversea/catchforms` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/services/:serviceId/catchforms/:isDomestic/resident/agree/:agree` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/document/P/:token` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/document/C/:token` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/document/OC/:token` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/shared-privacy/verify` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/shared-privacy/email-verify` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/shared-privacy/view` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/infoOwner/find` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/infoOwner/find/complete` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/infoOwner/agree-history/:infoOwnerToken` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/infoOwner/action-history/:infoOwnerToken` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/set/authority` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/set/company` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/set/company/edit` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/set/company/policy` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/set/company/policy/setting` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/set/service` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/set/service/modification` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/set/service/consent` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/set/service/consigment/mail` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/set/member` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/log/authority` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/log/info-monitoring` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/log/ad-monitoring` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/log/customer` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/log/service` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/log/collect-destruction` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/log/destruction_certificate` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/log/form-approval` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/log/destruction-schedule` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/log/mail` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/log/month-monitoring` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/log/access-history` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/log/external-viewer` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/log/member` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/dashboard/:serviceId` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/dashboard` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/privacy-detail` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/privacy-detail/:serviceId` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/marketing-detail` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/marketing-detail/:serviceId` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/compliance` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/basic/info-usage-purpose` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/basic/result/consent` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/basic/result/consent/phrase` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/basic/result/consent/edit` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/basic/result/consent/create` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/basic/info-usage-purpose/privacy-policy` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/basic/result/policy` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/form/template` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/form/ai/create` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/form/ai/recipient` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/form/ai/set` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/form/ai/share` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/form/manage` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/form/manage/applicant/:formId` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/form/manage/applicant/:serviceId/:formId` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/form/manage/applicant/log/:formId` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/form/ad-manage` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/form/ai/basic-frame` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/form/ai/basic-frame/v3` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/form/ai/agreement` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/form/ai/setting` | 로컬 데모·원본 정상 화면 미검증 | 미검증 |
| `/form/fixed-url` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/form/info-upload` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/form/info-upload/agreement` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/form/info-upload/recipient` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/integration/message` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/alimtalk` | 원본 오류 화면 대응 | 있음(해당 표시 상태) |
| `/alimtalk/channels` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/alimtalk/templates` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/alimtalk/templates/register` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/alimtalk/templates/:templateId` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/alimtalk/templates/:templateId/edit` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/alimtalk/send` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/alimtalk/history` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/kakao-playground` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/mail` | 원본 빈 화면 대응 | 있음(해당 표시 상태) |
| `/mail/catchform` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/mail/direct` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/mail/number` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/mail/history` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/mail/no-mail` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/my-page` | 로컬 데모·원본 정상 화면 미검증 | 있음(해당 표시 상태) |
| `/my-page/info` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/my-page/info/edit` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/my-page/delete` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/my-page/activity-log` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/my-page/info-activity-log` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/pay/membership/detail` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/pay/billing-policy` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/pay/license-service` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/pay/service-asset` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/pay/method` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/pay/cancel` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/pay/history` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/pay/usage/history` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/pay/result/success/:purchaseId` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/pay/credit/success/:purchaseId` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/pay/plus/success/:purchaseId` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/pay/plus/success/:purchasedId/:type` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/pay/result/fail` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/pay/plus/fail/:errorCode` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/creditBill/:id` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/bill/:id` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/bill/:id/refund` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/security` | 데이터 없음·접근 불가 대체 | 미검증 |
| `/security/compliance` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/security/sso` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/security/sso/setting` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/security/ip` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/security/ip/setting` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
| `/security/two-factor` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/security/two-factor/setting` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/sms` | 원본 빈 화면 대응 | 있음(해당 표시 상태) |
| `/sms/catchform` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/sms/direct` | 리디렉션 대상 대응 | 있음(해당 표시 상태) |
| `/sms/number` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/sms/history` | 원본 화면 기반 | 있음(해당 표시 상태) |
| `/sms/nonumber` | 권한·이용조건 제한 화면 | 있음(해당 표시 상태) |
