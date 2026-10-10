# A05 DB 설계 결정

기준 migration121 → additive migration122. DB 적용·generate·시험은 root가 직렬 실행한다. 이 문서는 구현 중 필드/호출 계약이며 실행 완료 주장이 아니다.

## 모델

- `AuthorAssetBlob`: `id,storageKey,mime,size,sha256,validationVersion,status,scanStatus,scanEngine,scannedAt,expiresAt,leaseUntil,version,createdAt,updatedAt`. 상태 pending/uploaded/ready/quarantined/deleting/deleted. bytes identity는 불변이며 격리 상태는 기존 역사 참조를 유지하면서 읽기만 차단한다.
- `AuthorAsset`: `id,blobId,ownerKind,tenantId,serviceId,createdById,purpose,nameCipher,size,status,expiresAt,version,createdAt,updatedAt`. ownerKind company/system, purpose QUESTION_MATERIAL/OPTION_IMAGE. pending/uploaded/ready/rejected/deleting/deleted. 회사 소유는 tenant/service/creator 필수, system은 tenant/service null. 기본 미연결 보관 1시간. 참조가 있으면 expiresAt null, 마지막 참조 제거 시 서비스가 새 유예시각을 설정한다.
- `AuthorAssetReference`: `id,assetId,tenantId,serviceId,formVersionId,questionId,templateId,approvalId,questionKey,slot,orderNumber,optionKey,createdAt`. 세 부모 ID 중 정확히 하나. 버전은 physical questionId FK 및 logical questionKey가 함께 일치. template/approval은 JSON의 logical questionKey. material slot에는 orderNumber, option slot에는 optionKey만 존재. 참조행 수정은 불가하며 draft/template 변경은 delete+insert.
- `QuestionOption.optionImageKey`: nullable Asset FK. DTO의 null 생략/현재 논리 ID 병합은 root 계약/서버 담당.

## 서비스 sync와 DB 검증

`createdById`는 User ID가 아닌 **Membership.id**이며 `Membership(tenantId,id)` Restrict FK다. 서버는 `ctx.member.id`를 넘긴다. system owner는 tenantId/serviceId/createdById가 모두 null이어야 한다.

서비스는 부모 JSON/QuestionOption과 pin을 같은 transaction에서 작성한다. DEFERRABLE INITIALLY DEFERRED constraint trigger가 최종 expected key/slot 집합과 pin 집합을 양방향 비교한다. FK/즉시 가드는 scope/purpose/clean 준비상태와 참조 불변을 막는다. DB 트리거가 pin을 자동 생성하지 않는다.

폼 참조는 draft 상태에서 게시 전에 작성한다. Approval pin은 승인 row를 생성한 transaction에서 모두 작성하며 이후 snapshot/pin 변경·삭제를 허용하지 않는다. published version 참조도 수정/삭제/사후 추가 불가다. 기존 immutable trigger를 대체하지 않는다.

신규 asset은 pending reservation으로 시작하거나, ready/clean blob에서 ready 상태의 새 소유 사본으로 시작한다. 후자는 실제 source 권한을 검증한 서버만 호출한다. DB는 scope·bytes identity 및 부모 결합을 보장하며 HTTP 호출자의 권한을 추론하지 않는다.

## 동시성과 수명

새 자산 관련 변경은 READ COMMITTED만 지원한다. RR/Serializable은 0A000으로 명시 거절하며 route의 409 매핑은 root 후속 서버 단계가 담당한다. 부모→정렬 asset→blob 잠금 프로토콜을 서비스에 요구하고 direct SQL의 반대 row-lock 순서 경합에서는 deadlock abort로 전체 불변식을 보존한다. Blob deleting 전이는 살아 있는 소유 asset이 없어야 하며 Asset deleting은 pin/option FK/JSON 참조가 없어야 한다. pin 작성/삭제와 자산 GC는 동일 asset row를 잠근 뒤 새 snapshot으로 확인한다.

