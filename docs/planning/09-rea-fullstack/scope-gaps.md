# 기존 구현 대조와 보완 범위

## 근거의 우선순위

1. 2026-10-09 원본 화면/네트워크 관찰: `../catchsecu-reverse-2026-10-09/pages`, `category-analysis.md`, `route-coverage.json`.
2. 같은 날짜 원본 번들 AST: `static/route-inventory.json`, `category-translations.json`, `data-models.json`. 클라이언트에 코드가 있다는 근거이며 서버 DB나 호출 성공의 근거는 아니다.
3. 현재 로컬 코드와 Prisma/OpenAPI: 본 계획 `baseline.json`, `snapshots/` 및 저장소. 현재 기능의 정적 존재를 보여준다.
4. 과거 QA 증거: 재현 조건·코드 시점·실제 DB/외부 제공사 여부를 확인한 경우에만 재사용한다. 과거 완료 체크를 그대로 새 완료 판정에 쓰지 않는다.

## 확인한 차이

| 항목 | 확인 근거 | 필요한 작업 |
|---|---|---|
| `/log/retention` 추가 | 최신 AST에는 있고 로컬 route-manifest에는 없음. `src/server/retention-rules.ts`·CRUD API는 존재 | R16: 보유기간 화면, 메뉴/경로, 정책 우선순위 및 실제 파기 연결. 정상 원본 화면은 미관찰이므로 독립 제안 |
| `/login/gpki/callback` 추가 | 최신 AST에는 있고 기존 manifest에 없음 | R07: callback 경로/어댑터·state/검증/실패 화면. 현재 가상기관 인증과 실제 인증 분리 |
| `/login/saeol/callback` 추가 | 같은 조건 | R07: 기관별 성공/실패·세션 생성 검증 |
| `/*`, `/security/*` 추가 | 최신 번들 wildcard2개 | R24: 일반404/보안 fallback, 인증경계. 2개를 CRUD 업무화면으로 세지 않음 |
| 알림톡 채널 화면 미연결 | `src/components/services/index.tsx`에 `/alimtalk/channels` 분기 없음 | R19: 기존 channel backend/컴포넌트 확인 후 정상 CRUD 연결. 현재 정적 제어흐름상 fallback 도달 |
| 월마감 화면 고정 제한 | `src/components/management/index.tsx`에서 `/log/month-monitoring`은 enterprise gate | R23: ComplianceClose 조회/생성/출력 화면 연결. BillingMonthClose와 혼합하지 않음 |
| 감사로그 컬럼 일부 미수집 | `AuditLogs.tsx`는 IP·고객번호·사유 등을 `-`로 처리하며 해당 설명 표시 | R22: DTO/감사 수집 항목·마스킹/보존 확정 후 필요한 실제 필드 연결. 존재하지 않는 값을 꾸며 표시하지 않음 |
| 기관 인증은 mock | `auth/AuthPages.tsx`, `src/server/org-auth.ts`는 VirtualOrgMember 사용 | R07/R25: 실제 기관 계약·환경 확보 후 별도 구현/시험. mock 디렉터리 성공은 실제 GPKI/새올 성공이 아님 |
| 기존 경로 문서의 상태 설명 낡음 | manifest에 “실제 백엔드 없음” 표시가 남지만 현재 Prisma/API 다수 존재 | R00: sourceObserved·implementation·API·UI·external 검증 상태를 분리해 갱신 |
| 과거 계획 모델명과 실제 모델명 불일치 | 기존 CSV의 Delivery/MonthlyClose/Purchase 등은 현재 Prisma 모델이 아님 | R00: Delivery→CampaignDelivery/SmsReceipt/NotificationDelivery, MonthlyClose→BillingMonthClose/ComplianceClose, Purchase→PaymentOrder/PaymentEvent/PaymentRefund로 문맥별 매핑 |
| 계획 검증기181 hardcode | `scripts/verify-plan.py`가 source/matrix/manifest181을 assert | R00: 186 원본집합+별도 부가경로 집합으로 검증. wildcard 안전성 별도 |
| 결제 수정 진행 중 | 계획 시작 전 git status에서 payment-events/payments/subscriptions·문서·테스트 수정 확인 | R21: 기존 수정 보존 후 승인/환불/결제중 해지/취소구독 원장 회귀 재검증 |

위 표는 정적 검토로 확정 가능한 차이다. 이번 단계에서 로컬 앱의 실제 실패나 성공을 새로 재현한 것은 아니다.

## 구체적으로 다시 대조할 세부 기능

- 폼: 질문 유형·분기·필수/옵션·보유기간·본인인증·동의서 연결·v1/v3 경로 의미. 현재 파일 이름에 `ai`가 있다는 이유로 AI 생성 기능의 존재/규격을 추정하지 않는다.
- 문서: 목적·항목·제공/수탁자·국외이전·아동·CCTV·자동화결정·권리담당자 등 번들 항목과 현재 DTO 저장/게시/PDF의 누락 표.
- 문자: 발신자 모달 증빙4종·PDF/JPG/PNG·총2.5MB 등 관찰된 제약과 로컬 계약 대조. 관찰값은 원본 UI의 사실이며 법정 요건으로 설명하지 않는다.
- 알림: 추가 모달 9이벤트·서비스/폼 범위와 실제 이벤트 발생지/전송기의 일대일 연결.
- 광고동의: 동의일·연락처 존재·중복제거·조회/해제/출력의 실제 조건과 건수 일치.
- 인증/결과 경로: query와 임시 state 없이 주소만 열어 정상업무를 증명하지 않는다. 이메일·정보주체·공유·SSO·결제 각각 전용 사전 상태를 만든다.

## 원본과 동일성에 대한 한계

원본 계정은 조사 시 라이선스가 만료되어 유료/Enterprise 정상 화면과 일부 API가 제한되었다. 401/403·redirect·빈본문은 기능 정상 관찰이 아니다. 전체 사이트의 원본 백엔드나 비공개 DB를 알 수 없으므로, 접근 가능한 화면은 근거에 맞추고 미관찰 기능은 독립 제품 계약으로 구현한다. 로컬 모든 권한 fixture로 정상 흐름과 제한 흐름을 둘 다 시험한다.

## 기존 수정 보존

현 계획은 `outputs/catchsecu-fullstack-plan-2026-10-09` 안에서만 파일을 생성했다. 계획 시작 당시 저장소 HEAD·status와 코드/기존문서 지문을 기록했다. 검산 시 지문·status 비교로 애플리케이션 및 기존 계획 파일이 바뀌지 않았는지 확인한다. 테스트 실행·DB migration·seed·외부 송신·실결제는 이 계획 작성에 포함하지 않는다.
