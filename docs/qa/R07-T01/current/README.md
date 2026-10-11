# R07 현재 SSO 모델 대조

2026-10-11 개발/테스트 PostgreSQL의12모델132컬럼·56제약·37인덱스·4트리거를 읽기 전용으로 확인했다. 모든 제약이 validated이며 두 DB의 정의·컬럼 순서·함수·소스 지문이 일치한다. 가입 동의 migration을 추가하여149개가 적용됐다. [요약](model-summary.json), [개발](catchsecu_dev.json), [시험](catchsecu_test.json).

| 모델 | 데이터와 검증 경계 |
|---|---|
| SsoProvider | 회사+공급자 복합 unique, protocol·URL CHECK, 암호화 client secret와 인증서, enabled/preflight/version. 변경 시 기존 대기 인증의 providerVersion을 다시 검사한다. |
| SsoState | state/nonce 해시와 암호화 PKCE, browserHash, 만료, login/link/invite 모드, 현재 세션·초대 version/token 결합. 성공 시 트랜잭션에서1회 소비한다. orgMemberId는 앱에서 회사/공급자/디렉터리와 대조하며 직접FK가 아니다. |
| Account | 외부 provider+subject unique, 실제 SSO 공급자 FK를 trigger로 유도, 참조 공급자 삭제 RESTRICT. 서버가 계정·세션·근거·감사를 함께 정리한다. |
| Session | 사용자+세션 복합키, 현재 회사/서비스, 만료. 연결 state와 정책challenge의 세션 결합. |
| SsoSessionProof | 사용자/세션·회사/공급자·공급자/계정/사용자 복합FK, 불변 trigger. 연결 계정 보유만으로 발급하지 않고 검증한 인증 완료에서 생성한다. |
| SsoLoginPolicy | 회사 단일 NONE/GOOGLE/AZURE 정책·version. 저장·런타임 집행은 별도 서버 시험으로 확인한다. |
| SsoPolicyChallenge | 회사·사용자·세션·정책version·mode·이메일hash·코드hash·5회·만료·폐기/소비. 확인과 정책 갱신을 하나의 트랜잭션으로 처리한다. |
| OrgEmailChallenge | 회사+state 복합FK·암호화 이메일·해시·5회·만료. PIN은 이메일 소유를 대신하지 않으며 실제 번호 확인 후 JIT/초대/감사와 함께 소비한다. |
| VirtualOrgMember | 회사/공급자 복합FK·조직/사번 unique, 이름/메일 암호화·PINhash·version. 외부 기관 신원을 증명하는 모델이 아닌 로컬 가상 디렉터리다. |
| SsoSignupIntent | 검증된 OIDC 신규 신원 암호문·브라우저 결합·회사/공급자 FK·5분/원본 인증 기한·state와 tokenHash unique. 성공/취소/만료/공급자 삭제 후 정리. |
| SsoSignupAcceptance | 사용자별1개 필수 연령 확인·문서 버전·수락 시각. 별도 이름/이메일 사본 없음. 계정 폐쇄 시 유지, 물리 사용자 삭제가 실행되면 FK CASCADE. |
| IdempotencyRecord | scope/key unique, 공급자·디렉터리 변경 재전송과 삭제 캐시 무효화. |

외부 Google/Microsoft/GPKI/새올 제공사 수신 성공은 이 메타데이터 검사의 결과가 아니다. 원본 클라이언트와 독립 구현 차이는 [원본 근거](../../../planning/09-rea-fullstack/sso-source-evidence.md)에 남긴다. 현재 서버의 실제 권한·상태전이·실패/경합은 [R07-T02](../../R07-T02/current/)에서 확인한다.
