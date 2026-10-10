# 보안 기능 구독 권한 — 실제 앱 검증

원본과 로컬 설계의 차이를 [구현 계약](../../../planning/09-rea-fullstack/security-entitlements.md)에 명시했다. 원본 근거는 IP·회사정책의 Enterprise 조건과 MFA의 별도 키 `two_factor`/`two_factor_policy`를 구분한다. 원본 서버가 허용하는 MFA 상품 목록과 만료 이후 정책 집행은 미확인이다. 로컬에서 현재 설정 조회와 기존 보안 보호를 유지하는 것은 독립 제품 결정이다.

검증 계정 2개, 회사 6개, 합성 trial 버전 5개를 별도로 준비했다. 이메일 확인과 회사/구독 구성은 명시적 fixture 작업이며 원본 서버 데이터를 변경하지 않았다. 관리자 MFA는 실제 HTTP enable/verify-totp로 등록했다. Ego는 그 실제 세션을 복원하여 사용했으며 이 단계에서 브라우저 로그인 자체를 재시험했다고 주장하지 않는다. [준비 기록](prepared.json).

- [HTTP 상태 23개](http-matrix.json): 기능 포함/미포함, 만료, 시작 전, 미가입, MFA만 포함한 경우의 정책/IP/MFA 조회와 IP 변경 차단.
- [실제 화면 저장](browser-saved.json): IP 규칙 등록, 현재 비밀번호로 IP 제한 활성화, 회사 MFA 강제 활성화.
- [상태별 모바일 화면 18개](browser-state-matrix.json): 실제 회사 선택 메뉴로 6개 회사를 전환하고 정책/IP/MFA의 안내·변경 버튼을 검사. 390px 가로 넘침 0.
- [자연 만료 후 이전 설정 창 저장](stale-editor.json): 만료 전에 연 MFA 설정 창에서 만료 후 해제 요청을 보내자 오류를 표시하고 설정을 유지했다.
- [만료 이후 실제 HTTP 6개](expiry-http.json): 읽기 유지와 변경 402, 미등록 관리자 MFA_REQUIRED, 별도 실제 IPv6 소켓에서 IP_NOT_ALLOWED. DB 시계를 바꾸지 않고 API로 예약한 12초 후 만료를 사용했다.
- [8경로×3폭](expired-routes-responsive.json): 390/768/1440px에서 만료 안내, 변경 버튼 제한, 넘침 0. 보안현황·정책 조회/설정·IP 조회/설정·MFA 조회/설정 포함.
- [상품/구독 안내 6개](billing-disclosure-responsive.json): 2경로×3폭에서 기능별 포함 여부를 표시하며 넘침 0.

기존 R06 보안 fixture와 증거는 보존했다. 이 폴더의 fixture는 구독 기한 종료 후에도 IP 제한과 MFA 강제가 켜진 상태로 남는다. 현재 회사에서 만료는 관리 기능의 변경 권한에만 적용된다. 재시작 결과와 최종 상태 해시는 아래 후속 기록을 따른다.

비밀 쿠키·암호·TOTP·복구코드는 보고서에 포함하지 않는다. 원본 동등성 전체, 실제 Enterprise 활성 원본 화면 및 외부 결제 공급자 시험은 완료로 집계하지 않는다.

## 최종 DB 및 재시작

[최종 상태](verified.json)와 [재시작 후 상태](verified-after-restart.json)의 SHA256은 `0fe82444d7fa26ed9f71bdbe81a11d70d6e8346b14566b36df114ea06cb84332`로 동일하다. 회사6개·구독5개·IP규칙1개·예외0개·감사31건이다. 만료된 included 회사의 IP 제한과 MFA 강제를 유지했고, [재시작 브라우저](browser-after-restart.json)에서도 기존 규칙과 변경 버튼 제한을 확인했다. 만료worker 시험은 격리 test DB에서만 실행했으며 dev의 전체 만료worker를 실행하지 않았다.
