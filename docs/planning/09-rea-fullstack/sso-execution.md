# R07 SSO·OAuth·기관 인증 실행 계획

2026-10-10. 기존 107작업 중 R07-T01~T04의 구체 실행 항목이다. 원본 관측, 독립 구현, 실제 외부 수용을 구분한다.

## 확인된 근거와 차이

- 원본 번들 `outputs/catchsecu-reverse-2026-10-09/bundle/main.183e9d2c.js`의 REA 근거는 `ev_87493e79c4f053718022b23e1e5d42acf1af245f8c7838a89cd7ebc3918df152`이다. UTF-16 오프셋 14840626/14843190의 SSO 두 화면은 `ssoOAuthLoginPolicy=NONE/AZURE/GOOGLE` 설정이다. Enterprise, `sso_login_lookup`, ROOT/SECURITY 조건과 이메일 재인증이 중첩된다. IdP URL·client secret·인증서 관리 화면은 원본 두 컴포넌트에서 발견되지 않았다.
- 기존 클론의 공급자·디렉터리 관리는 독립 운영 화면이다. 이 기반의 CRUD를 보완해도 원본 로그인 정책 구현을 완료한 것으로 집계하지 않는다.
- 20개 고유 경로 중 5개는 element가 없는 부모 경로이다. `/oauth2/invite/signup`은 공통 초대 단계와 연결된다. 원본 callback의 query token은 원본 서버만 검증할 수 있으므로 로컬 서버가 임의 승인하면 안 된다.
- GPKI 팝업, 단독 callback, 새올 callback은 후속 경로와 응답 토큰 필드가 다르다. 실제 기관 SDK·서명·기관 목록·서버 state 검증은 번들로 확정되지 않는다. 가상 디렉터리 성공은 공식 기관 인증의 성공이 아니다.
- 과거 P11-T03의 RSA/JWKS, XML-DSig, 초대·MFA·계정 연결·공급자 수명주기 증거는 역사적 결과다. 현재 코드 지문이 달라 새 회귀와 실제 HTTP·Ego 검증이 필요하다. 과거 소비형 fixture는 재사용하지 않는다.

## 실행 순서와 수용 조건

### A. 공급자·가상 디렉터리 데이터/서버 (R07-T01/T02)

- [x] SsoProvider, SsoState, Account, Session, VirtualOrgMember의 테넌트 FK·암호화·state/nonce/expiry·소비 관계를 dev/test DB와 대조한다.
- [x] 공급자 생성·디렉터리 생성이 전송받은 Idempotency-Key를 실제 처리한다. 같은 키·내용의 동시 재시도는 한 행·한 감사만 만들고 다른 내용은 409, 삭제된 자원은 410, 현재 권한 상실은 403/401이다. 기존 키 없는 호출 계약은 유지한다.
- [x] 모든 디렉터리 쓰기는 공급자 관리와 같은 직접 소속 owner 조건과 Company→actor→provider 잠금 순서를 사용한다. 읽기도 직접 소속 여부를 확인하고 현재 canManage를 반환한다.
- [x] 디렉터리 이름·이메일·PIN 수정 PATCH를 추가한다. 조직 코드·사번은 외부 계정 subject이므로 수정 불가다. version 충돌 409, 입력 오류 422, 다른 회사/공급자 404, 동시 수정은 한 건만 성공한다.
- [x] 수정은 대기 이메일 등록 티켓을 무효화하고 감사와 함께 원자적으로 저장한다. PIN은 재조회하지 않는다. 기존 연결 User의 이메일·이름·이미 발급된 세션은 디렉터리 프로필 편집으로 변경하지 않는다.
- [x] 삭제 후 대기 티켓·생성 응답 캐시는 정리하고 기존 계정·세션에 대한 영향은 화면에 정확히 설명한다.
- [x] 실제 DB 시험으로 재시도·권한 회수·테넌트 경계·등록/수정/삭제·PIN 변경 로그인·티켓 무효화·감사 실패 롤백을 검증한다.

