# A07/A12/A13 업로드·읽기 독립 소스 검토

검토 방식: 읽기 전용. 제품 코드·schema123·시험·DB·브라우저를 변경하거나 실행하지 않았다. root가 전달한 DB 21/21, 업로드 13/13, 참조 통합 20/20은 별도 실행 증거이며 이 검토의 재실행 결과가 아니다. 현재 작성된 read 시험 8개는 소스 범위를 확인했으며 실행 결과는 root가 기록한다.

## 최초 지적 1개 — 현재 소스 수정 확인

### P2 — 업로드 init 재전송에서 자산의 자연 만료 최종 검사가 빠짐 (수정 확인)

- 위치: `src/server/author-asset-uploads.ts:71–73`. replayBody가 `withUpload` 대신 `withFormAccess` 안에서 `lockAuthorUpload`와 `uploadInfo`만 실행한다.
- 검사 시점: `lockAuthorUpload:41`은 처음 읽은 expiresAt을 검사한다. `uploadInfo:24–26`은 ready 상태의 검사 이후 `fileQuotaUsage`를 await한다. 그 집계는 `file-quota.ts:11–13`의 순차 DB 조회 3개다. 이후 idempotent의 finalCheck는 `withFormAccess(..., async () => undefined)`이므로 현재 actor와 세션 기한만 재검사하고 **자산 expiresAt은 확인하지 않는다**. 비교 대상인 일반 GET/PUT/complete/download는 `withUpload:47–48`에서 작업 종료 후 자산 만료를 확인한다.
- 재현 조건: 원래 init 요청과 같은 Idempotency-Key/입력을 유지하고, 미참조 자산의 expiresAt이 250ms 남은 시점에 init을 재전송한다. `fileQuotaUsage` 집계 또는 이어지는 finalCheck의 DB 쿼리에 300ms 지연을 넣으면 시작 검사는 통과하지만 반환할 때 이미 만료된 자산 info가 201로 반환된다. 대기 행 잠금/느린 집계도 같은 조건을 만든다. 새 데이터 수정 없이 반환하므로 DB `AuthorAsset` update trigger는 이 경로의 만료를 막지 않는다.
- 영향: 만료된 임시 key를 성공한 업로드처럼 재전송하여 편집기가 더 이상 연결할 수 없는 자료를 성공 상태로 받아들인다. 이후 attach/download의 독립 검사는 계속 거절하므로 이 지적은 파일 bytes나 다른 tenant 권한 우회가 아니다.
- 최소 수정 방향: replay에서 읽은 자산의 deadline을 유지하고 idempotent finalCheck의 마지막 DB 작업 이후 `assertLiveAuthorAsset`을 다시 수행하거나, 그 시점에 같은 잠금의 자산을 재조회·검사한다. fresh/replay 모두가 같은 종료 검사를 사용하면 시간 경계가 일치한다.
- 필요한 회귀: 동일 init key + 지연된 quota/replay finalCheck에서 410, 기존 replay ready 성공/중복 quota 없음 유지. 본 검토자는 이 시험을 실행하지 않았다.

### 후속 소스 재확인

root 수정 후 `author-asset-uploads.ts:60,69,74–75`에서 fresh/replay 모두 reservationId를 캡처하고 idempotent finalCheck가 최신 actor 검사 안에서 `lockAuthorUpload`를 다시 호출하는 것을 확인했다. 이 재호출은 quota 집계 및 cached/fresh response 처리 뒤 자산을 잠근 상태로 재조회하고 `assertLiveAuthorAsset`를 실행한다. 최초 지적의 누락 경로는 현재 소스에서 해소됐다.

신규 `author-asset-uploads.test.ts` 마지막 시험은 같은 key, expiresAt 250ms, quota 집계 후 300ms 지연으로 410 및 자산 한 행 유지라는 의미 있는 회귀를 검증한다. 본 검토자는 시험을 실행하지 않았다. root의 최종 실행 결과와 이 소스 판단은 별도로 취급한다. read 8/8 GREEN 및 UI 55/55 GREEN은 root가 전달했으며 새로운 보안 실행 증거로 확대하지 않았다.

