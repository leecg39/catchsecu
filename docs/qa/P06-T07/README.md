# P06-T07 — 응답 흐름 E2E 라이브 게이트 (2026-10-05)

전 과정을 실제 HTTP API + DB + 워커로 연결 검증 (`scripts/qa-submission-e2e.ts`, 증거 `e2e-flow.json`):

| 단계 | 실측 |
|---|---|
| 폼 게시 | 생성→승인 요청(reference 필수)→승인→publish 201, 공개 토큰 발급 |
| 외부 제출 | 무쿠키 익명 POST `/public/forms/{token}/submissions` → 201 |
| 관리자 확인 | 목록에 해당 ID 포함, 상세 `values`에 실제 답변 복호화 반환 |
| 공유 인증 | share-grant 생성→초대 메일(43자리 인증코드) 실수신→challenge 202→인증번호 메일 수신→verify 200→viewer 세션 쿠키→공유 목록/상세 200 |
| 정정 | PATCH `answers` 부분 정정 → status `corrected`, 정정값 반영 |
| 철회 | POST `/withdraw` → status `withdrawn` |
| 파기 | destruction-request→approve→`runOneDestruction` 워커 → status `destroyed`, DestructionCertificate 생성(digest 검증 필드 존재), 연결 파일 0 |

선행 P06-T06(본인인증 공급자)은 외부 자격증명 차단으로 미검증 — 해당 게이트 없는 폼으로 E2E 수행.
