# R06 보안 정책·IP·MFA 로컬 검증 기록

전체 작업은 진행 중이다. 이 체크포인트는 독립 구현의 정책·CRUD·집행·화면 복구를 검증한다.

- [모델](../../R06-T01/model-audit/README.md): 개발/테스트 4개 모델 42컬럼·21제약·7인덱스·4트리거 대조.
- [서버](../../R06-T02/security/README.md): 오래된 권한으로 정책을 조회하는 문제 8개 재현→수정. 관련 고유 181개 시험 통과(실행 범위/시점은 서버 기록 참조).
- [화면](../../R06-T03/security-flow/README.md): IP·MFA 예외 CRUD, 정책 6탭 저장/초기화, 동시 수정·입력 보호·검색·페이지·모바일.
- [IP 20개 경계](ip-boundaries.json): 같은 로그인 쿠키로 실제 IPv4와 IPv6 소켓을 사용했다. 127.0.0.1만 허용할 때 ::1의 정책/구성원/폼/파일/내보내기 API 요청은 위조 IP 헤더와 무관하게 403이다. 시험용 IPv6 서버는 종료했다.
- [실제 MFA 만료 8개](mfa-expiry.json): 8초짜리 예외를 실제 HTTP 생성하고 자연 만료를 기다렸다. 같은 세션이 403→200→403으로 바뀌며 정리 worker/DB 시계 조작은 사용하지 않았다. 예외 삭제도 기존 접근을 즉시 차단했다.
- [최종 HTTP 8개와 독립 DB](verified.json), [새 서버 재검증](verified-after-restart.json).

최종 DB는 정책 v5(기본값·passwordRevision 3/approvalRevision 3), IP 제한 사용 v1, 허용 IP 규칙 1건 v3, MFA 예외 0건, 관리자 MFA 등록 유지, 감사 126건이다. 31분 유휴 상태로 준비한 시험 세션은 기본값의 30분 제한 적용 후 삭제됐다.

상태 해시: `cef31de2e955306df2870a5612210634923503080b2d12c289892a82a720e7ed`.

[초기 준비](prepared.json)는 이메일 확인/구성원·서비스 권한의 직접 입력을 명시한다. [유휴 시계 준비](idle-setup.json)는 해당 시험 관리자의 지정 세션만 31분 전으로 조정했다. 목록 다중페이지 자료는 실제 HTTP로 만들고 삭제했으며 [1차](ip-pages-setup.json)/[정리](ip-pages-cleanup.json), [2차](ip-pages-setup-2.json)/[정리](ip-pages-cleanup-2.json)를 구분했다. 별도 브라우저 프로필 대신 독립 HTTP 세션을 사용했다.

남은 필수 범위: Enterprise 포함/미포함·미가입/만료의 기능별 gate와 UI 안내, 전체 역할/상태 조합, 원본 동등성 및 실제 외부 제공사 검증. 현재 entitlements 수량 제한과 보안 기능 권한이 아직 연결되지 않아 `partial_verified`를 유지한다. 원본 미관찰 기본값을 원본의 사실로 간주하지 않는다.

## 기능 권한 후속

별도 fixture에서 [구독 기능 gate·자연 만료·화면·재시작](../security-entitlements/README.md)을 확인했다. 이 폴더의 과거 원본/외부 제한과 기존 상태 지문은 보존한다.
