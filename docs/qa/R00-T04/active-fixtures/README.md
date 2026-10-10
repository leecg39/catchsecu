# R00-T04 활성 경로 fixture·QA 재현계약

2026-10-11 완료. 이 Task는 페이지별 실행 전제와 기대 결과를 고정한다. HTTP·브라우저 CRUD 실행은 각 기능 Task가 별도로 증명한다.

## 확인 결과

- 실제 `catchsecu_dev` PostgreSQL에 회사 A 역할 9종, 데이터가 없는 회사 B 소유자, 서비스·폼·게시본·응답·문서·파일·가져오기·카카오 draft·pending 결제 주문 fixture를 생성했다.
- 원본 RR 경로 186개와 독립 제품 부가 경로 21개가 모두 구체 URL을 가진다. 임의 `demo` ID나 존재하지 않는 레코드를 사용하지 않는다.
- 각 경로에 정상·권한 거부·실패 시나리오를 3개씩 선언해 총 621개다.
- 동적 경로는 실제 DB 모델과 바인딩한다. 편집 화면의 `formId`, `documentId`, `jobId` 쿼리도 같은 방식으로 연결한다.
- callback은 선행 요청이 만든 state/challenge/OTP와 브라우저 세션을 요구한다. URL의 `result`나 임의 state를 성공 증거로 사용하지 않는다.
- wildcard 2개는 `__rea_unknown_route__`를 사용한 404 음성 경로다.
- 수신 거부 링크는 90일 이내의 실제 `local_delivered`/`accepted` 이메일 Job과 CampaignDelivery에 서명 바인딩한다.
- SMTP·문자·카카오·PG·본인인증·SSO 시험은 전용 allowlist 수신자, sandbox 상점 또는 시험 IdP/기관 계정만 사용하도록 계약에 기록했다.

## 준비 상태 해석

`contractResult=passed`, `contractComplete=true`이며 전체 207개 경로가 구체화됐다. `strictReadiness=blocked`와 준비조건 32개는 실패가 아니다. 브라우저 선행 상태가 필요한 원본 경로 19개와 외부 인증이 필요한 원본 경로 19개가 겹쳐 있으며, 실제 state·공급자 영수증을 만들기 전에는 실행 준비 완료로 올리지 않는다.

모든 경로의 `execution`과 시나리오 실행 상태는 `not_run`, `allCrudVerified=false`다. 이 카탈로그, 파일 존재 또는 화면 shell 렌더만으로 CRUD 완료를 주장하지 않는다.

## 검증

- `seed-result.json`: 실제 개발 DB 시드 성공, 역할 10개와 파일 fixture 3개 확인
- `result.json`: 원본 186 + 부가 21, 구체 경로 207, 시나리오 621, 누락 역할 0
- `route-catalog.json`: 경로별 모델 바인딩, 준비조건, 세 가지 기대 결과
- `tests-current.json`: fixture 경계 단위시험 6개 통과
- `npm run typecheck`: 통과
- 변경 파일 ESLint: 통과
- `npm run verify:fixtures -- --catalog-only`: 통과

외부 공급자 공식 검증은 이 Task의 완료 증거가 아니다. 해당 기능 Task의 `external_pending` 상태와 최종 통합 게이트에서 별도로 관리한다.