### B. 공급자·디렉터리 화면 (R07-T03/T04)

- [x] 서버 canManage로 수정 버튼/설정 진입을 제한한다. 조회 실패·로딩을 빈 목록으로 표현하지 않는다.
- [x] 생성/수정/삭제·사전검사/활성화 버튼을 동기 잠금으로 중복 실행하지 않는다. 생성 재시도 키는 동일 내용에 유지하고 입력 변경 시 새 키를 쓴다.
- [ ] 미저장 입력의 모달 닫기·메뉴·회사 전환·새로고침을 보호한다. 실패 후 입력을 유지한다.
- [x] 409 뒤 최신 데이터 다시 읽기와 명시적 편집 재시작을 제공한다. 이미 삭제된 행과 권한 회수를 처리한다.
- [ ] 검색·정렬·페이지 이동과 모바일 표 스크롤, 키보드 조작을 검증한다. 현재 디렉터리 검색/정렬/페이지/키보드 초점과 세 화면9폭은 확인했으며, 공급자10행 초과 페이지와 나머지 키보드 동작은 후속이다.
- [x] 새 전용 fixture로 실제 HTTP→Ego CRUD→독립 DB 감사/버전 대조→빌드/서버 재시작 지문을 남긴다.

### C. 원본 로그인 정책 (R07-T01~T04)

- [x] 원본 NONE/AZURE/GOOGLE와 독립 IdP 분류/검증 모델을 설계한다. 임의 issuer 문자열이나 표시 이름만으로 Google/Microsoft를 신뢰하지 않는다.
- [ ] 불변 요금제 기능에 SSO 정책 권한을 추가하고 현재 구독을 서버에서 확인한다. 원본 상품 가격/권한과 독립 로컬 상품 매핑을 구분한다.
- [ ] 현재 로그인 방식·연결 계정·최근 재인증·회사 구성원의 대체 수단을 검사하여 잠금 사고를 막는다. 허용 정책 저장/해제, version 충돌과 감사 원자성을 구현한다.
- [ ] 패스워드·OIDC·SAML·기관 인증, 계정 연결·초대·MFA 완료·회사 전환에서 정책을 동일하게 적용한다. 구독 만료로 기존 보안 정책이 자동 해제되지 않게 한다.
- [ ] 원본 SSO 경로에 정책 조회·라디오·재인증·적용 확인을 연결하고 독립 공급자 관리를 명확히 구분한다.

### D. 20개 인증 경로와 프로토콜 (R07-T02~T04)

- [ ] OIDC state/nonce/PKCE/issuer/audience/signature/expiry/replay, SAML XML 서명/Recipient/InResponseTo/time/replay, 초대·연결/해제·MFA를 현재 코드로 재검증한다.
- [ ] 전용 로컬 IdP의 실제 HTTPS와 합성 인증서로 HTTP·Ego 로그인/연결을 검증한다. TLS 검증을 끄지 않는다. 실제 외부 IdP 결과로 집계하지 않는다.
- [ ] `/gpki/email-register`의 새로고침·실패/재시도·티켓 만료/소비를 연결한다. 비밀 티켓을 URL/로그로 노출하지 않는다.
- [ ] 공개 success/fail/callback은 서버가 검증한 상태만 표시한다. 기관 미설정 callback은 명확한 미연결 오류와 복귀 경로를 제공한다.
- [ ] 공식 GPKI/새올/그룹웨어는 제공사 사양·기관 자격증명·sandbox를 확보한 뒤 별도 어댑터로 시험한다. 현재는 external_pending이다.

## 검증 기록

