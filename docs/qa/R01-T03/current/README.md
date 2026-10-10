# R01-T03 파일·비공개 저장소·다운로드 공통 경계

2026-10-11 완료. Node 24.18.0, 격리된 실제 PostgreSQL 17.11, 실제 ClamAV 1.5.4와 서명된 정의, 독립 S3 SigV4 검증 서버에서 현재 파일 공통 기반을 재검증했다. 이 교차 서버 작업에는 별도 브라우저 화면이나 운영 클라우드 계정이 필요하지 않다.

## 현재 결과

- pending/uploaded 파일과 공개 제출에 아직 연결되지 않은 파일은 내려받을 수 없다. 완료 뒤에도 현재 세션·계정·이메일 인증·MFA·비밀번호·회사·서비스 grant를 매번 다시 확인한다.
- 실제 EICAR가 들어간 파일을 ClamAV가 탐지했다. 파일 상태는 rejected/quarantined·infected가 되고 저장 바이트를 제거해 다운로드할 수 없다. 스캐너 중단이나 정의 만료도 fail-closed로 처리한다.
- 회사·서비스·응답·질문·게시본 조합을 모두 검사한다. 다른 tenant의 파일 결합, 질문/proof 교환, 다른 응답 파일 교체, DB의 tenant/service/status/불변 hash 변조는 API와 복합 FK/trigger가 거부했다.
- 파일 행이나 실제 저장소 읽기를 기다리는 동안 세션·공유 grant·보유기한이 만료되면 메타데이터·파일명·바이트·감사 쓰기를 함께 롤백한다. legal hold가 있는 권한 사용자는 보유 증거를 계속 읽을 수 있다.
- 실제 저장소 삭제 실패 시 먼저 `deleting`으로 접근을 차단하고 worker 재시도로 암호문과 DB 메타데이터를 제거했다. 저장 확인 응답 손실 뒤에도 pending 행을 재사용해 업로드를 다시 완료했고 중복 PUT/complete는 객체와 검사 결과를 한 번만 남겼다.
- 로컬 저장소는 공개 디렉터리와 symlink/path traversal을 거부하고 AES-256-GCM AAD로 객체 키를 묶는다. 폴더 0700·파일 0600 정책을 적용한다.
- S3 어댑터는 독립 검증 서버가 AWS4-HMAC-SHA256을 다시 계산했다. 암호화 PUT/GET/DELETE, 잘못된 서명 거부, 다른 키 암호문 거부, 용량·경로 제한을 9개 요청으로 통과했다.
- PDF/PNG/JPEG/UTF-8 CSV는 실제 signature와 예약 MIME을 검사하고 다운로드 바이트를 바꾸지 않았다. 다국어 PDF 기반은 한글·Arabic·Thai·Turkish와 16개 언어, 고정 폰트 hash, 다중 페이지, 지원하지 않는 문자·과도한 복잡도·폰트 손상 fail-closed를 확인했다.

## 실행 결과

| 검증 | 결과 | 증거 |
|---|---:|---|
| 비공개 파일 수명주기·ClamAV·hash | 19/19 | `files.json` |
| 현재 권한·보유기한·잠금 경계 | 22/22 | `file-access-gate.json` |
| 분리 저장 실패·재시도·격리 | 17/17 | `author-asset-uploads.json` |
| 다국어 PDF 생성 기반 | 19/19 | `pdf-renderer-v2.json` |
| S3 SigV4 암호화 왕복 | 9요청 통과 | `s3-roundtrip.json` |
| TypeScript·ESLint | 통과 | 공통 파일 5개와 관련 시험 |

총 4개 시험 파일의 77개 시험이 통과했다. 환경과 수용 조건 집계는 `verification-summary.json`에 고정했다.

## 재현 명령

```bash
/Users/user01/.local/bin/node24 --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/verify-s3-storage.ts
/Users/user01/.local/bin/node24 --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/files.test.ts
/Users/user01/.local/bin/node24 --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/file-access-gate.test.ts
/Users/user01/.local/bin/node24 --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/author-asset-uploads.test.ts
/Users/user01/.local/bin/node24 --env-file=.env.test.local node_modules/vitest/vitest.mjs run tests/server/pdf-renderer-v2.test.ts
/Users/user01/.local/bin/node24 node_modules/typescript/bin/tsc --noEmit
```

운영 S3 자격증명은 사용하지 않았다. 운영 버킷 연결은 배포 환경 설정이며 이 task의 암호화 저장소 계약과 SigV4 구현 검증 범위에는 포함되지 않는다. 각 기능 화면의 실제 업로드 UX는 해당 도메인 화면·최종 검증 task가 별도로 소유한다.
