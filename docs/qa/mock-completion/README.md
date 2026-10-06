# Mock 대체 및 내부 잔여 검증 결과

2026-10-06 사용자 지시: 외부 증명을 Mock Data로 대체하고 가능한 내부 구현을 우선 완료한다. 이번 실행 결과는 **passed**이며 실제 외부 수신·SSO 공급자·운영 PITR 성공과는 별도로 기록한다.

## 구현·수정

- 결제 이벤트 동시 처리: 동일 승인 8개·승인/실패·환불 중복/상충·가상 PG 경합을 회사/이벤트 잠금으로 직렬화했다. 수정 전 4개 실패, 수정 후 관련22개 통과.
- 관리자 상품: KRW/DB 정수 한도/0개 기능 한도/판매 가격/기간 검증, 현재 운영자 권한·세션 최종 기한, 동시 생성, 감사 롤백을 보완했다. 미판매·미참조 버전만 삭제하는 100번째 migration을 추가했고 모든 UPDATE 및 판매/구독 이력 삭제는 계속 금지한다. 수정 전8실패→신규13통과.
- 보유기간 규칙: 현재권한·MFA·최종기한·생성 재요청 최신값·보관410·서비스별 변경 직렬화를 보완했다. 최초 실패4개 중 제품3개/시험fixture1개이며, 마지막owner 보호를 만족하는 인계fixture를 보완한 후 관리자+보유규칙18개 통과.
- `verify:mock`/`verify:mock:providers` 통합 실행기: 실제 격리 PostgreSQL을 사용해 Mock 공급자·S3·계약·계획·타입·린트·production 빌드를 순차 실행하고 종료코드·실패/skip·소스해시를 기록한다. 실행 중 코드 변경은 실패로 판정한다.

## 최종 검증

- 최신 전체 실행: 서버/공통 UI112파일, 1695개 통과, 실패0, skip0, todo0. 이전 ad15c47의109파일1665개 이후 변경을 포함한다.
- 최종 실행 중 소스 변경 0개.
- 전체 타입·린트·production 빌드 통과. 린트는 기존 경고30개를 숨기지 않고 기록했다.
- 실제 HTTP 21개 통과. 서버 재시작 후 업무 데이터 해시 일치=true, 재로그인200·보관 규칙조회200·회수된 관리자403.
- migration 적용 4개 DB 모두 성공, 개발 상품/버전/구독/결제/잔액 데이터 해시 보존=true. 새 빈 DB100개 설치와99→100 업그레이드 확인. 파일명 접두사는 기존 migration 정렬 순서를 잇기 위한 것이며 실제 실행일은2026-10-06이다.
- runtime npm audit 0건.
- 계약306경로/438작업 모두 implemented, 계획181경로/72작업 검사 통과.

첫 전체 실행은1646통과/1실패였다. 실행기의 KAKAO_PROVIDER=local 강제가 미설정 거부 시험과 충돌해 테스트 기본값을unconfigured로 바로잡았다. 로컬 성공 시험은 자체적으로local을 켠다. 최초 실패는[first-run](first-run/report.json)에 보존했고 수정 후 전체를 재실행했다.

## 공급자별 모의 증거

| 영역 | 결과 | 검증 방식 |
|---|---|---|
| catalog-and-retention | mock-verified | synthetic catalog/retention + live authority/atomicity |
| idp | mock-verified | local OIDC RSA HTTP + signed SAML |
| organization | mock-verified | virtual GPKI/Saeol/groupware directory |
| payment | mock-verified | virtual PG + signed webhook + real PostgreSQL ledger |
| mail | mock-verified | local mail artifact + job/feedback state |
| sms | mock-verified | mock HTTP/HMAC provider + signed receipt |
| kakao | mock-verified | local channel/template review and delivery |
| notifications | mock-verified | local receipt + SSRF/failure contract |
| identity-signature | mock-verified | local signed identity/signature callbacks |
| recovery | mock-verified | synthetic legacy data/key rotation/destruction in PostgreSQL; not infrastructure restore |
| s3 | mock-verified | loopback SigV4 + encrypted bytes |

## 재실행·결과 위치

프로젝트 지원 Node22/24에서 `npm run verify:mock` 또는 `npm run verify:mock:providers`를 실행한다. `.env.test.local`의 loopback catchsecu_test만 사용하고 테스트 데이터를 초기화하므로 동일 DB 시험과 동시에 실행하지 않는다. 실제 앱 `.env.local`과 발송 설정은 바꾸지 않았다.

- [최종 실행 보고서](full/report.json) / [전체 테스트 상세](full/tests.json)
- [작업별 근거](task-matrix.md) / [HTTP](http/result.json) / [재시작](http/restart.json) / [마이그레이션](migration-result.json)
- [계획](../../planning/07-mock-completion.md)

