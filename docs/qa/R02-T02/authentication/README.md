# R02 인증 서버 회귀

2026-10-10. 계획의 인증 링크 일회 사용 조건과 기존 구현을 대조해, 인증 완료 링크가 다시 성공으로 처리되는 문제를 재현하고 수정했다.

1. 기존 7파일 138개 시험 통과: baseline.json.
2. 동시 확인의 단일 성공과 재사용 거부, 안전한 callback 유지, callback 없는 재사용, 외부 callback 거부 시험을 추가했다. auth-public-audit 29개 중 26통과/3실패를 verification-replay-before.json에 보존했다.
3. src/server/auth.ts에서 모든 callback 검증을 먼저 수행한 뒤, 사용자 행 잠금 안에서 이미 인증된 계정의 재사용을 거부한다. 안전한 callback은 EMAIL_ALREADY_VERIFIED로 돌아가고, callback이 없으면 400을 반환한다. 새로운 세션을 만들지 않는다.
4. 수정 후 같은 7파일 141개 모두 통과했다: verification-replay-after.json. 두 동시 확인 중 실제 플래그 전이와 성공은 한 번이며 감사 실패 시 롤백도 기존 회귀에 포함한다.

대상: foundation(43), auth-navigation(13), auth-session-gate(7), auth-public-audit(29), auth-mutations-audit(20), credential-audit(7), password-policy(22).

MFA 정책·IP 제한·인증 감사 원자성·클라이언트 오류의 추가 5파일 64개도 통과했다: policy-boundaries.json. 첫 7파일과 중복되지 않아 이번 인증 범위는 12파일 205개다.

실제 화면/메일 worker/독립 DB/재시작은 [화면 기록](../../R02-T03/authentication/README.md)과 [DB·재시작 기록](../../R02-T04/authentication/README.md)으로 확인한다. 141개는 전체 저장소 시험 수나 전체 원본 동등성 수용 결과가 아니다.
