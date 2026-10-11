# R06-T03 보안 화면 완료

2026-10-11 현재 production build와 Ego Lite 2/p5에서 IP·MFA 목록을 검증했다. 검색·상태·정렬·페이지·페이지 크기를 URL에 보존하고 목록/설정 이동도 조건을 유지한다. 공통 URL 생성기가 숫자20을 무조건 기본값으로 지워 20페이지가 사라지던 오류를 수정했다.

- [실제 목록 자료](pagination-fixture.json): 비활성 IP21개는 HTTP 생성, MFA 목록용 합성 구성원21개는 명시적인 DB fixture. DB 정렬과 API20+1을 대조했다. 기존 보안 CRUD fixture는 보존했다.
- [IP 목록](ip-list-browser.json), [MFA 목록](mfa-list-browser.json): 2페이지·새로고침·설정 링크·빈 검색/필터·뒤로 가기 입력 복원·999페이지 보정. IP 정렬은 DB 문자열 순서다.
- [IP 편집 보호](ip-dirty-history.json): 같은 문서의 뒤로 가기 취소는 입력과 INPUT 포커스를 유지하고 승인 시 1페이지로 이동하며 편집창이 닫힌다. 브라우저가 직접 표시하는 문서 전환/새로고침 확인창의 취소 동작은 이번 시험 범위에 포함하지 않는다.
- [8경로×3폭](route-widths.json): 390/768/1440px 문서 가로 넘침0. 공유 안내문에 적용된 음수 상단 간격 때문에 모바일 설명과12px 겹치던 문제를 [재현](entitlement-overlap-before.json)하고 전용 여백으로 수정했다. [수정 후](entitlement-overlap-after.json) 인접 요소 사이 최소12px, [최종 화면](mfa-mobile.png)을 직접 열어 확인했다.
- [목록·기록 단위시험15개](list-tests.json), 타입 검사, 변경 파일 lint, production82페이지 빌드 통과. [품질 기록](quality-gates.json).

동작이 바뀌지 않은 편집기와 정책 화면의 생성·수정·삭제·초기화·현재 권한·자기 차단·409·재시도·키보드·모달은 기존 [실제 CRUD 증거](../security-flow/README.md)를 함께 사용한다. 구독6상태의18화면, 자연 만료된 편집기 차단 및 기존 보호 유지,24개 만료 화면은 [기능 권한 증거](../../R06-T04/security-entitlements/README.md)에 연결한다. 이번에는 목록 URL 처리와 안내문 간격이 변경되었다. 이전 증거를 새로 실행한 결과로 집계하지 않는다.

현재 독립 구현 화면 계약을 충족한다. 원본 Enterprise 상품 매핑과 실제 외부 공급자 수용은 R06-T04의 외부 대기로 남긴다.