사용자 지시로 Ego56을 회수하여 [19개 동적 화면 사례 검증](ego-pages/README.md)을 완료했다. 기존 화면 증거는 해당 작업 폴더에 보존한다. 전체72개 원래 수용 체크박스는 실외부·원본·화면 전체 수용을 포함하므로 자동으로 올리지 않았다. 실제 외부 연동 없이 내부/API/Mock 시험은 계속 실행할 수 있다.

## 후속 적대적 검토: 청구 조회 권한

전체 검증을 저장한 `ad15c47` 이후, 청구서·사용 내역 조회에서 오래된 요청 문맥의 역할만 검사하는 경로를 추가 수정했다. 조회 트랜잭션 안에서 현재 회원·세션·MFA·회사 선택과 반환 직전 기한을 검사하도록 공통 결제 권한 처리를 적용했다.

- 신규 재현 10개 중 변경 전 8실패/2통과, 수정 후 신규10개 및 기존 결제권한30개 **40개 통과**.
- 후속 변경 전체 타입 검사와 변경 파일 린트 통과.
- [실패 재현](billing-read-baseline.log), [수정 후 시험](billing-read-final.log), [타입 검사](billing-read-typecheck.log), [린트](billing-read-lint.log).
- 위 전체1665개 보고서는 `ad15c47`에 저장된 소스 기준이며, 이 후속 변경까지 전체1665개를 재실행한 것으로 표시하지 않는다.

## 후속 검증기 감사

전 페이지 검증기가 skip12개와 콘솔 오류16개를 전체 실패로 집계하지 않는 문제를 수정했다. fixture 인자명이 없으면 임의 토큰으로 채우던 동작도 제거했다. 누락·skip·측정 실패가 있으면 명시적인 요약과 실패 종료코드를 남긴다. [기존 증거 재평가](page-gate-prior-evidence.json)는 새 브라우저 실행을 의미하지 않는다. [판정 시험14개](page-gate-test.log)와 타입·변경 파일 린트가 통과했다. 기존 화면 수용 미완료 상태는 유지한다.

## 동적 경로의 실제 Mock 데이터

[동적 fixture 준비](dynamic-fixtures/README.md): 전용DB에 정상 결제 결과4·문서3·공개폼5·정보주체2, 총14경로 데이터를 생성했다. API 정상/오류 검사22개 통과. 토큰과 쿠키는 비공개 로컬 파일에만 저장하고, 검증 도구가 직접 읽도록 연결했다. 브라우저 수용 완료를 의미하지 않는다.

후속 첨부·공유 확장: 동적 fixture를19경로/API34검사로 확대했다. 실제 파일 업로드·ClamAV 검사·내부/공유 다운로드 바이트 일치·선택 필드 제한·미인증401을 확인했다. 파일은 독립 `.local/mock-page-storage`, 공유/정보주체 인증 쿠키는 ignored fixture 파일에만 보관한다. 타입·변경파일린트 통과. 후속 브라우저 재검증과 fixture 경로 정정은 [Ego 보고서](ego-pages/README.md)에 기록했다.

## 최신 복구 리허설

[복구 증거](restore/README.md): 최신100개 마이그레이션의 Mock DB128테이블617행·스키마2,747항목·암호화 객체1개를 새 DB/저장소로 복원했다. 모든 해시 일치, 복원 후 로그인·파일·공유 회수·재파기6검사 통과, 원본 보존 확인. 운영 WAL/PITR 인증은 아니다.

## 알림톡 캠페인 경계 후속

[승인·보유 기한 검증](kakao-campaign-boundary/README.md): 예약/발송과 승인 변경의 경쟁, 잔고 대기 중 원천 만료, 보관 상태 반복 조작을 재현 후 수정했다. 관련111개 및 Ego34흐름·21크기 통과. 전체 게이트 수용 완료는 아니다.

## 인증 진입 화면과 최신 복구 후속

[인증 진입·실패 기본 검사](auth-entry-pages/README.md):28경로·84크기·추가3동작 통과. 경로 재방문156/181, 아직 미재방문25개이며 전체 수용 판정은 별개다. [최신101개 복구](restore-101/README.md):129테이블·1458행·객체4개 일치, 복원 앱7검사와 원본 보존 확인.

## 공개·시스템 진입 화면 후속

[기본 검사](public-entry-pages/README.md):12경로·36크기와 로딩 전환/잘못된 공유 인증2동작 통과. 게시 공지 fixture를 감사와 함께 준비했다. 재방문169/181, 미재방문12개이며 기본 검사를 전체 수용으로 집계하지 않는다.

## 최신 전체 회귀

