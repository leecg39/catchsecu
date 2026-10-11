# R13-T03 정보주체 화면 검증

2026-10-14. `http://localhost:3121`(production 빌드)에서 정보주체 공개 경로를 실제 브라우저로 확인했다.

## 경로별 확인

| 경로 | 결과 |
|---|---|
| `/infoOwner/find` | 동의 이력 조회 — 이름·이메일·필수 동의·"인증 메일 받기"·한/영 전환 |
| `/infoOwner/find/complete` | "이메일을 확인해주세요" 완료 안내 — 10분·동일 브라우저 제한 명시(토큰을 신원증명으로 신뢰하지 않는 안내와 일치) |
| `/identification/invalid` | "외부 인증이 필요합니다. 이 인증 공급자는 아직 연결되지 않았습니다" — 미연동 제공자 정직 고지 |
| `/infoOwner/agree-history/{token}` · `action-history` · `formComplete` · `form-interrupt` | 서버 확인 결과 표시 경로 — 라이브 스크립트가 200 렌더 확인 ([http-prepare.json](../R13-T04/access/http-prepare.json) 6경로) |

## 누적 브라우저 증거

- find→메일→동의이력→철회 확정→미완료→철회됨→이력→관리자 반영·CSV·390px: [docs/qa/subjects/](../subjects/) (01~12.png).

## 판정

로컬 화면 검증 완료.
