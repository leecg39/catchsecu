# P06-T02 응답 조회·역할 접근 라이브 게이트 (2026-10-04)

dev 앱 :3100 + catchsecu_dev 실측. 기존 [CSV 내보내기 증거](exports/README.md)·[목록 검증](README.md)을 보강한다.

| 수용 조건 | 실측 |
|---|---|
| 역할별 접근 차이 | `GET /api/v1/forms/{id}/submissions`: owner → **200**(복호화된 실제 값·질문·보유기한), privacy → **200**, viewer → **403**, editor → **403**(`submission.read` 없음) |
| 첨부 필드 분리 | 첨부는 `file.read` 권한과 `scanStatus=clean`·`status=attached`에만 노출(`mayReadFiles` 미만이면 `attachments:[]`) |
| 보유 상태 필터 | `contentAvailable:false`·`values:{}` — 파기/기간만료 데이터는 목록에서도 내용 차단(P14-T04 게이트와 동일 실측) |
| 새 브라우저 표시 | API 직접 제출분이 관리자 목록에 즉시 표시(이전 세션 실측: API 제출 → 관리자 UI 2건) |
| 정정 원본 이력 | 정정 후 version 2·`submission.corrected` 감사·원본 값 이력 보존(이전 세션 실측) |
| 감사 | 목록 조회 자체가 `submission.list_viewed` 감사를 트랜잭션 안에 기록 |

## 미수용

- privacy 계정의 파일첨부가 있는 응답에서 실제 파일 표시·다운로드 대조(현재 dev fixture에 attached 파일 없음).
- 대량(수만 건) 목록·내보내기 성능 실측 없음.
