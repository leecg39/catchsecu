# P03-T04 문서 선택 목록 권한·만료 보완

2026-10-04. 동의 표시에서 참조하는 `GET /documents/options`의 후속 검증이며 전체 Task 완료가 아니다.

## 수정

documentOptions가 현재 회사·회원·계정·세션·MFA/IP/비밀번호 정책·전문가 배정과 document.read 서비스 범위를 잠금 아래 다시 확인한다. 마지막 DB 조회가 끝난 뒤 세션 등 유효기한을 검사하고, 그 사이 게시 기간이 끝난 처리방침은 선택지에서 제외한다. 기존 document.read의 보관 서비스 조회 동작과 DTO는 유지한다. 다른 문서 API 전체를 이번 수정의 검증 범위로 주장하지 않는다.

## 근거

- PostgreSQL 신규4개(회사변경/MFA추가/마지막 조회 중 세션만료/마지막 조회 중 게시만료) 모두 수정 전 실패, 수정 후 통과. DB query extension은 실제 질의를 마친 직후 Date만120초 전진시키며 질의 결과를 가짜로 만들지 않는다.
- 기존 document-access-gate/consent-display-authority/documents/form-documents를 포함한5파일60개 통과. 전체 저장소 회귀는 아니다. 기존 경고도 로그에 보존했다.
- 최종 production v12 build+TypeScript, 변경2파일 ESLint, git diff --check 통과. schema/migration 변경 없음.
- Ego45/p1에서 v12/3113 동의 설정 화면을 실제 조회했다. A/B 각 options200, 자체 게시본 포함·다른 서비스 게시본 제외·공개 토큰/암호문 미포함을 확인했다. A수집 설정의 문구와 게시본 선택값도 그대로 표시됐다. 조회만 수행했으므로 별도의 업무 쓰기/재시작 검증으로 주장하지 않는다.
- 최신 자체QA3113 PID59056/exec72823/buildv12, Ego45/p1 desktop1440x1000 동의 설정 A수집 탭. 이전QA3112 종료, 사용자3100 유지.

## 남은 작업

P03-T04 선행 문서/메일 Task와 실제 SMTP·전체 공통 수용 조건, P03-T05 관리 전체 E2E는 남아 있다. 전체 완료15·진행21·계획36을 유지한다. 개인정보 활동 검토는 고정 빈 배열 결손을 확인했으며 `docs/planning/06-privacy-activity-review.md`에 독립 구현 요구사항을 정리했다. 해당 업무 모델·API·UI 구현은 아직 시작 전이다.