기준 회귀6파일220개 통과. 티켓 발급/폐기 경합2개 실패 재현 후 수정했고, 최종7파일241개 모두 통과했다. HTTP35+별도 티켓12·Ego12관측·9폭·독립DB/최신 재시작 해시 일치. `docs/qa/R07-T04/management-flow/README.md` 참조. A/B 로컬 체크포인트이며 C/D는 미완료다.
각 단계는 해당 증거가 생긴 뒤에만 체크한다. A/B의 로컬 수용만으로 C/D 또는 전체 R07을 완료로 표시하지 않는다.

## C 세부 구현 순서 — 2026-10-10 후속

1. C1: SsoLoginPolicy(NONE/AZURE/GOOGLE, tenant PK, version)와 SsoSessionProof(session/account/provider/user/tenant 복합 FK, 실제 인증 시각)를 추가한다. 과거 세션과 연결 Account만 보고 인증 방법을 추정하지 않는다. 공급자 이름은 신뢰 근거가 아니다.
2. C2: Google·Microsoft 공식 discovery에 나온 issuer/authorization/token/JWKS 조합을 검증해 공급자를 분류한다. 일반 OIDC/SAML/가상 기관은 OTHER다. Microsoft는 구체 tenant UUID의 v2 issuer를 사용하며 임의 JWKS 또는 common issuer를 Microsoft 인증 증거로 인정하지 않는다. localhost 시험 IdP를 Google/Microsoft로 재분류하는 운영 우회는 넣지 않는다.
3. C3: OIDC/SAML/가상 기관 성공과 SSO MFA 성공에서만 세션 증거를 원자 저장한다. 이메일 로그인은 증거를 만들지 않는다. 계정/MFA 세션 교체는 검증된 기존 증거를 원래 인증 시각 그대로 옮기며 재인증 시각을 새로 만들지 않는다. 로그아웃/연결 해제 시 cascade 정리를 검증한다.
4. C4: 불변 상품 버전에 security.sso_login_policy 기능을 추가한다. 기존 상품 버전을 조용히 변경하거나 상품명으로 권한을 추론하지 않는다. 만료 뒤에도 저장된 제한은 계속 집행한다.
5. C5: 공통 요청 문맥 및 실제 데이터 트랜잭션, 파일·service scope·초대 수락/replay·회사 전환·SSO 시작/완료·MFA 완료에 동일한 정책을 적용한다. 다른 회사의 인증 증거는 사용할 수 없다. 회사에서 차단된 세션도 본인 계정 복구와 허용된 다른 회사 선택은 가능해야 한다.
6. C6: 조회·영향 확인·이메일 재인증 challenge·정책 저장 API를 추가한다. challenge는 회사/사용자/세션/정책 version/선택 mode에 묶고 만료·시도 제한·한 번 소비·감사/outbox 원자성을 지킨다. owner/security 권한과 최근 선택 공급자 인증을 확인한다. 원본 /manage/user/status의 서버 predicate는 확인되지 않았으므로 모든 구성원의 사전 연결을 원본 요구사항이라고 단정하지 않는다. 미연결 구성원 수와 영향은 명시한다.
7. C7: /security/sso와 /security/sso/setting을 정책 화면으로 연결하고 공급자/디렉터리는 별도 부가 운영 경로로 옮긴다. NONE·Microsoft·Google, 현재 연결 상태·재인증·409·실패 재시도·차단 시 복구를 실제 API와 연결한다.
8. C8: 격리 DB 회귀와 별도 합성 fixture의 HTTP/Ego/재시작을 검사한다. 로컬 서명 시험과 Google/Microsoft의 실제 외부 인증 결과는 구분한다. 공식 계정 없는 외부 성공을 만들거나 완료라고 표시하지 않는다.

C1~C8은 전부 필요한 작업이며, 중간 모델/시험 통과만으로 로그인 정책 기능을 완료하지 않는다.

### C1~C4 로컬 기반 검증

