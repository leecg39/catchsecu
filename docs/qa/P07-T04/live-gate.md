# P07-T04 수명주기 게이트 라이브 보강 (2026-10-04)

dev 앱 :3100 + catchsecu_dev 실측. 기존 구현 설명을 라이브 수치로 보강한다.

| 수용 조건 | 실측 |
|---|---|
| 영속 DB·파일 삭제 | `FileObject.status=deleted` **18건 전부 스토리지 물리 파일 부재**(18/18 gone, 잔존 0) — `.local/catchsecu_dev/storage` |
| 타사 응답 직접 접근 | 다른 테넌트 submission → **404**, destruction-certificate → **404** |
| 타사 파기 조작 | 다른 테넌트 DestructionRequest에 approve·cancel POST → **404 NOT_FOUND**(tenant 스코프 조회에서 차단, version 검사 이전) |
| 회사 B → 회사 A | owner-b 세션으로 회사 A submission → **404** |
| 백업 복원 후 재파기 | [P14-T04 실증](../P14-T04/restore-evidence.md): `catchsecu_restore` 복원 → `:3101` 승인 → 워커 재파기 → 증명서·감사 완결 |
| CSV→파기 수명주기 | [P07-T01 라이브](../P07-T01/live-revalidation.md): 업로드→매핑→검증→부분반영→원본 FileObject `deleted` |
| 승인자 역할 | approve/reject는 owner·admin만(`DESTRUCTION_APPROVER_REQUIRED`), 트랜잭션 안에서 현재 역할 재확인 |

## 미수용

- 업로드→파기 전 구간을 단일 신규 fixture로 관통한 1회 관통 E2E는 각 구간별 실측의 합성 — 통합 재연 없음.
- S3 스토리지·실제 보관 정책·감사 체인 전수 대조 미검증.
