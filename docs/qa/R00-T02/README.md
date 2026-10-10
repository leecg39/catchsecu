# 2026-10-10 현재 구현 감사

## 2026-10-11 현재 소스 재감사

- 계약 생성에서 `PublicSubmissionReceipt`만 공통 rich 문서 변환기를 우회해 `#/$defs/` 참조가 남는 결함을 전체 회귀에서 발견했다. `openApiSchema`를 사용하도록 수정했고 집중 시험 1/1과 Node 25 진단 실행 2,867/2,867이 통과했다. Node 25는 지원 버전이 아니므로 최종 품질 게이트로 쓰지 않는다.
- 지원 Node 24.18.0 전체 실행은 261파일 중260파일, 2,867개 중2,865개가 통과했다. 실패2개는 `tests/server/sso.test.ts`의 `beforeEach` DB 초기화 hook timeout이며 제품 assertion 실패는 없었다. 같은 현재 소스의 해당 파일 독립 재실행은 131/131 통과했다. 이 둘은 결합 증거이며 단일 전체 회귀 성공으로 기록하지 않는다.
- 관리자 요금제·공지·가이드의 목록·생성·상세·수정·삭제 15개 operation을 실제 route handler와 격리 PostgreSQL로 실행했다. 대상3파일24시험, 타입 검사와 변경 파일 lint가 통과했다. [관리자 CRUD route 수용](admin-crud-routes/README.md)
- 보유기간 규칙·피드백 CRUD와 개인정보·마케팅·준수 집계 13개 operation을 실제 route handler와 격리 PostgreSQL로 실행했다. 대상3파일17시험, 타입 검사와 변경 파일 lint가 통과했다. [내부 별칭·집계 route 수용](internal-alias-routes/README.md)
- 가입·로그인·비밀번호·세션·MFA의 공통 인증 route 13개 operation을 격리 PostgreSQL로 실행했다. 대상3파일71시험, 타입 검사와 변경 파일 lint가 통과했다. [공통 인증 route 수용](auth-route-adapter/README.md)
- 본인 SSO 연결·청구/사용량·초대 SSO·문자 수신확인·SSO 사전검사·기관 이메일 인증번호의 잔여9개 operation을 실제 route로 실행했다. 현재 소스의 대상5파일228시험이 단일 실행으로 통과했다. [잔여 API route 수용](final-handler-routes/README.md)
- 현재 API 감사는 466 operation·158 handler, handler/메서드 누락0·정책 누락0·작업 소유자 누락0이다. 모든466개 operation에 handler 직접 import 시험이 연결됐다. 실제 route wrapper 요청807건 중 계약766건을 연결했고 성공 operation57개, catch-all 분기34/285개를 확인했다. 남은 catch-all251개는 분기별 실행 증거가 계속 필요하다. [런타임 route 추적](runtime-route-trace/README.md)
- [현재 감사 요약](current-audit-summary.json), [API operation 감사](api-audit/README.md), [지원 Node 전체 실행](full-tests-current.json), [SSO 재실행](sso-node24-retry.json)

R00-T02는 위 누락과 단일 지원 Node 전체 실행 실패 때문에 진행 상태를 유지한다.

## 현재 결과

- 후속 수탁 항목 초기화·재수탁자 필수/선택 항목·처리 근거를 DB/공개 스냅샷/PDF에 연결했다. 관련4파일58개와 네트워크 오류3개, 실제 UI 생성/삭제저장/재게시·실패재시도 입력보존·3개 화면 폭을 확인했다. 게시2본/감사5건/PDF2개·재시작 지문 일치, 기존 처리방침14개 HTTP/2개 PDF 불변도 확인했다. [실행 증거](../R10-T04/trustee-items/README.md). 전체1,834개는 이 변경 전 체크포인트다.

