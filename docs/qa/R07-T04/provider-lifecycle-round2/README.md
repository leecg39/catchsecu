# R07 라운드2 — 오류 코드 화면·제공사 수명주기·최근인증 게이트 (2026-10-11)

scope: 프로덕션 빌드(localhost:3121)·QA owner A·테넌트 A. 로컬 검증 전용 — 가상 GPKI는 mock 디렉터리이며 외부 기관 연동 증거가 아니다.

## 오류 코드별 /login?error= 화면

`src/lib/sso-recovery.ts`의 15개 코드는 action 3종(restart/contact/login)으로 분기한다. 코드→문구 매핑은 순수 조회 테이블이므로 action 종류별 대표 화면을 실제 렌더로 확인했다:

| 코드 | action | 실측 |
|---|---|---|
| SSO_BROWSER_MISMATCH | restart | "로그인을 시작한 브라우저를 확인할 수 없습니다." + 쿠키 허용 안내 + "회사 SSO 로그인 다시 시작" CTA |
| SSO_LINK_CONFLICT | contact | "이 회사 계정은 이미 다른 사용자에게 연결되어 있습니다." |
| SSO_LINK_NEEDED | login | "기존 계정의 확인이 필요합니다." + 초대 링크 안내 + "이메일 로그인 후 연결 관리" CTA |

## SSO 제공사 등록→사전검사→사용→중지→삭제 수명주기

`/security/sso/providers`에서 실제 UI로 전체 체인 수행:

1. **등록**: 프로토콜 "가상 GPKI (mock 디렉터리)" + 이름만으로 등록 → 목록에 `urn:virtual:gpki`·`/login/gpki` 경로·"사용 안 함" 상태로 생성
2. **사전검사**: "통과" 반영, 감사 `sso.provider_preflight`
3. **사용**: 상태 "사용"으로 전환, 감사 `sso.provider_updated`
4. **가상 GPKI 로그인 시작**: `GET /api/v1/auth/sso/{id}?mode=login` → 302 `/login/gpki?state=…` — 화면은 "가상 인증 — 외부 GPKI 기관 미연동. 가상 디렉터리에 등록된 계정만 로그인됩니다." 고지. 임의 자격(NOORG/0000/000000)은 "조직 인증에 실패했습니다"로 정직하게 거절(외부 성공으로 집계하지 않음)
5. **중지**: 확인 모달 "새 로그인과 진행 중 인증이 중지됩니다…" → "사용 안 함"
6. **삭제 차단**: 오래된 세션에서 삭제 시 `SSO_REAUTH_REQUIRED` — "계정 연결을 변경하려면 다시 로그인한 뒤 5분 안에 시도해주세요." 행 유지(보안 게이트 실측)
7. **재로그인 후 삭제**: 이메일 재로그인(<5분 세션)→ 삭제 확인 "SSO 설정과 연결 계정을 삭제하고… 모든 기기 로그인을 종료합니다" → 행 제거·DB provider row 삭제

감사 체인: `sso.provider_created` → `sso.provider_preflight` → `sso.provider_updated`(사용) → `sso.provider_updated`(중지) → `sso.provider_deleted`.

## 미저장 변경 보호(in-app)

제공사 등록 모달에서 이름 입력 후 × 닫기 → "입력한 내용을 버리고 닫을까요?/변경 버리기" 확인 → 버리기 후 모달 닫힘·목록 복귀. 네이티브 beforeunload 대화상자는 자동화 검증 불가로 기존 문서의 제한을 유지하고, 앱 내 가드(`useUnsavedChanges`)는 실측했다.

## 잔여 외부 항목

- 실제 Google/Microsoft OIDC·GPKI/새올/그룹웨어 기관 어댑터 수신 증거 — 계정 미확보, external_pending 유지
- 원본 제품과의 화면 동등성 비교 — source_fidelity 미평가 유지

이 라운드는 로컬 결정 항목(오류 화면, 수명주기, 재인증 게이트, 더티 가드)의 실측만 기록한다.
