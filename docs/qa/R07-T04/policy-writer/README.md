# R07 SSO 로그인 정책 저장·화면 체크포인트

현재 정책 조회/영향·이메일 재인증·저장 API와 원본 두 경로의 정책 UI를 구현했다. 전체 R07 또는 전 사이트 완료가 아니다. 원본 서버의 미확인 predicate와 독립 구현 조건을 구분한다.

## 구현

- `GET /api/v1/security/sso-policy`: 정책·버전·화면 회사 ID·현재 구독·인증 방식/시각·직접 소속 구성원의 연결/미연결 수. 개인 이메일·공급자 비밀은 반환하지 않는다.
- `POST /api/v1/security/sso-policy/challenge`: 직접 owner/security, security.write, 현재 불변 상품의 기능 권한, 해당 회사 공급자의 최근5분 실제 SSO 근거 확인. 회사/user/session/version/선택mode/현재email에 결합한 6자리 HMAC 코드, 5분·5회·분당1회/시간10회, 암호화 메일과 감사 원자 저장.
- `PUT /api/v1/security/sso-policy`: 현재 권한·회사·구독·정책·코드·인증 근거를 다시 검사하고 코드 소비/버전/감사 원자 저장. 실패 횟수는 오류 응답 전에 커밋한다. 성공·오답 감사 실패와 최종 기한 초과는 관련 변경을 롤백한다.
- 메일은 실제 발송 직전 현재 회사/사용자/세션/역할/정책/인증/구독/lease/기한을 재검사한다. 이 메일은 업무 발송 동의와 별개의 인증 메일이다.
- `/security/sso`, `/security/sso/setting`: NONE/Microsoft/Google 선택·영향·재인증·오류/충돌/만료·미저장 입력 보호. 독립 공급자/디렉터리 화면은 `/security/sso/providers`로 분리했다.
- 다른 탭의 회사/세션 변경을 막기 위해 화면 tenantId를 요청에 명시한다. 정책 응답 회사와 ApplicationContext 회사가 다르면 편집 폼을 렌더링하지 않는다.
- 기존 구독 상품에는 기능을 자동 부여하지 않는다. 구독 만료로 저장된 제한이 풀리지 않는다. 제한 공급자 교체는 기존 공급자의 최근 인증으로 NONE 저장 후 새 공급자 인증을 거치는 독립 설계다.

## 검증

- [최종 회귀93개](../../R07-T02/policy-writer/regression.json): 새 정책41 + 기존 집행14 + 서명 근거2 + 기능 권한27 + 초대 권한9. PostgreSQL에서 회사/사용자/세션/mode/version/email 결합, 5회 실패, 중복 저장, 감사 실패, 최종 인증/구독 기한 롤백, 여러 탭 회사 변경을 검사했다.
- [메일·공급자·계약35개](../../R07-T02/policy-writer/mail-regression.json): 메일감사10·공급자21·계약4. 위93개와 테스트 파일 중복 없음. **합계8파일128개 통과.** 과거 전체1,834개 결과를 이번 전체 재실행으로 집계하지 않는다.
- [실제 HTTP13개](http.json): 계정 생성/로그인, 연결 계정만 있는 세션 거절, 조회, 이메일 요청, 발급 간격 제한, 실제 scoped worker의 로컬 메일, 오답·정답·재사용·세 페이지200.
- [재시작 HTTP](http-after-restart.json) 및 [읽기 전용 DB 대조](verified.json): GOOGLE v1·challenge1/오답1/소비완료·합성 proof1·감사9 보존. 상태 해시: `45fee7c44d9ff3eb45a4850df109af22b5af503cba8dae4dbb8e93e294ba928e`.
- migration107/Prisma133모델. [개발 DB](../../R07-T01/policy-writer/catchsecu_dev-contract.json)와 [테스트 DB](../../R07-T01/policy-writer/catchsecu_test-contract.json)의 예상밖 스키마 차이0; 의도된 SQL 전용 FK1 유지.
- `.next-rea-policy` 최종 production 빌드·전체 TypeScript·변경 ESLint 오류/경고0. OpenAPI310경로/444작업·156 handler·미연결0. 활성계획186원본/21부가/107작업·의존순환0.
- [독립 읽기 검토](read-only-review.json): Mail export와 여러 탭 회사 오적용/재조회 후 문맥 불일치를 수정하고 재검토했다. 브라우저 검증을 대신하지 않는다.

## 범위와 남은 검증

HTTP fixture의 공식 endpoint 설정, 사전검사 통과 값, 최근 Google 세션 근거는 **명시적 합성 DB 준비**다. 실제 Google 로그인/외부 preflight 성공을 주장하지 않는다. 프로토콜 서명 검증은 별도 통제된 시험으로 확인했다. 메일은 실제 로컬 outbox 파일이며 외부 SMTP 수신 증거가 아니다.

Ego 기존 공간3이 없어지고 목록이 비어 새 공간 생성 답변을 기다린다. [브라우저 대기 근거](../policy-enforcement/browser-pending.json). 새 UI의 여러 탭/실패·재시도/입력 보호/모바일/키보드 수용, 로컬 HTTPS IdP 실제 브라우저 흐름, 외부 Google/Microsoft/공식기관 및 전체20개 인증경로 수용은 남아 있다. 활성107작업은51진행/56계획/0완료 유지.

## 시험 수정 이력

초기 fixture가 기존 DB의 trial7일 규칙과 마지막 owner 유지 제약을 위반했다. 운영 제약은 유지하고 시험 데이터를 수정했다. 독립 검토로 발견한 tenant 결합 문제는 동일 사용자의 A/B 회사 라우트 회귀로 방어했다. 최종 재시작 직후 첫 HTTP 조회는 서버 ready 이전 ECONNREFUSED였으며 ready 확인 뒤 재조회200·해시 일치를 확인했다. [이전 HTTP](http-before-tenant-binding.json)는 회사 결합 보완 전 기록이며 최종 수용으로 집계하지 않는다.
