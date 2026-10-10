"""Append current execution evidence without rewriting legacy task completion."""
from pathlib import Path
import json
import shutil
from collections import Counter

root = Path(__file__).resolve().parents[1]
plan = root / 'docs/planning/09-rea-fullstack'
tasks = json.loads((plan / 'tasks.json').read_text())
notes = {
    'R07-T01': ('기존6모델81컬럼23제약22인덱스3트리거 dev/test 대조. 원본 NONE/AZURE/GOOGLE 정책과 독립 IdP 관리를 구분했으며 원본 정책 모델/SSO feature gate는 후속 필수다.', ['docs/qa/R07-T01/model-audit/catchsecu_dev.json', 'docs/qa/R07-T01/model-audit/catchsecu_test.json', 'docs/planning/09-rea-fullstack/sso-source-evidence.md']),
    'R07-T02': ('공급자/디렉터리 생성 idempotency·직접owner·현재권한·원자적 PATCH/티켓/캐시폐기 구현. 회귀232와 추가CRUD16의 중복제거 고유236통과, 실제HTTP35. 원본 정책·공식기관 어댑터는 미완료.', ['docs/qa/R07-T02/core/regression.json', 'docs/qa/R07-T02/core/crud-final.json', 'docs/qa/R07-T04/management-flow/http.json']),
    'R07-T03': ('공급자/가상디렉터리 CRUD·읽기전용·네트워크 재시도·입력보호·409최신복구·검색/페이지/키보드·9폭 넘침0 확인. 원본 로그인 정책 화면과20개 인증경로 전체수용은 남음.', ['docs/qa/R07-T04/management-flow/browser.json', 'docs/qa/R07-T04/management-flow/responsive.json']),
    'R07-T04': ('실제 HTTP35·Ego12관측·브라우저 비밀번호 재인증·6모델·고유236서버시험·빌드/type/lint 통과. 공급자3/구성원12/감사32·재시작해시 일치. 원본정책/외부IdP/공식기관 전체수용 미완료.', ['docs/qa/R07-T04/management-flow/README.md', 'docs/qa/R07-T04/management-flow/verified-after-restart.json']),
    'R00-T04': ('활성186+부가20경로·618개 정상/거부/실패 시나리오 계약. 읽기전용 DB fixture 대조·매개변수5개 시험 통과. 선행 데이터/인증 준비45경로는 blocked; 실제CRUD 통과와 구분.', ['docs/qa/R00-T04/active-fixtures/README.md', 'docs/qa/R00-T04/active-fixtures/result.json']),
    'R00-T01': ('186개 선언 일치. 34개 메뉴를 실제 production UI에서 관측하고 로그아웃/재로그인을 별도 검증. 모달/동적경로 행동표 보완 중.', ['docs/qa/R00-T01/route-contract-check.json', 'docs/qa/R00-T01/menu-runtime/inventory.json']),
    'R00-T02': ('440개 API의 진입점·메서드·정책 누락0. 초기 실패·복구 이력 보존. 구조화 처리방침 시점 전체122파일1834개 통과. 후속 회사/서비스135개·접근요청89개 회귀 통과(실행 간 중복 있음). 빌드/typecheck 통과·lint 오류0/기존경고1. 전체 경로 수용과 구분.', ['docs/qa/R00-T02/README.md', 'docs/qa/R00-T02/full-tests-policy-final.json', 'docs/qa/R00-T02/quality-gates/current.json', 'docs/qa/R03-T02/authority/regression-final.json', 'docs/qa/R03-T02/access-authority/regression-complete.json']),
    'R01-T01': ('dev/test104개 checksum 일치. 격리DB 빈설치·업그레이드·seed반복·FK/unique·131테이블/암호화파일 복구 통과. 스키마 예상밖 차이0·SQL전용FK1개 실제검사·최종 회귀88개 통과.', ['docs/qa/R01-T01/db-rehearsal/result.json', 'docs/qa/R01-T01/schema-alignment/README.md', 'docs/qa/R01-T01/schema-alignment/regression-final.json']),
    'R01-T03': ('서명 검증 ClamAV1.5.4·curl8.22.0 사용자폴더 설치. TLS 경고 해결·공식6개 시험·실제 파일/EICAR/권한41개 통과. 실제 HTTPS 공식정의 다운로드·서명·최신성·socket0600 검증. 관리자 설치 불필요.', ['docs/qa/R01-T03/scanner-runtime/source-build/runtime-final.json', 'docs/qa/R01-T03/scanner-runtime/files-restored-tests.json']),
    'R01-T05': ('Node/DB/검사 서비스/마이그레이션 사전점검 명령. ClamAV 복구 후 dev 런타임 검사 통과. 운영 외부연동 수용과 구분.', ['docs/qa/R01-T05/preflight/catchsecu_dev.json']),
    'R02-T01': ('dev/test8개 인증모델73컬럼21제약24인덱스7트리거 실제 대조. 이메일/계정/세션 unique·유예 복합FK·credential 이력/세션폐기/감사 트리거 확인, 신규 migration 없음.', ['docs/qa/R02-T01/model-audit/README.md', 'docs/qa/R02-T01/model-audit/catchsecu_dev.json', 'docs/qa/R02-T01/model-audit/catchsecu_test.json']),
    'R02-T02': ('인증 링크 재사용 성공3실패 재현→사용자 잠금 내 단일 성공/재사용 거부·안전 callback 유지 수정. 인증141개+정책경계64개, 총12파일205개 통과. 원자적 감사·만료·세션폐기 포함; 전체 수용은 후속.', ['docs/qa/R02-T02/authentication/README.md', 'docs/qa/R02-T02/authentication/verification-replay-after.json', 'docs/qa/R02-T02/authentication/policy-boundaries.json']),
    'R02-T03': ('실제UI 가입/링크인증/암호재설정/OTP·TOTP·복구코드/해제/암호변경 확인. 영문 복구오류·3화면 재시도·정책 미확인 폼·모바일 약관 줄바꿈 보완. 인증15경로45폭관측·키보드 확인. 모든 정책/원본 조합은 후속.', ['docs/qa/R02-T03/authentication/README.md', 'docs/qa/R02-T03/authentication/routes-responsive.json', 'docs/qa/R02-T03/authentication/resource-failure-after.json', 'docs/qa/R02-T03/authentication/signup-final-check.json']),
    'R02-T04': ('새합성계정 UI·개별메일job5건 실제 로컬전달·독립HTTP 다른세션 폐기·DB암호이력2/MFA해제/감사67건·서버재시작 지문 일치. 단위/통합205개·타입/린트/빌드 통과. 실제외부메일·별도브라우저프로필/전체조합 수용은 남음.', ['docs/qa/R02-T04/authentication/README.md', 'docs/qa/R02-T04/authentication/verified-after-restart.json', 'docs/qa/R02-T04/authentication/revoked-second-session.json']),
    'R03-T01': ('dev/test6모델66컬럼29제약24인덱스 대조. 회사·서비스·멤버·권한·접근요청·사업자파일의 tenant FK/unique/상태/삭제 규칙을 실제 메타데이터와 검사. 신규 migration 없음. 운영 폐쇄·전체 조합은 후속.', ['docs/qa/R03-T01/model-audit/README.md', 'docs/qa/R03-T01/model-audit/catchsecu_dev.json', 'docs/qa/R03-T01/model-audit/catchsecu_test.json']),
    'R03-T02': ('회사/서비스 잠금 대기 중 세션·멤버·MFA 변경과 최종 만료 재검사·회사등록 경합 수정, 관련135개 통과. 접근요청에도 현재 권한/최종 만료·원자성·페이지 보정·승인대상 활성 검사, 관련89개 통과. 전체 조합 수용은 후속.', ['docs/qa/R03-T02/authority/README.md', 'docs/qa/R03-T02/authority/regression-final.json', 'docs/qa/R03-T02/access-authority/README.md', 'docs/qa/R03-T02/access-authority/regression-complete.json']),
    'R03-T03': ('회사/서비스 CRUD·첨부·폐쇄요청/취소·409·입력보호·컨텍스트전환·모바일 확인. 접근요청4건 생성/취소/거절/충돌복구/승인·답변보호·회원표 즉시갱신·실패재시도·조회자거부·390/768/1440폭 확인. 전체 역할/다중페이지는 후속.', ['docs/qa/R03-T03/company-flow/README.md', 'docs/qa/R03-T03/service-flow/README.md', 'docs/qa/R03-T03/access-flow/README.md']),
    'R03-T04': ('회사/서비스 HTTP23개·감사14건·파일바이트·재시작 지문 일치. 별도 접근요청 HTTP19개·요청4건/권한1건/감사8건·새로그인·브라우저·서버재시작 지문 일치. 전체 R03 수용과 구분.', ['docs/qa/R03-T04/management-flow/README.md', 'docs/qa/R03-T04/management-flow/verified-after-restart.json', 'docs/qa/R03-T04/access-flow/README.md', 'docs/qa/R03-T04/access-flow/verified-after-restart.json']),
    'R04-T01': ('dev/test5모델43컬럼20제약21인덱스7트리거 대조. tenant 복합FK·멤버/권한/전문가 unique·pending 초대 lower(email) 부분unique·마지막 owner 잠금 확인. 신규 migration 없음.', ['docs/qa/R04-T01/model-audit/README.md', 'docs/qa/R04-T01/model-audit/catchsecu_dev.json', 'docs/qa/R04-T01/model-audit/catchsecu_test.json']),
    'R04-T02': ('현재 권한·세션·MFA/기한·테넌트·마지막 owner·초대 중복/만료/재수락·전문가 범위/회수 PostgreSQL5파일68개 통과. 새HTTP 권한11개·최종11개와 DB감사 대조; 서버 계약 유지.', ['docs/qa/R04-T02/members/README.md', 'docs/qa/R04-T02/members/baseline.json', 'docs/qa/R04-T04/members-flow/boundaries.json']),
    'R04-T03': ('구성원/전문가 입력보호·수락조회 재시도/토큰별 상태·제외/이전/초대409 복구 보완. 실제 초대/재초대·정지/회수·소유권 왕복·전문가 배정/만료/재배정/회수·검색/실패재시도 확인. 원본4경로12폭+운영모달3폭·Tab6단계. 모든 역할/원본 동등성은 후속.', ['docs/qa/R04-T03/members-flow/README.md', 'docs/qa/R04-T03/members-flow/browser-after-restart.json', 'docs/qa/R04-T03/members-flow/expert-reassigned-revoked.json']),
    'R04-T04': ('새합성회사·멤버3/초대3/전문가배정1·감사45건·로컬메일4건/구버전job취소1건을 독립DB 대조. 권한HTTP11개·최종HTTP11개 및 재시작 지문 일치. 타입/린트/빌드 통과. 다중페이지/외부메일·별도브라우저 등 후속.', ['docs/qa/R04-T04/members-flow/README.md', 'docs/qa/R04-T04/members-flow/verified-after-restart.json']),
    'R06-T01': ('dev/test4개 보안모델42컬럼21제약7인덱스4트리거 대조. CIDR 정규화/회사 unique, MFA 복합FK/암호화/24시간/자기예외/버전 제약 확인. 인증3모델은 R02 근거 참조; 신규 migration 없음. 후속: BillingPlanVersion capabilities 불변배열·CHECK 및105번째마이그레이션 dev/test검증. 예상밖 스키마차이0.', ['docs/qa/R06-T01/model-audit/README.md', 'docs/qa/R06-T01/model-audit/catchsecu_dev.json', 'docs/qa/R06-T01/model-audit/catchsecu_test.json', 'docs/qa/R06-T01/security-entitlements/README.md']),
    'R06-T02': ('정책 조회의 오래된 권한8실패 재현→현재 actor/기한 트랜잭션 재검사로 수정. 관련104개+파일/worker77개(시점 구분) 통과. 실제 IPv4/IPv6/위조IP20개·MFA 자연만료8개 확인. Enterprise 기능gate는 후속 필수. 후속: 기능별구독 gate 전변경/재시도/우회 연결. 실제 만료worker 교착 재현→회사/구독 잠금순서 수정. 관련 고유225시험 통과.', ['docs/qa/R06-T02/security/README.md', 'docs/qa/R06-T02/security/current-authority-before.json', 'docs/qa/R06-T02/security/authority-regression.json', 'docs/qa/R06-T02/security/files-workers.json', 'docs/qa/R06-T02/security-entitlements/README.md', 'docs/qa/R06-T02/security-entitlements/worker-and-features-final.json']),
    'R06-T03': ('IP 검색 포커스/모바일 표·오류노출/입력보호·정책/예외409복구·기한 편집 보완. 실제 CRUD·정책6탭/초기화·21건 페이지/검색/정렬·8경로24폭/모달3폭 확인. 요금제별 제한 UI/API는 미완료. 후속: 포함/미포함/만료/시작전/미가입/MFA전용 상태별18화면, 만료8경로24폭, 상품/구독6폭, 실제IP/MFA저장·만료전편집창차단 확인.', ['docs/qa/R06-T03/security-flow/README.md', 'docs/qa/R06-T03/security-flow/routes-responsive.json', 'docs/qa/R06-T03/security-flow/ip-search-focus-after.json', 'docs/qa/R06-T03/security-flow/browser-after-restart.json', 'docs/qa/R06-T04/security-entitlements/README.md']),
    'R06-T04': ('정책v5/기본값·IP제한v1/규칙v3·예외0·관리자MFA/감사126건·유휴세션 폐기 DB대조. HTTP최종8개·새서버 상태해시 일치. 실제TOTP/자연만료와 fixture 시계를 구분. 원본/외부 전체수용은 남음. 후속: 기능권한 HTTP23+만료6, 실제IPv6/IP·MFA보호유지, 회사6/구독5/감사31, 재시작해시 일치. 원본상품매핑·외부PG 수용은 남음.', ['docs/qa/R06-T04/security-flow/README.md', 'docs/qa/R06-T04/security-flow/verified-after-restart.json', 'docs/qa/R06-T04/security-flow/ip-boundaries.json', 'docs/qa/R06-T04/security-flow/mfa-expiry.json', 'docs/qa/R06-T04/security-entitlements/verified-after-restart.json']),
    'R08-T03': ('실제 폼 생성·질문 편집·단계 저장·재조회. 보유기간 미지정 안내를 서비스 규칙 우선 적용과 일치시킴.', ['docs/qa/R08-T04/browser-flow/public-submission.json']),
    'R08-T04': ('Ego에서 생성→이름만 지정한 게시 거부→이메일 항목 추가→게시→익명 제출→관리자 응답 조회. 독립 DB 대조 통과. 전체 질문/템플릿 수용은 남음.', ['docs/qa/R08-T04/browser-flow/db.json']),
    'R09-T03': ('직접 생성한 폼의 단계 설정에서 실제 게시 후 공유 URL을 얻고 익명 응답까지 확인. 전체 승인/회수/고정URL 수용은 남음.', ['docs/qa/R08-T04/browser-flow/published.png']),
    'R05-T01': ('dev/test6모델70컬럼28제약22인덱스10트리거 대조. 본인/회사 복합FK·진행 중 검토 unique·메시지 불변성·파기 승인·계정폐쇄/마지막 owner/admin 제약 확인. 신규 migration 없음.', ['docs/qa/R05-T01/model-audit/README.md', 'docs/qa/R05-T01/model-audit/catchsecu_dev.json', 'docs/qa/R05-T01/model-audit/catchsecu_test.json']),
    'R05-T02': ('프로필/계정폐쇄/현재권한/활동검토/SSO 복구104개와 SSO121개, 7파일225개 PostgreSQL 시험 통과. 독립 HTTP13개 본인/회사/역할/버전/중복/소유자 폐쇄 거부와 DB 무변경 확인. 서버 계약 유지.', ['docs/qa/R05-T02/profile/README.md', 'docs/qa/R05-T02/profile/baseline.json', 'docs/qa/R05-T02/profile/sso-integration.json', 'docs/qa/R05-T04/profile-flow/boundaries.json']),
    'R05-T03': ('프로필/기기 조회 재시도·프로필/검토/탈퇴 입력보호·409복구·파기 오류 노출·탈퇴 완료 안내 보완. 실제 프로필/세션/SSO 해제/검토 요청·답변·완료·취소·파기·보존/탈퇴 확인. 원본6경로18폭·탈퇴모달3폭/Tab4단계. 원본 전체 동등성은 남음.', ['docs/qa/R05-T03/profile-flow/README.md', 'docs/qa/R05-T03/profile-flow/closure-conflict.json', 'docs/qa/R05-T03/profile-flow/destruction-conflict.json', 'docs/qa/R05-T03/profile-flow/route-widths.json']),
    'R05-T04': ('합성계정 폐쇄v6·세션/자격증명/권한0·검토3건/메시지5건·감사75건·로컬알림1건 독립 DB 대조. HTTP13+8개 및 새서버8개·지문 일치. 모델/서버225개·타입/6파일린트/빌드 통과. fixture 시계/SSO 설정·외부 미검증 구분.', ['docs/qa/R05-T04/profile-flow/README.md', 'docs/qa/R05-T04/profile-flow/verified-after-restart.json']),
    'R10-T01': ('게시 수탁자 출처 보존에 이어 DocumentPolicyDraft·복합FK·유형 guard·DTO 구현. dev103→104에서 기존7테이블 hash 보존. 원본102필드 중98개 정규화·수탁유형2개 부모 구분; 초기화 배열2개 서비스 전체 항목에 연결·재수탁자 항목/근거 추가·과거JSON 모양 보존. 원본 전체 동등성은 계속 검토.', ['docs/qa/R10-T01/public-recipient-snapshots/README.md', 'docs/qa/R10-T01/structured-policy/README.md', 'docs/qa/R10-T01/structured-policy/migration-after.json', 'docs/qa/R10-T01/source-field-audit/implementation-map.csv', 'docs/qa/R10-T01/source-field-audit/service-item-source.json']),
    'R10-T02': ('목적 수탁자 공개목록·초안변경 영향·100건 전처리 누락 수정. 구조화 초안 저장/제거/과거PATCH 보존·게시 검증·숨은 입력 공개 제외·실패 롤백 추가. 문서/PDF55개와 폼연결23개 회귀 통과. 후속 수탁 항목·재수탁자 저장/게시/PDF·권한58개, 네트워크 오류3개 통과. 전체 문서 API 수용 계속.', ['docs/qa/R10-T02/public-recipient-snapshots/README.md', 'docs/qa/R10-T01/structured-policy/server-first.json', 'docs/qa/R10-T01/structured-policy/form-binding-regression.json', 'docs/qa/R10-T02/trustee-items/README.md']),
    'R10-T03': ('수집 근거·문서·문구·표시 설정 입력보호/409 복구. P/C/OC 공개경로 연결. UI CRUD·문구적용·게시·연결회수거부·PDF·390/768/1440폭 확인. 국외이전 게시/비공개/보관/복원과 공개7+4경로·390/768/1440폭 확인. 구조화88입력·재위탁 추가/삭제·409복구·미완성 게시거부·게시2본·모바일도 확인. 후속 서비스 항목 초기화·재수탁자 추가/삭제저장/재게시·실패재시도 입력보존·한국어 오류·390/768/1440폭도 확인. 전체 역할/원본 동등성은 남음.', ['docs/qa/R10-T03/catalog-flow/README.md', 'docs/qa/R10-T03/document-flow/README.md', 'docs/qa/R10-T03/clause-flow/README.md', 'docs/qa/R10-T04/overseas-flow/README.md', 'docs/qa/R10-T04/structured-policy/README.md', 'docs/qa/R10-T03/trustee-items/README.md']),
    'R10-T04': ('기존 수집 근거/문서 검증 유지. 문구·표시 설정 HTTP29개·DB감사18건·문구6/처리방침5/표시5·2 개정 및 재시작 지문 확인. 국외이전 HTTP30개·감사10건·PDF3개·출처6건·재시작 지문도 일치. 구조화 처리방침 HTTP14개·감사6건·PDF2개·재시작 지문도 일치. 후속 재수탁자 문서 v5/초안3/게시2본·감사5건·PDF2개·서버재시작 지문 일치, 과거 구조화 문서 그대로 보존. 전체유형/역할 수용 계속.', ['docs/qa/R10-T03/catalog-flow/db-after-restart.json', 'docs/qa/R10-T03/document-flow/db-after-restart.json', 'docs/qa/R10-T04/display-flow/verified-after-restart.json', 'docs/qa/R10-T04/overseas-flow/verified-after-restart.json', 'docs/qa/R10-T04/structured-policy/verified-after-restart.json', 'docs/qa/R10-T04/trustee-items/verified-after-restart.json']),
    'R11-T03': ('응답 상세의 미저장 입력 유실 재현 후 닫기/취소 보호·409 입력보존·최신 재조회 구현. 실제 UI 충돌/복구·메모 닫기 보호 통과.', ['docs/qa/R11-T04/browser-flow/conflict-recovered.json']),
    'R11-T04': ('정정/사유/메모CRUD·실제PDF다운로드/DB해시·409복구·새로고침·새서버 유지. 정정3건/메모0건과 감사CSV를 독립DB 대조. 첨부·전체수용은 남음.', ['docs/qa/R11-T04/browser-flow/README.md', 'docs/qa/R11-T04/browser-flow/db-after-conflict.json']),
    'R16-T04': ('HTTP21개 및 별도DB·브라우저CRUD·충돌·미저장 입력 보호·viewer거부·재시작 유지 통과. 실제 응답과 영수증120일 적용도 DB 확인. 전체 파기 수용은 남음.', ['docs/qa/R16-T04/route-connection/README.md', 'docs/qa/R08-T04/browser-flow/db.json']),
    'R19-T03': ('/alimtalk/channels를 실제 기존 채널CRUD 화면에 연결. UI 생성/수정/새로고침/삭제 및 재시작 후 삭제 유지 확인. 외부 공급자 미검증.', ['docs/qa/R19-T03/route-connection/browser.json']),
    'R22-T01': ('기존 폼/응답/파일/내보내기 관계로 조회필드를 정의. 현재회사/서비스/전체감사권한 경계를 명시하고 원문/IP/외부고객번호를 추정하지 않음.', ['docs/qa/R22-T02/audit-resources/README.md']),
    'R22-T02': ('실제 폼 이름·응답ID를 회사/폼 감사 API·CSV에 연결. 다른회사/서비스/없는참조/제한역할 차단·원문비노출. PostgreSQL/화면48개 통과.', ['docs/qa/R22-T02/audit-resources/tests-final.json']),
    'R22-T03': ('일반 로그 상세와 실제 폼/응답 필드 연결. 403을0건으로 표시하지 않음. 실제 UI검색/상세/CSV·390/768/1440폭 검증.', ['docs/qa/R22-T02/audit-resources/browser.json', 'docs/qa/R22-T02/audit-resources/responsive.json']),
    'R22-T04': ('실제 정정3건을 화면/CSV/독립DB에서 대조. viewer는 앱 role gate에서차단. 전체종류·검토·보존 수용은 남음.', ['docs/qa/R22-T02/audit-resources/viewer-denied.json', 'docs/qa/R11-T04/browser-flow/db-after-conflict.json']),
    'R23-T03': ('/log/month-monitoring에서 실제 월 마감 저장·점검근거·CSV200·DB스냅샷 및 재시작 유지 확인. 전체 통계 수용은 남음.', ['docs/qa/R23-T03/route-connection/browser.json']),
    'R25-T04': ('격리 DB에 실제pg_dump/pg_restore 및 암호화파일복사/복호화hash 대조. 131테이블 동일. 운영자료·키복구·worker재개·런북 최종수용은 남음.', ['docs/qa/R01-T01/db-rehearsal/result.json']),
}
text = (plan / 'TASKS.md').read_text()
for task in tasks:
    if task['id'] not in notes:
        continue
    note, evidence = notes[task['id']]
    for file in evidence:
        if not (root / file).is_file():
            raise RuntimeError(f'Missing evidence: {file}')
    if task['status'] != 'completed':
        task['status'] = 'in_progress'
    task.update(progress_note=note, progress_evidence=evidence, updatedOn='2026-10-10', local_status='partial_verified')
    if task['id'].startswith(('R04-', 'R05-', 'R06-', 'R07-')):
        task.update(source_fidelity_status='partial_observed', external_status='not_applicable' if task['stage'] == 'model' else 'external_pending')
    text = text.replace('### [ ] ' + task['id'] + ' ', '### [~] ' + task['id'] + ' ')