기존 parent에 자산이 전혀 없으면 신규 검사로 레거시 쓰기 경로의 격리 계약을 바꾸지 않는다. 미연결 reservation은 1시간 만료를 기본으로 갖는다. 논리 quota는 삭제되지 않은 Asset.size를 합산하므로 pin 개수는 용량에 영향을 주지 않는다. ready blob 공유가 타 회사 소유권 공유를 뜻하지 않으며, raw storageKey/blobId는 API DTO에 노출하지 않는다.

## 실행 경계

신규 DB 시험은 실제 테이블·SQL transaction으로 missing schema RED와 제약 GREEN을 구성한다. 조사자/구현자는 DB·ClamAV·스토리지 시험을 실행하지 않았다. 시험 파일 ESLint는 통과했다. source byte/decode/백신 사실 자체와 caller 권한은 이후 A06/A07 서비스 단계의 책임이다. 저장된 scanEngine은 명시적인 DB fixture 문자열이며 실제 검사 결과로 보고하면 안 된다.

시험에는 attach가 먼저인 경우와 GC가 먼저인 경우 모두 실제 `pg_blocking_pids` 대기를 관측하는 2개 row-lock 경합이 포함된다. blob GC 대 새 scoped copy, 여러 asset 간 정렬 순서, 기존 FileObject/사업자 파일과 quota 잠금 경합은 A06/A11/A12 서비스 연결 단계에서 추가 시험해야 한다.

## 첫 DB 실행과 additive123 수정

root 실행 `database-first.json`은 20개 중 18통과/2실패다. 첫 실패는 migration122 상한 비교의 실제 정밀도 결함이다. TIMESTAMP(3) expiresAt 기본값은 최대 0.5ms 위로 반올림되는데 고정밀 clock_timestamp와 비교해 정상 기본값을 거절할 수 있었다. 적용된122는 변경하지 않고 새123에서 비교 시각에도 timestamp(3)를 적용했다. 여유시간을 추가하거나 1시간 계약을 넓히지 않는다.

두 번째 실패는 시험 fixture가 stableKey와 짝인 label을 빠뜨려 기존 QuestionOption_identity_check에 막힌 것이다. label을 보완했고 20개 이미지 성공/21번째 전체 rollback 검증은 그대로 유지했다. 기본값 autocommit INSERT 100회와 명시적 1시간 초과 거절을 확인하는 회귀 1개를 추가하여 현재 21개다. 추가/수정 시험과123의 실제 적용·통과는 root 재실행 대기다.

## 호출 순서와 오류

- 예약: Blob pending → Asset pending. bytes 기록 후 Blob/Asset uploaded. 검사 후 Blob ready+clean+engine+scannedAt → Asset ready. 각 UPDATE는 version을 정확히 1 증가시킨다.
- 복사: ready+clean Blob에 새 Asset(status ready, size 동일, 발급 Membership.id). default 만료는 1시간이다. 한 transaction의 bind가 성공하면 expiresAt을 null로 바꾼다.
- 저장: 부모 내용·ref diff·Asset.expiresAt을 같은 transaction에 저장한다. 순수 개정은 기존 Asset을 pin하며 명시 복사는 새 Asset을 쓴다. ref DELETE는 physical question/template DELETE보다 먼저 한다.
- 삭제: 마지막 pin 해제 후 expiresAt을 현재부터 1시간 이내로 설정한다. expired reservation은 clear/extend로 부활시킬 수 없다. Asset deleting→deleted 이후, 해당 Blob의 모든 소유 Asset이 deleted이면 Blob deleting→deleted를 허용한다. 실제 storage 삭제와 재시도는 서버 worker의 책임이다.
- DB 반환: 구조/상태/집합 위반 23514, FK 23503, 중복 23505, 고정 snapshot 0A000, direct SQL 역순 잠금의 deadlock 40P01 가능. route가 409 또는 적합한 공개 오류로 매핑해야 한다. DB 예외 원문·storage key를 사용자에게 노출하지 않는다.
