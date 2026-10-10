# A08–A12 작성자 자산 참조·복사 연결

## 범위와 증거 경계

작성자 참고자료 FILE와 일반 보기 `optionImageKey`를 폼·템플릿·승인 원문과 `AuthorAssetReference`에 함께 저장한다. 원본 opaque 키는 로컬 `AuthorAsset.id` UUID로 분리하며 스토리지 키나 blob ID를 콘텐츠 DTO에 넣지 않는다. 기존 응답 첨부 `FileObject`의 소유권·다운로드 계약은 바꾸지 않는다.

소유 제품 파일은 `src/server/author-asset-references.ts`, `forms.ts`, `templates.ts`, `approvals.ts`, `question-options.ts`이다. 신규 시험은 `tests/server/author-asset-references.test.ts`의 20개 사례다. 이 문서 작성자는 DB·시험·마이그레이션·Prisma generate·빌드·브라우저를 실행하지 않았다. 아래 DB fixture는 그래프/트랜잭션 검증용이며 실제 파일 검증·ClamAV 성공을 뜻하지 않는다. 실제 업로드와 백신 시험은 주 에이전트의 별도 업로드 시험이 담당한다.

## helper 계약

- `authorAssetScope(ctx, serviceId)`: 회사·서비스·발급 Membership ID·감사 User ID.
- `authorAssetSlots(questions)`: FILE의 질문 logical ID/0 기반 순번, 보기 이미지의 질문·보기 logical ID를 추출한다.
- `withAuthorAssetReferences(tx, scope, parent, questions, requestId, write)`: 같은 트랜잭션에서 이전/다음 자산을 잠그고 제거 pin을 먼저 삭제한 다음 `write`를 수행하며, 물리 질문이 만들어진 뒤 새 pin을 삽입한다. `parent`는 `{kind:'version'|'template'|'approval',id}`다.
- `assertAuthorAssetReferences(...)`: 저장 콘텐츠와 실제 pin의 정확한 집합 일치 및 현재 모든 blob ready/clean을 검사한다. 게시·승인·복사의 입구다.
- `copyAuthorAssets(...)`: 인가된 source 원문과 pin을 검증하고 unique source key당 한 번 용량을 예약한 뒤 새 회사 소유 Asset을 만든다. blob은 공유한다. 이후 호출자가 `cloneFormContent`로 질문·보기·분기 ID를 새로 배정한다.

helper는 임의 HTTP scope를 인가하는 공개 API가 아니다. 호출자는 먼저 현재 actor와 정확한 source/target parent 권한을 확인해야 한다. null tenant/service/member의 system scope는 신뢰하는 플랫폼 importer에서만 사용한다. 콘텐츠 참조 helper 자체에서 공개 템플릿을 판별하거나 타회사 읽기를 허용하지 않는다.

## 저장·이력 정책

1. 폼 생성과 현재 초안 갱신은 materialList와 optionImageKey를 저장하고 같은 commit에 정확한 pin을 만든다. 보기 이미지 null은 DB NULL, DTO는 필드 생략이다. current logical option 생략 보존은 공통 option-identities 계약을 사용한다. 과거 이미지가 나중에 되살아나지 않는다.
2. 옵션 일괄 UPDATE에 optionImageKey를 포함한다. 기존 physical question/option ID와 immutable value는 유지한다. 삭제되는 질문의 pin은 restrictive FK보다 먼저 제거하며 options는 기존 Question cascade를 사용한다.
3. 명시 revise와 자동 새 초안은 같은 Asset ID에 새 version pin을 만든다. 이전 게시 행/pin은 수정하지 않는다. 새 pin이므로 격리된 blob은 개정을 차단한다.
4. 같은 서비스라도 명시 `copyForm`/`useTemplate`은 새 Asset ID·현재 발급 member·논리 용량을 만든다. 동일 자산이 한 콘텐츠에서 여러 번 쓰이면 새 자산은 하나이고 pin만 여러 개다. ready/clean blob의 이름 암호문·size·blob ID가 복사된다. 물리 I/O나 백신 재실행은 하지 않으며 최초 검증 및 이후 다운로드 무결성 검사는 별도 모듈이 담당한다.
5. 기존 `getTemplate`의 source 인가와 대상 서비스 form.write 인가 뒤 복사한다. 같은 회사의 다른 서비스 템플릿과 공개 system 템플릿 사용이 가능하다. 타회사 private 템플릿은 기존 locateTemplate 경계 밖이다. 타회사 자산 키를 직접 저장하는 것은 scope 불일치다.
6. createTemplate은 해당 서비스의 권한 있는 기존 자산을 그대로 참조할 수 있다. 아직 어디에도 pin되지 않은 업로드는 발급 member만 연결할 수 있다. 이미 pin된 같은 서비스 콘텐츠는 권한 있는 작성자가 재사용할 수 있다.
7. 승인 생성 트랜잭션에서 snapshot 전용 pin을 별도로 만든다. 이후 초안 삭제·교체·승인 supersede는 과거 승인 pin을 지우지 않는다. 기존 DB approval snapshot 불변 규칙을 유지한다.
8. 기존에 동일한 slot/key pin이 있는 quarantined blob은 무관한 초안 편집에서 그대로 유지할 수 있다. 새 slot/key pin, 복사, 게시, 승인은 ready/clean만 허용한다. 격리 시 읽기 차단은 read 모듈의 책임이다.
9. 초안 purge와 템플릿 삭제·참조 해제는 해당 parent pin만 삭제한다. 마지막 pin이 없어지면 DB millisecond clock 기준 한 시간 grace를 부여한다. 다른 게시본/승인/템플릿 pin이 남으면 expiresAt NULL을 유지한다. 실제 저장소 제거는 root의 GC worker가 담당한다.

