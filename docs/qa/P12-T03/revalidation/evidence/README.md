# P12-T03 — 점검 근거와 월마감 연결

2026-10-04. 사용자 지시에 따라 P12-T03만 순차 구현했다. 이 기록은 해당 보완의 증거이며 전체 57개 Task 완료를 뜻하지 않는다.

## 구현

- 월마감의 RepeatableRead 트랜잭션 안에서 5개 기술적 점검의 원천 집계·점검 시각·범위·버전·SHA-256을 함께 저장한다. 목적 등록, 유효 내부 처리방침 게시, 보유 기한 경과 응답, 검증된 구성원 인증 등록, 회사 인증 강제 설정이다.
- 화면·동기 CSV·비동기 PDF/CSV는 같은 저장 근거를 사용한다. 법적 준수는 계속 미판정이며 점수·과태료를 추정하지 않는다. 조건 확인/검토 필요/미점검/대상 없음을 구분한다.
- 서비스별 마감은 회사 전체 인증 정보를 수집하지 않는다. 회사 전체 마감은 기존 direct owner/admin 제한을 유지한다. 원문·개인 응답·이메일·인증 비밀·게시 토큰을 근거에 넣지 않는다.
- 내부 게시의 유효 조건은 실제 공개 문서와 같이 published·active·미회수·미만료다. 보유 기한 경과에는 파기 중 응답을 포함하고 보존 조치는 따로 센다. 임시 MFA 예외는 인증 등록으로 세지 않는다.
- 근거가 없는 예전 마감은 소급 변경하지 않는다. 기존 출력의 원천 해시와 CSV 바이트를 유지한다. 현재 자료 카드도 선택 서비스 범위를 적용한다.
- 점검은 마감 저장 당시 상태이며 과거 월말 상태 복원 또는 외부 게시·사본·법적 적정성 검증이 아니다. 근거 해시는 저장 집계의 무결성을 확인하는 값이지 외부 기관의 증명이 아니다.

## 검증

- PostgreSQL 통합 5파일 **77개 통과**: 신규13 + 기존64. [최종 로그](tests-final.log).
- 이전 스냅샷 호환성, 중복/만료/회수/비공개/초안 게시 제외, 기한 경계·legalHold·파기 중/완료, 범위/무결성 손상 거부, 원천 변경 후 마감 불변, 검증된 인증만 집계, 비동기 파일 내용을 검사했다. 기존 현재 권한·세션 만료·감사 실패 롤백·경합·출력 만료 검사도 포함한다.
- 최종 v24 production build·타입·변경 lint 통과: [빌드](build-ui-final.log), [타입](typecheck-ui-final.log), [lint](lint-final.log). 계약 289 paths/418 operations/38 policies 유지.
- Ego45/p1에서 viewer 서비스A 마감과 owner 회사 전체 마감을 생성했다. A는 서비스1/목적1/게시1, 회사 전체는 서비스2/목적2/게시2/구성원2/인증등록0/인증강제false. [브라우저 A](browser-close.json), [독립 SQL](db-after-restart.json), [회사 SQL](company-db.json).
- viewer 회사 전체403·다른 서비스404, owner가 다른 요청자의 파일을 받으려면404. [HTTP 결과](browser-checks.json).
- 실제 [PDF](service-a.pdf) 2쪽/55,042바이트와 [CSV](service-a.csv) 1,972바이트에 동일 근거 해시가 들어 있다. 한글·미판정 문구를 확인했고 활성 JS/첨부는 없다. [파일 검사](files.json).
- v22 프로세스를 종료하고 v23 새 프로세스에서 재로그인·재다운로드했다. 마감/작업/기존09월 마감 해시와 PDF/CSV 바이트가 동일했다. 기존09월 PDF도 이전 파일 해시와 동일하다. 최종 v24에서 화면을 다시 확인했다.
- 1440/768/390에서 페이지 너비와 scrollWidth를 대조했다. 긴 근거 설명을 줄바꿈하고 표 자체는 좁은 화면에서 가로 스크롤한다. [최종 레이아웃](layout-final.json).

## 실행과 시행착오

Node 24로 `.env.test.local`의 격리된 catchsecu_test에서 vitest를 실행했다. 개발 검증은 기존 합성 회사1600c8e7-888b-4d0e-8b61-ee248839142e의 서비스A 및 회사 전체 2026-10 마감에 한정했다. 출력 worker는 새 합성 작업 ID 두 개만 처리했다. DB 스키마 변경은 없으며 120모델/76migration을 유지한다.

```sh
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/compliance-evidence.test.ts tests/server/compliance-close.test.ts tests/server/compliance-close-authority.test.ts tests/server/compliance-exports.test.ts tests/server/analytics.test.ts
ALLOW_LOCAL_MAIL=1 CATCHSECU_BUILD_DIR=.local/recovery-production-v24 CATCHSECU_TSCONFIG=.local/recovery-production-v24-tsconfig.json node node_modules/next/dist/bin/next build
node node_modules/typescript/bin/tsc --noEmit -p .local/recovery-production-v24-tsconfig.json
python3 scripts/verify-plan.py
python3 scripts/verify-contracts.py
```

최초 시험 실패는 신규 fixture의 DB 제약/개정 이력 누락과 PDF 첫 페이지만 보던 기존 시험 가정이었다. 원래 제약을 유지하며 fixture와 검사 범위를 수정했다. 재시도 중 catalog 종류 오타도 수정했다. 최초 build는 로컬메일 허용 환경변수 누락으로 실패했고 최종 명령에 명시했다. 실제 게시 조건에서 비공개/초안을 제외하는 조건도 보완했다. 초기 실패 로그를 보존하며 이를 제품 오류 개수로 부풀리지 않는다. 브라우저 대기 문자열을 잘못 지정한 한 번의 자동화 timeout과 서버 ready 전 접근 실패는 재관찰 후 복구했다.

## 남은 Task 수용

점검 근거 연결은 구현·검증했다. P12-T03은 선행 P12-T01·P12-T02·P07-T03의 완료 증거와 FLOW-12(응답/파기→감사/집계→마감) 전체 수용 대조가 남아 **in_progress**로 유지한다. 이 기록으로 선행 Task나 전체57개를 완료 처리하지 않는다. 다음 작업도 이 수용 대조부터 이어간다.

후속 완료 판정(2026-10-04): 위 내용은 실행 당시 기록이다. 최종80개·v25빌드/타입/lint·실제 HTTP/새 프로세스와 원래 요구별 대조 후 P12-T03을 완료로 갱신했다. [최종 수용](../../completion.md)
