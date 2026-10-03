# P01-T03 파일 저장 기반

2026-10-03. 로컬 비공개 저장과 path-style S3 어댑터를 확인했다. 운영 버킷 자격증명은 연결하지 않았다.

## S3 호환 어댑터

`FILE_STORAGE=s3`일 때 객체는 AES-256-GCM 암호문으로 `PutObject`/`GetObject`/`DeleteObject`에 실린다. 서명은 AWS4-HMAC-SHA256이다. 시험 서버는 클라이언트와 별도로 서명을 다시 계산하고, 평문과 불일치하면 403을 반환한다.

[s3-roundtrip.json](s3-roundtrip.json): 서명된 요청 5건, 왕복 바이트 일치, 다른 키로 옮긴 암호문 복호화 실패, 경로 탈출과 10MB 초과는 네트워크 요청 없이 거부, 삭제 후 조회 실패.

## 로컬 저장·검사·권한

`tests/server/files.test.ts` 19개를 테스트 데이터베이스와 실제 ClamAV 소켓으로 다시 실행해 통과했다. 여기에는 바이트 왕복, 위장 MIME, 용량 경계, 타 회사·역할·서비스·질문 거부, 검사 전 다운로드 차단, 경로 탈출·심볼릭 링크 거부가 포함된다.

```text
Test Files  1 passed (1)
Tests       19 passed (19)
Duration    8.94s
```

실행: `npm run verify:s3`, `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/files.test.ts`.
