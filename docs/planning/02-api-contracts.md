# API·권한·화면 계약 설계안

## P06-T06 서비스별 공급자 설정 (2026-10-04, 진행 중)

`GET/POST/PATCH/DELETE /services/{id}/verification`을 구현했다. 조회는 현재 `form.read`, 변경은 현재 `integration.manage`와 서비스 grant·세션·회사 정책을 검사한다. 생성은 16~128자의 Idempotency-Key, 수정은 version, 삭제는 현재 버전의 If-Match를 요구한다. 알려지지 않은/중복 조회 키와 ready/비밀 키/공급자 URL 입력을 거부한다. 설정과 최근 20개 이력은 안전 DTO이며 `ready`/`sandboxVerified`는 false다.

폼 편집기에서 서비스별 공급자 식별자·테스트/운영 환경·대기/사용 중지 설정을 관리한다. 설정 변경/중지/삭제는 이전 미소비 요청을 취소하고 생성 응답 캐시를 지운다. 삭제 후 재등록은 새 세대로 기록한다. 잠금·감사·생성 키 저장 뒤 실제 세션/배정/비밀번호 기한이 끝나면 설정·이력·감사·캐시를 같은 transaction에서 롤백한다.

외부 공급자 선정/자격증명과 실제 sandbox 검증이 아직 없다. 공개 인증 요청·callback·전자서명 대상 문서 생성·제출과의 일회 영수증 소비 API는 구현 전이며 verify 폼 게시·접수는 계속 503이다. P06-T06 전체 완료 조건을 줄이지 않는다.

endpoint는 독립 백엔드의 계약이다. [P00-T03 기준선](contracts/README.md)의 OpenAPI와 작업별 정책 표에 method·권한·범위·입력·응답·삭제/금지 규칙을 기록했다. `planned` 경로는 아직 구현되지 않은 제안이다. 하나의 범용 JSON 저장 API로 전 페이지를 처리하지 않는다.

## 공통 HTTP 계약

prefix: `/api/v1`. 매핑 CSV의 `CRUD /resources`는 다음을 의미한다. 불변 자원에는 U/D를 제공하지 않으며 해당 자원의 허용 동작이 우선이다.

| 요청 | 의미 | 성공 | 실패 |
|---|---|---|---|
| POST /resources | 생성 | 201 + id/version/Location | 401/403/409/422 |
| GET /resources | 목록·검색·정렬·페이지 | 200 + items/pageInfo/total | 400/401/403 |
| GET /resources/{id} | 상세 | 200 + 안전 DTO/version | 401/403/404 |
| PATCH /resources/{id} | 허용필드 변경 | 200 + 새 version | 403/404/409/422 |
| DELETE /resources/{id} | 삭제/보관/회수 | 204 또는 job ID와202 | 403/404/409 |

- 세션에서 Membership과 현재 회사를 검증한다. serviceId/parentId/fileId는 tenant 관계와 ServiceGrant까지 확인한다.
- 오류: `{error:{code,message,fieldErrors?,requestId}}`. stack·SQL·비밀·원문 PII는 반환하지 않는다.
- 날짜는 from 포함/to 미포함, UTC 저장·선택 시간대 변환. 정렬은 허용필드와 id 보조키. 페이지크기 상한을 고정한다.
- 변경에는 version/If-Match를 요구한다. 오래된 버전409는 최신 내용과 사용자 초안을 비교할 수 있게 표시한다.
- 주문·발송·게시·CSV 작업 생성·공개 제출에는 Idempotency-Key. CSV 반영은 job ID·version과 job/row unique로 중복을 막는다. 동일 key/다른 payload는409, 같은 요청은 기존 결과를 반환한다.
- 개인정보 API는 private,no-store. 회사/사용자별 cache 누출을 검사한다.
- 쿠키 mutation은 Origin/CSRF 확인. 공개 token은 scope·만료·rate limit를 검사하고 일반 로그인 session으로 승격하지 않는다.
- 대량 작업은 제한된 ID 또는 서버 검색 snapshot으로 확인 후 실행한다. 부분실패와 진행 Job을 표시한다.
- webhook은 raw payload 서명·시간창·event ID 확인 후 영속화한다. 중복 수신과 중복 업무 처리를 분리한다.
- 비동기 삭제/발송의 202를 완료로 표시하지 않는다. 실제 Job 상태를 다시 조회한다.

## 도메인별 계약

| 영역 | API/actions | 서버 규칙 | 화면 |
|---|---|---|---|
| 인증 | auth/signup,login,session,logout,password-reset,challenges,mfa | 검증전/2FA전 session 분리; token 원자소비; 존재여부 공통응답 | 필드오류·잠금·재전송·복구·만료 |
| 조직 | companies,services,members,invitations,roles,expert-assignments,access-requests | 마지막owner·소유권인계·회사귀속·초대받은이메일 | CRUD·보관·초대취소·서비스선택·권한 |
| 본인계정 | me,me/sessions,me/closure,me/audit-events | 민감변경 재인증; 소유권인계; 세션회수 | 프로필·활동·탈퇴·인계 |
| 폼 | forms,drafts,templates,publications,approvals,fixed-urls | 질문/분기 typed validation; draft편집; 게시 snapshot·token 원자생성 | 단계저장·preview·복제·승인·게시·공유 |
| 문서 | documents,clause-templates,processing-purposes,recipients | 게시버전 불변·HTML무해화·당시문서 동의증거 | 문구CRUD·버전비교·게시·PDF |
| 응답 | public/forms/{token}/submissions,submissions,corrections,withdrawals,destruction | 한도원자검사·필드타입·동의·중복키; 열람/정정권한 분리 | 공개폼·응답상세·마스킹·정정·철회 |
| 외부열람 | share-grants,viewer/challenges,viewer/submissions,subjects/access-requests | token hash·기한·범위·이메일확인·회수 | 인증→허용자료·철회·만료 |
| 파일 | uploads/init,uploads/{id}/complete,files/{id}/download | checksum·검사·용량·소유권·private storage | 진행·검사대기·재시도·권한다운로드 |
| CSV | imports,mapping,validate,commit,errors | 행별검증·job+row 멱등·부분실패 정의 | 컬럼매핑→검증표→실패행→반영건수 |
| 파기 | retention-rules,destruction-requests,holds,jobs,certificates | 승인·보류·DB/파일원문삭제·재시도·최소증거 | 파기일·보류사유·진행·증명서 |
| 마케팅 | marketing/preferences,withdrawals,suppression | 근거없는opt-in 금지·채널/service별·발송전 재검사 | 개별/일괄동의·철회·제외 |
| 발신자 | senders,verify,renew | 공급자검증 후 active·만료 재인증·사용중삭제제한 | 번호/주소·증빙·상태·비활성 |
| 발송 | campaigns,preview,schedule,send,cancel,deliveries/retry | draft만편집·대상snapshot·동의/한도/잔액 최종검사·멱등 | 작성·비용·예약·결과·재시도 |
| 카카오 | kakao/channels,templates,submit,review,preview | 공급자승인상태·수정후재심사 | 채널CRUD·심사·변수/버튼·playground |
| 메신저 | integrations,subscriptions,test,attempts | 비밀암호화·SSRF/DNS/내부IP/redirect 차단·최소payload | CRUD·사용여부·실전송결과·이력 |
| 결제 | plans,subscriptions,payment-methods,purchases,refunds,invoices | 서버가격·PGtoken·verified webhook·환불한도 | 상품·주문·수단·해지·환불·청구서 |
| 원장 | ledger,usage-events,monthly-closes | source 유일·원장불변/보정entry·마감후조정 | 잔액·자산·사용량·마감·export |
| 보안 | security/policy,ip-rules,mfa-policy,identity-providers | 서버실행경로에 집행·설정검증·lockout예방 | 정책탭·IP·2FA·SSO·테스트 |
| 통계 | analytics/dashboard,privacy,marketing,compliance | 원천집계·service범위·freshness·근거있는결과 | 기간·서비스·드릴다운·PDF/CSV |
| 로그 | audit-events,forms/{id}/audit-events | 사용자U/D 금지·서버이벤트·safe diff·보존 | 분류·행위자·기간·상세·export |

| 공지/도움 | notices,guides,support-tickets + admin mutation | 운영자RBAC·게시상태·첨부/HTML검증·문의 암호화·작성자 범위 | 고객조회/문의·운영자CRUD |

