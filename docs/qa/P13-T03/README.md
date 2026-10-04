# P13-T03 내비게이션·모달·캐시 일관성 — 미완료

> 2026-10-04: 실제 부분 구현을 근거로 planned에서 in_progress로 정정했다. 전체 완료는 아니다. [근거](../status-revalidation/README.md).

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

회사/서비스 전환·메뉴·MY·모달 기반. 이번 소스 조사만으로 테스트 실행·브라우저·외부 연동 통과를 주장하지 않는다.

- [src/server/context.ts](../../../src/server/context.ts) — activeMembershipWhere, requireActor, requireContext, requireService
- [tests/server/auth-navigation.test.ts](../../../tests/server/auth-navigation.test.ts)

## 남은 구현·수용

모든 visible action 실동작·권한/오류/캐시 전수.

원래 범위: 메뉴·헤더·MY·서비스 전환·권한에 맞는 action, 공통 Table/Form 상태와 서버 cache invalidation을 연결한다.

수용 조건: 모든 visible action이 실제API/이동에 연결; loading·empty·validation·conflict·forbidden·retry·disabled 확인

선행: P04-T04, P08-T04, P10-T05, P13-T02. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.
