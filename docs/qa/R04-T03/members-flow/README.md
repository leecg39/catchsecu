# 구성원·초대·전문가 UI 검증

2026-10-10, Ego Lite space 3/p1, 로컬 production 미리보기. 새 합성 회사와 계정을 사용했다. 원본 4경로(`/set/member`, `/set/authority`, `/oauth2/invite/signup`, `/expert/select-company`)와 부가 `/admin/expert-assignments`를 확인했다. 전체 원본 동등성·모든 역할 조합 수용 완료는 아니다.

## 재현 및 수정

| 재현 | 보완 | 증거 |
| --- | --- | --- |
| 구성원 초대 모달을 닫으면 작성값 유실 | 닫기/이동 입력 보호, 계속 편집/입력 버리기 선택 | `unsaved-before.json`, `unsaved-after.json`, `unsaved-confirm.png` |
| 초대 조회 네트워크 실패에 재시도 없음 | 일시적 오류 재시도, query token 변경 시 이전 초대 정보 숨김, token별 수락 멱등키 | `invitation-preview-before.json`, `invitation-preview-after.json` |
| 구성원 제외 409 이후 창을 다시 열어도 이전 버전으로 반복 실패 | 처리 재시도 비활성화, 최신 목록 복구; 소유권 이전·초대 재전송/취소에도 적용 | `action-conflict-before.json`, `action-conflict-after.json`, `invitation-action-conflict.json` |
| 전문가 배정 취소 시 입력 유실 | 닫기/취소/이동 및 충돌 후 재조회에 입력 보호; 서비스 선택지 조회 실패 중 저장 차단 | `expert-unsaved-before.json`, `expert-unsaved-after.json`, `expert-conflict.json`, `expert-options-responsive.json` |

구성원 편집은 409에 입력을 유지하고 저장을 막는다. 최신 정보 요청 시 계속 편집을 선택하면 그대로 유지하고, 버리기를 선택한 뒤에만 새 버전·서비스 범위를 적용한다(`member-conflict.json`).

## 실제 수행한 흐름

- 초대 생성 → 지정 메일 job 전달 → 재발송/기존 링크 거부 → 다른 이메일 거부 → 재시도 → 실제 수락 → 서비스 A만 조회. 수락 링크 재사용 거부(`invitation-*.json`).
- 편집자 변경 → 모든 서비스 권한 회수 → 기존 HTTP 세션에서도 403 → 정지 시 세션 폐기/401 → 활성 복구. 별도 HTTP 재로그인으로 복구 확인(`member-grants-suspension.json`, R04-T04 `boundaries.json`).
- 제외 409 복구 → 제외 → 새 초대 수락으로 동일 멤버십 재참여. 조회자에게 두 관리 화면 거부. 잘못된 비밀번호를 거부한 후 소유권 이전과 복원을 UI에서 수행; 이전 소유자의 추가 이전은 403(`reinvitation-*.json`, `ownership-transferred-returned.json`).
- 관리자로 다른 합성 계정 초대 → 재발송 409 복구 → 초대 만료 표시 → 취소. 최종 링크 410, 관리자에게 billing 역할 선택 미노출(`invitation-action-conflict.json`, `invitation-cancelled.json`).
- 운영자 배정 생성/편집 409 복구 → 전문가 로그인/회사 선택/서비스 A만 조회 → 만료 후 선택 불가·서비스 403 → 동시 재배정 409 복구 → 회수 충돌 복구 → 실제 UI 재배정/재회수. 최종 전문가 두 서비스 모두 403(`expert-*.json`, `revoked-responsive.json`).
- 구성원 검색·빈 결과·제외 상태 필터, 구성원 목록 네트워크 실패 재시도, 전문가 검색 빈 결과·목록 실패 재시도, 전문가 선택지 실패 재시도를 확인했다.

원본 4경로의 390/768/1440 폭 12관측과 운영자 배정 모달의 3폭을 확인했다. 페이지 가로 넘침 없음; 표 내부 가로 스크롤은 허용한다. 구성원 모달 Tab 6단계는 모달 안에 머물렀다(`member-search-responsive.json`, `revoked-responsive.json`, `expert-options-responsive.json`). 모바일 스크린샷도 직접 확인했다. 서버 재시작 후 목록 3명과 초대 3건 상태를 다시 조회했다(`browser-after-restart.json`).

## 검증 범위의 한계

- 전문가·초대 만료는 이 fixture의 기한만 과거로 설정한 명시적 시험 준비 후 실제 API/UI로 확인했다. 실제 시간이 며칠 흐르거나 전체 만료 worker를 실행한 것으로 주장하지 않는다.
- Ego `fill()`로 날짜 DOM 값이 바뀌어도 React 상태가 갱신되지 않는 경우가 있었다. 기록을 남기고 native input setter + input/change 이벤트로 날짜를 넣은 뒤 실제 저장 버튼을 눌렀다(`expert-created.json`). 전체 날짜 키보드 조작 수용은 남아 있다.
- 이 단계의 표 데이터는 3건이다. 다중 페이지 탐색, 모든 역할/서비스 수 및 원본 ROOT/USER와 독립 구현 역할의 전체 대응은 후속이다. 다른 기기 세션은 독립 HTTP 쿠키이며 별도 브라우저 프로필 시험은 아니다.
- 외부 SMTP/SSO 제공사 검증은 통과로 집계하지 않았다.

[DB·HTTP·재시작](../../R04-T04/members-flow/README.md) · [서버 68개](../../R04-T02/members/README.md)