## 확인한 방어 경계

- 업로드 발급자는 회사·Membership ID·ownerKind company로 제한되며 최신 service form.write와 현재 actor/policy/session을 잠근다(`uploads:34–50`, `form-access:11–16`, `service-actor:20–59`). decode 및 백신 스캔을 트랜잭션 밖에서 수행하더라도 이후 별도 withUpload에서 현재 권한과 자산을 다시 잠근다(`uploads:88–130`).
- bytes의 declared size/hash/MIME·실제 형식은 업로드/complete에서 검사한다. uploaded/ready에 대한 재 PUT은 다른 bytes를 덮어쓰지 않는다. read는 복호화 bytes의 size와 SHA를 확인한 후 자산 deadline을 다시 검사한다(`uploads:134–142`).
- member 읽기는 exact parent의 form/template revision, approval 또는 submission의 원래 버전을 사용한다(`reads:40–80`). strict union 및 반복 query 거부로 문맥을 혼합할 수 없다. 저장된 실제 pin이 없는 asset ID는 404다(`reads:22–38`). 직접 입력되는 storageKey/blobId/ownerKind는 없다.
- 공개 읽기는 현재 게시본·회사·서비스·Form/Publication 활성 상태를 잠그고 I/O·감사 후 재검사한다(`reads:91–102`, `public-publication:6–21`). response count를 다운로드 금지로 해석하지 않는 것은 root의 명시 계약이다.
- 공유 열람은 현재 grant/session/발급자 권한과 정확한 원래 formVersion/submission을 확인한다. 질문 key는 grant.fields 집합으로 제한된다(`viewer:212–219`). withViewer가 읽기·감사 이후 발급자/공유/세션/응답 보유 deadline을 다시 검사한다(`viewer:95–120`). grant 회수는 row lock과 grantVersion으로 직렬화된다.
- 논리 복제 용량은 새 회사 Asset 크기만 합산하고 pin 수로 중복 청구하지 않는다. 초기화 및 copy/useTemplate은 actor SHARE 이전 Company UPDATE를 선취득한다. 기존 응답파일 초기화도 reserveQuota가 먼저 실행된다. read-only usage는 일관 snapshot이 아닌 현재 합계 안내지만 quota 허용 판단은 Company UPDATE 아래 수행된다.
- 최종 삭제는 deleting 상태로 이미 접근이 차단된 Asset만 대상으로 Asset→Blob 순서로 잠근다. 같은 blob의 다른 non-deleted owner가 하나라도 남으면 bytes를 삭제하지 않는다(`uploads:158–177`). 마지막 bytes 삭제 후 DB/audit 실패가 나도 기존 durable deleting 상태가 남고 remove의 ENOENT 허용으로 재시도할 수 있다(`file-storage:70–72`). orphan blob 경로는 blob lock 후 live owner를 다시 확인한다(`uploads:202–214`).
- system importer는 HTTP에 노출되지 않는 trusted entry이며 ownerKind system, tenant/service/createdBy null을 DB 제약으로 보존한다. pending Asset/Blob을 먼저 commit하여 저장 실패·프로세스 중단의 정리 표적을 남기고, ready 전 실제 형식/백신 및 현재 expiry를 검사한다(`system-import:11–48`). 일반 사용자 업로드 preview는 system asset을 찾지 못한다.

## 검토 한계와 후속 수용 범위

확인한 코드는 pin 존재와 현재 scope에 따른 인가를 갖추고 있으며, 위 expiry 재전송 지적은 수정됐으며 권한 회수·공개/공유 범위·마지막 blob 삭제에서 재현 조건이 확정되는 추가 결함은 찾지 못했다. 이는 모든 경합이나 저장소 장애를 실행 검증했다는 뜻이 아니다.

