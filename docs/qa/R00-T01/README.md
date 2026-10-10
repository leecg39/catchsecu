# R00-T01 경로·메뉴·동작 기준선

## 판정

R00-T01의 두 완료 조건을 충족했다. 이 판정은 범위와 미확인 상태를 확정한 것이며, 각 화면의 CRUD 수용 완료를 뜻하지 않는다.

- `source-routes.json`, 활성 route matrix, 앱 manifest의 186개 경로가 고유하며 서로 일치한다.
- 2026-10-02 기준 181개 경로가 모두 포함된다.
- 186개 중 구체 경로는 184개이고 wildcard fallback은 2개다. wildcard는 업무 화면 수에 포함하지 않는다.
- 원본 목록 밖 독립 제품 보조 경로 21개는 별도 register로 유지한다.
- 메뉴 35개 중 34개를 실제 production 화면에서 열었고 모두 예상 URL에 렌더됐다. alert와 redirect는 0개다.
- `/logout`은 소스와 계약을 추적했지만 활성 QA 세션을 파괴하므로 실행하지 않았다.
- 화면에서 관측된 동작 463개는 API 링크 36개, 경로 링크 58개, 버튼 216개, 입력 계열 153개다.
- 버튼과 입력 계열 369개는 로컬 동작·모달·폼 제어로 분류해 미확인 목록에 남겼다.
- 렌더링, 미실행 링크, redirect, HTTP 403, 미실행 제어는 모두 CRUD 성공으로 집계하지 않는다.

## 재현

```sh
npm run verify:plan
npm run verify:route-baseline
```

## 증거

- `route-contract-check.json`: 활성 계획·경로·의존성의 정적 일치
- `menu-runtime/inventory.json`: 34개 메뉴 화면의 실제 URL·alert·표시 동작 원자료
- `action-trace.json`: 35개 메뉴와 463개 동작의 route/API/로컬·모달/입력 분류, 미확인 목록, CRUD 비집계 규칙

후속 도메인 작업은 `action-trace.json`의 미확인 동작을 실제 클릭·API·PostgreSQL 결과에 연결하고 개별 CRUD 수용 증거를 남겨야 한다.
