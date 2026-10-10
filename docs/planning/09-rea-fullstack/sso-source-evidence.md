# R07 원본 정적 근거

2026-10-10, 읽기 전용 분석. 원본 경로는 작업공간의 `outputs/catchsecu-reverse-2026-10-09/bundle/main.183e9d2c.js`다. REA `ev_87493e79c4f053718022b23e1e5d42acf1af245f8c7838a89cd7ebc3918df152`. 아래 위치는 UTF-16의 0부터 시작하는 오프셋이며 실행 성공 증거가 아니다.

| 경로/심볼 | 위치 | 확인한 동작 |
|---|---:|---|
| `/security/sso` acr | 14840626 | 구성원 SSO 연동 관리, 연결 계정 확인 후 이메일 인증 또는 SSO 연동 필요 안내 |
| `/security/sso/setting` scr | 14843190 | NONE/AZURE/GOOGLE 선택·저장·확인 |
| SSO 경로 gate zcr | 14865663 | twoStepCertification, Enterprise, sso_login_lookup, ROOT/SECURITY |
| `/login/oauth2/verified` Egr | 15246473 | token 검증 후 이동 |
| `/login/gpki/callback` Cgr | 15244034 | 팝업 opener 전송 또는 단독 서버 검증 |
| `/login/saeol/callback` Igr | 15248349 | token 서버 검증 |
| `/gpki/fail` wgr | 15243657 | 팝업 이메일 필요 메시지 또는 등록 화면 이동 |
| `/gpki/email-register` ygr | 15241923 | 기관/기존 이메일 조회, 새 이메일 중복 확인·인증 |
| `/saeol/fail/:org` jgr | 15247996 | 오류별 로그인/이메일 등록 이동. org 매개변수 사용은 본문에서 확인 못함 |
| `/link/oauth2/verified` Tgr | 15245848 | 연결 결과 후 /my-page/info |
| `/oauth2/fail` Sgr | 15244481 | login/link/invite 별 오류 복구 |
| `/oauth2/signup` $fr | 15225960 | 이메일·이름·회사명·만14세/약관 동의 |
| `/oauth2/invite/signup` Dfr | 15223173 | invitedInfo 기반 Google/MS 버튼 |
| `/login/saml/start` Hgr | 15259250 | 서버 HTML form 자동 제출 |
| `/login/saml/verified` $gr | 15258596 | token 검증 후 이동 |
| `/login/saml/fail` Vgr | 15258411 | 오류 안내 후 / 또는 /login-failed |

`/login/oauth2`, `/login/gpki`, `/login/saeol`, `/link/oauth2`, `/login/saml`은 자체 element 없는 부모다. `/oauth2/fail` 선언이 중복된다. R07의 고유20경로와 공통 초대 경로를 혼동하지 않는다.

## 로그인 허용 정책

GET `/user-service/security/sso/manage` (@14841017), GET `/user-service/sso/oauth2/status` (@14488276)로 `ssoOAuthLoginPolicy`, `oauth2` 조회. POST manage(@14843749)는 `{ssoOAuthLoginPolicy}`만 전송한다. NONE은 모든 로그인 허용, AZURE는 Microsoft 제한, GOOGLE은 Google 제한이다. 현재 oauth2가 google이면 AZURE가, azure이면 GOOGLE이 비활성이다.

이메일 인증 `GL("SSO_LOGIN", accessToken)`→`KL("SSO_LOGIN", code)` 성공 후 `location.state.certified=true`로 설정에 진입한다. 저장 시 `TwoStep-Authorization`을 보낸다. 제한 적용 전 GET `/user-service/security/sso/manage/user/status` (@14846303) 성공을 요구한다. NONE은 이 사전 조회가 없다. 원본의 클라이언트 표시와 서버의 실제 집행은 별도다.

## OAuth/SAML

`sso_login_lookup`이면 Google/MS 버튼 → `/user-service/oauth2/authorization/google|azure`. 로그인 검증 POST `/user-service/sso/oauth2/login/verified`(@15246668), 연결 POST `/user-service/sso/oauth2/link/verified`(@15246054)는 `{token}`. IP 오류는 `/not-allow-ip`. 원본 accessToken을 로컬 인증 자격으로 인정하지 않는다.

