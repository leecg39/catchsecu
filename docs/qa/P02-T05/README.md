# P02-T05 미인증 API 점검

2026-10-03. 이 파일은 전체 Task 완료 증거가 아니다. 보호 API가 세션 없이 성공 응답을 주지 않는지만 기록한다.

[unauthenticated.json](unauthenticated.json): 라우트 핸들러 180회 호출, 178회는 400 이상. 200은 `/api/v1/health`와 `/api/v1/ready`뿐이다. `returnTo`는 `/dashboard`만 통과하고 `https://`, `//`, 역슬래시는 `/dashboard`로 되돌린다.

회사 격리 전수와 브라우저 가입 E2E는 아직이다.
