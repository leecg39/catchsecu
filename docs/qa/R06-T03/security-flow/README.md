# R06 보안 화면 검증

Ego Lite의 기존 space 3/p1과 별도 합성 회사에서 실제 API/DB에 연결해 확인했다.

- IP 규칙: 생성·수정·삭제, 현재 접속 IP 입력, 자기 차단 거부, 비밀번호 오류, 네트워크 재시도, 동시 수정 409/최신 상태 복구와 입력 폐기 확인. [생성](ip-created.json), [충돌](ip-conflict.json), [차단 방지](ip-lockout.json), [오류 수정 전](ip-error-before.json)/[후](ip-error-after.json), [입력 보존](ip-discard-after.json).
- 검색 중 입력창이 교체돼 포커스가 BODY로 이동하는 문제를 [재현](ip-search-focus-before.json)했다. 입력과 검색 실행을 분리한 후 [포커스 유지](ip-search-focus-after.json), [21건의 1·2페이지/삭제](ip-pagination-delete.json), [상태 필터·정렬·빈 검색](ip-filters-sort.json)을 확인했다. 첫 시험용 20건은 모두 HTTP 정리했고, 재검증용 20건은 UI 1건/HTTP 19건으로 삭제했다.
- MFA: 실제 관리자 TOTP 등록, 예외 사유 수정·기한·생성·갱신·삭제, 실패 후 편집 가능, 409 복구 시 최신 기한 반영, 회사 강제 정책 활성화. [등록](mfa-enrolled.json), [생성](mfa-created.json), [실패 후 입력](mfa-network-input.json), [충돌 복구](mfa-conflict.json), [삭제 즉시 기존 세션 차단](mfa-delete-revoked.json), [만료 표시](mfa-expired-list.txt), [검색/필터](mfa-filters.json).
- 정책: 6개 탭 값 저장 후 [API 재조회](policy-saved.json), [미저장 입력/409 복구](policy-conflict.json), [네트워크 실패](policy-network.json), [조회 재시도](policy-read-retry.json), [기본값 복원과 유휴 세션 만료](policy-reset.json). 잘못된 로컬 초안 값이 있어도 초기화 자체는 정상 처리한다.
- 관리자 역할은 [정책 읽기 전용](policy-admin-readonly.json)이고 IP 수정 버튼이 없다. IP 읽기 전용 캡처 당시 21건 중 최신 20건을 표시해 현재 IP 규칙은 2페이지에 있었다. [조회자 거부](viewer-denied.json)는 UI와 실제 403으로 확인했다.
- [8개 원본 경로 × 390/768/1440 = 24개 관측](routes-responsive.json). IP 표의 모바일 가로 넘침을 재현하고 스크롤 래퍼를 수정했다. 수정 후 문서 가로 넘침은 0건이다. MFA 편집창 3개 폭은 [별도 기록](mfa-editor-responsive.json), 정책 탭 Enter 선택은 [키보드 기록](policy-keyboard.json)을 참조한다. 캡처 이미지를 직접 열어 확인했다.

원본 Enterprise 정상 상태와 모든 권한·라이선스 조합은 미확인이다. 이 문서는 로컬 동작 증거이며 전체 원본 동등성이나 모든 R06 수용 완료를 뜻하지 않는다. 다음 보완은 기능별 entitlement와 만료/미가입 UI·API 일치다.

## 기능 권한 후속

[기능별 구독 권한 화면 검증](../../R06-T04/security-entitlements/README.md)을 추가했다. 이전 본문의 entitlement 미검증 표시는 이 후속 이전 시점의 기록이다. 원본 전체동등성·활성 Enterprise 원본 및 외부 제공사 검증은 여전히 남아 있다.