`GET /audit-events`는 `scope=company|mine`, `kind=all|service|info|marketing|customer|member|authority|external|access|mail`, `serviceId`, `actorId`, ISO `from/to`, `search`, `searchField=action|resource|actor`, `page/pageSize`를 지원한다. `from`은 포함, `to`는 미포함이다. 회사 범위는 `audit.read` 역할과 현재 서비스 grant를 재검사하고, 본인 범위는 현재 회사의 본인 이벤트만 반환한다. 전체 관리자/보안/감사 역할 외에는 처리자명·대상 ID를 숨기며 원문 `detail`은 어떤 역할에도 응답하지 않는다. `GET /audit-events/export`는 같은 범위·필터의 CSV를 최대 5,000건까지 반환하며 초과 시 413을 준다. 성공한 다운로드는 원장에 요청 ID·처리자·건수를 기록하며 검색어 원문은 남기지 않는다. 원장에는 기존 DB 불변 트리거가 적용돼 있다. 모든 원천 이벤트·운영 보존·PDF 내보내기는 P12-T01의 남은 범위다.

## 공개 조회·접수 계약 보강 (2026-10-04)

`GET /public/forms/{token}`는 현재 회사/폼/서비스/게시본을 잠금 순서로 검사하고 현재 게시 버전의 질문/동의만 제공한다. 한도 도달은 `closed=true`로 표시한다. 종료/중지/회수/만료는 410이며 내부 관리자·게시/문서 버전 ID·토큰 암호문은 공개 DTO에 포함하지 않는다.

`POST /public/forms/{token}/submissions`는 strict 입력과 16~128자의 Idempotency-Key를 검사한다. 한도 증가·응답/암호화 답변·검사 완료 파일 연결·동의 영수증/이벤트·감사는 같은 transaction이다. 같은 키/본문은 같은 ID/시각/submitted 상태를 반환하고 다른 유효 본문은 409다. 정상 마지막 한도 접수의 재전송은 한도를 다시 소비하지 않는다. 캐시 재전송도 잠금 대기 후 현재 공개 상태를 검사하며 종료는 410이다. 성공 여부가 불확실한 화면은 원래 본문/키·첨부로 재확인하고 새 입력을 추가 접수하지 않는다. [실행 증거와 남은 범위](../qa/P06-T01/README.md).

## 응답 목록·CSV 내보내기 계약 (2026-10-03)

`GET /forms/{id}/submissions`와 `GET /forms/{id}/submissions/export`는 같은 상태·응답 ID 검색·제출 기간 필터를 사용한다. from은 포함하고 to는 제외한다. 목록은 page/pageSize를 허용하고 빈 마지막 페이지를 보정한다. CSV는 같은 필터의 전체 결과를 UTF-8 BOM·CRLF로 반환한다. 현재 회사·서비스·사용자·세션·구성원/전문가·권한을 transaction 안에서 확인하고 응답 잠금 후 보유 상태를 재검사한다.

CSV 열은 게시 버전·질문 순서·행렬의 행별로 구분하고 복수 선택은 JSON 배열을 유지한다. 보유 기한 종료·파기 중/완료 원문은 비우며 현재 파일 조회 권한에 따라 파일 이름을 제공한다. 파일 ID·저장소 키·다운로드 URL·정정 과거 원문·메모는 내보내지 않는다. 수식 방어와 5,000건·1,000열·20MB 상한을 적용한다. 성공 시 원문/검색어 없이 `submission.exported` 감사를 남긴다. 파일은 attachment·private no-store·nosniff와 행 수 헤더로 제공한다. [구현·검증과 남은 범위](../qa/P06-T02/README.md).

## 비동기 응답 CSV 계약 (2026-10-04)

`POST /exports`는 `{formId, filters}`와 Idempotency-Key로 201 작업 DTO를 반환한다. 같은 요청자/키/본문은 같은 ID를 반환하며 조건 변경은 409, 삭제·만료된 키 재사용은 410이다. 현재 응답 조회 권한·회사/서비스 범위를 확인한다. 요청자별 진행 중 작업 5개, 결과 100,000건·1,000열·20MB를 제한한다.

`GET /exports?formId=…&page=…&pageSize=…`와 `GET /exports/{id}`는 요청자 본인의 현재 허용 범위에서 상태·version·진행·기한·안전 오류와 가능 동작을 반환한다. 검색 조건·암호화 값·원천 해시·요청 키는 노출하지 않는다. `POST /exports/{id}/cancel`과 `DELETE /exports/{id}`는 `{version}`을 받고 CSV 조각·조건·결과 해시를 제거한다. 삭제는 204이며 원천 응답을 유지한다.

`GET /exports/{id}/download`는 현재 세션/권한·파일 이름 권한·원천 상태/해시·기한을 재검사하고 성공 다운로드 감사를 남긴다. 처리 중은 409, 취소·삭제·만료·원천 변경 결과는 410이다. 다른 회사/요청자 ID는 404다. 응답/파일 변경·권한 회수·파기에 연결한 DB trigger는 결과를 무효화하고 복사 원문을 같은 transaction에서 지운다. 결과는 최대 24시간이며 포함된 응답의 더 빠른 보유 기한을 따른다.

처리기는 100건씩 암호화 CSV 조각과 진행을 저장하고 60초 lease·version·SKIP LOCKED로 중복 claim/옛 worker를 차단한다. `npm run worker:exports`는 내보내기 처리와 결과 만료 정리 전용이다. 화면은 현재 적용한 필터로 생성·진행 조회·다운로드·취소·삭제를 제공한다. 즉시/비동기 CSV는 같은 열/수식 방어 규칙을 사용한다. [구현 증거와 남은 게이트](../qa/P06-T02/exports/README.md).

## 역할 초안

| 역할 | 범위 |
|---|---|
| platform-admin | 공통 공지/가이드/상품 운영. 고객 PII 자동 열람권 없음 |
| tenant-owner | 회사·소유권·관리자 지정. 민감 열람도 감사 기록 |
| tenant-admin | 위임받은 구성원·서비스 관리. owner 권한 초과 부여 금지 |
| service-admin/editor | 배정 서비스 폼·문서 CRUD. 응답열람 별도 capability |
| pii-reader/privacy-manager | 허용필드 열람·정정·철회·파기 요청 |
| message-sender/message-admin | 발송 또는 발신자 관리. 서비스 범위 제한 |
| billing | 구독·결제·환불. 개인정보 응답권한과 분리 |
| security/auditor | 설정변경 또는 로그조회. auditor 일반변경 불가 |
| external-viewer/data-subject | 해당 grant/session 범위만 |

프런트 권한표시는 편의 기능이다. API/DAL/파일/export/worker에서 동일 정책을 적용한다.

## 기존 URL에 없는 추가 관리 화면

기존 목록의 모달을 우선 활용하되 다음 기능은 별도 페이지가 필요하다. 기존 181개 집계와 별도로 관리·검증한다.

| 추가 경로 제안 | 담당 | 시험 |
|---|---|---|
| /admin/notices | P13-T01 | 운영자CRUD·일반회원403 (ADD-01) |
| /admin/guides | P13-T01 | 파일업로드·교체·다운로드 (ADD-02) |
| /admin/plans | P10-T01 | 가격버전·과거구독불변 (ADD-03) |
| /admin/jobs | P01-T04 | 제한권한·재시도중복없음 (ADD-04) |
| /set/company/closure | P03-T01 | 자산인계·마지막owner·폐쇄 (ADD-05) |
| /account/data-import | P14-T01 | dry-run·중복·회사귀속 (ADD-06) |

## 화면 공통 작업

1. 목록: 서버 필터/정렬/pagination/total·빈상태·선택삭제·삭제불가이유.
2. 입력: 필수/타입/길이/범위·서버필드오류·중복클릭방지·이탈안내·저장후재조회.
3. 상세: 권한별필드·수정/보관/이력/download·404와권한거부 구분.
4. 오류: 인증만료·403·409·429·외부실패·재시도. 실패를 빈목록/성공으로 표시하지 않는다.
5. 모달: 취소는미저장·Escape/닫기·focus복귀·제출중상태·성공후목록갱신.
6. 서버저장 후 목록/상세/통계/다른브라우저 값 일치. localStorage는 비업무 UI 선호만.
7. queued/sending/sent/delivered/failed를 분리한다. 접수만으로 실제 발송/결제 성공이라고 표시하지 않는다.

## 2026-10-02 구현 경로 확정분