[카카오 경계 수정 뒤 전체 회귀](regression-1748/README.md):115파일1,748개 모두 통과. 이후 문자/이메일 수정의 검증은 별도로 기록한다.

## 문자·이메일 기한과 발송 임대 후속

[발송 직전 경계](transport-expiry/README.md): 실패7건 재현 후 신규11개 및 영향 범위143개 통과. 문자·메일도 발송 직전 기한을 재검사하고, 미발송 임대 만료는 예약을 유지해 안전하게 재처리한다. 수동 재요청 원장 분리는 다음 검증 대상이다.

## 수동 발송 재요청 정산 후속

[원장 분리](manual-attempt-ledger/README.md): 실패6건 재현 후 수정, 영향 범위 서버142개+UI12개 통과. 새 수동 요청은 새 예약을 사용하고 중단 복구와 webhook도 같은 키로 정산한다. 공급자 결과 기록 후 재요청·늦은 결과 경계는 후속 검증한다.

## 동의 철회 화면 후속

[실제 Mock 철회 흐름](subject-withdrawal/README.md): 로컬 메일·같은 브라우저 인증 뒤 확인/결과2경로·6크기·4흐름 통과. 재방문171/181, 미재방문10이며 전체 게이트 판정은 유지한다.

## 문자 공급자 회차와 불확실 응답 후속

[회차별 결과·정산](provider-attempts/README.md): 공급자 결과 기록 뒤 수동 재요청과 응답 손실 4건을 재현해 수정했다. 회차별 영수증을 보존하고, 불확실 응답은 재전송하지 않고 늦은 서명 결과로 정산한다. 102개 신규 설치와 기존 Mock DB 업그레이드 보존 검증을 완료했다. 최종 영향 범위 8파일158개·타입·린트·빌드·Ego 기본 검사 통과 기록은 해당 폴더에 보관한다. 사용자 요청에 따라 현재 작업의 커밋·푸시 뒤 목표를 일시정지하며 전체 게이트 수용 상태는 유지한다.

## 재개 후 최신 복구

2026-10-07 사용자의 계속 진행 요청으로 작업을 재개했다. [102개 복구 결과](restore-102/README.md): Mock DB129테이블1,680행·암호화 객체4개가 새 복원본과 일치하며, 앱7검사 및 원본 보존 검증을 통과했다. 이전 일시정지는 해제된 사용자 요청이며, 앞으로 새 정지 요청이 없는 한 잔여 작업을 이어간다.

[채널 공통 상태 문구](channel-status/README.md): 문자·알림톡에도 SMTP와 로컬 메일함으로 표시되던 결과·취소 안내를 공급자 접수·로컬 전달로 정정했다. 타입·린트·빌드·상태 API 검증은 통과했다. 기존 Ego56 공간을 찾을 수 없어 브라우저 공간 선택 응답을 기다리며 서버 검증은 계속한다.

[화면 근거 집계](page-coverage.json)는 별도로 커밋된 전문가 회사 선택 검증의 파일 해시를 확인해 연결했다. 누적172/181경로, 미연결9개이며 이번에 새 브라우저 검사를 실행했다는 뜻은 아니다. 모든 경로의 원본·전체 상호작용 수용 완료로 표시하지 않는다.

[파일 검사 사전 점검](scanner-preflight/README.md)을 추가했다. 실제 정상 파일·EICAR 검사와 서비스 부재·설정/증거 경로 거절을 확인했다. 서비스가 없으면 마이그레이션과 본시험에 들어가지 않는다. 발신번호 상세의 이메일 전용 표현도 추가 정정했다.

## 재개 후 의존성 정리와 회귀 증거

[회귀·의존성 감사](resumed-validation/README.md): 초기 전체115파일1,774개 중 파일 검사 서비스 부재로 첨부13개 실패, 정상화 후 해당81개 모두 통과했다. 서로 다른 실행의 증거를 연결하며 단일 전체 성공으로 표시하지 않는다. CLI와 개발 의존성220개를 제거하고 기존 CSS·MIT 라이선스를 보존했다. 타입·린트·빌드는 통과했다. 운영 취약점0, 전체 개발 도구 포함high5는 공식 수정 버전 부재로 남아 있다.

[재개 후 순서](../../planning/08-resumed-work.md)에 새 정지 요청 없이 이어갈 작업과 미완료 수용 범위를 기록했다.

## 조직 이메일 등록 실패 원자성 후속

[등록·로그인 롤백](org-registration-atomicity/README.md): 제품 문제5개를 재현한 뒤 등록 쓰기와 SSO 로그인/JIT/감사를 같은 트랜잭션으로 묶었다. 최종 영향 범위7파일220개·타입·린트·빌드와 실제 HTTP2개 통과. 이전1,774개 전체 회귀와는 별도 검증이다.
