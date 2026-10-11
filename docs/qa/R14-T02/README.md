# R14-T02 개인정보 업로드·이관 API 계약 대조

2026-10-14. imports 상태 기계를 운영 계약과 누적 검증으로 대조했다.

## 운영 계약 (operation-policy-matrix)

- `GET/POST /imports` · `GET /imports/options` — init(파일+목적/제공자 증빙) + Idempotency-Key.
- `GET/PATCH/DELETE /imports/{id}` — 진행 조회·매핑 수정·archive(If-Match).
- `POST /imports/{id}/inspect|validate|commit|retry` — 헤더 분석→행 검증→비동기 커밋(202)→실패 재시도.
- `GET /imports/{id}/rows` · `GET /imports/{id}/errors.csv` — 스테이징 미리보기·오류 CSV(private,no-store).

## 누적 검증

| 항목 | 근거 |
|---|---|
| 상태기계·인코딩/크기/확장자·수식 주입 방어·중복행·동의 근거 | [imports.test.ts](../../tests/server/imports.test.ts) 29건 |
| 라이프사이클 재실행 28+9케이스 | [R14-T04 lifecycle](../R14-T04/lifecycle/) |
| 타 회사 파일 주입 차단·보존 해시 | lifecycle database.json |

## 판정

계약=구현=검증 일치. 외부 제공사 차원 없음.
