# P12-T03 — 응답·파기와 월마감 연결 검증

2026-10-04. 한 Task씩 순차 진행한다. 이번에는 P12-T03의 FLOW-12 중 응답 수명주기 분기를 검증했다. 전체 업무의 FLOW-12나 선행 Task 전체 완료를 뜻하지 않는다.

## 확인한 결과

- 실제 PostgreSQL·Route Handler·worker 통합 시험 1개를 추가해 통과했다. 공개 접수, 정정, 철회, 보존, 보존 대상 파기 거절, 승인, 실제 파기, 중복 실행 방지, 감사, 서비스별 집계와 월마감·비동기 CSV까지 연결한다. [시험 로그](tests.log).
- Ego45/p1의 별도 합성 회사에서 공개 폼으로 응답 두 건을 제출했다. 한 건은 API로 보존 조치하고 다른 한 건은 실제 상세 화면에서 파기 요청·승인했다. worker는 해당 회사·요청 ID 한 건만 처리했다.
- 파기 대상의 답변·동의 영수증은 각각 0개가 됐다. 보존 대상은 legalHold=true, 답변 1개를 유지했다. 파기 완료 감사는 1개다. [독립 DB 조회](database-final.json).
- 현재 보유 응답은 2→1, 기간 내 파기 완료는 0→1로 바뀌었다. 파기 전 서비스 월마감은 보유 2건과 근거 해시를 유지했다. 실제 버튼으로 받은 [파기 전 CSV](close-before.csv)와 [파기 후 동일 마감 CSV](close-after.csv)는 바이트가 같다.
- 파기 후 회사 전체 마감을 화면에서 새로 생성했다. 보유 1건·파기 1건이며 독립 DB와 일치한다. [새 마감](company-close-after.json), [CSV](company-close-after.csv).
- 화면에서 원문 파기 안내와 증명서 무결성 확인을 보았고 [증명서 JSON](certificate.json)을 내려받았다. 증명 범위는 활성 DB와 비공개 저장소이며 백업·WAL·외부 사본 전체 삭제의 증거가 아니다.
- 이번 변경은 통합 시험 추가다. [타입 검사](typecheck.log)와 [해당 시험 lint](lint.log)는 종료 코드 0이다. 제품 코드는 이전 검증의 production v24를 그대로 사용했다. 기존 77개 시험은 앞선 실행 결과이고, 이번 실행은 신규 1개로 구분한다.

## 재현과 범위

```sh
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/compliance-lifecycle.test.ts
node node_modules/typescript/bin/tsc --noEmit -p .local/recovery-production-v24-tsconfig.json
node node_modules/eslint/bin/eslint.js tests/server/compliance-lifecycle.test.ts
```

Node 24, 격리된 catchsecu_test를 사용한다. 개발 브라우저 회사는 setup.json에 기록한 6e093213-bd51-4b35-939d-242ae0d00c0f다. 비밀과 공개 게시 토큰은 증거에서 제외했다. 파기·보존 fixture를 다시 처리하지 않는다. 사용자 서버 3100과 기존 QA 회사는 유지했다. 이번 흐름에서 서버 재시작은 추가 실행하지 않았으며, 마감·출력의 재시작 검증은 앞선 evidence/exports 기록에 있다.

처음 두 통합 시험 실패는 시험 기대값을 수정했다. 파기 응답 조회는 410 대신 원문 없는 200 tombstone이 계약이고, Response.text의 BOM 제거와 파일 바이트를 혼동하지 않도록 arrayBuffer로 비교했다. 브라우저에서 다운로드 링크 명칭을 잘못 기다린 timeout 1회는 현재 화면 재관찰로 복구했다. 이 실패들을 제품 결함으로 집계하지 않는다.

## 수용 조건 대조와 다음 순서

| P12-T03 조건 | 근거 |
|---|---|
| 근거 없는 준수 통과 금지 | evidence의 5개 집계·저장 해시, UI/PDF/CSV 미판정 |
| 같은 필터 동일 합계 | close-authority·analytics 시험, 서비스/회사 SQL, 이번 파기 전후 CSV 불변 |
| 다운로드 제한·CSV 수식 방어 | exports의 권한·기한·크기·행수·수식 검사와 실제 다운로드 |
| 월마감 영속성과 불변성 | migration76의 UPDATE/DELETE 거부, 앞선 재로그인·새 프로세스 파일/DB 동일성 |
| 응답 수명주기 연결 | 이번 정정·철회·보존·파기 통합 시험과 실제 화면·DB |

P12-T03의 핵심 기능과 응답 수명주기 연결은 검증됐다. 공식 상태는 in_progress를 유지한다. 남은 대조는 선행 범위 중 감사 이벤트 생산·원자성의 누락 경로(P12-T01), 라이선스/원장을 포함한 전체 원천 집계(P12-T02), 파기의 운영 저장소·복구 범위(P07-T03)다. 이번 응답 분기 통과를 그 전체의 통과로 확대하지 않는다. 다음에는 해당 선행 항목이 P12-T03의 저장·보고 범위에 실제 영향을 주는지 계약별로 구분해 최종 수용표를 확정한다. 무관한 전체 출시 조건을 이 Task의 새로운 구현 범위로 추가하지 않는다.

[파일 해시와 요약](summary.json). 전체 공식 완료 수는 15/72이며 코드 구현률을 의미하지 않는다.

후속 완료 판정(2026-10-04): 위 내용은 실행 당시 기록이다. 최종80개·v25빌드/타입/lint·실제 HTTP/새 프로세스와 원래 요구별 대조 후 P12-T03을 완료로 갱신했다. [최종 수용](../../completion.md)