- 템플릿의 API 경로는 `/templates`, `/templates/{id}`, `/templates/{id}/use`이다. 서비스 템플릿은 회사와 서비스 복합 FK 및 서비스 권한을 검사한다.
- 초대 미리보기·수락은 토큰을 JSON 본문으로 받는 `POST /invitations/preview`, `POST /invitations/accept`이다. 링크 화면 경로는 `/oauth2/invite/signup?token=...`을 사용한다.
- 구성원 제외는 상태를 revoked로 바꾸고 서비스 권한·세션을 회수한다. 소유권 이전은 `POST /members/{id}/transfer`와 현재 비밀번호 재확인을 사용한다.
- 응답 정정은 `PATCH /submissions/{id}`, 철회·보존 조치·파기 요청은 각각 `POST .../withdraw`, `.../hold`, `.../destruction-request`이다. 파기 요청 등록은 실제 원문 삭제 완료를 의미하지 않는다.
- 상세 입력 계약과 구현 여부는 [생성된 OpenAPI](contracts/openapi.json)에 반영했다. 현재 121개 경로의 구현/계획 상태를 구분하며, 계획 단계 계약의 응답 스키마 등은 계속 보완한다.

## 단계별 편집기 초안 저장 계약 (2026-10-03)

- POST `/forms`는 생성 키를, PATCH `/forms/:id`와 `/forms/:id/draft`는 선택적 Idempotency-Key를 받는다. 자동저장은 키를 보내며 같은 키/본문/version의 재시도는 저장·감사를 추가하지 않는다. 같은 키/다른 본문은 409 `IDEMPOTENCY_MISMATCH`, 다른 키/오래된 version은 409 `VERSION_CONFLICT`다. 재전송 결과를 열기 전에도 현재 세션/이메일 인증/역할/전문가/서비스와 활성 상태를 검사한다.
- 입력 후 1.2초 자동저장은 한 요청씩 처리하며 저장 중 추가 입력을 유지한다. 응답 유실은 정확히 같은 요청을 다시 확인한 후 새 입력을 최신 version으로 저장한다. 409 뒤에는 자동 덮어쓰기를 멈추고 수정본 다운로드·최신본 불러오기를 제공한다. 미완성 입력은 검증 안내와 함께 화면에 유지한다.
- 최초 생성의 결과가 불확실하면 서비스 선택을 고정하고 같은 키를 재시도한다. 생성이 확정 거부되면 다른 서비스를 선택해 새 키로 생성한다. 생성된 폼의 서비스 ID는 변경하지 않는다.
- 초안 PATCH 응답에는 공유 토큰을 포함하지 않는다. 과거 저장된 재전송 캐시에서도 토큰을 제거한다. 공유 화면의 GET `/forms/:id`는 현재 `form.publish` 권한을 검사하며 권한 회수 후 토큰을 반환하지 않는다.
- 생성/basic-frame/v3/recipient/agreement/set/setting/share는 같은 formId를 사용한다. 질문 편집기는 기존 edit 링크도 지원한다. 제공/수집 문서 선택은 단계별로 나누고 서로 보존한다. 저장 완료 후 앞뒤/다음으로 이동하며 서버 재조회로 기기·새로고침 복원을 수행한다.
- 게시 후 저장은 별도 새 초안을 만들며 공개 버전·문서·동의 표시는 유지한다. [P04-T02 검증](../qa/P04-T02/README.md)에 실제 production API와 PostgreSQL/재시작·편집 상태 시험을 기록한다. 수정 후 실제 브라우저 조작은 대기 중이다.

## 세션·2FA·게시 승인 구현 계약 (2026-10-02)

- GET/PATCH/DELETE /security/policy. 변경/복원은 owner + 현재 암호 + tenantId + version. DELETE는 기본 정책 복원이며 행 삭제가 아니다.
- GET/POST /forms/{id}/approvals. POST는 Idempotency-Key, 현재 form version, 메시지, 정책상 증빙 번호를 검사한다.
- 게시·승인 요청·고정 URL 생성은 같은 키 재전송에도 현재 계정/세션/전문가/서비스 권한과 서비스·폼 활성 상태를 검사한다. 회수된 권한에는 캐시의 토큰·검토 메시지·고정 URL 결과를 반환하지 않는다.
- 승인 이력/상세와 고정 URL 목록/상세는 transaction 안에서 현재 조회 범위를 다시 확인한다. 화면의 요청/검토/취소 가능 여부는 현재 구성원·grant·회사 정책으로 계산한다.
- 고정 URL PATCH는 version과 이름/대상 폼 중 하나 이상을 요구한다. 대상 변경은 기존 서비스와 새 서비스의 게시 권한, 현재 유효한 게시본을 검사한다. Form을 먼저 잠근 뒤 FixedUrl을 잠가 재게시의 자동 연결과 변경/종료의 version 충돌을 유지한다.
- 고정 URL/승인 목록과 폼 승인 이력은 범위를 벗어난 page를 마지막 페이지로 보정한다. 화면은 서버가 반환한 페이지를 표시한다. 고정 URL 목록은 이름·상태·서비스·정렬·페이지를 서버에서 처리한다.
- GET /approvals, GET/DELETE /approvals/{id}, POST /approvals/{id}/decision. DELETE는 pending 취소이며 증거는 유지한다.
- 승인 당시 snapshot과 정책 revision을 고정한다. 편집/승인 정책 변경으로 이전 요청을 무효화하고, 게시 전에 해시와 현재 담당자 권한을 다시 검사한다. 요청자와 담당자 분리는 현재 계약에서 강제하지 않는다.
- 승인 담당 역할은 owner/admin/security 중 선택한다. owner는 복구 담당자로 항상 포함한다. security는 서비스별 form.read/form.approve 권한이 있어야 한다.
- 회사 비활성 세션을 인증 API 갱신과 회사 전환보다 먼저 검사한다. 자동 갱신을 끄고 7일의 절대 세션 만료를 유지한다.
- 암호 주기·유예·재사용은 아래 후속 계약에 구현했다. 사후 파기일과 IP/SSO는 미완료이다.

## 비밀번호 정책 구현 계약 (2026-10-02)

- GET /me/password-policy는 현재 회사의 만료·유예 상태와 모든 활성 회사 소속의 최소 길이·재사용 규칙을 반환한다. 해시·토큰은 제외한다.
- POST /me/password-policy는 tenantId/passwordRevision을 검증하고 회사가 허용하는 유예만 저장한다. 로그인 유예는 해당 세션, 기간 유예는 선택 시점부터 설정 개월 수까지 적용한다.
- /security/policy는 minPassword 12~128, passwordMonths 0~12, passwordReuse 0/1/10, passwordDeferral never/session/period를 추가로 저장한다. 암호 관련 수정만 passwordRevision을 올리고 이전 유예를 무효화한다.
- POST /auth/change-password와 /auth/reset-password는 같은 암호 규칙을 검사한다. 계정별 DB 잠금·단일 트랜잭션에서 해시/이력/변경 시각/세션/재설정 증명을 함께 처리한다. 실패하면 링크 소비와 암호 변경도 원복한다.
- 회사 API는 만료 시 PASSWORD_CHANGE_REQUIRED 403을 반환한다. 보호 화면은 안전한 returnTo를 포함한 /password-change-rule로 이동한다. 복구·본인 정책 조회는 가능하다.
- 달력 월은 한국 시간을 기준으로 계산하고 DB 저장 시각은 UTC이다. 최소 길이는 다음 변경부터 적용한다. 원본에 없는 세부 경합·다중 회사 규칙은 위 독립 계약과 실제 테스트로 확정했다.
- 근거: [비밀번호 정책 검증](../qa/password-policy/README.md). 사후 파기일·IP/SSO는 별도 미완료 범위이다.

## 첨부파일 구현 계약 (2026-10-02)

2026-10-04 보강: 로그인 파일/업로드 요청은 현재 계정·이메일 인증·회사 소속/선택·서비스 권한·세션/비활동 기한·MFA/비밀번호 정책을 잠금 아래 재검사한다. 처리기와 외부 공유는 현재 발급자 권한을 별도로 검사한다. 파일 잠금·저장소 읽기/쓰기·감사 저장 후 기한을 다시 확인해 종료 요청은 이름/바이트를 반환하지 않고 성공 감사/변경을 롤백한다. 공유의 응답 보유 기한도 마지막 응답 직전에 검사한다.

파일 목록 쿼리는 `submissionId`, `page`(1~100,000), `pageSize`(1~100, 기본 20)만 허용한다. 단건의 `submissionId`/`questionId`는 UUID와 stableKey를 검사하며 제출 파일은 정확한 조합이 필요하다. 미제출 구성원 파일은 본인 소유 범위로 읽는다. 공유 단건은 두 바인딩이 모두 필요하다. 중복·알 수 없는 쿼리는 422다. [실제 PostgreSQL·HTTP·재시작 검증](../qa/P06-T03/README.md).

