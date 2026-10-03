# P00-T02 런타임·DB·인증 호환성 시험

2026-10-02. 결과: 통과.

## 실제 실행

- Node 22.23.1, PostgreSQL 17.11, Prisma 7.10.0, Better Auth 1.7.7.
- 빈 dev/test DB에 migration 2개 적용. 인증 ID의 DB 기본값 누락을 최초 통합 시험에서 발견했고, 두 번째 migration으로 수정했다.
- Better Auth 1.7.7 CLI가 만든 참조 스키마와 모델 필드를 대조했다. Prisma 모델 이름으로 어댑터에 연결하므로 DB 테이블명은 프로젝트의 PascalCase를 유지한다.
- `npm test`: 실제 PostgreSQL 통합 12/12 통과. 모의 DB를 사용하지 않았다.
- `npm run typecheck`, `prisma validate` 통과. lint 오류 0, 기존 이미지·조사 스크립트 관련 경고 21.
- `ALLOW_LOCAL_MAIL=1 npm run build`: production build 통과. 개발용 메일함을 쓰는 로컬 미리보기 빌드임을 명시했다.
- `npm audit`: 취약점 0. Prisma CLI의 전이 의존성을 deepmerge-ts 8.0.2 / mysql2 3.24.5로 고정하고 타입·스키마·테스트·빌드를 다시 검증했다.
- Ego TaskSpace 30에서 잘못된 암호 거부 → 정상 로그인 → 서비스 생성 → 새로고침 → 수정 → 보관을 수행했다. 생성/수정 값은 별도 DB 연결에서 조회했다.

## 통합 시험 내용

1. 실제 DB health / 세션 없는 접근 401 / private no-store.
2. 잘못된 비밀번호·정지 계정 거부.
3. 서비스 생성·조회·수정·보관, version 충돌과 감사 기록.
4. 타 회사 ID 404 / viewer 쓰기 403 / 입력 422 / 외부 Origin 403.
5. 회사 교차 FK·중복 이름·감사 기록 변경을 DB에서 차단.
6. 동시 편집 두 요청 중 하나만 성공.
7. 같은 idempotency key 동시 요청의 부작용 1회, 다른 payload 409.
8. 두 worker의 단일 claim, lease 만료 후 복구, 로컬 메일 파일의 영속 저장.
9. 로그아웃 후 기존 쿠키 재사용 거부.
10. 회사 inactivity timeout을 갱신 전에 검사.
11. 가입 이메일 인증·암호 복구·복구 링크 재사용 거부·이전 세션 폐기.
12. TOTP 등록·2FA 전 보호 API 거부·복구코드 한 번 사용.

## 근거

- `build.log`, `lint.log`, `npm-audit.json`
- `integration-result.txt`
- `service-update-snapshot.txt`, `service-update.png`
- `service-archive-snapshot.txt`, `service-archive.png`
- `runtime-and-db.json`

이 Task는 도구 호환성과 기반 흐름의 시험이다. 전체 인증·파일·조직 기능 또는 181개 페이지 구현이 완료됐다는 뜻은 아니다. 실제 외부 메일/SMS/카카오/결제/SSO 공급자 시험은 아직 수행하지 않았다.