SAML start는 **!sso_login_lookup** 분기다. accessToken 확인 실패가500이 아니면 POST `/user-service/sso/saml/start`, `{token:accessToken||""}`, 401이면 Token-Delete. 응답 HTML form 제출 후 `/user-service/sso/saml/verified`에 `{token}`. `saml_login` 문자열이 존재한다고 실제 분기 키로 간주하지 않는다. 전문가 분기는 `mE` 반환 형태와 `t.data` 사용이 달라 런타임 정상 동작을 확정하지 못했다.

## 기관 인증

gov_badge→기관 목록 GET `/user-service/gpki/company`(@9347333), institutionCode/institutionName 선택. GET authorize(@9345905)에 `{institutionCode,state}`. state는 UUID·sessionStorage.gpki_state, 반환 authorizeUrl을600×700 팝업으로 연다.

- GPKI 팝업은 `{type:"gpki-login-success",token,state}`를 opener에 보낸다. 수신 화면은 같은origin을 검사하고 OAuth verified로 간다. 수신 측 state 비교는 이 번들에서 확인하지 못했으며 서버 검증 여부도 미확인이다.
- GPKI 단독은 POST `/user-service/gpki/login/verified` 후 **response.data.data.accessToken**, 새올은 같은API 후 **response.data.token**을 사용한다. 두 응답 형태를 임의 통일하지 않는다.
- GET `/user-service/gpki/email-info?code=...`→이메일 중복 확인→메일 인증→`/auth-code`에 `{gpki:true,code,email}`. 입력 변경 시 중복 확인 초기화.
- 새올 EXISTS/DUPLICATE_EMAIL/MISSING_REQUIRED_EMAIL은 saeolLogin 세션 플래그 후 공통 등록 화면. auth-code(@10193605)는 플래그로 GPKI `/user-service/gpki/user` 또는 새올 `/user-service/sso/saeol/user`에 `{code,email,authKey}` 전송.

정상 원본 SSO/기관 인증·실제 라이선스/제공사·서명/state 서버 검증은 미관측이다. 원본 캡처는 Enterprise 제한 화면이다. 현재 구현의 VirtualOrgMember와 로컬 서명 IdP는 합성 검증이며 외부 수용을 대신하지 않는다.
# 후속 읽기 전용 대조 — 2026-10-10

- UTF-16 `scr @14846303`: GET `/security/sso/manage/user/status`는 TwoStep 헤더만 보내며 선택 정책이나 구성원 목록을 보내지 않는다. 응답 본문을 사용하지 않고 성공하면 저장한다. **전원 사전 연결 완료 조건은 확인되지 않았다.** 원본 phrase7은 미연결 구성원에게 연결을 요청하라는 적용 영향 안내다.
- `acr @14841017`: 관리 GET의 `response.data`는 정책 문자열이다. `/sso/oauth2/status`는 `{oauth2,ssoOAuthLoginPolicy}`이며 현재 사용자의 연결 제공자를 나타내는 데 쓰인다. 실제 세션의 인증 수단을 뜻하는지는 서버를 보지 못해 미확인이다.
- `uar @14511976`: 정책이 NONE이 아니면 개인 연결 해제를 UI에서 차단한다. NONE은 회사 제한 없음이지 연결된 모든 계정의 비밀번호 로그인 허용을 보장하지 않는다. 비밀번호 로그인 별도 오류 `OAUTH2_USER_ALREADY_EXIST @9345076`가 존재한다.
- `GL @7733535`, `KL @7733827`, `wD @7755305`: SSO_LOGIN 목적의 이메일 initial/verify, `twoStepAccessToken`과 `TwoStep-Authorization`. 공통 재발송 분기에는 이 목적이 없어 SSO 재발송 성공 계약은 미확인이다.
- `JPe @10181631`, `Dfr @15223173`: 초대의 정책을 소문자로 바꿔 공급자 URL에 전달한다. 두 번째 초대 조회 후에도 전달받은 정책을 사용하는 흐름이므로 클라이언트 상태만으로 현재 정책을 집행할 수 없다. `Sgr @15244481`에서 GOOGLE_OAUTH_POLICY/MS_OAUTH_POLICY와 초대 이메일 오류를 처리한다.

위 내용은 기존 번들에 대한 독립 에이전트의 읽기 전용 소스 추적이며 원본 서버의 미공개 판정식을 검증한 결과가 아니다.