SsoLoginPolicy/SsoSessionProof와 복합 FK·불변 근거·공식 endpoint 조합 분류를 추가했다. 실제 OIDC/SAML 서명시험과 SSO MFA·설정 회전의 인증 시각 보존, 비밀번호 로그인 근거 없음, HTTP15/Ego/재시작 상태 보존을 확인했다. 네 번째 capability와 DB 제약은 추가했지만 **기존 상품에 자동 부여하지 않았고 정책 저장 API/현재 구독 쓰기 gate(C4 후반), C5 집행·C6 이메일 재인증·C7 정책 화면·C8 전체 수용은 미완료**다.

후속 필수 진입점은 context/service-actor/file-access/service-access/context-selection/members replay/company-management/download-actor/password-deferral 및 SSO 시작·완료·MFA다. requireActor와 계정 복구 경로는 업무 접근 허용과 구분한다. 회사 UPDATE를 먼저 잠그고 기존 계정·업무 잠금 순서를 유지한다. contextDto는 차단된 세션도 복구용 회사 목록을 받을 수 있게 하되 회사 상세/서비스/업무 권한은 노출하지 않는다.


### C5 집행·계정 복구 후속 — 2026-10-10

- [x] 실제 세션/계정/공급자의 인증 근거와 현재 회사의 NONE/AZURE/GOOGLE를 요청·업무 트랜잭션·파일·서비스 scope·비밀번호 유예에서 대조한다. 구독 여부로 저장된 제한을 해제하지 않는다.
- [x] OIDC/SAML/가상 기관 시작·완료, 가상 기관 이메일 등록 티켓 발급, SSO MFA 완료에서 현재 회사 정책을 검사한다.
- [x] 회사 선택은 계정 복구 대상을 지정하는 작업으로 허용한다. 제한된 회사의 context DTO는 서비스/업무 capability를 비우고 ssoLogin.required를 반환한다. 제한 회사의 상세 회사 목록 행은 제외한다.
- [x] 이메일 본인확인·초대 토큰 검증 후 소속을 부여하되 제한 상태에서는 선택 서비스를 비운다. 업무 접근 전에 SSO 연결을 할 수 있고, 초대 캐시 재전송은 현재 정책을 재계산한다. 기존 이메일 계정의 IdP 자동 병합을 허용하지 않는다.
- [x] 본인 SSO 연결 복구는 직접 소속·현재 세션·MFA/IP/비밀번호 정책·최근 로그인 조건을 유지하고 업무 scope를 반환하지 않는다. 제한 중 개인 연결 해제를 막고, 공급자 중지의 대체 로그인도 후보 회사별 정책에 맞는 계정만 인정한다.
- [ ] 새 복구 UI를 Ego에서 수용한다. 기존 작업공간 3과 전체 작업공간 목록이 소실돼 새 공간 생성 확인 답변을 기다린다. DB/HTTP/다른 구현은 계속 가능하다.
- [ ] C4 후반/C6: 현재 SSO 기능 구독 gate, 회사/사용자/세션/version/선택 mode에 묶인 이메일 재인증·시도 제한·한 번 소비와 감사/outbox 원자 저장 API. 정책 저장은 현재 인증 근거와 권한을 다시 검사한다.
- [ ] C7: 원본 /security/sso 및 /security/sso/setting에 정책 화면을 구현하고 기존 공급자 CRUD는 별도 운영 경로로 옮긴다.

현재 집행 검증은 별도 QA 회사에 정책을 직접 설정한 결과다. 정책 저장 API가 작동한다는 증거가 아니다. 회귀/실제 HTTP/재시작 증거는 `docs/qa/R07-T04/policy-enforcement/README.md`에 연결한다. 전체 R07·원본 20경로·외부 제공사 수용은 미완료다.


### C4 후반·C6·C7 정책 저장 구현 — 2026-10-10