- [정적 API 대조](api-audit/README.md): 440개 operation 모두154개 handler에 대응하며 메서드 export·정책 누락0. 이 중264개는 catch-all 내부 분기를 사용한다. 389개 operation의 handler를 현재 테스트가 직접 import한다. 함수 호출 관계·DTO import·권한/이벤트 문자열·소스 지문을 기록했다. 이 매칭 자체는 API별 런타임 성공 증거가 아니다.
- [전체 시험 첫 실행](baseline-tests.json): 116개 파일 중98개 통과·18개 실패. 총1,796개 중1,605통과·157실패·34미실행(skipped). 파일 검사 서비스 연결 오류503과 해당 fixture 실패의 후속 오류를 확인했다. 실패 결과를 보존하며 검사 서비스 복구 후 실패 파일을 재실행한다.
- 파일 검사 실행 파일의 손상을 확인한 뒤 공식 서명을 검증한 ClamAV1.5.4·curl8.22.0 소스를 사용자 폴더에 빌드·설치했다. 관리자 설치는 더 이상 필요하지 않다. 공식 CTest6개와 실제 HTTPS 정의 다운로드·서명·EICAR 차단을 확인했다. 이전 실패18파일의400개 회귀가 모두 통과했다. [복구 증거](../R01-T03/scanner-runtime/source-build/runtime-final.json), [파일 검사 41개](../R01-T03/scanner-runtime/files-restored-tests.json), [나머지 359개](scanner-restored-regressions.json)
- [사전 점검](../R01-T05/preflight/catchsecu_dev.json): 현재 dev/test 모두104개 migration 적용, 현재 SQL과 DB checksum 차이0, 미적용0. 과거 기록의4건 불일치는 현재 DB 조회에서 재현되지 않았다. 이번 작업에서 과거 migration SQL이나 이력을 수정하지 않았다.
- 공개 문서가 현재 초안의 제공·수탁자를 참조하는 결함과 필터 전100건 제한 누락을 수정했다. 관련37개 회귀가 통과했고 수정 후 전체 시험은 1,815개 중 1,814개 통과·1개 실패했다. 중단 시험이 남긴 임시 DB 함수 충돌을 정리한 뒤 CSV 가져오기 41개 재시험은 모두 통과했다. [전체 기록](full-tests-recipient-final.json), [정리 후 재시험](imports-after-interruption-cleanup.json). [관련 회귀](../R10-T02/public-recipient-snapshots/README.md)
- 34개 메뉴의 페이지·컨트롤을 실제 production 브라우저에서 관측했으며, 오류 alert나 경로 이탈이 없었다. 로그아웃은 별도 실제 로그아웃/재로그인 검증으로 다뤘다. [메뉴 관측](../R00-T01/menu-runtime/inventory.json)

## 결과 해석

구조화 처리방침 시점 전체1,834개가 통과했고 이후 회사·서비스 변경은 관련135개로 검증했다. 186개 원본 경로의 전체 CRUD, 외부 발송·결제·기관 인증 또는 전체107작업 완료로 집계하지 않는다. 이전 QA 파일을 덮어쓴 테스트의 생성물은 `baseline-generated`와 `full-generated-policy`로 보존했고 원래 이력 파일을 복원했다. 사용자가 이전부터 수정하던 결제 코드·문서는 유지했다.

## 재현

Node24.19.0으로 `.env.test.local`을 적용해 Vitest를 실행했다. 테스트는 로컬 `catchsecu_test`, 브라우저와 HTTP 시험은 별도의 `catchsecu_dev`를 사용한다. 실제 수신자에 메시지를 보내거나 원본 사이트 데이터를 변경하지 않았다.

## 구조화 처리방침 후속 검증

새 모델/DTO·실제 개별 입력·게시 스냅샷·PDF를 추가하고 관련55개+폼연결23개 회귀를 통과했다. 실제88개 입력과 DB 대조, HTTP14개, PDF2개와 서버 재시작 지문도 일치했다. [새 전체 실행](full-tests-policy-final.json)은122파일·1,834개 모두 통과, 실패·미실행0이다. [부분 수용 증거](../R10-T04/structured-policy/README.md).

## 회사·서비스 후속 검증

관리 API의 잠금 대기 중 권한/세션/MFA 변경과 종료 직전 만료를 재현해 수정했다. 회사등록 세션 잠금 경합도 수정했으며 [관련7파일135개](../R03-T02/authority/regression-final.json)가 통과했다. 실제 회사·서비스 CRUD·파일·폐쇄요청/취소·입력 보호·모바일과 독립HTTP23개·감사14건·서버재시작 지문이 일치했다. [부분 수용](../R03-T04/management-flow/README.md). 최종 빌드/typecheck 통과, 변경 파일 lint 오류0·기존 이미지 경고1이며 [현재 체크포인트](quality-gates/current.json)에 범위와 소스 지문을 기록했다.