- POST /public/forms/{token}/uploads와 /uploads/init는 Idempotency-Key를 요구한다. 공개 업로드는 게시본·파일 질문·한도·스캐너 상태를, 구성원 업로드는 서비스 권한 또는 응답 정정 권한을 확인한다.
- PUT /uploads/{id}/content는 raw bytes와 실제 MIME을 받고 10MB·크기·SHA-256·시그니처를 검증한다. POST /uploads/{id}/complete는 실제 ClamAV의 clean 결과만 활성화한다. GET/DELETE /uploads/{id}는 상태 조회·취소이다.
- 공개 업로드의 X-Upload-Token은 제출 전 업로드 관리에만 사용한다. /public/forms/{token}/submissions의 attachments는 질문별 fileId/token을 전달하며 답변 파일 ID와 함께 원자 검증·소비한다.
- GET /files?submissionId, GET /files/{id}, GET /files/{id}/download는 회사/서비스/응답/질문 권한을 검사한다. 첨부 단건과 다운로드는 submissionId 및 stableKey인 questionId query가 필수이다.
- PATCH /files/{id}는 본인의 제출 전 파일명, DELETE는 본인의 제출 전 파일 삭제만 지원한다. DELETE는 If-Match를 확인한다. 첨부 증거는 응답 정정으로 교체하고 과거 파일은 남긴다.
- 파일뷰 일반 두 경로는 위 API에 연결했다. /shared 두 경로는 외부 인증·공유권한 연결 전까지 차단한다. 원본 customerId의 독립 대응은 Submission.id로 정했다.
- 만료/차단은 410, 크기 초과 413, MIME 오류 415, 내용·증명 오류 422, 검사 서비스 불가 503이다. [실제 검증](../qa/files/README.md).

## 보존·파기 구현 계약 (2026-10-02)

- GET /destruction-requests는 서비스·응답·상태와 pagination을 받는다. GET /destruction-certificates는 서비스·응답별로 완료 증명서를 조회한다. 두 목록 모두 회사·소속 잠금 후 현재 역할·서비스 권한을 재검사한다.
- POST /submissions/{id}/destruction-request는 제출 버전·사유로 승인 대기 요청을 만든다. submission.destroy가 필요하고 보존 조치·활성 중복 요청은 409이다.
- POST /destruction-requests/{id}/approve, reject, cancel, retry, reschedule은 version·reason을 받는다. 승인·반려는 현재 owner/admin만 가능하다. reschedule은 dueAt도 받고 기존 승인을 지운다. 모든 변경은 정확한 Origin을 검사한다.
- 예정 시각은 현재부터 보유 기한 이내이다. 이미 만료됐으면 즉시 처리를 요청한다. 실행 후 취소·보존 추가는 금지한다. 실패한 파기는 원문 접근 차단을 유지한 채 재처리할 수 있다.
- GET /destruction-certificates/{id}와 /download는 현재 audit.read 및 서비스 권한을 확인한다. download는 JSON attachment이며 무결성 실패는 409이다. 증명서는 현재 DB/비공개 저장소 범위와 삭제 수량을 명시한다.
- PATCH /submissions/{id}/retention은 version·reason·retentionUntil을 받는다. 회사의 allowRetentionAdjustment가 켜져 있고 만료·보존·파기 진행 상태가 아니어야 한다. 원래 동의 기한을 넘기면 422이다.
- /security/policy의 automaticDestruction은 새 만료 접수 시 자동 예약 여부를 결정한다. 기본은 관리자 승인 대기이며 기존 pending 요청을 자동 승인하지 않는다. 취소·반려된 만료 요청을 재개하려면 새 수동 요청이 필요하다.
- 파기 시작 또는 보유 기한 만료 후 원문 열람은 차단한다. 보존 조치 중에는 만료 예외를 적용한다. 상세의 contentAvailable=false는 값·첨부·메모·정정·동의 원문을 제외한다. 만료/파기 응답의 캐시 재생은 410이고 작업을 다시 실행하지 않는다.
- 구현·실제 검증·업그레이드 영향: [파기 검증](../qa/destruction/README.md). 서비스별 RetentionRule CRUD, 보유 기간 미지정 사후 지정, S3·공유·복원 후 재파기는 미완료이다.

## 수집 목적·제공/수탁자 구현 계약 (2026-10-02)

- `/processing-purposes`, `/recipients`의 GET은 `document.read` 및 현재 서비스 권한으로 목록을 조회한다. serviceId·search·status(active/archived/all)·page/pageSize·sort(createdAt/name)·direction을 받으며 ID를 보조 정렬로 사용한다. 읽기·변경·중복 요청 재전송 모두 transaction 안에서 현재 회사·활성 사용자·이메일 인증·유효 세션·구성원·역할·grant를 다시 검사한다. 전문가 서비스 범위는 활성/미만료 배정 서비스와 grant의 교집합이다. 보관 서비스의 조회·이력은 유지하고 변경은 거부한다. [현재 권한 검증](../qa/P05-T01/README.md).
- POST는 `document.write`, 활성 서비스, `Idempotency-Key`를 요구한다. 필드·연결·중복 검사를 통과하면 본문·연결·개정본·감사를 함께 저장한다. 같은 키 재생 전에도 현재 권한을 확인한다.
- `/{id}` GET은 상세, PATCH는 전체 허용 필드와 현재 version을 받는다. 회사·서비스 소속은 바꿀 수 없다. `/{id}/history`는 version 내림차순의 불변 개정본을 page/pageSize로 조회한다.
- DELETE는 `If-Match`의 version으로 자료를 보관하고 204를 반환한다. `/{id}/restore` POST는 `{version}`으로 복원한다. 수정된 version·중복 이름·사용 중인 제공자 보관은 409, 보관된/다른 서비스 제공자 연결은 422이다.
- 로그인 없음 401, 역할/서비스 권한 없음 403, 타 회사 ID 404, 잘못된 입력 422를 반환한다. 변경 요청은 정확한 애플리케이션 Origin을 검사하고 모든 응답은 private/no-store이다.
- `/basic/info-usage-purpose`와 `/basic/info-usage-purpose/privacy-policy`가 같은 회사·서비스 자료의 CRUD 화면을 사용한다. 원본 유료 화면은 확인할 수 없어 독립 계약으로 구현했다. CSV 반영 API를 연결했다. 문서 초안 생성과 게시는 아래 문서 API에 연결했다.

## CSV API 구현 계약 (2026-10-02)

`/imports` 생성은 Idempotency-Key를 요구하고 파일은 기존 `/uploads/{fileId}/content`, `/complete`로 업로드·검사한다. `/inspect` 후 PATCH로 매핑·근거를 저장한다. `/validate`는 응답을 생성하지 않으며 `/commit`이 version·현재 근거 개정·권한을 확인하고 202를 반환한다. `/retry`는 failed 작업만 재개한다. `/rows`는 페이지·오류 필터, `/errors.csv`는 실패행 다운로드이다. DELETE는 취소/보관 결과를 200으로 반환하고 파일 제거는 worker가 재처리한다.

`import.read/write`는 owner/admin/editor/privacy에 부여하며 서비스별 현재 grant를 다시 확인한다. editor의 기존 공개 응답 열람 권한은 확장하지 않는다. 원본은 10MB, 데이터 10,000행, 100열, 셀 10,000자이며 UTF-8/BOM·EUC-KR을 명시적으로 선택한다. 수집일과 비일수형 보유 종료일은 사용자가 지정한다. 날짜만 있는 값은 Asia/Seoul 자정으로 해석한다.

반영 전 자료 변경은 검증을 초기화한다. 반영 후에는 원본이 삭제되고 설정을 수정할 수 없다. 회사·서비스·권한 오류는 처리 중에도 다시 확인한다. 원본 삭제 실패 시 응답은 생성하지 않는다. 같은 작업 재처리의 중복은 DB에서 차단하며 별도 새 작업의 동일 자료는 별도 수집으로 간주한다. 실패 CSV는 셀 인용·따옴표 이스케이프·수식 시작 문자 접두 처리를 적용한다. 응답 파기 및 임시 자료 만료 후에는 원문을 반환하지 않는다.

## 구현 계약 — 문서·게시·서비스 표시 (2026-10-03)

