# API·CRUD·화면 구현 명세

API base: `/api/v1`. 아래 operation 목록은 현재 OpenAPI의 선언이다. 실제 handler 존재·권한·동작 성공은 각 Rxx-T02/T04에서 검증한다. 넓은 공통prefix 때문에 여러 도메인에 같은 API가 반복되며, 도메인 업무 범위 밖 operation까지 새로 구현하라는 뜻은 아니다. 정확한 요청/응답 계약 snapshot은 `snapshots/api-operations.json`이다.

공통: DTO whitelist·서버측필수검증·tenant/service 범위·license capability·pagination·version409·idempotency·감사/outbox·파일및secret비노출. 서버중단/네트워크실패를 성공toast나 빈목록으로 치환하지 않는다.

<a id="r02"></a>
## R02 계정 인증·세션·복구

경로 15개: `/auth-code`, `/expire/code`, `/login`, `/login-email`, `/login-failed`, `/login-otp`, `/logout`, `/not-allow-ip`, `/password-change-email`, `/password-change-email/complete`, `/password-change-rule`, `/passwordChange`, `/signup`, `/two-step`, `/two-step-setting`

**데이터/CRUD**: C 가입·인증 challenge; R 세션/암호정책; U 암호·2FA; D 세션 폐기·2FA 해제. 계정 삭제는 R05.
**접근범위**: 익명 challenge 또는 자기 계정; 회사 권한 이전에 인증 검증

**백엔드**: 이메일 가입→인증→로그인→로그아웃, 재설정, OTP/TOTP·복구코드 계약을 실제 handler와 대조한다. 재전송 rate limit, 계정 존재 노출 방지, returnTo 검증 및 정책 변경 후 기존 세션 집행을 확인한다.

**화면**: 로그인/가입/이메일·OTP/복구/암호변경/2단계/만료 경로 각각 서버 상태에 연결한다. 전송 중·잘못된 코드·만료·재전송 대기·로그아웃 완료를 표시한다.

**수용 시나리오**: A 계정 가입 후 로컬 시험메일 링크를 한 번 사용, 재사용 거부; 틀린 암호·만료 OTP·복구코드 재사용 거부; 다른 브라우저 세션 폐기; 재시작 뒤 인증 유지/폐기 일치.

