# P12-T03 월마감 권한·원자성 보완 (진행 중)

2026-10-04. 사용자 지시에 따라 **P12-T03 하나를 순차적으로 구현·검증**한다. 이번 기록은 해당 Task 안의 월마감 저장·조회·CSV 보완이다. 전체 완료는 아니며 공식 상태는 완료15·진행42·계획15를 유지한다.

## 구현

- GET/POST 기존 마감 반환/CSV 모두 현재 회사·구성원·사용자·세션·서비스 권한·IP·MFA·비밀번호·전문가 기한을 검사한다. 응답 직전 기한도 검사한다.
- 회사 전체 키는 직접 소속 owner/admin만 사용한다. 제한된 구성원은 권한 있는 활성 서비스를 명시해야 한다. 일부 서비스 합계를 회사 전체 키에 저장하지 못한다.
- 집계 조회, 마감 저장, 생성 감사는 동일한 Repeatable Read 트랜잭션이다. 감사 실패·최종 세션 만료 시 모두 롤백한다. 동시 생성의 unique/serialization 충돌은 전체 권한 검사를 포함해 최대 3회 재시도한다.
- 저장된 스냅샷의 필드·월·서비스 키·중복 ID·서비스 수를 검증하고 손상된 기록은 409로 거부한다. 조회·CSV에도 감사 기록을 남긴다.
- 화면에 월/서비스 범위 선택, 이미 마감된 범위의 중복 버튼 비활성화, 로딩·오류·재조회를 연결했다. 판정은 계속 `not_assessed`다.

## 실행 증거

- PostgreSQL 3파일 **33개 통과**: 신규 권한 27개, 기존 월마감 1개, 집계 5개. [최종 로그](tests-final.log).
- 신규 검사는 저장 후 권한 제한, grant 삭제, 서비스 보관, 회사 전환, MFA 추가, 세션 삭제, 감사 오류, 최종 기한, 동시 생성, 조회/출력 감사, 손상된 범위를 포함한다.
- 최초 baseline 13개 중 12개 실패는 **제품 결손 5개 + 테스트 fixture 결손 7개**였다. 후자는 마지막 owner를 내리려다 DB 보호 규칙에 거부된 것으로, 별도 합성 owner를 추가한 후 실행했다. 12개 전체를 제품 결함 재현으로 주장하지 않는다. [초기 기록](authority-baseline-attempt.log).
- 변경 파일 lint 및 production v19의 타입/빌드 통과. 최초 빌드는 로컬 메일 허용 플래그가 없어 환경 검증에 실패했으며, `ALLOW_LOCAL_MAIL=1`로 재실행했다. [최종 빌드](build-final.log), [최초 빌드](build-attempt1.log).
- OpenAPI 285경로/412작업/37정책, 계획 181경로/72Task 검증 통과. 마감 3개 API의 권한 설명도 갱신했다.

## 실제 Ego 화면·파일·DB

QA 회사 6d8eed27의 2026-09 월을 사용했다. 사용자 운영 서버 3100은 유지하고 별도 3120 production 서버에서 확인했다.

1. owner가 회사 전체와 서비스 A를 실제 화면에서 각각 마감했다. DB 마감 2건/생성 감사 2건. 회사 전체는 서비스2/처리방침2, A는 서비스1/처리방침1이다.
2. 실제 링크로 회사 CSV 4행, A CSV 3행을 다운로드했다. 둘 다 UTF-8 BOM/미판정이며 A에는 B가 없다.
3. viewer 화면에는 서비스 A만 있다. 회사 전체 GET/POST/CSV 403, 서비스 B GET 404. A 기존 마감 POST는 200/created=false/동일 ID다. [HTTP 기록](browser-authority.json).
4. viewer A CSV는 owner A CSV와 바이트 해시가 같다. 390px에서 innerWidth/scrollWidth 모두390이며 [스크린샷](member-close-mobile.png)을 직접 확인했다.
5. 브라우저 offline에서 조회 실패를 표시하고 온라인 복귀 후 재조회 성공. 오류 문구는 현재 공통 네트워크 메시지 `Failed to fetch`다. [재시도 기록](browser-retry.json).
6. 서버 PID31864→33589 재시작 후 마감2행의 해시 `8ad213c16be985050347cd2b490b1d20a61ad658e2c34ad73ce943ad4d79f595`가 유지됐다. 재시작 후 실제 다운로드도 A의 기존 CSV와 동일하다. 조회/다운로드 감사는 정상 증가하고 생성 감사는2건을 유지했다.

[기계 판독 요약](summary.json), [DB](database-after-restart.json), [owner 화면](owner-close-desktop.png), [회사 CSV](company-close.csv), [서비스 CSV](service-a-close.csv), [viewer CSV](member-service-a-close.csv), [재시작 CSV](restart-service-a-close.csv).

## P12-T03 남은 범위

- 증거에 기반한 준수 점검 항목·결과·월마감 연결. 법적 자동 통과를 주장하지 않는다.
- 필터를 고정한 PDF/CSV 출력 작업과 만료 파일, 다운로드 권한·실패·재시작 처리.
- DB 수준 월마감 변경/삭제 방지와 기존 기록 이행 검증. 현재 공개 수정 API는 없지만 DB 직접 변경 방어는 아직 없다.
- 선행 P12-T01/P12-T02/P07-T03 및 원래 공통 완료 조건. 전체 수용 전까지 P12-T03은 in_progress다.

후속 완료 판정(2026-10-04): 원래 요구별 대조 후 P12-T03을 완료로 갱신했다. [최종 수용](../completion.md)
