# F5 참여자 인증·대상자·중복 참여 검증

검증일: 2026-10-10

## 구현 범위

- 폼 버전에 참여자 인증 사용 여부, 이메일/소셜 방식, 전체/허용 대상 범위, 이메일 OTP, 소셜 제공자, 중복 참여 제한을 독립 필드로 저장한다.
- 이메일 OTP는 암호화된 로컬 outbox와 만료·시도 횟수 제한을 사용하며, 성공 후 게시본 범위의 참여 세션을 발급한다.
- 허용 대상은 배치와 개별 대상을 PostgreSQL에 저장하고 작성자 API와 설정 화면에서 생성·조회·삭제한다. 대상 삭제는 이후 인증을 즉시 거부한다.
- 참여자 신원은 폼 범위로 유지해 재게시 뒤에도 중복 참여 기록을 보존한다. 세션과 challenge는 게시본 범위로 분리한다.
- 인증 proof는 게시본에 묶인 HttpOnly·SameSite=Strict 쿠키와 요청 헤더로 확인한다. 공개 파일 업로드와 작성자 자산 읽기도 같은 권한 경계를 따른다.
- 카카오·네이버 소셜 방식의 계약과 설정 UI는 연결했지만 실제 공급자 자격증명이 없으면 게시를 503 `SOCIAL_PARTICIPATION_PROVIDER_REQUIRED`로 거부한다.

## 실제 검증

| 영역 | 결과 | 증거 |
|---|---|---|
| 새 PostgreSQL 설치 | 145개 migration, 참여자 테이블 5개, 버전 필드 7개, CHECK 6개, FK 9개 통과 | `fresh-schema.json` |
| 기존 데이터 호환 | 기존 FormVersion 196/196 기본값 보존, 신규 참여 테이블 0행 | `existing-data-compatibility.json` |
| API·서버 회귀 | 관련 16개 파일, 171개 테스트 통과 | `verification-final.json` |
| 계약 | OpenAPI 326경로/463작업, 정책 누락 0, schema 차이 0 | `verification-final.json` |
| 실제 브라우저 | 관리자 설정→공개 폼 본문 비노출→이메일 OTP→본문 표시→제출→같은 신원 재참여 거부 | `browser-flow.json` |
| production 재시작 | 제출 1·참여자 1·세션 1과 해시가 재시작 전후 동일 | `browser-freeze.json`, `browser-verify.json` |
| production build | 82개 정적 페이지 생성과 타입 검사 통과 | `verification-final.json` |

브라우저 검증은 Ego Lite를 우선 시도했으나 다른 Ego 작업공간이 앱 포커스를 바꾸면서 제어가 중단됐다. 같은 로컬 production 서버와 PostgreSQL을 대상으로 제어 가능한 Chrome 탭에서 전체 흐름을 완료했다. 이 체크포인트의 브라우저 증거는 Chrome fallback 결과다.

## 남은 외부 수용

- 실제 SMTP 수신함 전달·반송은 확인하지 않았다. 이번 OTP 검증은 암호화된 로컬 outbox를 사용했다.
- 카카오·네이버 개발자 앱, client secret, 승인 callback/domain과 테스트 계정이 없어 실제 OAuth 왕복을 확인하지 않았다.
- 기존 데이터 검사는 migration 이전 해시를 미리 채취하지 못했다. 현재 기존 버전 196개의 기본값과 신규 테이블 무백필을 확인했으며, byte 단위 전후 동일성을 주장하지 않는다.
- 위 외부 항목과 R08-T02 전체 수용이 남아 있으므로 Task 상태는 `in_progress`를 유지한다.
