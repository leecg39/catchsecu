# 조직 이메일·SSO 정책 브라우저 후속 검증

사용자가 복구용 새 Ego 작업공간 생성을 승인한 뒤 공간2/p1에서 실제 브라우저 조작을 재개했다. 기존 공간3 대기는 해소됐다. 원본 전체 인증경로 또는 외부 IdP 수용 완료를 뜻하지 않는다.

## 실제 동작

| 흐름 | 확인 결과 | 증거 |
|---|---|---|
| 조직 이메일 신규 등록 | 로컬 메일 OTP 오답 거부 후 정답 등록, 임시 초안 삭제, `/api/v1/me` 200. 새 viewer는 서비스 권한이 없어 `/service/none`으로 이동 | [성공](org-success.json) |
| 새로고침 | 이메일·challenge 복구, PIN/OTP 미저장, 코드 입력은 빈 값 | [복구](org-draft-restore.json) |
| 저장소 실패 | 현재 문서의 해당 sessionStorage 키 쓰기에 QuotaExceededError를 주입. 인라인 화면에서 실제 메일 번호로 등록 성공 | [저장소](org-storage-fallback.json) |
| 오답 5회 | 입력란 제거·재요청 안내, 새로고침 뒤 소진된 challenge 미복원. 실제 60초 대기 후 새 번호로 등록 성공 | [횟수 제한](org-attempt-limit.json) |
| 만료 | 전용 티켓의 DB expiresAt만 과거로 이동. 실제 서버 거절 뒤 초안 삭제·입력 비활성화·빈 조직 로그인으로 재시작 | [만료](org-expiry-restart.json) |
| 이메일 수정 | 기존 challenge와 코드 제거. 실제 재전송 대기 후 변경 이메일 번호로 등록 성공 | [변경](org-edited-email.json) |
| 정책 사전 조건 | 비밀번호 세션은 최근 Google 인증 요구 및 발급 비활성. 링크 이탈·최신값 재조회 확인창, Escape/계속 편집으로 선택 유지 | [정책](policy-browser.json) |
| 정책 저장 | 명시적 합성 Google proof를 별도 세션에 준비한 뒤, 실제 로컬 메일 오답 거절·정답 저장. Google v1 재조회. Microsoft 직접 전환 차단 | [정책](policy-browser.json) |
| 제한 세션 복구 | 정책 저장 후 로그아웃·비밀번호 재로그인 → `/access-not-allow`. 정책 API 403, 계정 연결 복구 화면 접근 및 해제 제한 | [복구](policy-recovery.json) |
| 정책 오답 5회 수정 | 새 빌드에서 실제 5회 오답 후 번호 입력란·정책 적용 버튼 제거 | [수정 확인](policy-limit-fixed.json) |
| 반응형 | 수정 전 390/768/1440px에서 설명과 구독 안내 겹침 발견. 수정 후 같은 폭에서 문구 간격·가로 넘침0을 좌표와 스크린샷으로 확인 | [화면](screenshots/) |

## 수정과 회귀

서버가 정책 OTP 다섯 번째 오답을 일반 오답으로 반환하여 사용할 수 없는 입력창이 남았다. [실패 재현](policy-limit-before.log)은 1실패/40미실행이다. 실패 횟수·감사를 커밋한 뒤 다섯 번째는 기존 `SSO_POLICY_CHALLENGE_INVALID`를 반환하도록 수정했다. 남은 대기 메일도 취소하고 최종 기한 검사를 유지한다. 현재 UI의 terminal 처리로 입력란이 제거된다.

정책 화면 전용 CSS grid/gap과 제목 줄바꿈을 추가해 `.mg-description`의 음수 여백으로 인한 겹침을 해소했다. 390px 버튼·내용은 세로 스크롤로 접근한다.

[최종 서버 시험](policy-limit-final.log): 1파일41개 통과. [프로덕션 빌드](build-final.log): `.next-rea-browser-followup` 컴파일·타입 검사 통과. [변경 린트](lint.log) 오류·경고0, [검증 helper 타입 검사](helper-typecheck.log) 통과. 전체 회귀는 이번에 다시 실행하지 않았고, 과거 274개 및 전체1,834개 기록은 해당 시점 증거로 유지한다.

## 재시작과 증거 범위

전용 회사 `f1cc6ee3-9a2e-4d51-9256-47b7aaa3d887`에서 등록 구성원4, 공급자2, Account6, 현재 Session/Proof 각1, 남은 만료 SsoState1, 감사57, 로컬 메일7개(done7/cancelled1 작업8)와 Google 정책v1을 확인했다. [freeze](freeze.json) 뒤 서버33084→33978 재시작, [브라우저 재조회](restart-browser.json) 200 및 [독립 DB/메일 해시](verify.json)가 일치했다.

`b891f5e8b670f8f76ab9f6cfe22f26a933d61f15155e86bacb138c6ec66eb9ff`

검증 helper는 RepeatableRead로 디렉터리·정책·challenge·티켓·공급자·계정·소속·사용자·세션 요약·proof·구독/상품·감사·작업을 읽고, 완료 로컬 메일 파일 해시를 함께 비교한다. 세션 token/updatedAt은 제외한다. freeze는 비교 기준이며 DB 쓰기 잠금이 아니다. 기존 이메일/정책 writer fixture의 해시도 읽기 전용으로 재확인했다.

시험용 회사·권한·상품·가상 GPKI·공식 endpoint 형태의 Google 설정/계정은 DB fixture다. Google proof 역시 비밀번호 로그인 세션에 직접 준비한 합성 근거다. **실제 Google/Microsoft/기관 인증 또는 SMTP 외부 수신 성공으로 집계하지 않는다.** 저장소 오류와 DB 만료 주입은 각각 실제 브라우저 정책·실제 시간 만료와 구분한다. 비밀 ticket·OTP·cookie·비밀번호는 공개 증거에 포함하지 않았다.

## 남은 필수 작업

SSO 시작 브라우저 결합(E1), outbound DNS/IP 보호(E2), 실제 HTTPS 로컬 IdP(E3), 공급자 생성의 회사 결합·편집 보호(E4), 원본18인증+2정책의 전체 상태 및 MFA/초대/연결 화면 수용(E5)이 남았다. 공통 미저장 가드의 SPA history Back/Forward는 링크 확인창 시험과 별도로 보완·검증해야 한다. 정책 재전송 쿨다운은 서버에서 집행하며 저장/폼 재생성 직후의 429 안내는 추가 UX 개선 대상이다.

전체107개 작업은 51진행·56계획·0완료, 목표는 active다.