(plan / 'tasks.json').write_text(json.dumps(tasks, ensure_ascii=False, indent=2) + '\n')
(plan / 'TASKS.md').write_text(text)
counts = Counter(task['status'] for task in tasks)
out = root / 'docs/qa/rea-fullstack-2026-10-10'
out.mkdir(parents=True, exist_ok=True)
shutil.copy2(root / '.local/rea-fullstack/build-local-preview.log', root / 'docs/qa/R00-T02/build-local-preview.log')
summary = f'''# 전 페이지 풀스택 구현·검증 진행 기록

2026-10-10. 사용자 승인 후 실행 중이다. 전체 완료가 아니다.

- 활성 계획: 원본186개 선언(구체184·fallback2), 부가20경로,26개 Phase·107작업.
- 새 수용 상태: 완료{counts['completed']}·진행{counts['in_progress']}·계획{counts['planned']}. 기존72작업의 완료 이력은 별도 보존한다.
- 구현: 보유기간 규칙 관리, 월마감·알림톡 채널 API/UI 연결, 새 경로/fallback404, 보유기간 안내. 감사로그 실제 폼/응답 참조·CSV·상세. 응답/메모 미저장 입력 보호·수정 충돌 복구. 시드 반복 시 기존상태 덮어쓰기 수정.
- 검증: 보유기간 실제HTTP21개/단위·DB8개, 감사 PostgreSQL/화면48개, browser CRUD·충돌·권한·모바일·새프로세스 유지. 폼 생성·게시·익명 응답·정정·메모CRUD·실제PDF와 DB해시·CSV/DB대조.
- 정적 계약: 440개 operation의 handler·메서드·정책 누락0. 메뉴34개 렌더링과 로그아웃별도 확인. 이는 모든CRUD 수용 완료와 다르다.
- 활성fixture206경로·618개 시나리오 계약과 실제DB 참조 대조. 준비45경로는 통과로 집계하지 않음. 수집근거/문서 입력 보호·충돌 복구 및 P/C/OC 공개경로 연결. 실제UI CRUD·문서게시3본·회수거부·PDF한글/해시·재시작 확인.
- 현재 dev/test migration104개 checksum 일치. 이번 실행에서 과거SQL/적용기록을 수정하지 않았다.
- 격리 PostgreSQL에서 빈설치104개·103→104 업그레이드·seed반복·기존보관상태 유지 통과. pg_dump/pg_restore 후131테이블과 암호화파일 해시 대조 통과.
- Prisma/DB 메타데이터 정합성 보완. dev/test 예상밖 차이0·SQL전용FK1개 실제검사. 중간 ORM 관계의 회사생성 회귀를 재현·철회하고 최종88개 시험 통과.
- 전체 서버시험 첫 실행:1605통과·157실패·34미실행 보존. ClamAV 소스 설치 후 실패18파일의400개 시험 모두 통과. 전체 재실행1814통과/1실패와 임시DB객체 정리 후 가져오기41개 통과를 별도 보존한다. 관리자 설치는 더 이상 필요하지 않다.
- 문구·서비스 표시 설정 입력 보호와409복구, 내부처리방침 연결/해제/회수/재게시, 외부링크 저장/해제 UI 확인. HTTP29개·감사18건·서버 재시작 지문 일치. 관련 회귀34개 통과.
- 국외이전 실제 UI 게시3본·비공개/보관/복원·공개7+4경로·HTTP30개·PDF3개·재시작 지문 확인. 게시 수탁자 출처 보존 및 필터 전100건 제한 누락을 수정해 관련37개 회귀 통과.
- 구조화 처리방침104번째 migration·DTO·88개 입력·원자적 CRUD·숨은 입력 공개 제외·게시2본/PDF/재시작 확인. 해당 시점 전체122파일1,834개 모두 통과했다.
- 후속 회사/서비스 CRUD·첨부 다운로드/교체/삭제·폐쇄요청/취소·409복구·미저장 입력과 컨텍스트 전환 보호·모바일 검증. 관련7파일135개, HTTP23개·감사14건·서버재시작 지문 일치. 전체시험1,834개는 이 후속 변경 전 결과다.
- 접근요청 권한/세션 경합 수정·최종 관련89개 통과. 실제 UI 생성/취소/거절/승인·409복구·실패재시도·권한반영, HTTP19개·요청4건/권한1건/감사8건·재시작 지문 확인. dev/test6모델66컬럼·29제약·24인덱스 대조.
- 수탁 항목 초기값·재수탁자3필드 저장/게시/PDF 보완. 관련58개+네트워크3개 시험, 실제UI 추가/삭제저장/재게시·실패재시도 입력보존·390/768/1440폭, 게시2본/감사5건/새서버 지문 일치. 과거 구조화 문서도 그대로 유지.
- 인증 링크 재사용 거부·한국어 오류·3개 조회 실패 재시도·모바일 약관 보완. 관련12파일205개, 실제 UI 가입/암호/MFA 흐름·인증15경로45폭관측·로컬메일5건·감사67건·새서버 상태 지문 일치. 외부 SMTP와 모든 정책 조합은 별도 미완료.
- production 빌드는 로컬메일/가상결제 미리보기 설정으로 통과했다. 최종 설치환경은 외부 공급사 설정 후 별도 검증한다.
- 구성원·초대·전문가 입력보호/재시도/409복구 보완. 서버68개·모델5개·실제UI 역할/회수/정지/재초대/소유권/전문가 만료·재배정/회수 확인. 감사45건·로컬메일4건·HTTP11+11개·재시작 지문 일치. 전체 역할/원본/외부 수용은 남음.

- 보안 정책 조회 권한 경합8개 수정·회귀104개/파일worker77개. IP/MFA CRUD·실제IPv6 차단·자연만료·정책초기화·감사126건·재시작 지문 일치. 8경로24폭 확인. Enterprise 기능gate는 후속 필수다.
- MY 프로필/활동/세션/SSO해제/검토/탈퇴 입력보호·충돌복구 보완. 서버225개·모델6개·원본6경로18폭 확인. 검토3건·폐쇄v6·감사75건·메일1건·HTTP13+8개·재시작 지문 일치. 외부/원본 전체 수용은 남음.

## 바로 보기

- [보안 정책·IP·MFA UI/DB/재시작](../R06-T04/security-flow/README.md)
- [사용자 설치 ClamAV 1.5.4 확인](../R01-T03/scanner-runtime/pkg-install/verified.json)
- [MY·프로필·활동 검토·탈퇴 UI/DB/재시작](../R05-T04/profile-flow/README.md)
- [구성원·초대·전문가 UI·DB·재시작](../R04-T04/members-flow/README.md)
- [인증 UI·DB·메일·재시작](../R02-T04/authentication/README.md)
- [상세107작업](../../planning/09-rea-fullstack/TASKS.md)
- [현재 구현 감사](../R00-T02/README.md)
- [보유기간 CRUD·브라우저·재시작](../R16-T04/route-connection/README.md)
- [실제 폼 응답 DB](../R08-T04/browser-flow/db.json)
- [응답 정정·메모·PDF·입력 보호](../R11-T04/browser-flow/README.md)
- [감사로그 서버·UI·CSV](../R22-T02/audit-resources/README.md)
- [DB 설치·업그레이드·복구](../R01-T01/db-rehearsal/README.md)
- [수집 목적·제공/수탁자 CRUD](../R10-T03/catalog-flow/README.md)
- [문서 CRUD·공개 경로·PDF](../R10-T03/document-flow/README.md)
- [문구 CRUD·처리방침 적용](../R10-T03/clause-flow/README.md)
- [서비스 표시 설정·게시본 연결](../R10-T04/display-flow/README.md)
- [국외이전·공개목록·PDF·재시작](../R10-T04/overseas-flow/README.md)
- [스키마 정합성·회귀 수정](../R01-T01/schema-alignment/README.md)
- [ClamAV 복구 의존조건](../R01-T03/scanner-runtime/README.md)
- [회사·서비스 CRUD·독립 DB·재시작](../R03-T04/management-flow/README.md)
- [접근요청·승인권한·재시작](../R03-T04/access-flow/README.md)
- [수탁 항목·재수탁자·PDF·재시작](../R10-T04/trustee-items/README.md)

모든 시험은 로컬 전용 계정/회사/수신자를 사용한다. 실제 SMS·SMTP·카카오·PG·기관 인증 등 외부 수용은 개별 증거가 필요하다.
'''
(out / 'README.md').write_text(summary)
(out / 'status.json').write_text(json.dumps({'date': '2026-10-10', 'counts': dict(counts), 'complete': False, 'evidence': notes}, ensure_ascii=False, indent=2) + '\n')
dashboard = f'''# 실행 진행판 — 2026-10-10

사용자 승인으로 상세 계획 후 구현·검증을 계속한다. 전체 완료가 아니다.

- 활성 계획107개: 완료{counts['completed']}·진행{counts['in_progress']}·계획{counts['planned']}. 기존72개 상태는 이력으로 보존한다.
- 실제 UI/HTTP/DB: 보유기간CRUD, 폼 게시·응답, 정정·메모·PDF, 감사조회/CSV, 채널CRUD, 월마감과 서버재시작 확인.
- 수집 근거CRUD·HTTP26·개정4/6·감사10 확인. 문서 게시3본·P/C/OC연결·회수거부·PDF한글/해시·감사8·재시작 확인. 문서 회귀46개 통과.
- 격리DB 설치104개·업그레이드·시드 반복·131테이블/암호화파일 복구 통과. dev/test 스키마 예상밖 차이0·SQL전용FK1개 확인·회귀88개 통과.
- 문구/표시설정 HTTP29개·감사18건·개정6/5/5·2·실제 UI·재시작 일치 확인. 관련34개 회귀 통과.
- 전체시험 첫 실행1605통과·157실패·34미실행 보존. ClamAV 복구 후 실패18파일400개 통과. 관리자 설치 불필요. 전체 재실행1814통과/1실패. 임시DB객체 정리 후 가져오기41개 통과.
- 구조화 처리방침 시점 전체122파일1,834개 통과. 이후 회사/서비스135개·접근요청89개 회귀 통과(중복 포함). 실제 UI·HTTP23개/19개·감사14건/8건·각 서버재시작 지문 일치. R03 전체 역할·다중페이지·원본 동등성 수용은 남아 있다.
- 수탁 항목/재수탁자 후속58개·네트워크3개 통과. UI·초안3개정/게시2본/감사5건/PDF2개·재시작 지문 일치. 과거 처리방침 JSON/PDF 불변도 확인.
- 인증141개+정책64개 통과. 실제가입·암호·MFA·로컬메일5건·15경로/45폭·감사67건과 재시작 지문을 확인했다. 링크 재사용, 조회실패 재시도, 한국어 오류, 모바일 약관 보완.
- 외부 SMS·SMTP·카카오·PG·기관 인증 수용은 미검증이며 통과로 집계하지 않는다.
- 구성원·전문가 후속 서버68개·권한11개·최종11개와 재시작 지문 통과. 모델5개·멤버3/초대3/배정1·감사45·메일4건을 대조했고 입력 보호/409복구/실패 재시도를 보완했다.

세부 상태는 활성 tasks.json과 docs/qa/rea-fullstack-2026-10-10/README.md를 따른다.
'''
(plan / '.Codex/goals/progress.md').write_text(dashboard)
root_progress = root / '.Codex/goals/progress.md'
previous = root_progress.read_text()
marker = '# 구현 진행 현황'
history = previous[previous.index(marker):] if marker in previous else previous
root_progress.write_text(dashboard + '\n' + history)
print(json.dumps(dict(counts)))