- [x] 현재 불변 상품 버전의 security.sso_login_policy와 직접 owner/security 권한을 발급/저장 트랜잭션에서 확인한다. 기존 상품에는 자동 부여하지 않는다.
- [x] SsoPolicyChallenge migration107: 회사·사용자·세션·정책 버전·선택 mode·현재 이메일을 결합하고 코드 HMAC, 5분 만료, 5회 실패, 1분 재발급/시간10회 상한, 1회 소비와 감사/outbox 원자성을 구현했다.
- [x] NONE/AZURE/GOOGLE 조회·영향·최근 인증과 이메일 발급/정책 저장 API를 연결했다. 제한 공급자 직접 교체는 먼저 명시적으로 NONE을 저장하고 새 공급자로 인증해야 한다. 모든 구성원 사전 연결을 원본 필수 조건으로 추정하지 않는다.
- [x] 원본 /security/sso 및 /security/sso/setting은 정책 화면으로 연결하고 독립 공급자·디렉터리 관리 UI는 /security/sso/providers로 옮겼다. 원본186은 보존, 추가 운영화면은21개다.
- [x] 여러 탭에서 회사가 바뀌는 경우 요청 tenantId를 현재 회사와 대조한다. 정책 조회 회사와 화면 context 회사가 다르면 편집 폼을 표시하지 않고 전체 새로고침을 요구한다.
- [ ] 새 정책·복구 화면의 Ego 브라우저 및 화면 폭/키보드·새로고침·여러 탭 수용. 기존 공간 소실에 대한 새 공간 생성 답변 대기.
- [ ] 로컬 실제 HTTPS IdP의 브라우저 인증, 공식 Google/Microsoft/기관 어댑터, 전체20개 인증경로의 원본 상태 수용.

증거는 docs/qa/R07-T04/policy-writer/README.md. DB에 명시적으로 만든 합성 인증 근거는 외부 Google 성공이 아니다. 정책 저장 자체와 로컬 이메일은 실제 HTTP/worker로 검증한다. 이 체크포인트로 R07 전체 또는107개 작업 완료를 선언하지 않는다.


## 이메일 등록 소유 검증과 추가 점검 — 2026-10-10

- [x] 신규 이메일은 6자리 소유확인 OTP를 발급·검증한 후만 verified 처리. 티켓/회사/공급자/디렉터리 버전/이메일 결합, 5분·오답5회·재전송60초·구성원10회/시간, 큐 메일 현재성 검사.
- [x] 잘못된 코드 횟수 커밋과 성공의 JIT/디렉터리/세션/감사 원자성 및 최종 만료 롤백 검증. 기존 계정 충돌·MFA·초대 변경·동시 소비·대기 메일 취소 포함.
- [x] 공급자 login/invite state가 있어도 미등록 이메일 단계로 전환, 최초 초대/만료 보존. `/gpki/email-register` 전용 화면과 탭별 복구; PIN/OTP 저장 금지, 저장소 차단 시 인라인 진행.
- [x] 독립 검토: 만료티켓/쿨다운이 구성원 메일한도를 소모하던 문제 수정. 고유274시험·실제HTTP16·재시작1 및 dev/test 스키마 차이0.
- [x] E1 시작 브라우저 결합: HttpOnly nonce/state 결합, 누락·변조·다른 브라우저·재사용·동시 탭 회귀와 HTTP/Ego 시험을 완료했다. 실제 HTTPS SAML cross-site POST/SameSite=None은 E3에서 추가 확인했다. [결합](../../qa/R07-T04/browser-binding/README.md), [HTTPS](../../qa/R07-T04/https-flow/README.md).
- [x] E2 SSO outbound: 전체 DNS 응답 검사·주소 고정·원래 hostname/SNI/TLS 검증·시간/본문 상한을 구현했다. 사설 HTTPS 사전검사 통과 결함 재현 후 수정, 회귀409·실제TLS6·production HTTP9·Ego·재시작/관계행 해시 보존을 확인했다. 개발 루프백 예외는 명시적 플래그와 정확한 hostname에만 적용하며 production은 거절한다. [E2 증거](../../qa/R07-T02/outbound/README.md). 실제 HTTPS 인증 브라우저 왕복은 E3에 남는다.
- [x] E3 실제 HTTPS IdP: 새 시험 CA/SAN/serverAuth, 별도 Node 신뢰, 실제 OIDC 로그인/연결·SAML 교차 사이트 POST 로그인/연결 및 재시작을 검증했다. HTTP48은 생성 계약 변경 전 기록이며 이후 스크립트는 tenantId 계약을 반영했다. 사용자 승인 임시 CA는 신뢰와 정확한 인증서를 제거하고 CSSMERR_TP_NOT_TRUSTED를 확인했다. 모든 로컬 인증 근거는 OTHER다. [증거](../../qa/R07-T04/https-flow/README.md).
- [x] E4 공급자 화면: 생성 tenant 결합/조회 문맥 검증, 처리 중 링크 이탈 안내·최신값 입력 폐기 확인과 동일 버전 초기화. 회귀247·HTTP23·Ego 두 탭/충돌/키보드 복구·재시작 및 해시 보존 통과. 원본 전수/반응형/history 및 경고 여백은 E5 잔여. [증거](../../qa/R07-T04/provider-context/README.md).
- [ ] E5 Ego: 사용자 승인으로 새 공간2/p1 복구 완료. 이어서 정책·이메일 등록의 새로고침/저장소 차단/재발급/만료/5회·MFA·키보드/폭별 실제 화면 수용. 원본18인증+2정책 경로 전수 대조.