- documents: 목록/생성/상세/수정/보관/복원, options, preview, versions, publish/unpublish/revoke/apply-clause. 생성/게시 중복 요청은 같은 결과를 반환한다. 수정·상태 전이는 version을 검사한다.
- 문서·문구·이력·미리보기·비공개 PDF·서비스 표시·폼의 문서 선택은 공통 `currentServiceScope`로 현재 사용자·이메일 인증·세션·구성원·역할·grant·전문가 배정/서비스를 transaction 안에서 다시 확인한다. 생성 재전송도 같은 검사를 적용한다.
- 문서 목록·상세·변경·게시 응답의 `DocumentRecord.hasActivePublication`은 최신 게시 버전의 활성·미만료 링크 존재 여부다. 동일 본문과 최신 유효 링크가 있으면 중복 게시를 409로 거부한다. 최신 링크가 만료/회수되면 동일 내용으로 새 불변 버전을 게시할 수 있고, 이전 버전의 유효 링크는 유지한다. 이력은 만료 상태를 계산하며 만료 URL을 제공하지 않는다. OpenAPI의 실제 응답 스키마와 화면의 게시 가능 상태를 연결했다.
- clause-templates: 목록/생성/상세/수정/보관/복원. document.write 권한과 같은 서비스·문서 종류를 적용 시 확인한다.
- services/:id/consent-display/:kind: GET/PATCH. service.manage 권한, 두 탭별 version과 입력 엄격 검사, 외부 HTTPS 및 같은 서비스 게시 처리방침 연결.
- public/documents/:token: 익명 GET, 현재 회사/서비스/문서/링크/만료 검사. 공개 스냅샷만 반환, no-store/no-referrer/noindex. 본문은 일반 문자열로 렌더링한다.
- 공개 URL, 버전별 본문/해시, 경합 및 실제 DB·Ego 검증: [문서 보고서](../qa/documents/README.md).
- 현재 권한·최신 게시본 만료/재게시·불변 문서/동의/PDF와 실제 서버 재시작: [P05-T02 검증](../qa/P05-T02/README.md). 수정 후 브라우저 조작은 대기 중이다.

## 구현 계약 — 게시 문서 PDF (2026-10-03)

- GET /documents/:id/versions/:number/pdf: 현재 document.read·서비스 권한으로 게시 당시 고정 PDF를 내려받는다. 조회를 감사 이력에 기록한다.
- GET /public/documents/:token/pdf: 현재 회사/서비스/문서/링크와 만료를 검사한다. 회수된 링크는 저장된 PDF가 있어도 거부한다.
- 두 경로: 요청 제한, application/pdf, attachment, no-store/nosniff/no-referrer, X-PDF-SHA256과 X-Document-SHA256. 최초 동시 다운로드는 하나의 파일만 만든다. 지원 범위 초과와 글꼴 오류는 JSON 오류이며 파일을 저장하지 않는다. [검증](../qa/document-pdf/README.md).

## 구현 계약 — 폼 문서·동의 영수증 (2026-10-03)

- GET /forms/document-options?serviceId=&page=&pageSize=&search=: 현재 form.read + document.read·서비스 권한으로 공개 중인 문서 버전을 검색한다.
- 폼/템플릿 content.documentConsents: 최대 10개 `{documentVersionId,required,kind}`. 클라이언트의 임의 사본/해시는 받지 않는다. 같은 문서의 중복 버전, 타 서비스/회사, 처리방침 유형, 종료 링크, 기간 초과를 거부한다.
- 폼 조회의 consentBundle은 저장된 표시 사본과 문서 내용을 포함한다. 공개 조회에는 내부 선택 ID를 제외하고 해당 폼의 동의 키만 제공한다.
- POST /public/forms/:token/submissions의 documentConsents는 동의한 키 배열이다. 필수 누락/알 수 없는 키/중복을 422로 거부한다. 선택 거부를 동의 증거로 저장하지 않는다. 응답·암호화 증거·암호화 PDF·동의 이벤트를 원자적으로 저장한다.
- GET /submissions/:id/receipts/:receiptId/pdf: 현재 submission.read·서비스 권한·보유 상태 검사, 감사, no-store와 파일/증거 해시 헤더. 401 비로그인, 403 권한, 404 범위/기존 PDF 없음, 410 보유 종료/파기 상태. 기존 고정 바이트를 반환한다.
- 응답 상세는 evidence/pdfAvailable/documentHash/pdfHash를 포함한다. 보유 종료·파기 시 원문을 반환하지 않는다. [검증](../qa/form-documents/README.md).

## 구현 계약 — 외부 공유 (2026-10-03)

2026-10-04 보강: 생성 재전송도 현재 로그인/파일 권한·폼/서비스와 실제 공유의 게시본·발급자·세대·기한을 검사한다. 변경·재발송·회수는 신규/이전 생성 캐시의 암호화 원문/본문 해시를 제거한다. 관리 작업과 인증 성공 감사 저장 후 실제 로그인/challenge/공유 기한을 검사하며 종료 시 변경·메일·인증 세션·감사를 롤백한다.

공유 목록은 `formId`, `page`(1~100,000), `pageSize`(1~100), `status`, `search`(전체 이메일·최대 254자)만 허용한다. options는 `formId`, 로그/외부 응답 목록은 페이지 두 키만 허용한다. 중복/미지정 키는422이며 페이지를 현재 마지막 페이지로 보정한다. `permissions`·공유 `actions`·질문 `selectable`은 현재 서비스/폼/파일 권한을 반영한다. UI의 생성 응답 유실은 원래 본문/키로 재확인한다. [실행 검증과 남은 조건](../qa/P06-T04/README.md).

- GET/POST /share-grants, GET/PATCH/DELETE /share-grants/:id, GET /share-grants/options, POST /share-grants/:id/resend, GET /share-grants/:id/events. 현재 share.manage + submission.read + 서비스 권한, 파일 항목은 file.read 추가. 생성은 멱등키, 수정/재발송은 version, 회수는 If-Match 필수.
- 생성은 formId/formVersionId/email/questionIds/expiresAt, 수정은 고정된 버전에 대해 email/questionIds/expiresAt을 변경한다. 최대 90일·1~100개 질문. 수정·재발송 후 기존 코드와 세션 무효화, 새 초대 메일 작업을 원자 저장한다.
- POST /viewer/challenges: formCode(UUID), invitationCode(43자), email, consent=true. 유효/무효 모두 `{id,expiresAt}` 202, 브라우저 HttpOnly 쿠키. 코드·토큰 미반환.
- POST /viewer/challenges/:id/verify: `{code}` 6자리. 브라우저 바인딩·10분·5회·1회 소비; 실패 카운터는 오류 반환 후에도 유지한다. 성공 시 30분(공유 기한 이내) 세션 쿠키.
- GET /viewer/session, POST /viewer/logout, GET /viewer/submissions[/:id], GET /viewer/files[/:id[/download]]. 회사·발급 구성원·서비스·공유·세션 상태를 매 요청 재평가한다.
- 공유 파일은 submissionId/questionId(stableKey) 바인딩 필수. 현재 Answer의 허용 첨부만 조회하며 다운로드는 no-store·attachment·nosniff·sandbox CSP. 다른 범위 404, 종료 응답 410, 만료/회수된 인증 401. [검증](../qa/sharing/README.md).

### 현재 정보주체 보완 계약 — P06-T05 (2026-10-04)

- 회사→서비스→응답 잠금 뒤, 인증 세션 INSERT와 성공 감사 저장 뒤 실제 세션·링크·반환 자료 보유 기한을 검사한다. 지연 중 종료는401/404/422이며 인증 일회 소비·세션·철회 이벤트·suppression·성공 감사를 함께 롤백한다.
- GET /subjects/me와 철회 상세는 쿼리를 받지 않는다. 목록은page/pageSize만 받으며 중복/알려지지 않은 키는422다. page는 현재 보유 자료의 마지막 페이지로 보정하고 UI는 반환한page/pageSize를 표시한다.
- 이름/이메일 HMAC으로 본인확인 때 고정한DataSubject 범위의 현재 보유 동의만 반환한다. 새 회사/서비스의 정보주체 연결을 나중에 추가하지 않는다. 답변·연락처·관리자 메모·인증 비밀을DTO에서 제외한다.
- 인증 쿠키 수명은DB 세션의 남은 시간 안으로 제한한다. subject 인증 메일worker는 사용/만료/현재 조회 범위 종료를 전달 전에 거부한다. 본인 철회 후 기존 예약 메일과 앞으로의 같은 서비스 메일을 차단하며 다른 서비스와 유효한 필수 인증은 별도로 검사한다.
- 안전SubjectSession/Consent/Receipt/Event/Withdrawal과 페이지 응답 스키마·검색 파라미터를OpenAPI에 명시했다. [현재 검증](../qa/P06-T05/README.md).

## 구현 계약 — 정보주체 조회·동의 철회 (2026-10-03; 이전 단계 기록)