**기존 코드 근거**: [src/server/auth.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/auth.ts), [src/server/auth-adapter.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/auth-adapter.ts), [src/server/auth-mutations.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/auth-mutations.ts), [src/server/credential-lock.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/credential-lock.ts), [src/server/password-policy.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/password-policy.ts), [src/server/password-deferral.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/password-deferral.ts), [src/components/auth/AuthPages.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/auth/AuthPages.tsx), [src/components/auth/LiveAuth.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/auth/LiveAuth.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/me/sessions` |
| DELETE | `/me/sessions/{id}` |
| POST | `/auth/sign-up/email` |
| POST | `/auth/sign-in/email` |
| POST | `/auth/request-password-reset` |
| POST | `/auth/reset-password` |
| POST | `/auth/change-password` |
| POST | `/auth/sign-out` |
| POST | `/auth/two-factor/enable` |
| POST | `/auth/two-factor/verify-totp` |
| POST | `/auth/two-factor/send-otp` |
| POST | `/auth/two-factor/verify-otp` |
| POST | `/auth/two-factor/verify-backup-code` |
| POST | `/auth/two-factor/disable` |
| GET | `/auth/get-session` |
| GET | `/me/password-policy` |
| POST | `/me/password-policy` |
| POST | `/auth/org/login` |
| POST | `/auth/org/email-register` |
| GET | `/auth/sso/{providerId}` |
| GET | `/auth/sso/callback` |
| POST | `/auth/sso/saml` |

<a id="r03"></a>
## R03 회사·서비스·초기 설정

경로 6개: `/company-info`, `/service/none`, `/set/company`, `/set/company/edit`, `/set/service`, `/set/service/modification`

**데이터/CRUD**: C 회사/서비스/접근요청; R 목록·상세·현재 컨텍스트; U 기본정보/이름/요청결정; D 서비스 보관·회사 종료요청. 참조 데이터 즉시 cascade 삭제 금지.
**접근범위**: company.manage/service.manage; 접근요청은 자기 멤버십·허용 서비스

**백엔드**: 회사·서비스 CRUD, 사업자 파일, 컨텍스트 전환 및 서비스 접근 요청 API에 tenant·활성 상태·version·권한 재검사를 적용한다. 서비스 폐기 시 게시·예약·공유 접근과의 일관성을 확인한다.

**화면**: 회사 조회/편집, 서비스 목록·추가 모달·편집/보관, 회사 최초 등록, 서비스 없음→접근요청 흐름. 전환 시 목록·권한·선택값 캐시를 함께 갱신한다.

**수용 시나리오**: 회사 A 생성→서비스2개→수정→보관→재로그인; B 회사 serviceId를 본문/URL에 주입해 거부; 같은 이름 동시생성 하나409; 사용 중 서비스 삭제 의존성 안내.

**기존 코드 근거**: [src/server/company-management.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/company-management.ts), [src/server/service-management.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/service-management.ts), [src/server/context-selection.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/context-selection.ts), [src/server/service-access.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/service-access.ts), [src/server/access-requests.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/access-requests.ts), [src/components/management/live.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/live.tsx), [src/components/ServiceAccessPage.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/ServiceAccessPage.tsx), [src/components/ApplicationContext.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/ApplicationContext.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/companies` |
| POST | `/companies` |
| GET | `/companies/{id}` |
| PATCH | `/companies/{id}` |
| DELETE | `/companies/{id}` |
| GET | `/services` |
| POST | `/services` |
| GET | `/services/{id}` |
| PATCH | `/services/{id}` |
| DELETE | `/services/{id}` |
| GET | `/context` |
| POST | `/context` |
| GET | `/services/{id}/verification` |
| POST | `/services/{id}/verification` |
| PATCH | `/services/{id}/verification` |
| DELETE | `/services/{id}/verification` |
| POST | `/companies/{id}/closure` |
| GET | `/companies/{id}/business-file` |
| POST | `/companies/{id}/business-file` |
| DELETE | `/companies/{id}/business-file` |
| GET | `/services/{id}/consent-display/{kind}` |
| PATCH | `/services/{id}/consent-display/{kind}` |
| GET | `/services/{id}/subprocessors` |
| POST | `/services/{id}/subprocessors` |
| GET | `/services/{id}/subprocessors/{subId}` |
| PATCH | `/services/{id}/subprocessors/{subId}` |
| GET | `/services/{id}/subprocessor-notices` |
| POST | `/services/{id}/subprocessor-notices` |
| GET | `/access-requests` |
| POST | `/access-requests` |
| PATCH | `/access-requests/{id}` |
| DELETE | `/access-requests/{id}` |

<a id="r04"></a>
## R04 구성원·초대·권한·전문가

경로 4개: `/expert/select-company`, `/oauth2/invite/signup`, `/set/authority`, `/set/member`

**데이터/CRUD**: C 초대/서비스 권한/전문가 배정; R 목록·초대미리보기; U 역할·담당범위·소유권 이전; D 초대취소/권한회수/배정해제.
**접근범위**: member.manage, company.manage, platformAdmin; 원본 ROOT 등과 로컬 역할은 별도 매핑

**백엔드**: 초대·재전송·수락·취소, 멤버 변경/삭제/owner 이전, 서비스 접근요청 결정과 전문가 배정 API를 역할 허용표에 대조한다. 회수 후 세션과 진행 중 작업에서 권한을 다시 검사한다.

**화면**: 구성원 목록/검색/초대/편집/삭제와 /set/authority 서비스별 범위 편집, 전문가 회사 선택을 연결한다. 관리자용 배정 페이지는 별도 부가 경로로 관리한다.

**수용 시나리오**: A 초대 수락→서비스1만 조회→권한회수 즉시거부; B ID 교체 실패; owner2명이 동시탈퇴/이전해도 최소1명 보장; 초대 중복·만료·전문가 기간 만료/재배정409.

**기존 코드 근거**: [src/server/members.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/members.ts), [src/server/permissions.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/permissions.ts), [src/server/service-access.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/service-access.ts), [src/server/expert-assignments.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/expert-assignments.ts), [src/components/management/members.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/members.tsx), [src/components/auth/InvitationAccept.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/auth/InvitationAccept.tsx), [src/components/ExpertSelectPage.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/ExpertSelectPage.tsx), [src/components/ExpertAssignmentsAdmin.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/ExpertAssignmentsAdmin.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/invitations` |
| POST | `/invitations` |
| DELETE | `/invitations/{id}` |
| GET | `/members` |
| GET | `/members/{id}` |
| PATCH | `/members/{id}` |
| DELETE | `/members/{id}` |
| POST | `/members/{id}/transfer` |
| POST | `/invitations/{id}/resend` |
| POST | `/invitations/preview` |
| POST | `/invitations/accept` |
| POST | `/invitations/sso/options` |
| POST | `/invitations/sso/start` |
| GET | `/access-requests` |
| POST | `/access-requests` |
| PATCH | `/access-requests/{id}` |
| DELETE | `/access-requests/{id}` |
| GET | `/expert-assignments` |
| POST | `/expert-assignments` |
| GET | `/expert-assignments/{id}` |
| PATCH | `/expert-assignments/{id}` |
| DELETE | `/expert-assignments/{id}` |
| GET | `/expert-assignments/options` |

<a id="r05"></a>
## R05 MY·프로필·활동 검토·탈퇴

경로 6개: `/my-page`, `/my-page/activity-log`, `/my-page/delete`, `/my-page/info`, `/my-page/info-activity-log`, `/my-page/info/edit`

**데이터/CRUD**: C 활동 검토요청·탈퇴요청; R 프로필/내 활동/검토; U 이름·연락처·검토 응답; D 세션·연결 계정 해제, 탈퇴는 상태 전이.
**접근범위**: 자기 계정; 검토자는 security.write/audit.read 및 해당 서비스

**백엔드**: 프로필 PATCH·세션 DELETE·연결 계정 해제·closure 및 활동검토 actions/notifications/destruction의 상태 전이를 검사한다. 권한회수/탈퇴 경합 중 다른 회사 자료 조회를 막는다.

**화면**: /my-page 별칭→프로필, 편집/탈퇴 확인, 내 활동로그, 개인정보 활동검토 목록·상세·사유응답·처리결과·재시도를 구현 또는 보완한다.

**수용 시나리오**: 자기 프로필 수정 재로그인 확인; B 사용자 프로필 노출없음; 최종 로그인 수단 해제 차단; 탈퇴 후 세션 폐기와 보존대상 분리; 검토 만료·중복처리·알림실패 재시도.

**기존 코드 근거**: [src/server/account-closure.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/account-closure.ts), [src/server/account-actor.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/account-actor.ts), [src/server/activity-reviews.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/activity-reviews.ts), [src/server/activity-review-mail.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/activity-review-mail.ts), [src/server/auth-mutations.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/auth-mutations.ts), [src/server/sso-accounts.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/sso-accounts.ts), [src/components/management/live.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/live.tsx), [src/components/management/AccountClosure.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/AccountClosure.tsx), [src/components/management/ActivityReviews.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/ActivityReviews.tsx), [src/components/auth/SsoAccounts.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/auth/SsoAccounts.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/me` |
| PATCH | `/me` |
| GET | `/me/sso-accounts` |
| DELETE | `/me/sso-accounts/{id}` |
| GET | `/me/sessions` |
| DELETE | `/me/sessions/{id}` |
| GET | `/me/closure` |
| POST | `/me/closure` |
| GET | `/me/audit-events` |
| GET | `/me/audit-events/export` |
| GET | `/me/password-policy` |
| POST | `/me/password-policy` |
| GET | `/activity-reviews` |
| POST | `/activity-reviews` |
| GET | `/activity-reviews/{id}` |
| POST | `/activity-reviews/{id}/actions` |
| POST | `/activity-reviews/{id}/notifications` |
| POST | `/activity-reviews/{id}/destruction` |

<a id="r06"></a>
## R06 회사 보안정책·IP·MFA

경로 8개: `/security`, `/security/compliance`, `/security/ip`, `/security/ip/setting`, `/security/two-factor`, `/security/two-factor/setting`, `/set/company/policy`, `/set/company/policy/setting`

**데이터/CRUD**: C IP 규칙/MFA 예외; R 정책·보안현황; U 정책·예외기간·활성; D 규칙·예외 삭제/정책 초기화.
**접근범위**: security.read/write + 서비스 범위 + entitlements

**백엔드**: 저장된 정책이 로그인·매 API·파일/내보내기·worker에 실제 집행되게 한다. 프록시 IP 신뢰 경계, 잘못된 정책으로 관리자 전원 잠금 방지와 예외 갱신 경합을 시험한다.

**화면**: 회사 정책 조회/설정, 보안 대시보드, IP 목록·편집·삭제, 2FA 강제·예외 사용자/기간을 API로 연결한다. Enterprise 미가입과 권한 부족을 구분한다.

**수용 시나리오**: IP 차단 후 기존 로그인에서도 API403; 잘못된 CIDR422(INVALID_CIDR); 신뢰하지 않는 X-Forwarded-For 우회실패; MFA 예외만료 즉시 재인증; 정책초기화 이후 DB와 화면 일치.

**기존 코드 근거**: [src/server/security-policy.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/security-policy.ts), [src/server/ip-access.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/ip-access.ts), [src/server/ip-enforcement.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/ip-enforcement.ts), [src/server/client-ip.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/client-ip.ts), [src/server/mfa-policy.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/mfa-policy.ts), [src/server/mfa-enforcement.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/mfa-enforcement.ts), [src/server/password-policy.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/password-policy.ts), [src/components/management/policy.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/policy.tsx), [src/components/management/SecurityOverview.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/SecurityOverview.tsx), [src/components/management/IpAccess.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/IpAccess.tsx), [src/components/management/MfaPolicy.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/MfaPolicy.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/security/policy` |
| PATCH | `/security/policy` |
| DELETE | `/security/policy` |
| GET | `/security/ip-rules` |
| POST | `/security/ip-rules` |
| GET | `/security/ip-rules/{id}` |
| PATCH | `/security/ip-rules/{id}` |
| DELETE | `/security/ip-rules/{id}` |
| PATCH | `/security/ip-rules/settings` |
| GET | `/security/mfa-policy` |
| PATCH | `/security/mfa-policy` |
| POST | `/security/mfa-policy/exceptions` |
| GET | `/security/mfa-policy/exceptions/{id}` |
| PATCH | `/security/mfa-policy/exceptions/{id}` |
| DELETE | `/security/mfa-policy/exceptions/{id}` |
| GET | `/security/status` |

<a id="r07"></a>
## R07 SSO·OAuth·기관 인증

2026-10-10 원본 정적 대조 보완: 원본 관리 화면은 NONE/AZURE/GOOGLE 로그인 허용 정책이다. 현재 독립 공급자 관리와 별도 구현한다. [근거](sso-source-evidence.md)와 [단계별 계획](sso-execution.md) 참조. 원본 정책 모델·SSO 구독 기능·재인증·모든 로그인/연결/초대/회사전환 집행은 후속 필수이며 현재 미완료다.

경로 20개: `/gpki/email-register`, `/gpki/fail`, `/gwloginUser/login`, `/link/oauth2`, `/link/oauth2/verified`, `/login/gpki`, `/login/gpki/callback`, `/login/oauth2`, `/login/oauth2/verified`, `/login/saeol`, `/login/saeol/callback`, `/login/saml`, `/login/saml/fail`, `/login/saml/start`, `/login/saml/verified`, `/oauth2/fail`, `/oauth2/signup`, `/saeol/fail/:org`, `/security/sso`, `/security/sso/setting`

**데이터/CRUD**: C SSO 공급자/인증 state/계정연결; R 설정·preflight; U 설정·활성; D 공급자 비활성/계정연결 해제. callback은 검증 후 1회 처리.
**접근범위**: 관리 security.write; 익명 callback의 일회성 state; 자기 계정연결

**백엔드**: OIDC/SAML 검증·계정연결 및 신규 /login/gpki/callback·/login/saeol/callback 경로를 정식 어댑터 계약에 연결한다. GPKI/새올/그룹웨어 규격은 제공사 확인 후 확정하며 callback URL만으로 성공시키지 않는다.

**화면**: SSO 목록·등록·수정·삭제·연결시험, OAuth/SAML 시작/성공/실패/초대가입, GPKI 이메일등록/기관 실패/새올 callback 화면을 서버 결과와 연결한다.

**수용 시나리오**: 잘못된 issuer/audience/state·만료/재사용 assertion 거부; 별도 시험 IdP로 로그인·연결·해제; 기관2곳 tenant 분리; 가상기관 테스트와 실제기관 수신 증거를 분리.

**기존 코드 근거**: [src/server/sso.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/sso.ts), [src/server/sso-provider-lifecycle.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/sso-provider-lifecycle.ts), [src/server/sso-route.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/sso-route.ts), [src/server/saml-validation.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/saml-validation.ts), [src/server/sso-accounts.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/sso-accounts.ts), [src/server/org-auth.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/org-auth.ts), [src/server/sso-mfa.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/sso-mfa.ts), [src/components/management/SsoProviders.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/SsoProviders.tsx), [src/components/auth/AuthPages.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/auth/AuthPages.tsx), [src/components/auth/SsoRecovery.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/auth/SsoRecovery.tsx), [src/components/auth/SsoAccounts.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/auth/SsoAccounts.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/me/sso-accounts` |
| DELETE | `/me/sso-accounts/{id}` |
| POST | `/invitations/sso/options` |
| POST | `/invitations/sso/start` |
| GET | `/security/sso` |
| POST | `/security/sso` |
| PATCH | `/security/sso/{id}` |
| DELETE | `/security/sso/{id}` |
| POST | `/security/sso/{id}/preflight` |
| GET | `/security/sso/{id}/directory` |
| POST | `/security/sso/{id}/directory` |
| PATCH | `/security/sso/{id}/directory/{memberId}` |
| DELETE | `/security/sso/{id}/directory/{memberId}` |
| POST | `/auth/org/login` |
| POST | `/auth/org/email-register` |
| GET | `/auth/sso/{providerId}` |
| GET | `/auth/sso/callback` |
| POST | `/auth/sso/saml` |

<a id="r08"></a>
## R08 캐치폼·질문·템플릿·단계 편집

경로 9개: `/form/ai/agreement`, `/form/ai/basic-frame`, `/form/ai/basic-frame/v3`, `/form/ai/create`, `/form/ai/recipient`, `/form/ai/set`, `/form/ai/setting`, `/form/manage`, `/form/template`

**데이터/CRUD**: C 폼/초안/질문/보기/템플릿/복제; R 목록·상세·초안; U 순서·문구·유형·단계 설정; D 미사용 초안·질문·템플릿 보관.
**접근범위**: form.read/write; service grant; 문서 read 권한

**백엔드**: 폼·템플릿 CRUD/use/copy/revise/draft/favorite 계약과 편집 저장 payload를 대조한다. 질문 유형별 필수/길이/선택/첨부 검증과 충돌409를 서버에서 집행한다.

**화면**: 템플릿→신규 폼, create/basic-frame/v3/recipient/agreement/set/setting 각 단계로 직접진입·저장·재개; 전체 단계 경로/query의 formId 유지. 목록 검색/필터/복제/삭제와 미저장 이동 경고.

**수용 시나리오**: 질문3종+제공자+동의서로 초안 작성→모든 단계 새로고침→다른 브라우저 재개; 2탭409; A 문서를 B 폼에 연결 차단; 게시본 수정 시 원래 응답의 질문·문구 불변.

**기존 코드 근거**: [src/server/forms.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/forms.ts), [src/server/templates.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/templates.ts), [src/server/form-access.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/form-access.ts), [src/server/form-documents.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/form-documents.ts), [src/server/answer-validation.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/answer-validation.ts), [src/components/forms/FormEditor.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/FormEditor.tsx), [src/components/forms/FormLists.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/FormLists.tsx), [src/components/forms/TemplateGallery.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/TemplateGallery.tsx), [src/components/forms/Workflow.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/Workflow.tsx), [src/components/forms/QuestionInput.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/QuestionInput.tsx), [src/components/forms/QuestionSettings.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/QuestionSettings.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/forms` |
| POST | `/forms` |
| GET | `/forms/{id}` |
| PATCH | `/forms/{id}` |
| DELETE | `/forms/{id}` |
| POST | `/forms/{id}/publish` |
| POST | `/forms/{id}/copy` |
| POST | `/forms/{id}/pause` |
| POST | `/forms/{id}/revise` |
| GET | `/forms/{id}/submissions` |
| PATCH | `/forms/{id}/retention` |
| PATCH | `/forms/{id}/draft` |
| GET | `/forms/{id}/deletion` |
| DELETE | `/forms/{id}/purge` |
| POST | `/forms/{id}/resume` |
| PUT | `/forms/{id}/favorite` |
| DELETE | `/forms/{id}/favorite` |
| GET | `/forms/{id}/audit-events` |
| GET | `/forms/{id}/audit-events/export` |
| GET | `/forms/{id}/submissions/export` |
| GET | `/templates` |
| POST | `/templates` |
| GET | `/templates/{id}` |
| PATCH | `/templates/{id}` |
| DELETE | `/templates/{id}` |
| POST | `/templates/{id}/use` |
| GET | `/forms/{id}/approvals` |
| POST | `/forms/{id}/approvals` |
| GET | `/forms/document-options` |

<a id="r09"></a>
## R09 폼 승인·게시·고정 URL

경로 3개: `/form/ai/share`, `/form/fixed-url`, `/log/form-approval`

**데이터/CRUD**: C 승인요청/게시/고정URL; R 승인상세·게시상태; U 승인결정·URL 대상·재개; D 승인취소·URL 폐기·게시중단.
**접근범위**: form.publish/form.approve 분리; fixed URL 관리 권한

**백엔드**: 요청/승인/거절/취소와 publish/pause/resume/고정URL CRUD를 트랜잭션으로 연결한다. 자기승인 허용 여부를 계약으로 확정하고 만료 라이선스에서 write gate를 검증한다.

**화면**: 공유 단계에서 게시전 검증·승인상태·URL 복사·중단·재개, 고정URL 추가/이름변경/대상교체/삭제, 승인로그 상세/결정/사유 입력을 연결한다.

**수용 시나리오**: 초안→승인→게시→외부접속→중단410→재개; 승인본 바꿔치기 거부; 고정URL 대상 교체와 이전 링크 정책; 같은slug 경쟁409; 링크 복사만으로 게시되지 않음.

**기존 코드 근거**: [src/server/approvals.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/approvals.ts), [src/server/public-publication.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/public-publication.ts), [src/server/fixed-urls.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/fixed-urls.ts), [src/server/forms.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/forms.ts), [src/server/form-cache.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/form-cache.ts), [src/components/forms/Approvals.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/Approvals.tsx), [src/components/forms/Workflow.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/Workflow.tsx), [src/components/forms/FixedUrls.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/FixedUrls.tsx), [src/components/forms/DraftStatus.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/DraftStatus.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/forms` |
| POST | `/forms` |
| GET | `/forms/{id}` |
| PATCH | `/forms/{id}` |
| DELETE | `/forms/{id}` |
| POST | `/forms/{id}/publish` |
| POST | `/forms/{id}/copy` |
| POST | `/forms/{id}/pause` |
| POST | `/forms/{id}/revise` |
| GET | `/forms/{id}/submissions` |
| GET | `/fixed-urls` |
| POST | `/fixed-urls` |
| GET | `/fixed-urls/{id}` |
| PATCH | `/fixed-urls/{id}` |
| DELETE | `/fixed-urls/{id}` |
| PATCH | `/forms/{id}/retention` |
| PATCH | `/forms/{id}/draft` |
| GET | `/forms/{id}/deletion` |
| DELETE | `/forms/{id}/purge` |
| POST | `/forms/{id}/resume` |
| PUT | `/forms/{id}/favorite` |
| DELETE | `/forms/{id}/favorite` |
| GET | `/forms/{id}/audit-events` |
| GET | `/forms/{id}/audit-events/export` |
| GET | `/forms/{id}/submissions/export` |
| GET | `/public/urls/{slug}` |
| GET | `/forms/{id}/approvals` |
| POST | `/forms/{id}/approvals` |
| GET | `/approvals` |
| GET | `/approvals/{id}` |
| DELETE | `/approvals/{id}` |
| POST | `/approvals/{id}/decision` |
| GET | `/forms/document-options` |

<a id="r10"></a>
## R10 처리 목적·동의서·처리방침·서비스 공개문서

경로 19개: `/basic/info-usage-purpose`, `/basic/info-usage-purpose/privacy-policy`, `/basic/result/consent`, `/basic/result/consent/create`, `/basic/result/consent/edit`, `/basic/result/consent/phrase`, `/basic/result/policy`, `/document/C/:token`, `/document/OC/:token`, `/document/P/:token`, `/services/:serviceId/catchforms`, `/services/:serviceId/catchforms/:isDomestic/resident/agree/:agree`, `/services/:serviceId/catchforms/category/:category/agree/:agree`, `/services/:serviceId/catchforms/recipients`, `/services/:serviceId/catchforms/recipients/agree/:agree`, `/services/:serviceId/oversea/catchforms`, `/services/:serviceId/oversea/catchforms/agree/:agree`, `/set/service/consent`, `/set/service/consigment/mail`

**데이터/CRUD**: C 목적/제공·수탁자/문서/문구; R 목록·버전·공개/PDF; U 초안·표시문구·재위탁; D 보관·복구·게시폐기. 증거 참조 버전은 불변.
**접근범위**: document.read/write; 공개문서는 게시토큰·공개허용 필드

**백엔드**: 목적/제공자/문구/문서 CRUD·restore/history/publish/unpublish/revoke/PDF와 서비스 동의표시·재위탁고지의 상태 전이를 연결한다. HTML 정제·PDF 폰트·공개 토큰 권한을 확인한다.

**화면**: 이용목적 wizard, 동의서 생성/목록/편집/문구, 처리방침 목록·미리보기·버전·게시, 서비스 표시동의/수탁자 고지 화면. 모든 /services/... 공개 변형은 경로 파라미터에 맞는 문서 분기.

**수용 시나리오**: 목적+제공자 CRUD→문서생성/개정→공개토큰/PDF 내용일치; 소프트삭제/복구; 게시문서와 이전동의영수증 불변; 국내/국외/수신자/agree 변형 DB fixture로 각각검증.

**기존 코드 근거**: [src/server/processing-catalog.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/processing-catalog.ts), [src/server/documents.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/documents.ts), [src/server/document-pdf.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/document-pdf.ts), [src/server/public-service-documents.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/public-service-documents.ts), [src/server/subprocessors.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/subprocessors.ts), [src/server/form-documents.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/form-documents.ts), [src/components/forms/ProcessingCatalog.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/ProcessingCatalog.tsx), [src/components/forms/Documents.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/Documents.tsx), [src/components/forms/ConsentDocuments.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/ConsentDocuments.tsx), [src/components/forms/PublicServiceDocuments.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/PublicServiceDocuments.tsx), [src/components/management/ConsentDisplay.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/ConsentDisplay.tsx), [src/components/management/SubprocessorMail.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/SubprocessorMail.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/services` |
| POST | `/services` |
| GET | `/services/{id}` |
| PATCH | `/services/{id}` |
| DELETE | `/services/{id}` |
| GET | `/documents` |
| POST | `/documents` |
| GET | `/documents/{id}` |
| PATCH | `/documents/{id}` |
| DELETE | `/documents/{id}` |
| GET | `/public/services/{serviceId}/documents` |
| GET | `/processing-purposes` |
| POST | `/processing-purposes` |
| GET | `/processing-purposes/{id}` |
| PATCH | `/processing-purposes/{id}` |
| DELETE | `/processing-purposes/{id}` |
| GET | `/recipients` |
| POST | `/recipients` |
| GET | `/recipients/{id}` |
| PATCH | `/recipients/{id}` |
| DELETE | `/recipients/{id}` |
| GET | `/clause-templates` |
| POST | `/clause-templates` |
| GET | `/clause-templates/{id}` |
| PATCH | `/clause-templates/{id}` |
| DELETE | `/clause-templates/{id}` |
| GET | `/services/{id}/verification` |
| POST | `/services/{id}/verification` |
| PATCH | `/services/{id}/verification` |
| DELETE | `/services/{id}/verification` |
| POST | `/processing-purposes/{id}/restore` |
| GET | `/processing-purposes/{id}/history` |
| POST | `/recipients/{id}/restore` |
| GET | `/recipients/{id}/history` |
| POST | `/documents/{id}/restore` |
| POST | `/clause-templates/{id}/restore` |
| GET | `/documents/options` |
| GET | `/documents/{id}/preview` |
| GET | `/documents/{id}/versions` |
| POST | `/documents/{id}/publish` |
| POST | `/documents/{id}/unpublish` |
| POST | `/documents/{id}/revoke` |
| POST | `/documents/{id}/apply-clause` |
| GET | `/public/documents/{token}` |
| GET | `/documents/{id}/versions/{number}/pdf` |
| GET | `/public/documents/{token}/pdf` |
| GET | `/services/{id}/consent-display/{kind}` |
| PATCH | `/services/{id}/consent-display/{kind}` |
| GET | `/services/{id}/subprocessors` |
| POST | `/services/{id}/subprocessors` |
| GET | `/services/{id}/subprocessors/{subId}` |
| PATCH | `/services/{id}/subprocessors/{subId}` |
| GET | `/services/{id}/subprocessor-notices` |
| POST | `/services/{id}/subprocessor-notices` |

<a id="r11"></a>
## R11 공개 폼·응답·첨부·정정

경로 12개: `/customer-use-case/:outerToken`, `/file-view/:customerId`, `/file-view/:customerId/:questionId/:fileId`, `/file-view/:customerId/:questionId/:fileId/shared`, `/file-view/:customerId/shared`, `/form/manage/applicant/:formId`, `/form/manage/applicant/:serviceId/:formId`, `/jap_intro`, `/project/:outerToken/form`, `/projects/:outerToken/form`, `/test-projects/:outerToken/form`, `/url/:outerToken`

**데이터/CRUD**: C 제출/동의영수증/첨부/메모; R 응답·파일·내보내기; U 정정/메모/보유기간; D 메모·미참조첨부, 개인정보 삭제는 파기요청.
**접근범위**: 외부 publication 토큰; 내부 submission.read/write/file.read; 공유별 scope

**백엔드**: 외부 토큰 조회/제출과 응답 list/read/PATCH/withdraw/hold/retention/note/export API를 점검한다. 응답+영수증+outbox 원자성, 공개 제출 중복과 최대응답 경합, 파일 owner 검증을 수행한다.

**화면**: project/projects/test-projects/url/customer-use-case/jap_intro 별칭의 차이를 명세한다. 응답목록·상세·정정·철회·첨부 실제다운로드·로그; file-view 일반/공유 및 파일 지정/목록 네 변형을 각각 연결한다.

**수용 시나리오**: 게시된폼 외부제출→관리자응답조회→정정→영수증/PDF→첨부hash비교→재시작; 2회제출 멱등; 필수동의누락400; 만료게시/타회사파일/공유범위밖파일 거부; 내보내기 재권한검사.

**기존 코드 근거**: [src/server/submissions.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/submissions.ts), [src/server/submission-management.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/submission-management.ts), [src/server/submission-access.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/submission-access.ts), [src/server/consent-receipts.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/consent-receipts.ts), [src/server/files.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/files.ts), [src/server/file-access.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-access.ts), [src/server/file-download.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-download.ts), [src/server/submission-export.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/submission-export.ts), [src/components/forms/PublicForm.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/PublicForm.tsx), [src/components/forms/SubmissionDetail.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/SubmissionDetail.tsx), [src/components/forms/FileView.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/FileView.tsx), [src/components/forms/ExportJobs.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/ExportJobs.tsx), [src/components/forms/FormLists.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/FormLists.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/forms` |
| POST | `/forms` |
| GET | `/forms/{id}` |
| PATCH | `/forms/{id}` |
| DELETE | `/forms/{id}` |
| POST | `/uploads/init` |
| POST | `/public/forms/{token}/uploads` |
| GET | `/uploads/{id}` |
| DELETE | `/uploads/{id}` |
| PUT | `/uploads/{id}/content` |
| POST | `/uploads/{id}/complete` |
| GET | `/files` |
| GET | `/files/{id}` |
| PATCH | `/files/{id}` |
| DELETE | `/files/{id}` |
| GET | `/files/{id}/download` |
| GET | `/public/forms/{token}` |
| POST | `/public/forms/{token}/submissions` |
| POST | `/forms/{id}/publish` |
| POST | `/forms/{id}/copy` |
| POST | `/forms/{id}/pause` |
| POST | `/forms/{id}/revise` |
| GET | `/forms/{id}/submissions` |
| GET | `/submissions/{id}` |
| PATCH | `/submissions/{id}` |
| PATCH | `/forms/{id}/retention` |
| PATCH | `/forms/{id}/draft` |
| GET | `/forms/{id}/deletion` |
| DELETE | `/forms/{id}/purge` |
| POST | `/forms/{id}/resume` |
| PUT | `/forms/{id}/favorite` |
| DELETE | `/forms/{id}/favorite` |
| GET | `/forms/{id}/audit-events` |
| GET | `/forms/{id}/audit-events/export` |
| GET | `/forms/{id}/submissions/export` |
| POST | `/submissions/{id}/withdraw` |
| POST | `/submissions/{id}/destruction-request` |
| POST | `/submissions/{id}/hold` |
| POST | `/submissions/{id}/notes` |
| PATCH | `/submissions/{id}/notes/{noteId}` |
| DELETE | `/submissions/{id}/notes/{noteId}` |
| PATCH | `/submissions/{id}/retention` |
| GET | `/forms/{id}/approvals` |
| POST | `/forms/{id}/approvals` |
| GET | `/forms/document-options` |
| GET | `/submissions/{id}/receipts/{receiptId}/pdf` |
| POST | `/exports` |
| GET | `/exports` |
| GET | `/exports/{id}` |
| DELETE | `/exports/{id}` |
| POST | `/exports/{id}/cancel` |
| GET | `/exports/{id}/download` |

<a id="r12"></a>
## R12 외부 공유·열람자 인증

경로 3개: `/shared-privacy/email-verify`, `/shared-privacy/verify`, `/shared-privacy/view`

**데이터/CRUD**: C 공유권한/열람 challenge; R 공유목록·허용 응답; U 허용필드·기간·대상; D 권한회수/열람세션 폐기.
**접근범위**: share.manage; 외부 viewer 전용 세션과 필드 allowlist

**백엔드**: 공유 CRUD/resend/events와 challenge→verify→session→submissions/files/logout API에서 매번 허용필드/범위를 적용한다. 사용자가 전달한 filter로 범위를 넓힐 수 없게 한다.

**화면**: 공유생성/편집/회수/초대재전송, /shared-privacy/verify·email-verify·view 각 단계와 만료/권한없음. 이메일·공유코드 입력값과 필수동의 확인을 구분한다.

**수용 시나리오**: 공유범위2필드/응답1개 지정→별도브라우저코드인증→그 범위만조회; 필드회수·만료·완전회수 즉시적용; 다른공유의 id 주입·재사용OTP·토큰로그노출 차단.

**기존 코드 근거**: [src/server/sharing.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/sharing.ts), [src/server/viewer.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/viewer.ts), [src/server/share-query.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/share-query.ts), [src/server/share-cache.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/share-cache.ts), [src/server/sender-access.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/sender-access.ts), [src/components/forms/ShareGrants.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/ShareGrants.tsx), [src/components/forms/SharedPrivacy.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/SharedPrivacy.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/share-grants` |
| POST | `/share-grants` |
| GET | `/share-grants/{id}` |
| PATCH | `/share-grants/{id}` |
| DELETE | `/share-grants/{id}` |
| GET | `/share-grants/options` |
| POST | `/share-grants/{id}/resend` |
| GET | `/share-grants/{id}/events` |
| POST | `/viewer/challenges` |
| POST | `/viewer/challenges/{challengeId}/verify` |
| GET | `/viewer/session` |
| POST | `/viewer/logout` |
| GET | `/viewer/submissions` |
| GET | `/viewer/submissions/{id}` |
| GET | `/viewer/files` |
| GET | `/viewer/files/{id}` |
| GET | `/viewer/files/{id}/download` |

<a id="r13"></a>
## R13 정보주체·동의이력·본인인증

경로 7개: `/identification/:result`, `/infoOwner/action-history/:infoOwnerToken`, `/infoOwner/agree-history/:infoOwnerToken`, `/infoOwner/find`, `/infoOwner/find/complete`, `/infoOwner/form-interrupt`, `/infoOwner/formComplete`

**데이터/CRUD**: C 본인조회 challenge/철회요청/인증설정; R 자기동의·처리이력; U 인증설정·철회확정/취소; D 인증설정 비활성·세션종료.
**접근범위**: 주체 전용 세션·검증 scope; 설정은 service.manage

**백엔드**: access-requests→sessions→consents/events/withdrawals(confirm/cancel), 서비스별 verification CRUD와 검증된 provider callback을 연결한다. 검증 미설정이면 성공 영수증을 만들지 않는다.

**화면**: find/find-complete, 동의이력·행위이력 토큰, formComplete/form-interrupt 및 /identification/:result에 서버 확인결과를 표시한다. 토큰/URL 문구를 신원증명으로 신뢰하지 않는다.

**수용 시나리오**: 주체A 링크로 B동의 접근거부; 같은이메일 회사간격리; 철회확정→마케팅억제 반영; 취소·반복확정 멱등; 인증만료/중복callback/대상폼교체 거부; 실제기관시험 별도.

**기존 코드 근거**: [src/server/subjects.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/subjects.ts), [src/server/subject-identity.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/subject-identity.ts), [src/server/subject-scope.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/subject-scope.ts), [src/server/verification.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/verification.ts), [src/server/verification-flow.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/verification-flow.ts), [src/components/forms/SubjectPortal.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/SubjectPortal.tsx), [src/components/forms/VerificationSettings.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/VerificationSettings.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/services` |
| POST | `/services` |
| GET | `/services/{id}` |
| PATCH | `/services/{id}` |
| DELETE | `/services/{id}` |
| GET | `/services/{id}/verification` |
| POST | `/services/{id}/verification` |
| PATCH | `/services/{id}/verification` |
| DELETE | `/services/{id}/verification` |
| GET | `/services/{id}/consent-display/{kind}` |
| PATCH | `/services/{id}/consent-display/{kind}` |
| GET | `/services/{id}/subprocessors` |
| POST | `/services/{id}/subprocessors` |
| GET | `/services/{id}/subprocessors/{subId}` |
| PATCH | `/services/{id}/subprocessors/{subId}` |
| GET | `/services/{id}/subprocessor-notices` |
| POST | `/services/{id}/subprocessor-notices` |
| POST | `/subjects/access-requests` |
| POST | `/subjects/sessions` |
| POST | `/subjects/logout` |
| GET | `/subjects/me` |
| GET | `/subjects/me/consents` |
| GET | `/subjects/me/events` |
| POST | `/subjects/me/withdrawals` |
| GET | `/subjects/me/withdrawals/{id}` |
| POST | `/subjects/me/withdrawals/{id}/confirm` |
| POST | `/subjects/me/withdrawals/{id}/cancel` |

<a id="r14"></a>
## R14 개인정보 업로드·이관

경로 3개: `/form/info-upload`, `/form/info-upload/agreement`, `/form/info-upload/recipient`

**데이터/CRUD**: C 업로드job·행; R 검사결과·오류CSV·진행상태; U 매핑/동의증빙·재검증; D 미실행작업취소·파일정리. commit 이후 증빙은 보존.
**접근범위**: import.read/write + 대상폼권한

**백엔드**: init/upload/inspect/validate/commit/retry/cancel/rows/errors.csv를 상태기계로 연결한다. 인코딩·크기·확장자·수식 주입·동의 근거 없는 데이터·중복행을 검사한다.

**화면**: 업로드 기본/동의/제공자 세 페이지에서 파일·매핑·검증오류·미리보기·확정·진행·재시도·취소를 연결한다. 기존 localStorage 이관은 사용자 선택 dry-run과 중복 보고 후 실행한다.

**수용 시나리오**: 정상CSV3행+오류1행→검증수정→확정; 같은commit2번/worker재시작에도 중복없음; B파일주입차단; UTF8/한글·대용량·잘못된동의 증빙·CSV수식 안전성.

**기존 코드 근거**: [src/server/imports.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/imports.ts), [src/server/import-csv.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/import-csv.ts), [src/server/import-worker.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/import-worker.ts), [src/server/legacy-migration.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/legacy-migration.ts), [src/components/forms/Imports.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/Imports.tsx), [src/components/management/LegacyImport.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/LegacyImport.tsx)

| Method | 현재 계약 path |
|---|---|
| POST | `/uploads/init` |
| GET | `/uploads/{id}` |
| DELETE | `/uploads/{id}` |
| PUT | `/uploads/{id}/content` |
| POST | `/uploads/{id}/complete` |
| GET | `/imports` |
| POST | `/imports` |
| GET | `/imports/options` |
| GET | `/imports/{id}` |
| PATCH | `/imports/{id}` |
| DELETE | `/imports/{id}` |
| POST | `/imports/{id}/inspect` |
| POST | `/imports/{id}/validate` |
| POST | `/imports/{id}/commit` |
| POST | `/imports/{id}/retry` |
| GET | `/imports/{id}/rows` |
| GET | `/imports/{id}/errors.csv` |

<a id="r15"></a>
## R15 광고 동의·수신거부

경로 1개: `/form/ad-manage`

**데이터/CRUD**: C 근거 있는 동의등록; R 동의목록·집계·내보내기; U 채널별 동의/철회; D 근거 삭제가 아닌 동의회수·보존정책 적용.
**접근범위**: marketing.read/write + 주체의 본인 철회

**백엔드**: preferences CRUD/withdrawals/export/sources/summary를 실제 ConsentReceipt와 연결한다. 철회는 예약발송이 claim되는 시점에도 재검사되며 재동의는 새로운 근거를 요구한다.

**화면**: /form/ad-manage 검색조건(동의일·이메일/전화 존재·중복제거), 채널/서비스/폼 필터, 선택철회·수정·내보내기와 marketing-detail 집계를 연결한다.

**수용 시나리오**: 동의→검색→철회→예약발송억제; 중복제거 on/off 집계 대조; 원본 응답정정 시 잘못된 주체 재동의 방지; 권한없는 복호화·타회사 export 실패.

**기존 코드 근거**: [src/server/marketing.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/marketing.ts), [src/server/marketing-jobs.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/marketing-jobs.ts), [src/server/suppression.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/suppression.ts), [src/server/subject-query.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/subject-query.ts), [src/components/forms/Marketing.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/Marketing.tsx), [src/components/forms/MarketingSettings.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/MarketingSettings.tsx), [src/components/forms/FormLists.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/FormLists.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/marketing/preferences` |
| POST | `/marketing/preferences` |
| GET | `/marketing/preferences/{id}` |
| PATCH | `/marketing/preferences/{id}` |
| DELETE | `/marketing/preferences/{id}` |
| POST | `/marketing/preferences/withdrawals` |
| GET | `/marketing/preferences/export` |
| GET | `/marketing/sources` |
| GET | `/marketing/summary` |
| GET | `/email-suppressions` |

<a id="r16"></a>
## R16 보유기간·파기 일정·증명서

경로 4개: `/log/collect-destruction`, `/log/destruction-schedule`, `/log/destruction_certificate`, `/log/retention`

**데이터/CRUD**: C 보유규칙/파기요청; R 기간·예정목록·증명서; U 보유기간·승인·보류·재예약; D 규칙보관·요청취소·승인된 실제파기. 증명서 수정/임의삭제 없음.
**접근범위**: security.read/write·submission.destroy 분리; 승인자 범위

**백엔드**: 기존 retention-rules CRUD와 /log/retention 신규 화면을 연결할 계약을 명시한다(원본 정상화면 미확인, 독립 제안). 파기 승인/거절/취소/재시도/재예약과 worker의 참조차단·재실행 안전성을 점검한다.

**화면**: /log/retention 기간규칙목록/추가/편집/보관, 수집파기현황, 파기예정·요청상세·승인/보류·재예약, 증명서조회/다운로드. 파기 이후 빈값이 아닌 파기 상태/근거를 표시한다.

**수용 시나리오**: 짧은보유fixture→보류→만료worker실행(유지)→보류해제/승인→실제DB·파일삭제→증명서; 다운로드/발송/정정과 파기경합; worker중단후재개 중복증명서없음.

**기존 코드 근거**: [src/server/retention-rules.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/retention-rules.ts), [src/server/destruction.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/destruction.ts), [src/server/destruction-worker.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/destruction-worker.ts), [src/server/collect-destruction.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/collect-destruction.ts), [src/server/destruction-access.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/destruction-access.ts), [src/components/management/destruction.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/destruction.tsx), [src/components/management/CollectDestruction.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/CollectDestruction.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/submissions/{id}` |
| PATCH | `/submissions/{id}` |
| GET | `/retention-rules` |
| POST | `/retention-rules` |
| GET | `/retention-rules/{id}` |
| PATCH | `/retention-rules/{id}` |
| DELETE | `/retention-rules/{id}` |
| POST | `/submissions/{id}/withdraw` |
| POST | `/submissions/{id}/destruction-request` |
| POST | `/submissions/{id}/hold` |
| POST | `/submissions/{id}/notes` |
| PATCH | `/submissions/{id}/notes/{noteId}` |
| DELETE | `/submissions/{id}/notes/{noteId}` |
| PATCH | `/submissions/{id}/retention` |
| GET | `/destruction-requests` |
| POST | `/destruction-requests/{id}/approve` |
| POST | `/destruction-requests/{id}/reject` |
| POST | `/destruction-requests/{id}/cancel` |
| POST | `/destruction-requests/{id}/retry` |
| POST | `/destruction-requests/{id}/reschedule` |
| GET | `/destruction-certificates` |
| GET | `/destruction-certificates/{id}` |
| GET | `/destruction-certificates/{id}/download` |
| GET | `/submissions/{id}/receipts/{receiptId}/pdf` |

<a id="r17"></a>
## R17 발신번호·문자 캠페인

경로 6개: `/sms`, `/sms/catchform`, `/sms/direct`, `/sms/history`, `/sms/nonumber`, `/sms/number`

**데이터/CRUD**: C 발신자·초안·수신자·템플릿; R 인증/발송내역; U 초안·예약·기본발신자; D 초안·발신자 비활성/예약취소. 발송완료는 receipt 이력 유지.
**접근범위**: sender.manage·message.send/manage·service scope

**백엔드**: 발신자 CRUD/검증증빙/disable, 폼응답·직접수신자 구성, 캠페인 preview/schedule/reschedule/cancel/retry와 receipt 서명/순서/중복 검증. 발송직전 동의·권한·잔액 재검사.

**화면**: sms 기본/폼선택/직접작성/번호관리/내역/번호없음 모두 실데이터. 번호등록 모달의 번호·설명·증빙4종·파일제한을 최신 캡처와 맞추고 작성내용·주소록·비용·예약확인을 구현한다.

**수용 시나리오**: 번호등록→시험검증→수신자2명→예약→취소/발송→receipt→잔액대조; 미승인번호거부; 철회직후발송차단; provider timeout 재시도 중복비용없음. 실제SMS도착증거 별도.

**기존 코드 근거**: [src/server/senders.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/senders.ts), [src/server/sender-providers.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/sender-providers.ts), [src/server/campaigns.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/campaigns.ts), [src/server/campaign-scheduling.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/campaign-scheduling.ts), [src/server/campaign-worker.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/campaign-worker.ts), [src/server/sms-adapter.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/sms-adapter.ts), [src/server/campaign-ledger.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/campaign-ledger.ts), [src/components/services/Senders.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/Senders.tsx), [src/components/services/Campaigns.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/Campaigns.tsx), [src/components/services/MessageTemplates.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/MessageTemplates.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/senders` |
| POST | `/senders` |
| GET | `/senders/{id}` |
| PATCH | `/senders/{id}` |
| DELETE | `/senders/{id}` |
| GET | `/campaigns` |
| POST | `/campaigns` |
| GET | `/campaigns/{id}` |
| PATCH | `/campaigns/{id}` |
| DELETE | `/campaigns/{id}` |
| GET | `/message-templates` |
| POST | `/message-templates` |
| GET | `/message-templates/{id}` |
| PATCH | `/message-templates/{id}` |
| DELETE | `/message-templates/{id}` |
| POST | `/sms/receipts` |
| POST | `/senders/{id}/default` |
| POST | `/senders/{id}/disable` |
| POST | `/senders/{id}/renew` |
| POST | `/senders/{id}/cleanup` |
| POST | `/senders/{id}/request-email` |
| POST | `/senders/{id}/confirm-email` |
| POST | `/senders/{id}/dns` |
| POST | `/senders/{id}/check` |
| POST | `/senders/{id}/evidence` |
| POST | `/senders/{id}/evidence/{fileId}/attach` |
| DELETE | `/senders/{id}/evidence/{fileId}` |
| GET | `/senders/{id}/evidence/{fileId}/download` |
| GET | `/campaigns/sources` |
| GET | `/campaigns/{id}/recipients` |
| POST | `/campaigns/{id}/recipients` |
| GET | `/campaigns/{id}/deliveries` |
| GET | `/campaigns/{id}/export` |
| POST | `/campaigns/{id}/preview` |
| POST | `/campaigns/{id}/schedule` |
| POST | `/campaigns/{id}/reschedule` |
| POST | `/campaigns/{id}/cancel` |
| POST | `/campaigns/{id}/archive` |
| POST | `/campaigns/{id}/retry` |
| GET | `/message-templates/{id}/revisions/{version}` |
| GET | `/campaigns/{id}/files/{fileId}/download` |
| POST | `/message-templates/{id}/archive` |
| POST | `/message-templates/{id}/restore` |
| POST | `/campaigns/{id}/apply-template` |
| POST | `/campaigns/{id}/files` |
| POST | `/campaigns/{id}/files/{fileId}/attach` |
| DELETE | `/campaigns/{id}/files/{fileId}` |

<a id="r18"></a>
## R18 발신메일·이메일 발송·수신거부

경로 6개: `/mail`, `/mail/catchform`, `/mail/direct`, `/mail/history`, `/mail/no-mail`, `/mail/number`

**데이터/CRUD**: C 발신주소/메일초안/첨부/템플릿; R DNS·내역·반송; U 내용·예약·템플릿; D 초안·첨부·예약취소, 발신주소 비활성. 구독취소는 억제 이벤트.
**접근범위**: sender.manage·message.send/manage; 구독취소 서명토큰

**백엔드**: 발신주소 request/confirm/DNS/check, HTML 정제·개인화 preview·첨부다운로드, 송신/반송/불만/구독취소 token 처리와 retry를 연결한다. 조작된 수신거부 토큰·다른회사 receipt를 거부한다.

**화면**: mail 폼/직접발송·발신주소/발송내역/주소없음 화면, 편집기·템플릿·미리보기·첨부·예약/취소·반송사유를 연결한다. 401/403을 빈목록으로 표시하지 않는다.

**수용 시나리오**: 메일작성/첨부→로컬메일함 수신본문과hash대조→반송→억제→재발송차단; 실제SMTP·DNS·수신함·unsubscribe 및 재시작 검증을 분리 기록.

**기존 코드 근거**: [src/server/email-policy.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/email-policy.ts), [src/server/email-feedback.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/email-feedback.ts), [src/server/message-content.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/message-content.ts), [src/server/message-templates.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/message-templates.ts), [src/server/campaign-files.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/campaign-files.ts), [src/server/campaign-worker.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/campaign-worker.ts), [src/server/senders.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/senders.ts), [src/components/services/Senders.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/Senders.tsx), [src/components/services/Campaigns.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/Campaigns.tsx), [src/components/services/MessageContent.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/MessageContent.tsx), [src/components/services/EmailSuppressions.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/EmailSuppressions.tsx), [src/components/services/EmailUnsubscribe.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/EmailUnsubscribe.tsx), [src/components/services/CampaignFiles.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/CampaignFiles.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/senders` |
| POST | `/senders` |
| GET | `/senders/{id}` |
| PATCH | `/senders/{id}` |
| DELETE | `/senders/{id}` |
| GET | `/campaigns` |
| POST | `/campaigns` |
| GET | `/campaigns/{id}` |
| PATCH | `/campaigns/{id}` |
| DELETE | `/campaigns/{id}` |
| GET | `/message-templates` |
| POST | `/message-templates` |
| GET | `/message-templates/{id}` |
| PATCH | `/message-templates/{id}` |
| DELETE | `/message-templates/{id}` |
| POST | `/senders/{id}/default` |
| POST | `/senders/{id}/disable` |
| POST | `/senders/{id}/renew` |
| POST | `/senders/{id}/cleanup` |
| POST | `/senders/{id}/request-email` |
| POST | `/senders/{id}/confirm-email` |
| POST | `/senders/{id}/dns` |
| POST | `/senders/{id}/check` |
| POST | `/senders/{id}/evidence` |
| POST | `/senders/{id}/evidence/{fileId}/attach` |
| DELETE | `/senders/{id}/evidence/{fileId}` |
| GET | `/senders/{id}/evidence/{fileId}/download` |
| GET | `/campaigns/sources` |
| GET | `/campaigns/{id}/recipients` |
| POST | `/campaigns/{id}/recipients` |
| GET | `/campaigns/{id}/deliveries` |
| GET | `/campaigns/{id}/export` |
| POST | `/campaigns/{id}/preview` |
| POST | `/campaigns/{id}/schedule` |
| POST | `/campaigns/{id}/reschedule` |
| POST | `/campaigns/{id}/cancel` |
| POST | `/campaigns/{id}/archive` |
| POST | `/campaigns/{id}/retry` |
| GET | `/message-templates/{id}/revisions/{version}` |
| GET | `/campaigns/{id}/files/{fileId}/download` |
| POST | `/message-templates/{id}/archive` |
| POST | `/message-templates/{id}/restore` |
| POST | `/message-content/preview` |
| POST | `/campaigns/{id}/apply-template` |
| POST | `/campaigns/{id}/files` |
| POST | `/campaigns/{id}/files/{fileId}/attach` |
| DELETE | `/campaigns/{id}/files/{fileId}` |
| POST | `/email-feedback` |
| GET | `/email-suppressions` |
| GET | `/email-unsubscribe/{token}` |
| POST | `/email-unsubscribe/{token}` |

<a id="r19"></a>
## R19 알림톡 채널·템플릿·발송

경로 9개: `/alimtalk`, `/alimtalk/channels`, `/alimtalk/history`, `/alimtalk/send`, `/alimtalk/templates`, `/alimtalk/templates/:templateId`, `/alimtalk/templates/:templateId/edit`, `/alimtalk/templates/register`, `/kakao-playground`

**데이터/CRUD**: C 채널·템플릿·발송초안; R 목록·상세·심사/발송내역; U 초안·반려수정·활성; D 미사용채널/템플릿보관. 승인본 수정은 재심사.
**접근범위**: message/sender capability + 알림톡 entitlement + service scope

**백엔드**: 채널 CRUD/verify, 템플릿 CRUD/preview/submit/review/send 및 심사 callback, 수신결과·SMS 대체발송의 과금 멱등성을 점검한다.

**화면**: /alimtalk/channels 현재 dispatcher 누락을 연결하고 /alimtalk·templates/register·id·id/edit·send·history 전부 실제 상태에 맞춘다. Playground는 미리보기 도구로서 저장이 필요한 동작만 템플릿 계약에 연결한다.

**수용 시나리오**: 채널등록→검증→템플릿등록→반려/수정/승인→변수발송→receipt; 승인템플릿수정시 재심사; 비활성채널거부; fallback중복방지; 실제카카오 승인/수신은 제공사시험 증거필수.

**기존 코드 근거**: [src/server/kakao.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/kakao.ts), [src/server/kakao-binding.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/kakao-binding.ts), [src/server/campaign-worker.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/campaign-worker.ts), [src/server/campaigns.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/campaigns.ts), [src/components/services/KakaoTemplates.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/KakaoTemplates.tsx), [src/components/services/KakaoTemplateDetail.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/KakaoTemplateDetail.tsx), [src/components/services/Campaigns.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/Campaigns.tsx), [src/components/services/kakao.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/kakao.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/campaigns` |
| POST | `/campaigns` |
| GET | `/campaigns/{id}` |
| PATCH | `/campaigns/{id}` |
| DELETE | `/campaigns/{id}` |
| GET | `/kakao/channels/{id}` |
| DELETE | `/kakao/channels/{id}` |
| PATCH | `/kakao/channels/{id}` |
| GET | `/kakao/templates/{id}` |
| DELETE | `/kakao/templates/{id}` |
| PATCH | `/kakao/templates/{id}` |
| GET | `/kakao/channels` |
| POST | `/kakao/channels` |
| POST | `/kakao/channels/{id}/verify` |
| GET | `/kakao/templates` |
| POST | `/kakao/templates` |
| POST | `/kakao/templates/preview` |
| POST | `/kakao/templates/{id}/submit` |
| GET | `/kakao/templates/{id}/review` |
| POST | `/kakao/templates/{id}/send` |
| POST | `/kakao/reviews` |
| GET | `/campaigns/sources` |
| GET | `/campaigns/{id}/recipients` |
| POST | `/campaigns/{id}/recipients` |
| GET | `/campaigns/{id}/deliveries` |
| GET | `/campaigns/{id}/export` |
| POST | `/campaigns/{id}/preview` |
| POST | `/campaigns/{id}/schedule` |
| POST | `/campaigns/{id}/reschedule` |
| POST | `/campaigns/{id}/cancel` |
| POST | `/campaigns/{id}/archive` |
| POST | `/campaigns/{id}/retry` |
| GET | `/campaigns/{id}/files/{fileId}/download` |
| POST | `/campaigns/{id}/apply-template` |
| POST | `/campaigns/{id}/files` |
| POST | `/campaigns/{id}/files/{fileId}/attach` |
| DELETE | `/campaigns/{id}/files/{fileId}` |

<a id="r20"></a>
## R20 알림 받기·웹훅·이메일 알림

경로 1개: `/integration/message`

**데이터/CRUD**: C 알림설정/이벤트구독; R 설정·전송이력; U 대상·채널·활성; D 설정해제·일괄삭제. 전달결과는 append-only.
**접근범위**: integration.read/manage + 설정 대상 서비스 권한

**백엔드**: CRUD/options/test/enabled/bulk-delete/deliveries/retry를 검증하고 실제 업무 트랜잭션에서 outbox를 만든다. HTTPS목적지·내부주소차단·secret마스킹·재시도 상한을 점검한다.

**화면**: 목록·추가/편집 모달의 이름, webhook/email, 전체/선택 서비스·폼, 9이벤트, 활성토글·테스트·삭제·전송결과/재시도까지 연결한다.

**수용 시나리오**: 폼응답이벤트→정확한 대상1회전송→실패/재시도→비활성/삭제 즉시중단; 다른서비스이벤트누출없음; endpoint변경경합·타임아웃·내부망URL거부. Slack/Teams실제수신 별도.

**기존 코드 근거**: [src/server/notifications.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/notifications.ts), [src/server/notification-worker.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/notification-worker.ts), [src/server/notification-transport.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/notification-transport.ts), [src/components/services/Notifications.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/Notifications.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/integrations` |
| POST | `/integrations` |
| GET | `/integrations/{id}` |
| PATCH | `/integrations/{id}` |
| DELETE | `/integrations/{id}` |
| GET | `/integrations/options` |
| POST | `/integrations/delete` |
| POST | `/integrations/{id}/enabled` |
| POST | `/integrations/{id}/test` |
| GET | `/integrations/{id}/deliveries` |
| POST | `/integrations/{id}/deliveries/{deliveryId}/retry` |

<a id="r21"></a>
## R21 라이선스·결제수단·주문·원장·환불

경로 17개: `/bill/:id`, `/bill/:id/refund`, `/creditBill/:id`, `/pay/billing-policy`, `/pay/cancel`, `/pay/credit/success/:purchaseId`, `/pay/history`, `/pay/license-service`, `/pay/membership/detail`, `/pay/method`, `/pay/plus/fail/:errorCode`, `/pay/plus/success/:purchaseId`, `/pay/plus/success/:purchasedId/:type`, `/pay/result/fail`, `/pay/result/success/:purchaseId`, `/pay/service-asset`, `/pay/usage/history`

**데이터/CRUD**: C 구독/결제수단/주문/환불요청; R 상품·자산·원장·청구서; U 기본수단·예약해지/취소; D 수단삭제·구독해지. 승인결제/원장은 보정 이벤트만.
**접근범위**: billing.read/write; 상품관리는 platformAdmin; webhook검증

**백엔드**: provider event 검증·order return·승인/실패/환불 상태기계와 멱등성을 재검증한다. 수정 중인 payment-events/payments/subscriptions를 보존하고 새계획의 검증만 추가한다. success URL은 조회 전용.

**화면**: license-service/membership/detail/method/billing-policy/history/usage/service-asset/bill/creditBill/refund와 성공/실패/type/errorCode 모든 변형을 연결한다. 대기/중복callback/권한없음·영수증·해지철회를 구분한다.

**수용 시나리오**: 시험주문→승인중복/역순event→1회잔액충전→부분/전액환불→원장합계0검증; 결제중해지409·과거취소구독충전차단 기존회귀 보존; 임의successURL로승인불가; 실제PG시험은 별도.

**기존 코드 근거**: [src/server/admin-plans.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/admin-plans.ts), [src/server/entitlements.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/entitlements.ts), [src/server/payment-methods.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/payment-methods.ts), [src/server/payments.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/payments.ts), [src/server/subscriptions.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/subscriptions.ts), [src/server/subscription-worker.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/subscription-worker.ts), [src/server/billing-settlement.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/billing-settlement.ts), [src/server/ledger.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/ledger.ts), [src/server/billing-reads.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/billing-reads.ts), [src/server/billing-history.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/billing-history.ts), [src/components/services/payment.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/payment.tsx), [src/components/services/InvoiceDetail.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/services/InvoiceDetail.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/billing-history` |
| GET | `/ledger` |
| GET | `/admin/plans` |
| POST | `/admin/plans` |
| GET | `/admin/plans/{id}` |
| PATCH | `/admin/plans/{id}` |
| DELETE | `/admin/plans/{id}` |
| GET | `/usage-events` |
| GET | `/invoices` |
| GET | `/plans` |
| GET | `/entitlements` |
| GET | `/assets` |
| GET | `/subscriptions` |
| POST | `/subscriptions` |
| GET | `/billing/methods` |
| POST | `/billing/methods` |
| PATCH | `/billing/methods/{id}` |
| DELETE | `/billing/methods/{id}` |
| GET | `/billing/orders` |
| POST | `/billing/orders` |
| GET | `/billing/orders/{id}` |
| POST | `/billing/orders/{id}/return` |
| POST | `/billing/provider-events` |
| POST | `/billing/orders/{id}/virtual-checkout` |
| POST | `/billing/refunds/{id}/virtual-settle` |
| GET | `/subscriptions/entitlement` |
| POST | `/subscriptions/{id}/cancel` |
| POST | `/subscriptions/{id}/undo-cancel` |
| POST | `/subscriptions/{id}/schedule-cancel` |

<a id="r22"></a>
## R22 개인정보·권한·활동 감사로그

경로 10개: `/form/manage/applicant/log/:formId`, `/log/access-history`, `/log/ad-monitoring`, `/log/authority`, `/log/customer`, `/log/external-viewer`, `/log/info-monitoring`, `/log/mail`, `/log/member`, `/log/service`

**데이터/CRUD**: C 실제업무 처리시 서버가 이벤트 추가; R 필터·상세·CSV; U/D 원장 직접 조작 없음. 검토요청·응답은 별도 resource 상태전이.
**접근범위**: audit.read + service scope; mine는 actor 강제

**백엔드**: 각 kind(info/marketing/service/member/authority/external/access/customer/mail)와 mine/form 범위 조회·export가 동일 필터를 사용하게 한다. 업무변경과 audit append 원자성, 개인정보원문 최소화·보존집행을 검증한다.

**화면**: 9종 로그와 내 활동·폼로그의 기간/서비스/처리자/검색/페이지크기/상세/내보내기, 개인정보활동 검토요청을 실제 컬럼에 연결한다. 403을 건수0으로 표시하지 않는다.

**수용 시나리오**: 각 도메인 실제변경1회→해당kind1건→화면/CSV같음; 읽기전용 권한·타회사·허용필드 마스킹; 로그PATCH/DELETE미노출; 경계날짜/KST·대량export·동일시각페이지 누락없음.

**기존 코드 근거**: [src/server/audit.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/audit.ts), [src/server/audit-events.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/audit-events.ts), [src/server/form-audit-events.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/form-audit-events.ts), [src/server/activity-reviews.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/activity-reviews.ts), [src/server/exports.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/exports.ts), [src/components/management/AuditLogs.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/AuditLogs.tsx), [src/components/management/ActivityReviews.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/management/ActivityReviews.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/audit-events` |
| GET | `/audit-events/export` |
| GET | `/me/audit-events` |
| GET | `/me/audit-events/export` |
| POST | `/exports` |
| GET | `/exports` |
| GET | `/exports/{id}` |
| DELETE | `/exports/{id}` |
| POST | `/exports/{id}/cancel` |
| GET | `/exports/{id}/download` |
| GET | `/activity-reviews` |
| POST | `/activity-reviews` |
| GET | `/activity-reviews/{id}` |
| POST | `/activity-reviews/{id}/actions` |
| POST | `/activity-reviews/{id}/notifications` |
| POST | `/activity-reviews/{id}/destruction` |

<a id="r23"></a>
## R23 대시보드·통계·준수·월마감

경로 8개: `/compliance`, `/dashboard`, `/dashboard/:serviceId`, `/log/month-monitoring`, `/marketing-detail`, `/marketing-detail/:serviceId`, `/privacy-detail`, `/privacy-detail/:serviceId`

**데이터/CRUD**: C 월마감 snapshot/출력job; R 대시보드·개인정보/광고통계·마감자료; U/D 수치 직접변경 없음, 출력취소/파일만 삭제 정책.
**접근범위**: 허용서비스 집계; audit/security·license별 마감권한

**백엔드**: dashboard/privacy/marketing/compliance/closes/exports의 분모·시점·동의철회·파기 반영 기준을 계약화한다. 마감 unique와 정정이력·실패재시도·읽기권한을 검증한다.

**화면**: 대시보드7경로의 전체/서비스 선택과 기간/드릴다운, /log/month-monitoring의 고정Enterprise gate를 실제 월목록·상세·출력에 연결한다. 근거부족은 미평가로 표시한다.

**수용 시나리오**: 수집3→철회1→파기1 fixture로 각통계DB대조; 서비스B제외; KST월말 경계; 마감중복1개; 파기후snapshot의 개인정보비노출; export재시작/취소·다운로드권한.

**기존 코드 근거**: [src/server/analytics.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/analytics.ts), [src/server/scoped-analytics.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/scoped-analytics.ts), [src/server/compliance-evidence.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/compliance-evidence.ts), [src/server/compliance-close.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/compliance-close.ts), [src/server/compliance-exports.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/compliance-exports.ts), [src/server/analytics-period.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/analytics-period.ts), [src/components/Dashboard.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/Dashboard.tsx), [src/components/StatisticsPages.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/StatisticsPages.tsx), [src/components/forms/Marketing.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/Marketing.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/analytics/privacy` |
| GET | `/analytics/marketing` |
| GET | `/compliance` |
| GET | `/analytics/closes` |
| POST | `/analytics/closes` |
| GET | `/analytics/closes/{id}/export` |
| POST | `/analytics/exports` |
| GET | `/analytics/exports` |
| GET | `/analytics/exports/{id}` |
| DELETE | `/analytics/exports/{id}` |
| POST | `/analytics/exports/{id}/cancel` |
| GET | `/analytics/exports/{id}/download` |
| GET | `/analytics/dashboard` |

<a id="r24"></a>
## R24 공지·도움말·문의·공통 경로

경로 9개: `/`, `/*`, `/IE`, `/access-not-allow`, `/help-center`, `/loading`, `/notice`, `/notice/:admNotiId`, `/security/*`

**데이터/CRUD**: C 관리자 공지/가이드·사용자문의; R 게시콘텐츠/상태; U 초안·답변·게시; D 초안/첨부보관. 로딩/오류/wildcard는 별도 CRUD 없음.
**접근범위**: platformAdmin; 게시문서공개정책; 자기문의 및 지원담당

**백엔드**: 콘텐츠 CRUD/게시·파일, 문의 생성/답변/종결/재개에 systemAdmin·자기문의 접근을 적용한다. 공개/로그인 경계와 안내 페이지의 실제 상태조회 계약을 명시한다.

**화면**: notice/id/help-center·관리자작성/편집·내문의, /·/IE·loading·access-not-allow와 /*·/security/* fallback을 명시적으로 처리한다. wildcards를 임의모든경로 허용 정규식으로 합치지 않는다.

**수용 시나리오**: 관리자공지생성/게시→일반조회→수정/보관·첨부검증; 일반계정관리CRUD거부; 문의A/B격리; 잘못된경로404·보안fallback·새로고침·뒤로가기·키보드·모바일까지 검증.

**기존 코드 근거**: [src/server/notices.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/notices.ts), [src/server/notice-attachments.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/notice-attachments.ts), [src/server/guides.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/guides.ts), [src/server/support-tickets.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/support-tickets.ts), [src/components/NoticePages.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/NoticePages.tsx), [src/components/GuidePages.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/GuidePages.tsx), [src/components/SupportPages.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/SupportPages.tsx), [src/components/LoadingTransition.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/LoadingTransition.tsx), [src/components/AccessDeniedPage.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/AccessDeniedPage.tsx), [src/components/AppShell.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/AppShell.tsx), [src/components/CloneApp.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/CloneApp.tsx)

| Method | 현재 계약 path |
|---|---|
| GET | `/admin/notices` |
| POST | `/admin/notices` |
| GET | `/admin/notices/{id}` |
| PATCH | `/admin/notices/{id}` |
| DELETE | `/admin/notices/{id}` |
| GET | `/admin/guides` |
| POST | `/admin/guides` |
| GET | `/admin/guides/{id}` |
| PATCH | `/admin/guides/{id}` |
| DELETE | `/admin/guides/{id}` |
| GET | `/feedback` |
| POST | `/feedback` |
| GET | `/feedback/{id}` |
| PATCH | `/feedback/{id}` |
| DELETE | `/feedback/{id}` |
| GET | `/notices` |
| POST | `/notices` |
| GET | `/notices/{id}` |
| PATCH | `/notices/{id}` |
| DELETE | `/notices/{id}` |
| GET | `/notices/{id}/attachments/{attachmentId}` |
| PUT | `/notices/{id}/attachments/{attachmentId}` |
| DELETE | `/notices/{id}/attachments/{attachmentId}` |
| GET | `/guides` |
| POST | `/guides` |
| GET | `/guides/{id}` |
| PATCH | `/guides/{id}` |
| DELETE | `/guides/{id}` |
| PUT | `/guides/{id}/file` |
| GET | `/guides/{id}/download` |
| GET | `/support-tickets` |
| POST | `/support-tickets` |
| GET | `/support-tickets/{id}` |
| PATCH | `/support-tickets/{id}` |
| DELETE | `/support-tickets/{id}` |
| POST | `/support-tickets/{id}/reply` |
| POST | `/support-tickets/{id}/close` |
| POST | `/support-tickets/{id}/reopen` |