이 항목들은 승인된 전체 구현 범위의 필수 후속이다. 이번 체크포인트로 전 페이지 완성이나 운영 인증 경계 검증 완료를 주장하지 않는다. 증거: `docs/qa/R07-T04/org-email/README.md`.


### Ego 복구 — 2026-10-10

사용자가 새 작업공간 생성을 승인했다. 공간2/p1에서 실제 브라우저 검증을 재개했으며 위 과거의 공간 생성 답변 대기는 해소됐다. 이메일 등록·정책 화면 후속 증거는 `docs/qa/R07-T04/browser-followup/`에 기록한다. E1~E4와 전체 인증경로·외부 제공사 검증은 별도 잔여다.

- 브라우저 후속에서 정책 OTP 5번째 오답의 terminal 응답 누락과 설명/구독 안내의 음수 여백 겹침을 확인해 보완 중이다. 별도 미저장 경계: 공통 navigation guard는 링크와 beforeunload를 처리하지만 SPA history Back/Forward는 별도 복구 설계·브라우저 검증이 남는다. 링크 확인창 성공을 뒤로가기 수용으로 확대하지 않는다.

### E1 로컬 구현·검증 — 2026-10-10

- [x] 시작 HttpOnly 쿠키의 해시와 SsoState 결합, OIDC/SAML/초대/연결/이메일 티켓 소비 전 검사, JSON allowlist, HTTPS/명시적 로컬 경계, 한국어 오류 복귀.
- [x] 최초 동시 탭 쿠키 덮어쓰기 실패 재현 후 이름 분리·기존 쿠키 재사용. 양쪽 순서 및 실제 PKCE 두 콜백 회귀.
- [x] PostgreSQL7파일269개, 실제HTTP22개·Ego 이메일 등록/쿠키/새로고침·HTTP/Ego 재시작과 관계 행 해시 보존. migration109 dev/test 차이0, 타입/린트/빌드 통과.
- [x] E1 후속 수용: 실제 HTTPS SAML cross-site POST와 Secure/HttpOnly/SameSite=None 쿠키 왕복을 Ego에서 확인했다. [E3](../../qa/R07-T04/https-flow/README.md).

증거: [브라우저 결합](../../qa/R07-T04/browser-binding/README.md). E2/E3/E4/E5와 전체 원본 경로·외부 수용은 계속 진행한다. 전체107작업의 완료0·진행51·계획56을 유지한다.