- POST /subjects/access-requests: `{name,email,consent:true}`. 매칭 여부와 관계없이 `{accepted:true}` 202와 브라우저 쿠키. 이메일별·전체 요청 제한, 10분 일회용 메일 링크. 불일치 자료에는 메일/인증 범위를 만들지 않는다.
- POST /subjects/sessions: `{token}`과 요청 브라우저 쿠키 필수. 성공 시 `{id,expiresAt}` 201과 30분 HttpOnly·SameSite=Strict 쿠키. HTTPS에서 Secure. 링크 GET은 소비하지 않고 버튼의 POST에서 한 번 소비한다.
- GET /subjects/me, GET /subjects/me/consents, GET /subjects/me/events: 쿠키와 `X-Subject-Session` UUID를 대조한다. 공통 page/pageSize. 현재 정보주체 범위·회사/서비스 상태·보유 기간을 검사하고 동의·CSV 등록·철회만 제공한다. 답변·관리자 메모·정정 원문 제외.
- POST /subjects/me/withdrawals: `{submissionId,version}`. GET /subjects/me/withdrawals/:id, POST .../:id/confirm, POST .../:id/cancel. 세션 소유·현재 버전·응답 상태를 다시 확인한다. 확정은 응답 withdrawn·ConsentEvent·Suppression을 함께 저장한다. 완료를 반복 확정해도 이벤트를 중복 생성하지 않는다.
- POST /subjects/logout: 현재 세션 회수와 쿠키 만료. 다른/없는 세션 401, 범위 밖 응답·철회 요청 404, 상태/버전 충돌 409, 만료·소비·브라우저 불일치 메일 링크 422.
- /infoOwner/find, find/complete, agree-history/:id, action-history/:id, form-interrupt, formComplete를 실제 서버 상태에 연결한다. 메일 토큰은 인증 후 세션 UUID URL로 교체한다. 완료 URL을 직접 열어 성공 상태를 만들 수 없다. no-store/no-referrer/noindex를 적용한다.
- enqueueServiceMail과 실제 worker 전달은 서비스별 이메일 차단 키를 잠근 후 검사한다. 철회가 먼저 커밋되면 예약되어 있던 메일도 전송하지 않는다. 필수 이메일 인증은 이 발송 종류와 구분하고 만료된 인증 메일은 전달하지 않는다. [검증](../qa/subjects/README.md).

## 구현 계약 — 마케팅 동의 (2026-10-03)

- GET/POST /marketing/preferences, GET/PATCH/DELETE /marketing/preferences/:id. 목록은 serviceId·page/pageSize(최대100)·정규화 완전일치 search·channel·status·excluded. 등록은 멱등키와 원본 응답/질문·채널·동의 시각·목적·증빙 참조·확인값을 요구한다.
- PATCH는 {version,excluded}, DELETE는 {serviceId,version}으로 연락처·근거·관련 큐 원문을 제거한다. 상세는 최근100개 변경 이력을 포함한다. 원본 응답은 유지한다.
- POST /marketing/preferences/withdrawals: 같은 서비스 최대100개 {id,version}, 원자 처리. 반복 철회는 중복 이벤트 없음, 재동의 이후 오래된 version은409.
- GET /marketing/preferences/export: 같은 검색/필터, 최대5000건, UTF-8 BOM·CSV 인용·수식 무해화. GET /marketing/sources: 출처20개 페이지와 추가 submission.read. GET /marketing/summary: 접근 가능한 서비스의 실제 상태/발송 가능 집계.
- marketing.read/write와 현재 서비스 권한을 검사한다. 입력422, 버전/상태409, 타 회사404, 권한403, 로그인401. 변경 요청은 Origin·요청 제한·암호화·감사를 적용한다.
- enqueueMarketingMail은 예약 시각과 동의 버전/출처를 고정한다. worker와 SMS 공통 판정은 전달 직전 현재 동의·제외·원본·보유 기한·서비스·정보주체 차단을 다시 검사한다. 외부 SMTP/SMS와 캠페인은 P08 후속 범위다. [검증](../qa/marketing/README.md).

## 구현 API — 발신번호·주소 (2026-10-03)

- sender.read/manage와 현재 서비스 권한을 재확인한다. owner/admin/sender 역할에만 해당 권한이 있다. 변경은 Origin과 version, 생성·업로드 예약은 Idempotency-Key를 요구한다.
- GET/POST /senders: serviceId·email/sms 채널, 이름 부분 검색 또는 정규화 연락처 완전 일치, 상태, page/pageSize(최대100). 주소/번호 정규화와 헤더 개행 금지, 개인 이메일 도메인 제한을 적용한다.
- GET/PATCH/DELETE /senders/:id: 상세·정보 변경·주소/증빙 원문 제거. 상세는 현 세대 인증·첨부와 최근100개 이벤트를 포함한다. 예약/처리 중 삭제, 증빙 있는 번호 변경은409다.
- POST /senders/:id/default|disable|renew: 대표 설정·중지·재인증. disable/renew는 인증 원문과 대표 설정을 해제하고 세대를 바꾼다.
- POST /senders/:id/request-email (202), confirm-email: 10분·5회·일회 코드. 확인 성공/재인증/만료 시 실제 인증 메일 파일과 작업 payload를 지운다.
- POST /senders/:id/dns (201), check: 암호화 TXT 발급·실제 DNS 조회 또는 SOLAPI 번호 상태 확인. 외부 요청 중 권한/버전 변경과 확인값 만료를 다시 검사한다. 발송 환경이 바뀐 확인값은409로 재인증을 안내한다.
- POST /senders/:id/evidence, POST /senders/:id/evidence/:fileId/attach, GET .../download, DELETE .../:fileId: 기존 업로드/ClamAV/암호화 저장 기반. 부모 발신자 없이 일반 파일 경로로 접근하면404다. 삭제 후410 또는404다.
- 발신자 지정 Job은 실제 From을 서버 자료로 만들며 일반 요청의 From을 신뢰하지 않는다. 외부 SMTP는 SMTP_HOST와 SMTP_SENDER_DOMAINS가 필요하다. 로컬 확인 환경은 외부 자격으로 사용할 수 없다.
- SOLAPI_TENANT_ID/API_KEY/API_SECRET는 하나의 회사에 고정한다. 미설정/공급자 오류503, 미활성/만료는 확인 실패이며 verified로 바뀌지 않는다. 실제 공급자 심사·발송은 후속 범위다. [검증](../qa/senders/README.md).

## 구현 API — 캠페인 (2026-10-03)

- GET/POST /campaigns: serviceId·email/sms·검색·상태·보관·기간·page/pageSize(최대100). 생성은 Idempotency-Key를 요구한다. GET/PATCH/DELETE /campaigns/:id는 상세·초안 수정·원문/대상 삭제다. 변경은 version을 검사한다.
- GET /campaign-sources는 현재 marketing.read와 서비스 권한 내의 동의만 최소 DTO로 반환한다. POST /campaigns/:id/recipients는 직접 입력·UTF-8 CSV·명시적 동의 ID를 원자적으로 교체하며 최대1,000명·중복 제거·형식/동의/기한 검사를 적용한다.
- POST /campaigns/:id/preview는 실제 대상·제외 이유·발신자·변수와 가격 확인 상태를 반환한다. 최초 텍스트 및 {{name}}/{{contact}}를 지원한다. HTML·첨부는 다음 실행 계획이다.
- POST /campaigns/:id/schedule|reschedule|cancel|archive|retry는 현재 권한·버전·상태를 다시 검사한다. 발송/재처리는 멱등키, 제외 대상이 있으면 명시적 excludeInvalid를 요구한다. 자동 재발송할 수 없는 unknown 행은 재처리409다.
- GET /campaigns/:id/recipients|deliveries|export는 서버 페이지·상태·삭제/기한을 검사한다. CSV는 BOM과 수식 무해화를 적용하며 삭제한 연락처를 다시 표시하지 않는다.
- message.read/manage/send 및 대상 열람의 marketing.read와 Origin을 검사한다. 입력422·상태/버전409·권한403·범위404·미설정 문자 공급자503이다. SMTP 접수와 실제 수신은 구분한다. [검증](../qa/campaigns/README.md).
## 이메일 내용·템플릿·첨부 실제 API (2026-10-03)

아래는 구현된 독립 계약이다. 기존 계획의 초안 경로와 구분한다. 실제 OpenAPI는 207 paths다.

- GET/POST `/message-templates`, GET/PATCH/DELETE `/message-templates/:id`, GET `/message-templates/:id/revisions/:version`, POST `/:id/archive`와 `/:id/restore`. 조회 message.read, 변경 message.manage와 현재 서비스 grant를 검사한다. 생성 멱등키, 변경 version, 검색/상태/채널/페이지를 지원한다.
- POST `/message-content/preview`: 서버 정제·변수 검사와 합성 예시 렌더링. 이메일 text/html, HTML의 텍스트 대체 본문 필수. 문자 HTML·속성 변수·제목 헤더 개행·미확정 변수 거부.
- POST `/campaigns/:id/apply-template`: 캠페인/템플릿 버전 일치와 같은 서비스/채널을 검사한 후 내용 사본을 만든다.
- POST `/campaigns/:id/files`: 버전·개수·합계 용량·소유권을 확인하여 업로드 예약. 공통 `/files` 바이트 업로드/검사 이후 POST `/campaigns/:id/files/:fileId/attach`, DELETE `/campaigns/:id/files/:fileId`, GET `.../download`를 사용한다. 다운로드는 message.read와 부모 바인딩을 요구하며 일반 파일 경로 우회는 404다.
- 초안 삭제는 첨부 원문도 제거한다. 요청 이후에는 첨부 고정과 매 전송 직전 바이트 재검사를 수행한다. 삭제 실패는 재처리할 수 있고 공급자에 파일 경로/URL을 전달하지 않는다. [검증](../qa/email-content/README.md).

