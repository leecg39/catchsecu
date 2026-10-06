# P11-T04 GPKI·새올·그룹웨어 어댑터 — 미완료

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

다른 본인확인 설정과 미연결 화면만 있음. 이번 소스 조사만으로 테스트 실행·브라우저·외부 연동 통과를 주장하지 않는다.

- [src/server/verification.ts](../../../src/server/verification.ts) — lockVerificationContext, getVerificationState, createVerificationIntegration, replayVerificationIntegration
- [tests/server/verification-configuration.test.ts](../../../tests/server/verification-configuration.test.ts)

## 남은 구현·수용

GPKI/새올/그룹웨어 공식 SDK·기관 인증 전체.

원래 범위: 계약/SDK와 조직 식별자를 확인하고 login/verified/fail/email-register 경로를 연결한다.

수용 조건: 공식 sandbox/테스트환경의 성공·실패 증거; SDK/접근권 없으면 블로커 유지; 임의 성공 처리 금지

선행: P11-T03. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.

## 2026-10-16 가상(mock) 어댑터 구현 — 사용자 지시

외부 기관 자격증명 없이 진행하라는 지시에 따라 GPKI·새올·그룹웨어를 **mock 디렉터리 + 실제 SSO 완료 경로**로 구현했다. 외부 기관 연동이 아니므로 공식 수용(공식 sandbox 성공·실패 증거)에는 계속 미완료다.

- `VirtualOrgMember` mock 디렉터리(조직 식별자+사번+인증번호), 이름·이메일 암호화·PIN 해시·버전·테넌트 격리
- 디렉터리 CRUD `/security/sso/{id}/directory` — 보안 owner 전용
- `/auth/org/login` → `completeSso` 실경로(JIT·계정연결·세션·MFA 그대로), `?state=`로 link/invite 흐름 재사용
- 이메일 미등록 구성원 → 1회성 티켓 `/auth/org/email-register` → 등록 후 동일 완료 경로
- 화면 `/login/gpki`·`/login/saeol`·`/gwloginUser/login` — "가상 인증 — 외부 기관 미연동" 경고 표시
- 서버 테스트 [tests/server/org-auth.test.ts](../../../tests/server/org-auth.test.ts) 5개: 디렉터리 CRUD·중복/버전·JIT·link state·email-register·티켓 재사용·테넌트 격리·비활성 거부
- 브라우저 검증 8/8: [virtual-auth/](virtual-auth/README.md) — 공급자 등록·디렉터리·JIT 로그인·email-register·모바일
- 임의 성공 없음: 디렉터리에 등록된 자격만 통과하고 틀린 자격·비활성·타 프로토콜은 전부 거부

잔여 공식 수용: 실제 GPKI·새올·그룹웨어 SDK/샌드박스 접근권과 성공·실패 증거 — 자격증명 부재로 블로커 유지.