### E2 전송 구현·검증 — 2026-10-10

사설 HTTPS JWKS를 native fetch 대역이 승인하는 회귀를 먼저 실패시켰다. 공개 주소 판정을 알림 전송과 공유하고 OIDC 토큰/JWKS를 고정 lookup 전송으로 연결했다. 실제 TLS 6개와 production HTTP9개에서 CA/hostname/만료 및 사설 대상 연결 전 차단을 검증했다. 회귀12파일409개·타입·린트·빌드 통과. Ego2/p1에서 실패 사유/비활성 상태를 확인하고 서버 재시작 뒤 HTTP/Ego 조회 및 공급자2·감사8·세션2의 해시3965f075…를 보존했다. E1 및 기존 브라우저 기준 해시도 읽기 전용 검사에서 유지됐다.

현재 표의 긴 로그인 URL 줄바꿈과 가로 스크롤은 E4/E5 화면 검증에 포함한다. 다음은 E3의 실제 HTTPS OIDC/SAML 브라우저 왕복과 E1 cross-site POST이며 외부 IdP 성공과 구분한다. 전체107작업 완료0·진행51·계획56은 유지한다. [전송 검증 기록](../../qa/R07-T02/outbound/README.md).

### E3·E5 레이아웃 후속 — 2026-10-10

HTTPS 앱/IdP의 실제 Ego 네 흐름과 새 프로세스 재시작을 통과했다. 원래 동결 데이터는 보존됐고 대시보드가 추가한 읽기 감사2건은 정확한 ID/행 해시 영수증으로 별도 비교한다. 실패 기록과 기존 동결 해시는 유지한다. 임시 CA 정리는 사용자 인증 후 완료됐다. 공급자 표와 일반 편집창의 390/768/1440px 레이아웃은 [별도 증거](../../qa/R07-T04/provider-layout/README.md)에 기록했다.

공통 history 이탈은 실제 Ego에서 입력 유실을 재현해 수정했다. 단위10·뒤/앞 취소와 승인·키보드/390px 확인창을 통과했고 기존 DB 해시를 유지했다. [수정/검증](../../qa/R07-T04/history-guard/README.md). Native 새로고침 확인창 취소는 도구 관측이 없어 미검증이며 Navigation API 없는 구형 브라우저는 범위 밖이다. E5의 원본18인증+2정책·MFA/초대·전체 상태/폭/키보드 및 외부 제공사 수용은 완료되지 않았다.

### E5 직접 진입 후속 — 2026-10-10

[20경로/60폭](../../qa/R07-T04/route-states/README.md)의 초기 상태를 확인했다. OAuth/SAML 결과 경로의 잘못된 미연결 단정을 수정하고 새 빌드에서2경로6폭·복귀링크2개를 확인했다. 원본 부모선언5개와 독립 화면을 구분한다. OAuth 가입은 현재 이메일 가입 대체이며 원본 OAuth 확인 후 가입/회사명 흐름 동등성을 확인하지 못했다. 다음은 초대·MFA·연결해제·정상/오류·회사/역할/라이선스별 수용과 이 차이의 구현 점검이다.

2026-10-10 E5 인증 여정: 가상GPKI 실제연결/잘못된PIN재시도→MFA등록/잘못된코드·대기401/세션0→정상로그인→해제/전체세션삭제→잘못된초대이메일거부/올바른수락→마지막수단409/초대재진입중복없음. 준비HTTP10·Ego/DB단언·3폭·현재타입/린트·PID97203재시작 hash2824c95fd260d9ffd09377378ed6b207c55405d71e38251186a58b7716e6aea4 일치. 기존5개동결fixture 보존. 제품코드는직전빌드동일. 전체0완료/51진행/56계획·goal active. 다음R08 모델/필드대조. docs/qa/R07-T04/journey/README.md.
