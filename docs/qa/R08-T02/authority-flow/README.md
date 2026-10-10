# 폼·템플릿 현재 권한과 최종 만료 보완

2026-10-10. R08-T02의 F1 보완이다. R08 전체 또는 107개 작업 완료가 아니다. 원본 특수 질문·보기 식별자·여러 페이지·참여 설정·템플릿 추가 필드와 전체 화면 수용은 [실행 계획](../../../planning/09-rea-fullstack/forms-execution.md)에 남아 있다.

## 변경과 재현

Context를 받은 뒤 바뀐 MFA/IP/비밀번호 정책, 세션 비활동 만료, 선택 회사 변경을 폼·템플릿 내부 트랜잭션에서 다시 검사한다. 현재 회사·사용자·구성원·grant·정책·세션을 잠그고 작업의 마지막 DB 조회·감사 저장 뒤 세션/MFA 예외/전문가 배정/비밀번호 기한을 검사한다. 실패하면 변경과 감사가 함께 롤백된다.

폼·템플릿 생성/수정/복제/사용/게시/개정과 목록·상세·보관/삭제/즐겨찾기, 게시 승인·고정 URL·폼 동의서 선택에 연결했다. idempotent 라우트는 신규 캐시 저장 및 캐시 응답 재전송의 마지막에도 검사한다. 익명 공개 URL 해석에는 로그인 가드를 추가하지 않았다.

폼 경로는 기존 Form/Template→선택 Service 순서를 유지하도록 actor 가드의 일괄 Service 잠금을 끈다. 기존 다른 호출자의 기본 동작은 유지한다. 전문가의 보관 서비스 목록·상세 404 계약도 보존한다. 보유기간 쓰기의 Service SHARE→UPDATE 승격을 없애 같은 서비스의 동시 생성을 직렬화한다.

- [최초 재현](../core/authority-before.json): 11 실패 중 실제 결함 9개, MFA 예외 준비 데이터 오류 2개. 자기 자신이 예외 승인자가 될 수 없다는 DB 제약을 fixture가 위반했다.
- [MFA fixture 수정 뒤 재현](../core/authority-mfa-before.json): MFA 자연 만료 2개 실제 실패. 위 9개와 합쳐 **서로 다른 결함 재현 11개**다. 이 실행의 9개 skipped는 이름 필터로 제외한 시험이다.
- [첫 수정 후](../core/authority-after.json): 재현 11개와 기존 템플릿 권한 9개 모두 통과.
- [확장 중간 실행](../core/authority-expanded.json): 23 통과·2 실패. 전문가는 자기 배정 금지, 동시 잠금 관측은 직접 대기자만 세는 준비 문제였다. [중간 fixture 보정](../core/authority-fixture-repair.json)은 전문가 전환 시 마지막 owner 보존 제약을 추가로 확인했다. 두 fixture를 보정했으며 이 실패를 제품 결함으로 집계하지 않는다.
- [최종 회귀](../core/authority-regression.json): **18파일 193개 통과, 실패·보류 0**. 새 현재 권한 시험 25개 포함. 5개 무효화 유형에서 각각 26개 서버 동작을 거절하고, 실제 Company 잠금 뒤 MFA/IP/비밀번호 변경 6개, 감사 중 세션/MFA 예외/비밀번호 유예 만료, 즐겨찾기 저장 중 전문가 만료, 감사 저장 실패, 캐시 저장/재전송 중 만료, 보유기간 생성 경합을 검사한다. 관련 초안·문서·게시·승인·삭제·질문·SSO·보안 회귀를 포함한다.
- [production 빌드](../core/authority-build.log), [타입 검사](../core/authority-typecheck-final.log), [변경 린트](../core/authority-lint-final.log), [계획 정합성](../core/plan-verify.log): exit 0. 빌드는 `.next-rea-form-authority`. 기존 전체 1,834개 결과는 과거 체크포인트로 구분한다.

## 실제 서버와 Ego

[HTTP 29개](http.json)는 새 전용 QA 회사·계정에서 실행했다. 폼/템플릿 생성·조회·수정, stale version 409, 복제·사용, 게시·일시중지·재개, 고정 URL 생성·수정·회수, 즐겨찾기 추가/제거, 폼 보관·완전 삭제·404, 템플릿 삭제·404와 목록을 확인했다. 계정 이메일 인증은 시험 준비를 위한 DB 설정이며 실제 이메일 전달 검증은 아니다.

Ego 공간2/p1에서 실제 입력과 저장을 수행했다.

- [폼 자동저장](form-saved.json), [템플릿 저장](template-saved.json).
- 편집기를 연 뒤 해당 QA 회사의 MFA 정책만 DB로 활성화했다. [템플릿 거부 화면](denied-template-browser.json)과 [DB 불변](denied-template-db.json), [폼 거부 화면](denied-form-browser.json)과 [DB 불변](denied-form-db.json)을 대조했다. 거부된 입력은 화면에 남고 DB 제목·버전은 변하지 않았다.
- 템플릿 첫 저장의 성공 안내를 기다리는 동안 정책을 먼저 활성화하여 대기 함수가 시간 초과했다. 실제 관측은 MFA 거부였으며 이를 성공으로 기록하지 않았다. 정책을 복원한 뒤 같은 입력으로 저장에 성공했다.
- 폼의 정책 복원 후 `최신본 불러오기`로 저장된 내용을 복구했다. 별도 관리자 UI의 정책 변경 수용이라고 주장하지 않는다.
- [재시작 후 브라우저](browser-after-restart.json): 폼·템플릿 저장 제목 유지. 폼 편집 화면 390/768/1440px 가로 넘침 없음. 모든 R08 경로의 반응형 수용을 의미하지 않는다.
- [실제 거부 화면](form-policy-denied.png)을 시각적으로 확인했다. 내려받기 버튼은 클릭했지만 파일 바이트 검증은 이번 증거에 포함하지 않는다.

## 영속성

production 프로세스 PID8074→10662로 재시작했다. [재시작 전](freeze.json)과 [재시작 후](verify.json)의 회사·정책·서비스·폼 버전/질문/보기/게시/즐겨찾기·템플릿·고정 URL·감사 행을 RepeatableRead로 비교했다.

- 폼2개, 템플릿1개, 회수된 고정 URL1개, 회사 범위 감사22건.
- SHA256 `6d197ff8a75cd71ce9e2cc97d773821d869983479782ee9880dca3d22ac74ae7` 일치.
- 이 지문은 세션·메일·요청 캐시를 포함하지 않는다. 캐시 원자성은 위 격리 PostgreSQL 시험의 별도 근거다.
- 기존 SSO browser/binding/outbound/HTTPS/provider-context/journey 6개 동결 fixture도 읽기 전용 verify로 통과했다. HTTPS의 기존 명시적 감사2건 차이 허용은 그대로 유지했다.
- 시험 CA의 키체인 신뢰 제거 상태를 되돌리지 않았다.

실행 helper: [qa-rea-form-authority.ts](../../../../scripts/qa-rea-form-authority.ts). 개인 fixture는 `.local/rea-fullstack/form-authority`에 0700/0600으로 보관하며, 동결 후 helper는 verify만 허용한다.