## 구현 API — 이메일 수신 결과·차단 (2026-10-03)

실제 OpenAPI는 210 paths다. 아래는 독립 릴레이 계약이며 특정 외부 공급자의 API를 추측한 구현이 아니다.

- POST `/email-feedback`: X-Email-Timestamp·X-Email-Signature의 HMAC(timestamp.rawBody), 5분 허용·16KB·strict JSON. 실제 발송 작업에서 범위를 도출한다. 같은 eventId/body는 202, 충돌409, 인증401, 입력422, 미설정503이다.
- GET `/email-suppressions`: message.read + marketing.read + 현재 서비스 권한. serviceId·사유·이메일 완전일치·page/pageSize로 조회하며 원문이 유효할 때만 연락처를 표시한다. 차단 해제 API는 없다.
- GET/POST `/email-unsubscribe/:token`: 90일 Job-HMAC. GET은 안내·상태만 읽고 POST는 JSON confirm 또는 RFC 8058 form을 수락한다. 토큰으로 인증하며 쿠키/Origin에 의존하지 않고 반복 확인은 멱등이다. `?confirmPage=1` GET은 공개 확인 화면으로 302 이동, POST는 직접 처리한다.
- 공개 화면 `/email/unsubscribe/:token`은 no-referrer/noindex/no-store다. 캠페인 본문/헤더에 서버가 링크를 추가한다. one-click 헤더는 HTTPS와 DKIM 서명 설정이 있을 때만 켠다. 실제 외부 수신 검증은 남아 있다.
- 발송 상세·결과 CSV는 최초 전송 상태와 수신 결과/출처/시각을 구분한다. 신규·미리보기·예약·worker 전송 직전과 발송 가능 통계가 같은 차단 정책을 사용한다. [계약](../qa/email-feedback/CONTRACT.md), [검증](../qa/email-feedback/README.md).

## 구현 API — Slack·Teams 알림 (2026-10-03)

- OpenAPI 216 paths. `GET/POST /integrations`, `GET/PATCH/DELETE /integrations/:id`, `GET /integrations/options`, `POST /integrations/:id/enabled`, `POST /integrations/delete`는 `integration.read/manage` 및 현재 서비스 범위를 확인한다. 목록은 이름·등록자·종류·이벤트·대상·사용여부·페이지를 필터한다. 생성/수정은 엄격한 구독 입력, 멱등키와 version을 사용한다.
- `POST /integrations/:id/test`, `GET /integrations/:id/deliveries`, `POST /integrations/:id/deliveries/:deliveryId/retry`는 시험 전달·이력·안전한 실패 재처리다. URL 원문은 조회/이력/감사에 반환하지 않는다. 중지·교체·삭제 후 이전 세대의 대기 전달은 취소한다.
- URL은 HTTPS 표준 포트·공식 Slack/Teams 호스트/경로만 허용하고 DNS의 모든 주소를 검사한다. 소켓을 확인한 공개 IPv4 주소로 고정하고 TLS 원래 호스트를 검증한다. 리디렉션·과대 응답을 거부한다. 로컬 모드의 실제 파일 전달과 모의 공급자 응답은 [검증](../qa/notifications/README.md)에 기록했다. 실제 외부 채널 수신은 후속 게이트다.

## 구현 API — 공지사항 (2026-10-03)

- `GET /notices?page=&pageSize=&search=&scope=`는 로그인한 사용자에게 게시 공지만 제공한다. `scope=admin`은 시스템 운영자만 사용하며 초안·보관 공지도 포함한다. 본문은 목록에서 제외한다.
- `GET /notices/:id`는 게시 공지를 조회한다. `?preview=1` 미리보기는 시스템 운영자만 허용한다. 일반 계정의 초안·보관 상세는 404다.
- `POST /notices`는 시스템 운영자 플래그·`Idempotency-Key`와 분류·제목·본문 HTML·정렬 순서·초안/게시 상태를 요구한다. `PATCH /notices/:id`는 현재 `version`을, `DELETE /notices/:id`는 `If-Match` 버전을 검사한다. 삭제는 보관으로 처리한다.
- `PUT /notices/:id/attachments/:attachmentId`는 운영자·공지 버전·UUID·이름/형식/크기/SHA-256·실제 바이너리를 검사해 최대 10개를 등록한다. `GET`은 게시 자료만 제공하고, `?preview=1`은 운영자 전용이다. `DELETE`는 버전 검사 후 접근을 차단하고 비공개 파일을 제거한다. 보관된 공지의 첨부 링크는 404이며 삭제 대기 파일은 worker가 재시도한다.
- 본문은 p/br/strong/em/ul/ol/li/a 및 http/https 링크만 보존한다. 모든 변경은 감사 이벤트와 같은 트랜잭션에 기록한다. [PostgreSQL·Ego 검증](../qa/notices/README.md).

## 구현 API — 헬프센터 가이드·PDF (2026-10-03)

- `GET /guides?page=&pageSize=&search=&scope=`와 `GET /guides/:id`는 활성 회사 소속 계정에 게시 자료만 제공한다. 운영자만 `scope=admin` 및 `?preview=1`로 초안·보관 자료를 본다.
- `GET /guides/:id/download`는 매번 로그인·회사/운영자·게시 상태와 실제 파일의 크기·SHA-256을 검사한다. PDF attachment·no-store·nosniff·sandbox, 감사 이력. 초안/보관은 일반 회원에게 404다.
- `POST /guides`는 운영자와 `Idempotency-Key`를 요구하고 PDF 없는 초안을 만든다. `PATCH /guides/:id`는 `version`으로 제목·분류·순서·게시 상태를 수정하며 PDF 없는 게시를 거부한다. `DELETE /guides/:id`는 `If-Match` 버전으로 보관하고 파일 연결을 지운다.
- `PUT /guides/:id/file`은 `If-Match`, PDF 이름·크기·SHA-256 헤더와 실제 바이너리를 받는다. 10MB·PDF 형식·ClamAV·버전을 검사한 뒤 암호화 저장, 이전 파일 삭제, 감사 이력을 기록한다. [PostgreSQL·Ego 검증](../qa/guides/README.md).

## 구현 API — 서비스 접근 요청 (2026-10-03)

- `GET /access-requests?scope=mine|review&status=&page=&pageSize=`는 내 요청 또는 `member.manage` 검토 목록을 회사 범위에서 반환한다. 내 목록에는 아직 권한이 없고 대기 요청도 없는 활성 서비스만 요청 선택지로 제공한다.
- `POST /access-requests`는 `{serviceId,reason}`을 받는다. 활성 회사 구성원과 같은 회사의 활성 서비스, 기존 권한 부재를 확인한다. 새 요청은 201, 같은 서비스의 기존 대기 요청은 같은 ID와 200을 반환한다. 부분 유일 인덱스와 회사 잠금이 동시 요청을 직렬화한다.
- `PATCH /access-requests/:id`는 관리자만 `{version,decision:approve|reject,note}`로 검토한다. 본인 승인·타 회사·역할 상승·비활성 서비스/요청자·오래된 버전을 거부한다. 승인 시 `ServiceGrant`를 추가한다.
- `DELETE /access-requests/:id`는 요청자만 `If-Match` 버전으로 대기 요청을 취소한다. 원문 기록은 상태와 감사 이력으로 남는다. 변경은 Origin 검사와 회사별 권한 검사를 거친다. [부분 검증](../qa/P13-T02/README.md).

## 구현 API — 전문가 회사 배정 (2026-10-03)

