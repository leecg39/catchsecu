# 인증·SSO 정책 20경로 직접 진입 점검

2026-10-10 Ego 공간2/p1, 기존 로컬 owner 세션으로 직접 진입했다. 인증·등록·정책 저장 요청을 제출하지 않았다. 아래는 경로/초기 상태 수용이며 정상 인증/CRUD 완료 결과가 아니다.

[직접 진입 1~5](batch-1.json), [6~20](batch-2.json), [20경로×390/768/1440px](responsive.json). 총60폭에서 문서 가로 넘침0, 각 경로 h1과 초기 상태를 확인했다. 유형별390px 스크린샷9개를 직접 확인했다. 일부 정책 내용은 세로 스크롤로 접근한다.

## 수정 전후와 수용 한계

초기 RR095/RR101의 `/login/oauth2/verified`·`/login/saml/verified`는 유효한 결과 없이 직접 진입해도 공급자가 미연결이라고 단정했다. 두 경로를 인증 결과 확인 불가 안내와 해당 SSO 로그인 재시작 링크로 수정했다. 원본 서버 토큰을 로컬 로그인 자격으로 승인하지 않는다. 초기20경로/60폭 기록은 수정 전 증거로 유지한다.

[새 빌드/타입](build.log)·[린트](lint.log) 통과. `.next-rea-auth-states` 새 서버에서 [수정 후 두 경로×세 폭 및 재시작 링크2개](callback-fixed.json)를 검증했다. 합성 무효 token 인자가 있어도 인증 성공으로 표시하지 않고 해당 프로토콜 로그인으로 복귀한다. [OAuth 화면](oauth2-result-fixed-390.png), [SAML 화면](saml-result-fixed-390.png)을 직접 확인했다. [DB 보존](preserved-fixture.log): 공급자13·감사27·세션2, 기존 `03a81972…` 해시 유지.

최초 링크 검사에서 기존 안전한 returnTo query를 제외한 pathname과 전체 href를 잘못 비교했다. [관측 오류](callback-observation-error.json)를 보존하고 같은 화면을 확인해 pathname 비교로 수정했다. 제품 코드 오류로 집계하지 않는다.

원본의 `/login/oauth2`, `/login/gpki`, `/login/saeol`, `/link/oauth2`, `/login/saml`은 자체 element 없는 부모 선언이다. 현재 독립 구현은 이 주소들에 시작/계정 화면을 제공한다. 20개 경로를 20개 원본 독립 화면으로 부풀리지 않는다. [원본 정적 근거](../../../planning/09-rea-fullstack/sso-source-evidence.md).

- 조직 이메일: 티켓 없는 요청의 안내/재시작 링크만 이번에 확인했다. 등록·새로고침·5회/만료는 [이전 실제 흐름](../browser-followup/README.md)에 있다.
- 가상 기관: GPKI/새올/그룹웨어 폼에 외부 기관 미연동을 표시한다. 공식 GPKI/새올 callback은 공식 어댑터가 없어 미연결 안내다. 외부 성공으로 집계하지 않는다.
- SSO 계정: 연결 없음·최근 인증 만료 안내를 확인했다. HTTPS 연결/로그인은 [로컬 IdP 결과](../https-flow/README.md)에 별도 기록했다.
- 실패 경로: 오류 인자 없는 일반 실패/복귀를 확인했다. 모든 오류 코드별 복귀·초대/MFA 흐름은 별도 잔여다.
- `/oauth2/signup`: 현재는 독립 이메일 가입 폼이다. 원본 OAuth 확인 후 회사명/약관 흐름과 동일하다고 평가하지 않는다.
- 정책 두 경로: 현재 회사의 구독 없음/이메일 인증/공급자 미설정 조합을 확인했다. 비활성 발급 버튼은 저장 성공이 아니다. 실제 정책 저장은 합성 근거를 명시한 [이전 결과](../browser-followup/README.md)를 따른다.

원본 정상 화면 동등성, 제공사/권한/라이선스별 모든 조합, MFA/초대/연결 해제 전체 상태와 native 새로고침 취소 수용은 남아 있다. 전체 E5/R07 완료로 표시하지 않는다.

## 경로별 초기 관측

| ID | 원본 경로 | 초기 화면 제목 |
|---|---|---|
| RR056 | `/gpki/email-register` | 조직 인증 이메일 등록 ([snapshot](RR056.txt)) |
| RR057 | `/gpki/fail` | 로그인에 실패했습니다. 다시 시도해 주세요. ([snapshot](RR057.txt)) |
| RR058 | `/gwloginUser/login` | 그룹웨어 조직 인증 ([snapshot](RR058.txt)) |
| RR070 | `/link/oauth2` | 내 SSO 연결 계정 ([snapshot](RR070.txt)) |
| RR071 | `/link/oauth2/verified` | 내 SSO 연결 계정 ([snapshot](RR071.txt)) |
| RR092 | `/login/gpki` | GPKI 조직 인증 ([snapshot](RR092.txt)) |
| RR093 | `/login/gpki/callback` | 외부 인증이 필요합니다. ([snapshot](RR093.txt)) |
| RR094 | `/login/oauth2` | 회사 SSO 로그인 ([snapshot](RR094.txt)) |
| RR095 | `/login/oauth2/verified` | 외부 인증이 필요합니다. ([snapshot](RR095.txt)) |
| RR096 | `/login/saeol` | 새올 조직 인증 ([snapshot](RR096.txt)) |
| RR097 | `/login/saeol/callback` | 외부 인증이 필요합니다. ([snapshot](RR097.txt)) |
| RR098 | `/login/saml` | 회사 SSO 로그인 ([snapshot](RR098.txt)) |
| RR099 | `/login/saml/fail` | 로그인에 실패했습니다. 다시 시도해 주세요. ([snapshot](RR099.txt)) |
| RR100 | `/login/saml/start` | 회사 SSO 로그인 ([snapshot](RR100.txt)) |
| RR101 | `/login/saml/verified` | 외부 인증이 필요합니다. ([snapshot](RR101.txt)) |
| RR120 | `/oauth2/fail` | 로그인에 실패했습니다. 다시 시도해 주세요. ([snapshot](RR120.txt)) |
| RR122 | `/oauth2/signup` | 회원가입 ([snapshot](RR122.txt)) |
| RR145 | `/saeol/fail/:org` | 로그인에 실패했습니다. 다시 시도해 주세요. ([snapshot](RR145.txt)) |
| RR151 | `/security/sso` | SSO 로그인 정책 ([snapshot](RR151.txt)) |
| RR152 | `/security/sso/setting` | SSO 로그인 정책 설정 ([snapshot](RR152.txt)) |
