# SSO 연결·MFA·해제·초대 여정 검증

2026-10-10. Ego 공간2/p1, 로컬 production `http://localhost:3100`, `.next-rea-auth-states`에서 실행했다. 전체 R07 완료나 실제 기관 인증 통과를 뜻하지 않는다. 이 체크포인트의 제품 코드는 직전 인증 진입 화면 빌드와 동일하다. 새 QA helper에 DB 최종 상태 단언과 메일 파일 해시를 추가했다.

## 실제 동작

| 순서 | 관측 및 독립 DB 확인 | 근거 |
|---|---|---|
| 준비 | 신규 회사/소유자/가상 GPKI/3명 디렉터리/초대에 실제 API 10개 사용. 해당 초대만 로컬 메일 worker로 처리 | [prepared.json](prepared.json) |
| 연결 | 화면에서 연결 시작, 잘못된 PIN 거절 후 같은 흐름에서 올바른 PIN 재시도. 계정2·세션3·SSO 근거1 | [browser-link.json](browser-link.json), [owner-linked.json](owner-linked.json) |
| MFA 등록 | 잘못된 등록 코드에 한국어 오류, 올바른 코드 등록. 비밀키/복구코드는 비공개 fixture에만 보관 | [browser-mfa-enrolled.json](browser-mfa-enrolled.json) |
| MFA 대기 | 로그아웃 후 기관 로그인은 OTP 화면으로 이동. `/me` 401, DB 세션0·근거0 | [browser-mfa-pending.json](browser-mfa-pending.json), [mfa-pending.json](mfa-pending.json) |
| MFA 완료 | 잘못된 코드 제출 후 올바른 코드로 로그인. 세션1·근거1(OTHER), 실제 `/me` 200. 로그인 오류 문구 추출은 null이므로 문구 확인으로 집계하지 않음. 거절 감사는 등록 직후1→로그인 후2, 성공 감사1→2 | [browser-mfa-login.json](browser-mfa-login.json), [mfa-authenticated.json](mfa-authenticated.json) |
| 연결 해제 | 화면의 추가 확인 후 모든 기기 종료 안내, `/me` 401. 소유자 비밀번호 계정과 MFA는 유지하고 SSO 계정/세션/근거 제거 | [browser-unlinked.json](browser-unlinked.json), [unlinked.json](unlinked.json) |
| 다른 이메일의 초대 수락 차단 | 유효한 디렉터리의 다른 계정으로 인증해도 거절·재시작 안내. 초대 pending v1·세션0. 최종 DB에 해당 이메일 사용자0 | [browser-invite-wrong-email.json](browser-invite-wrong-email.json), [wrong-invite-rejected.json](wrong-invite-rejected.json) |
| 초대 수락 | 원래 초대 링크에서 재시작, 올바른 계정 인증. 이메일 확인된 사용자·SSO 계정 생성, editor/active와 지정 서비스 grant1, accepted v2 및 acceptedBy 일치 | [invited.json](invited.json), [browser-invited.json](browser-invited.json) |
| 마지막 로그인 수단 보호 | 연결 해제 버튼 비활성화·안내, 직접 DELETE 요청도 409 `SSO_LAST_LOGIN_METHOD` | [last-method-denied.json](last-method-denied.json) |
| 초대 재진입 | 처리된 초대 안내, 계정/구성원/권한/수락 감사 중복 없음 | [browser-invite-replay.json](browser-invite-replay.json), [freeze.json](freeze.json) |
| 화면 | 마지막 로그인 수단 안내 화면390/768/1440px 가로넘침0. 390px 이미지 직접 확인 | [layout.json](layout.json), [390px](last-login-method-390.png) |
| 재시작 | PID90794 종료→97203 시작, Ego 새로고침 뒤 `/me`와 계정조회200. 동일 DB/메일 해시 및 최종 상태 단언 통과 | [browser-after-restart.json](browser-after-restart.json), [after-restart.json](after-restart.json) |

최종 해시: `2824c95fd260d9ffd09377378ed6b207c55405d71e38251186a58b7716e6aea4`. 사용자2·계정2·구성원2·초대1·세션1·근거1·MFA1·미처리 SSO state0. 서비스 권한9개를 예상 목록과 정확히 대조했다. `freeze`는 시험 기준 저장이며 DB 쓰기 잠금이 아니다. 동결 후 helper는 `verify`만 허용한다.

`scripts/qa-rea-sso-journey.ts`의 freeze/verify는 최종 사용자/계정/역할/서비스 권한/초대/세션 근거/감사·중간 인증 차단 상태·마지막 수단 거절·메일 해시를 단언한다. 현재 소스와 helper를 포함한 [타입 검사](typecheck-final.log), [helper 린트](lint-final.log) 모두 exit0. 새로운 제품 코드 변경이 없어 빌드와 전체 시험을 다시 실행하지 않았으며, 이전 전체 시험을 이번 여정의 결과로 재집계하지 않는다.

기존 browser/E1/E2/E3/E4 시험의 독립 보존 검사도 통과했다: `preserved-*.log`. HTTPS E3는 기존 명시된 읽기 감사2행 예외를 그대로 사용한다. 다른 fixture의 로그인/로그아웃·worker 처리를 실행하지 않았다.

## 범위와 잔여

- 가상 GPKI와 로컬 메일이다. 소유자 이메일 확인은 준비 단계에서 명시적으로 DB 설정했으므로 이메일 배송·확인 수용 결과가 아니다. Google/Microsoft/공식 GPKI·새올·그룹웨어 외부 수용은 미검증이다.
- 잘못된 PIN, 등록 코드, 초대 이메일과 마지막 수단 보호를 포함한 이번 흐름의 결과다. 모든 프로토콜·정책·역할 조합, 복구코드 로그인, 별도 브라우저 인증, 원본 `/oauth2/signup`의 회사명 입력 동등성까지 완료한 것은 아니다.
- 앞선20경로 직접 진입/입력 이탈 검증과 함께 보관한다. R07 전체 상태는 `in_progress / external_pending` 유지. 후속 내부 작업은 R08 폼·질문·템플릿 모델/계약 대조다.