## 잠금·원자성

- 기본 순서: 현재 actor/parent 잠금 → 모든 관련 Asset ID 정렬 FOR UPDATE → 모든 관련 Blob ID 정렬 FOR UPDATE → 콘텐츠/pin 변경 → 수명 정산 → 같은 트랜잭션 감사.
- 새 논리 용량을 만드는 `copyForm`/`useTemplate`은 함수 **첫 줄**에서 `lockFileQuota`로 대상 Company FOR UPDATE를 선취득한다. 이후 actor의 Company FOR SHARE를 잡는다. source 검사 뒤 `reserveQuota`를 재호출해도 이미 같은 회사 UPDATE lock을 갖는다. 실제 fresh idempotent operation은 replay validator보다 먼저 실행되므로 현재 HTTP fresh 경로의 upgrade는 없다.
- 외부 typed caller가 먼저 actor SHARE를 획득한 트랜잭션에서 copy를 호출한다면 **최상위 트랜잭션 시작에서 Company UPDATE를 선취득해야 한다**. helper는 호출자가 이미 잡은 lock을 되돌릴 수 없다. 반대 순서의 직접 SQL은 DB deadlock rollback 가능성을 유지하며 HTTP의 409 처리 대상이다.
- 새 복사 Asset은 같은 트랜잭션에서 생성되어 아직 다른 세션에 보이지 않는다. source blob 잠금을 유지하므로 GC/격리와 복사가 교차해 오래된 ready 상태로 통과하지 않는다.
- DB123의 service sync + deferred exact graph 검사와 FK/immutable/READ COMMITTED 제한을 그대로 사용한다. schema/적용된 migration122·123은 이 작업에서 수정하지 않았다.
- 409 CAS, 자산/기본 업무 감사 실패, quota 거절, 최종 actor/deadline 실패는 부모·자산·pin·수명을 모두 rollback한다. pin detached 감사는 parent purge 전에 formId와 parentKind/parentId를 기록한다. resource=`author-asset`, action=`author_asset.attached|detached|copied`; 원문 파일명/내용은 감사에 넣지 않는다.

## 준비한 20개 통합 시험

생성/정확한 물리 pin/논리 용량; legacy null/제목 저장 ID 보존; 생략·명시 제거·부활 방지; 질문 삭제 순서와 grace; 유형 변경 시 이미지 제거; scope/purpose/expiry/unknown key 원자 거절; 다른 member 임시 업로드 및 템플릿 재사용; 격리 유지와 새 연결/게시/복사 거절; CAS·감사 실패 rollback; 게시/개정 원문 및 pin 불변; 승인 독립 pin; 같은 서비스 복사의 새 ID·중복 제거·같은 blob; 다른 서비스 템플릿 사용; 공개 system 템플릿 사용; 템플릿/초안 삭제 후 마지막 grace; quota 부족 및 동시 canonical 복사; 복사 감사 실패; 최신 member/대상 서비스 인가; 실제 HTTP create/copy replay 및 PATCH 200/409; RR·직접 JSON bypass rollback.

root가 실행하기 전 이 문서는 시험 통과를 주장하지 않는다. 다운로드·원문 bytes·scan 재검증·공유 회수·회사 폐쇄·worker GC 경합은 root가 소유한 업로드/read/worker 시험과 실제 UI 수용에서 별도로 확인해야 한다. 동시 복사 시험은 두 호출의 Company UPDATE 직렬화와 잔여 quota 원자성을 확인하며, 임의 direct SQL 모든 lock 순열의 무교착을 주장하지 않는다.
