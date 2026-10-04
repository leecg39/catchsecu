# P14-T04 마이그레이션·백업·복구·운영 문서 — 미완료

2026-10-04 소스 재대조. 이전 구현·전수 통과 주장을 그대로 인정하지 않는다. [57개 재분류](../status-revalidation/README.md).

## 현재 확인

migration/부분 shadow 설치 증거 존재. 이번 소스 조사만으로 테스트 실행·브라우저·외부 연동 통과를 주장하지 않는다.

- [src/server/db.ts](../../../src/server/db.ts)
- [src/server/file-storage.ts](../../../src/server/file-storage.ts) — storageObjectName, encryptStoredObject, decryptStoredObject

## 남은 구현·수용

별도환경 DB/객체 백업복구·재파기·키 회전 실증.

원래 범위: 빈환경 설치, 업데이트/복구 리허설, DB와 객체저장소 백업·복원·재파기, 비밀/키 회전·보관 정책을 문서화하고 실행한다.

수용 조건: 별도환경 백업복원 성공; 기존 schema 업그레이드; worker 재기동; 복구 후 권한/파기 일관성

선행: P14-T02. 공통 DB/권한/실패/브라우저/재시작/실제 파일 및 외부 검증 조건을 유지한다.
