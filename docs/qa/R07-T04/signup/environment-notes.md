# 로컬 가입 검증 환경

- 프로덕션 build: Node24, Next16.3.8, 83페이지 생성 성공. 운영 모드는 로컬 HTTP IdP 등록을 INSECURE_URL로 차단하는 기존 정책을 유지한다.
- 실제 RSA/JWKS/PKCE HTTP 시험은 loopback3123 합성 IdP와 개발 서버3121에서만 수행한다. 공식 Google/Microsoft 검증 또는 TLS 증거로 집계하지 않는다.
- 개발 서버는 required-server-files.json 누락으로 첫 API를500 반환했고 webpack 전환 후에도 재시작에서 재현됐다. 설치된 Next16.3.8 소스에서 RouteModule이 __NEXT_DEV_SERVER로 개발/운영 manifest를 구분함을 확인했다. 앱의 사전 loadEnvConfig가 캡처한 환경으로 재로딩할 때 이후 설정된 개발 표시가 소실되는 상황이다. QA 프로세스 시작 환경에 __NEXT_DEV_SERVER=1을 명시해 유지한다. scripts/server.ts의 시험용 webpack 옵션 변경은 제거했고 제품 소스를 이 환경 문제 때문에 변경하지 않는다.
- 첫 개발 화면 webpack 컴파일63초, 가입 API 컴파일25초가 발생했다. 동시 TypeScript/회귀 실행 중 실제 가입 저장이29초 걸려15초 트랜잭션 제한으로500 롤백됐다. 제한을 늘리지 않고 검증 프로세스를 순차 실행한다. 이 실패를 성공 증거로 집계하지 않는다.
- 개발/테스트 DB를 분리하고 기존 HTTPS 및 provider-context 동결 fixture는 변경하지 않는다.

트랜잭션 시간 초과 직후 독립 DB조회에서 해당 신원의 User·Account·동의 기록0, 가입 대기1을 확인했다. [실패 롤백](timeout-rollback-database.json).