현재 업로드 시험은 실제 ClamAV 정상/EICAR, outage/저장 실패 mock, 현재 권한, 다른 발급자, preview 자연 만료, 삭제 재시도, 통합 quota를 다룬다. read 시험 8개는 exact query/revision, 공개 capacity·pause, 구응답 버전/기한, 승인 독립 pin, 격리, 실제 system ingest, 공유 선택/회수, 공개 I/O 후 expiry를 다룬다. 이 소스만으로 다중 회사의 동시 clone↔마지막 owner GC, 백신 중 권한 회수, 마지막 삭제 직후 audit 실패, system import 프로세스 중단·복구, 회사 최종 폐쇄·복구 이후 공유 blob 수명까지 실행되었다고 주장할 수 없다. 회사 closure request와 실제 최종 데이터 파기/복구는 별도 제품 단계로 확인해야 한다.

임의 raw SQL deadlock/isolation 오류가 어느 Prisma code로 노출되는지는 실행하지 않았다. 현재 HTTP 래퍼는 P2034를 409로 매핑하며 P2010의 SQLSTATE를 별도로 분류하지 않는다. 따라서 reference-integration.md의 임의 direct SQL 모든 경합이 HTTP 409로 귀결된다는 확대 해석은 하지 않아야 한다. 정규 copy 동시 호출과 quota 직렬화는 root references-first.json의 시험 범위다.

## 검토 시점 소스 지문

관찰 시각(UTC): 2026-10-10T08:12:21.067088+00:00

| 파일 | SHA-256 |
| --- | --- |
| `src/server/author-asset-uploads.ts` | `dee12fea8568226d0527cb2d517524cab867f5b0580f5fcf8f5d935447b024aa` |
| `src/server/author-asset-reads.ts` | `eb8f37c0e7bf4d54ae932c4316d359485f358c4bf4dedd165e676e225d0dd03e` |
| `src/server/author-asset-system-import.ts` | `0bd09bc9162c614bc1f510b6d9a84e465de413e72604e60b3844c0fa4755f1c4` |
| `src/server/file-quota.ts` | `48b8aba7fdf6db82e34b48d70621f4f7b22677a17140aca9268d9e53375bc423` |
| `src/server/viewer.ts` | `ee6e63a7d97a7c952df1af20036e125113f8d17d323cfdaa813c451d5a98b59e` |
| `src/app/api/v1/author-assets/[[...segments]]/route.ts` | `cdbdeba646a1ab2cbc7124e29f8b5c82a88d95e8ab72c513969050fa71e69464` |
| `src/app/api/v1/public/forms/[...segments]/route.ts` | `74e16b669f640415b0be91132c815ffc6a2c22e021a5fd02d0101e3024ecc918` |
| `src/app/api/v1/viewer/[...segments]/route.ts` | `e7cfee4a17ffd0f583cd9ff86ef39f3c81e28a1ac04d1fbe7deca9071e41b0f7` |
| `src/server/form-access.ts` | `2a088f47f97e0342e0717bfab47d3e25c9c292d1bc12e926f721998142babf11` |
| `src/server/service-actor.ts` | `90de94af2280241df81b535e480f44bf2b925d918bfcd2cc2649fceec4fa4545` |
| `src/server/file-access.ts` | `5d69c3b1ec143b709fb32a829cd5e97d6c5d36e6701536660d798286bc992feb` |
| `src/server/public-publication.ts` | `599a4b65169b0af465c572bbf00a779768eb57ddbbcb6ef110139eaeac4f034c` |
| `src/server/idempotency.ts` | `cff00186d5ad761363d9dbf84173f5cd3ef22759494a397fb9970ba316a8be70` |
| `src/server/file-storage.ts` | `c170df25a5ef48b73cea4470895768185244ec6d690461f955baed5f102c3da7` |
| `tests/server/author-asset-uploads.test.ts` | `c356907aad1fd0ea66eac6529a204989923386adc09597c3322871ad7352aa28` |
| `tests/server/author-asset-reads.test.ts` | `830efa188929273225f5c27ebcb88d34cee43424f33b48beef5d3576008383f4` |

### 수정본 추가 지문

재관찰 시각(UTC): 2026-10-10T08:12:39.616299+00:00

- `src/server/author-asset-uploads.ts`: `dee12fea8568226d0527cb2d517524cab867f5b0580f5fcf8f5d935447b024aa`
- `tests/server/author-asset-uploads.test.ts`: `c356907aad1fd0ea66eac6529a204989923386adc09597c3322871ad7352aa28`