접근 요청도 잠금 이후 세션·현재 권한·최종 만료를 재검사하도록 보완했다. 관련5파일89개가 통과했고 실제 UI 취소/거절/승인·답변 보존·409복구·실패재시도·권한표 갱신을 확인했다. HTTP19개와 DB 요청4건·권한1건·감사8건, 새 프로세스 지문이 일치한다. [접근 요청 증거](../R03-T04/access-flow/README.md). 기존135개 회귀와89개 회귀는 실행 간 중복된 파일이 있어 단순 합산하지 않는다.


## R02 인증 후속 체크포인트

인증 링크 재사용 성공을 재현한 뒤 사용자 잠금 내 재사용 거부와 안전 callback 검증을 보완했다. 해당 인증7파일141개와 정책경계5파일64개(총205개)가 통과했다. 실제 UI 가입·암호복구·MFA·일회 복구코드·해제·암호변경, 로컬메일 worker5건, 15경로45폭, 다른 HTTP 세션 폐기, 감사67건·새서버 지문을 확인했다. 네트워크 오류 재시도/정책 미확인 폼 차단·한국어 오류·모바일 약관도 검증했다. [상세](../R02-T04/authentication/README.md). 전체1,834개 수치는 이 후속 변경 전 전체시험이며 이번205개와 합산하지 않는다. 현재 build/typecheck/lint와 소스 지문은 quality-gates/current.json에 기록했다.

## 구성원·초대·전문가 후속 — 2026-10-10

R04 모델5개 대조와 서버68개 기준선, 실제 UI 수락/권한회수/정지/재초대/소유권/전문가 배정·만료·회수, 감사45건·로컬메일4건·HTTP11+11개·서버재시작 지문 확인. UI 입력 보호/일시 오류 재시도/409 최신 목록 복구를 보완했다. 전체 역할·원본·외부 수용 완료와 구분한다. [증거](../R04-T04/members-flow/README.md). 최신 타입/린트/빌드 증거는 quality-gates/current.json에 기록했다.


## R05 프로필·활동 검토·탈퇴 후속 검증

프로필/기기 조회 복구, 프로필·검토·탈퇴 미저장 입력 보호, 파기 요청 실패/409 안내, 탈퇴 완료 안내를 보완했다. 분리된 DB의 7파일225개 서버 시험과 dev/test6모델 대조를 통과했다. 실제 Ego Lite에서 프로필 저장/재로그인, 다른 기기 회수, 마지막 SSO 로그인 수단 보호/해제, 검토 요청·답변·완료·취소·로컬알림·파기·보존, 계정 폐쇄를 확인했다. HTTP13개 경계 검사와 8개 최종 검사, 감사75건/검토3건/폐쇄v6의 서버 재시작 지문이 일치한다. 타입검사·변경6파일 lint·production 빌드도 통과했다. [범위와 증거](../R05-T04/profile-flow/README.md). 전체1834개 시험은 이전 처리방침 체크포인트 기록이며 이번에 재실행한 총수로 합산하지 않는다.

## R06 보안 조회·CRUD 후속

정책 조회의 현재 권한 재검사 누락8개 재현 후 수정, 관련104개와 파일/worker77개(실행시점 구분) 통과. IP·MFA·정책 입력보호/충돌/재시도·검색포커스/모바일 수정, 실제IPv4/IPv6·MFA 자연만료·DB감사126건·재시작 지문 일치. [세부 기록](../R06-T04/security-flow/README.md). 전체 요금제/원본 수용은 미완료.

## R06 기능별 구독 권한 후속

현재 품질 게이트는 [current.json](quality-gates/current.json)을 따른다. 마이그레이션105, 개발/시험 DB 스키마 차이0, 최신 빌드/전체 타입/변경 파일 lint, 고유225개 관련 시험과 실제 상태별 UI·자연 만료·서버재시작을 확인했다. 만료worker 교착 재현과 수정 증거도 포함한다. 이전 R06 게이트는 [security-checkpoint.json](quality-gates/security-checkpoint.json)으로 보존한다. 과거 전체1834개는 이번 변경의 새 전체 회귀가 아니다. [기능 권한 증거](../R06-T04/security-entitlements/README.md).
