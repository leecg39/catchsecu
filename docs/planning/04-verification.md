# 실제 작동 검증 계획

## 증거 등급

| 등급 | 증거 | 의미 |
|---|---|---|
| 계약 | 타입/OpenAPI/상태전이 시험 | 계약 일치 |
| 서버통합 | 실제 PostgreSQL+Route Handler+Worker | 실제 DB·트랜잭션 |
| 브라우저 E2E | UI→API→DB/파일→재조회 | 사용자 흐름 |
| 외부연동 | sandbox/staging·메일함·수신채널·PG receipt | 서비스별 연결 |
| 운영복구 | 재시작·migration·백업복원·대사 | 복구 가능한 상태 |

HTTP 200은 CRUD 증거가 아니다. mock 응답만으로 외부 기능 완료를 표시하지 않는다. 메모리 DB나 서버 없는 UI 시험은 최종 통합/E2E를 대신하지 않는다.

## 모든 수정 가능한 자원의 공통 시나리오

1. 회사A로 생성→201 ID→독립 SQL 조회.
2. 목록/검색/정렬/상세→입력오류422·중복409.
3. 수정→version증가→새로고침/새브라우저에서 확인.
4. 같은version 동시수정→한쪽409·데이터유실 없음.
5. 회사B로 ID 변조→조회/변경/삭제/첨부/export 거부.
6. 참조중삭제→정의된409/archive·FK 유지.
7. 삭제/회수→목록/상세/공개token/파일 권한 확인.
8. 서버·worker 재시작→영속성·작업복구·중복효과0.
9. 감사 이벤트에 행위·주체·회사·시각·requestId 연결.
10. 취소·뒤로·직접URL·인증만료·네트워크실패의 화면 확인.

불변 자원은 U/D 거부를 검사하고 정정·철회·취소·환불·보정 action에 위 절차를 적용한다.

## 종단 흐름

| ID | 시나리오 | 증거 |
|---|---|---|
| FLOW-01 | 가입→검증메일→로그인→2FA→로그아웃→복구 | session/challenge·메일함 |
| FLOW-02 | 회사→서비스→초대→수락→권한회수 | tenant격리·권한표 |
| FLOW-03 | 템플릿→질문/분기→동의→승인→게시→다른기기응답 | version/publication/submission/receipt |
| FLOW-04 | 파일업로드→검사→응답→관리자/외부열람→회수 | byte/hash·다운로드권한 |
| FLOW-05 | CSV→검증→실패행→반영→재시도 | 행별결과·중복0 |
| FLOW-06 | 본인이력→메일확인→철회→발송제외 | consent/suppression/delivery |
| FLOW-07 | 보존규칙→보류/승인→파기→증명서 | DB원문·파일삭제·retry |
| FLOW-08 | 발신자인증→예약/즉시→취소/재시도 | 채널별 실제receipt |
| FLOW-09 | 메신저등록→이벤트→수신→비활성/삭제 | 테스트채널·attempt |
| FLOW-10 | 주문→PG승인→할당량→차감→부분환불 | PG/원장균형/invoice |
| FLOW-11 | 정책변경→세션/IP/2FA→SSO→회수 | 서버집행·테스트IdP |
| FLOW-12 | 위 업무→감사/통계/마감/export | 원천SQL 합계일치 |
| FLOW-13 | 운영자 공지/가이드CRUD→회원조회 | 역할·첨부·무해화 |
| FLOW-14 | 데모이관→재시작→upgrade→백업복원 | 건수/필드·migration·복원보고 |

## 181개 페이지 검사

- CSV의 E2E-R001~R181마다 실제 fixture·기대 API·화면·정상/실패를 연결한다.
- 동적 URL은 DB에서 만든 ID/발급token 사용. demo 치환 빈화면은 정상검증으로 인정하지 않는다.
- callback은 서명fixture/실제 테스트IdP 흐름으로 들어간다. URL만 바꿔 성공화면을 띄우는 시험을 배제한다.
- 보이는 button/link/modal/tab/filter action마다 시험 ID를 배정한다.
- 추가6개 화면은 ADD-01~06 별도 추적한다.
- 주요화면1440/768/390 캡처와 전체경로 overflow·깨진이미지·콘솔/API 오류를 확인한다.
- 각 행에 backend/UI/integration/e2e/evidence 상태를 따로 둔다. 일괄 “완료” 처리하지 않는다.

## 보안·경합·복구

- IDOR/tenant격리·CSRF·XSS·mass assignment·SQL입력·경로탈출·MIME위장·SSRF/DNS/redirect·비밀로그 누출.
- session수명·코드 rate limit·계정연결 재인증·복구코드1회·secret회전.
- 제출·발송·결제·환불·webhook·CSV반영 두번 요청→업무효과 한 번.
- 마지막응답자리/잔액/owner변경 동시요청→DB불변식 유지.
- 외부전송 성공 직후 worker중단→provider조회·멱등키·대사로 중복 방지.
- timeout·부분실패·순서역전·dead-letter에서 원장/상태/화면 일관성.
- 파일파기 실패·DB성공·백업복원 후 개인정보 재노출 방지·재파기 절차.

## 성능·운영

P00에서 기준환경과 목표를 고정한다. 초기 데이터는 2회사, 서비스별 폼100개, 응답1만개, 로그10만개를 제안한다. 목록쿼리 p95 500ms를 기준환경 목표로 두고 인덱스·실행계획을 확인한다. 외부 지연은 따로 측정한다. 큰 import/export는 Job과 진행률을 반환한다. 실패/미달은 수정·재측정 기록을 남긴다.

## 구현 후 추가할 검증 명령

현재 명령이 존재하거나 실행됐다는 뜻이 아니다. P01에서 scripts를 추가한 뒤 실행한다.

```sh
npm run db:migrate
npm run db:seed:test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:providers
npm run typecheck
npm run lint
npm run build
npm run verify:coverage
```

공급자 설정 누락은 skipped pass가 아니라 blocked 보고서로 남긴다. 내부CI와 외부연동 게이트를 분리하고 전체완료에는 양쪽 통과를 요구한다.

## Task별 완료 보고

Task ID / 변경파일·commit / migration / API계약 / 테스트명 / 실행시각 / fixture / 독립DB검사 / 화면캡처 / provider event ID / 실패·해결 / 잔존제약. 민감값은 마스킹한다. 증거가 있는 Task만 `.Codex/goals/progress.md` 완료 수에 포함한다.