- `GET /expert-assignments?scope=mine|admin`은 본인 배정 또는 플랫폼 운영자의 전체 검색/페이지를 반환한다. `GET /expert-assignments/:id`는 본인과 플랫폼 운영자만 본다. `GET /expert-assignments/options`는 운영자에게 활성 회사·해당 회사 서비스 선택지를 제공한다.
- `POST /expert-assignments`는 운영자만 `{companyId,expertEmail,serviceIds,expiresAt}`로 활성·인증 계정을 배정하거나 만료/회수 배정을 재활성화한다. 기존 일반 구성원, 타 회사 서비스, 본인/운영자 계정, 중복 활성 배정은 거부한다.
- `PATCH /expert-assignments/:id`는 version과 서비스 목록/만료일을 확인해 범위와 grant를 원자 교체한다. `DELETE`는 If-Match로 즉시 회수하고 grant 및 선택된 회사 세션을 해제한다. GET 서비스 API는 현재 배정과 grant의 교집합만 제공한다.
- `POST /context {companyId}`는 전문가가 배정된 활성 회사와 서비스를 명시적으로 선택할 때만 세션 회사를 변경한다. 선택 전 전문가는 회사 데이터 API에 접근할 수 없다. 만료 후 worker 정리 전에도 요청 단계에서 403/404를 반환한다. [부분 검증](../qa/P03-T02/README.md).

## 폼 목록·작업 권한 구현 계약 (2026-10-03)

- GET /forms와 /forms/{id}의 actions는 현재 역할·서비스 grant·서비스/폼 보관·가져오기 양식·공개/중단/만료 상태를 확인해 미리보기/응답/편집/복사/템플릿/공유/중단/재개/보관/삭제 조건 조회 권한을 반환한다.
- 응답은 submission.read가 있어야 안내한다. 응답 권한이 없는 목록 제목은 미리보기로 연결한다. checkDeletion은 삭제 조건을 열람할 작성 권한이며 참조된 폼도 사유를 확인할 수 있다. 실제 영구 삭제는 /deletion의 canPurge와 /purge에서 다시 검사한다.
- 목록 permissions의 canCreate/canImport/canViewImports는 현재 조회 가능한 선택 서비스의 권한과 서비스 상태를 따른다. 서비스 미선택 조회는 해당 범위 중 허용 서비스가 있는지 검사한다. 역할 전체 capabilities로 서비스별 버튼을 판단하지 않는다.
- 삭제 조건 DTO의 canReadResponses에 따라 응답/파기 관리 링크를 안내한다. 변경·생성/저장/복사/템플릿 사용 응답의 멱등 캐시에는 작업 권한을 저장하지 않는다. 작업 권한은 새 GET 응답에서 계산한다.

### 템플릿 현재 권한·삭제 계약

GET 목록/상세는 현재 역할·grant·세션·전문가 배정/만료·서비스 상태를 검사하고 작업과 활성 생성 대상 서비스를 반환한다. 목록은 strict 입력·생성일/제목 정렬·검색·회사/공용·페이지 보정을 처리한다. 전문가의 보관 서비스 양식은 숨기며 직접 구성원의 읽기는 유지한다. 생성 캐시는 회사/템플릿에 연결한다. version과 현재 작성 권한을 확인한 삭제는 신규·회사 구성원 범위의 이전 생성 캐시 내용을 원자 제거하고 생성 재전송은410이다. 독립 폼/다른 캐시는 유지한다. 생성/수정/사용 응답에는 현재 작업 권한을 캐시하지 않는다.


## P07-T03 현재 파기 API (2026-10-04)

요청은 항목별 현재 canApprove/canReject/canCancel/canReschedule/canRetry 권한을 반환한다. 두 목록은 권한 범위 내 검색·정렬·페이지 보정을 지원한다. 증명서 createdAt 정렬은 completedAt와 같은 의미다. 중복/미지원 쿼리는 변경·증명서 상세/다운로드에서도 422로 거절한다. 잠금 대기·감사 저장 뒤 실제 기한을 검사하며 무결성 확인 후에만 성공 열람 감사를 저장한다. [P07-T03 검증](../qa/P07-T03/README.md).

## P07-T01 CSV API 보완 (2026-10-04)

`GET /imports`는 필수 serviceId, page/pageSize, 제목·ID search, status, sort(createdAt/name), direction(asc/desc)을 지원하고 실제 마지막 페이지로 보정한다. `/rows`는 page/pageSize/errorsOnly만 받는다. 다른 쿼리와 중복 키는 422이며 `If-Match`는 안전한 양의 정수 십진 표현이다.

목록·상세·변경의 `permissions`는 현재 역할·서비스·작업·파일 상태로 canEdit/canInspect/canValidate/canCommit/canRetry/canClean을 계산한다. 감사·생성 캐시 저장 뒤에도 세션/비밀번호/배정/보관 기한을 검사한다. 실패 CSV는 private/no-store이며 연결 응답이 만료되면 원문을 제외한다. [현재 검증](../qa/P07-T01/README.md).


## P07-T02 현재 권한·사본 정리

현재 작업 권한·정렬/페이지·중복 쿼리 거부, 현재 버전의 생성 재실행과 삭제/기한 종료 410을 적용했다. 마케팅 DELETE는 DB 확정 뒤 사본을 정리하고 cleanup.pending을 반환한다. 같은 DELETE로 실패 사본을 재시도하며 중복 이력은 없다. 마케팅 발송은 게시/SMTP 호출 직전에 현재 동의·임대를 검사한다. URL 정규화 전에 원래 URL의 예약 키를 두 API에 한정된 Proxy에서 거부한다.

## 회사 2FA·보안 현황 (2026-10-04)

GET/PATCH /security/mfa-policy, POST /security/mfa-policy/exceptions, GET/PATCH/DELETE /security/mfa-policy/exceptions/{id}, GET /security/status. 조회는 직접 소속 security.read, 변경은 본인 인증을 등록한 직접 owner·현재 비밀번호·tenantId·version이다. 등록은 Idempotency-Key를 요구한다. 예외는 최초 등록부터 최대 24시간이며 만료·삭제 뒤 기존 세션도 회사 접근을 거부한다. 등록 상태와 보안 확인은 현재 DB 값이며 법적 준수 판단을 대신하지 않는다.


## 개인정보 활동 검토 모델/API (2026-10-04, 진행 중)

GET/POST `/activity-reviews`, GET `/{id}`, POST `/{id}/actions`를 구현했다. 생성은 현재 보안 관리 및 감사 열람 서비스 권한으로 원본 처리자에게만 요청한다. 대상자 답변·관리자 완료/취소와 version/요청키/최종기한 검사를 원자 처리한다. 목록 본문 제외, 상세 권한 후 복호화, 캐시 ID만 저장. OpenAPI와 activity-review 도메인 정책에 입력·출력·권한을 기록했다. 화면·이메일 알림은 미구현이며 [명세](06-privacy-activity-review.md)와 [증거](../qa/P03-T03/revalidation/activity-README.md)를 함께 적용한다.


## P12-T03 월마감 현재 권한 (2026-10-04)

GET/POST `/analytics/closes`, GET `/analytics/closes/{id}/export`는 저장된 기존 기록에도 현재 세션·정책·서비스 권한과 최종 기한을 적용한다. 회사 전체는 직접 owner/admin, 서비스 범위는 현재 service.read grant가 있는 활성 서비스다. 집계/생성/감사는 단일 Repeatable Read이며 동시 생성은 최대3회 전체 작업을 재검사한다. 조회와 CSV 감사도 기록한다. 손상된 범위는409, 접근 불가 서비스는404, 회사 전체 권한 부재는403이다. [부분 구현 증거](../qa/P12-T03/revalidation/README.md).


## P12-T03 출력 작업 (2026-10-04)

POST/GET `/analytics/exports`, GET/DELETE `/{id}`, POST `/{id}/cancel`, GET `/{id}/download`. 입력은 closeId+format, 변경은 version이며 생성은 요청 키와202응답이다. 현재 권한 및 요청자만 접근하고 회사 전체는 direct owner/admin이다. 동일 마감 PDF/CSV를 생성하며24시간 만료·16MB·대기5개 제한, 파일 해시 및 최종 기한을 검사한다. UI에서 요청/조회/취소/삭제/다운로드를 제공한다. 비동기 worker는 현재 발급자 권한을 독립적으로 확인하고 브라우저 세션은 다운로드에서 새로 검사한다. OpenAPI289/418작업/38정책. [검증](../qa/P12-T03/revalidation/exports/README.md).

2026-10-04 P12-T03: 선택 범위의 5개 기술적 점검 근거(version=1/checkedAt/serviceIds/facts/hash)를 월마감 JSON에 선택 필드로 저장하고 화면·CSV·PDF에서 재사용한다. 과거 마감의 근거 미저장 상태·기존 원천 해시를 보존한다. 회사 인증 집계는 회사 전체 direct owner/admin 마감에만 포함한다. 관련77개와 실제파일·SQL·새프로세스 검증. 선행3개/FLOW-12 수용은 남았다. 상세: docs/qa/P12-T03/revalidation/evidence/README.md.
