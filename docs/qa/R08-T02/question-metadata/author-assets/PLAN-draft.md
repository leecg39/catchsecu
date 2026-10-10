# FILE 참고자료·보기 이미지: 백엔드 구현 초안

상태: 읽기 전용 조사에 따른 제안. 제품 코드·DB·시험·빌드·브라우저는 실행하거나 변경하지 않았다. 최종 범위와 API 명칭은 root의 PLAN에서 확정한다. 정확한 현재 파일 SHA-256과 발췌 줄은 `backend-impact.json`, 원본 번들 근거 40개는 `source-review.json`에 연결한다. 이 문서의 자산 모델·권한·파기 정책은 원본 서버를 관측한 결과가 아니라 로컬 구현 제안이다.

## 1. 유지할 원본 계약과 독립 보완

| 항목 | 원본 클라이언트 근거 | 로컬 제안 |
|---|---|---|
| 참고자료 | FILE/LINK 혼합 합계 3개. FILE `{materialType:'FILE',orderNumber,fileKey,linkLabel:null,linkUrl:null}` | 기존 LINK strict 계약과 0기반 연속 순서 유지. FILE의 `fileKey`는 서버가 발급한 opaque AuthorAsset UUID. 실제 storage key와 blob ID는 비공개 |
| 자료 파일 | PDF/DOCX/AI, 5 MiB. 앞 4바이트 확인, DOCX는 ZIP, AI는 PDF 또는 PS | 1바이트 이상·5 MiB 이하, 실제 형식/크기/hash·ClamAV 검사. 문서는 attachment 다운로드만 제공 |
| 보기 이미지 | **`optionImageKey`** string/null. RADIO/CHECKBOX 일반 보기만, 질문당 20장, 각 1 MiB. JPEG/JPG/PNG | nullable 컬럼. 현재 논리 option의 생략은 보존, 명시 null은 제거. dropdown/matrix/custom true는 불허. 타입 전환 시 명시 제거 필요 |
| 업로드 | `asset/upload` FormData(catchformId,assetType,file,replacedS3Key?). QUESTION_MATERIAL/OPTION_IMAGE | 로컬 init → bytes PUT → complete/scan → 부모에 bind. 원본처럼 보여도 실제 스토리지 key를 받지 않음 |
| 저장/제거 | wire에서 URL/name/size/uploadToken 제외. temp/discard(s3Keys)는 best-effort | 저장 DTO에는 논리 asset key만. 교체·삭제는 reference diff이며 old blob 즉시 삭제 아님 |
| 파일명 | allowLongName:true로 일반 100자 제한 우회. 최종 서버 상한 미관측 | 제안: 255 UTF-16 이하의 유효 Unicode, NUL/제어/CRLF/경로 구분자 거절. 표시 원문 보존, 안전한 ASCII fallback + RFC5987 Content-Disposition 생성 |

원본의 미사용 오류문구에 있는 5개보다 실제 제한 분기인 3개가 기준이다. UUID 강제, 백신·문서 parser, 회사 간 소유 모델, 영구삭제 및 과거 게시본 수명은 원본 서버 미관측이다. `questionImageKey`/QUESTION_IMAGE는 별도 질문 본문 이미지 기능이며 이번 단위에서 섞지 않는다.

## 2. 재사용 범위와 모델 선택

기존 `FileObject` 직접 재사용은 권장하지 않는다. `files.ts:34–85`의 소유권은 응답/멤버 업로드이며, `file-bindings.ts:1–57`은 한 질문·공개본·응답에 결합한다. `files.ts:157–173`은 미연결 ready 서비스 파일까지 만료 정리하고, `destruction-worker.ts:82–140`은 응답 파기 시 해당 bytes를 지운다. 작성자 자료는 게시본·템플릿·승인 이력에 더 오래 남는다.

재사용할 것은 `privateFiles`의 암호화/경로 보호, `scanFile`의 fail-closed 검사, 제한된 request-body 읽기, 현재 actor/공개/공유 가드, 기한 재검사와 보안 응답 헤더다. 기존 일반 FILE/DRAW allowlist나 소유권은 넓히지 않는다. `document-pdf.ts`는 생성된 PDF를 버전에 저장하는 경로이며 업로드 DOCX/AI 모델이 아니다. 공지·가이드 첨부는 교체/삭제 시 이전 bytes가 제거되어 역사 보존 모델로 재사용할 수 없다.

### 권장: 불변 본체 + 범위별 소유권 + 부모 참조

1. **AuthorAssetBlob**: 서버 UUID/private storageKey, immutable canonical MIME·size·SHA-256, validation version, scan engine/시각/증거, upload reservation/lease, 상태. bytes를 쓰기 전에 durable row를 커밋한다. 클라이언트가 key/hash로 타 blob을 찾거나 선택할 수 없다.
2. **AuthorAsset**: 클라이언트에 보이는 새 opaque UUID, QUESTION_MATERIAL 또는 OPTION_IMAGE, 회사·서비스 소유권 또는 명시적인 platform 소유권, 생성자, 암호화된 이름, 논리 용량, blob FK, 상태/version. ready/bound 이후 bytes·크기·MIME·이름은 불변이다. 이름 변경/교체는 새 논리 asset으로 처리하여 과거 이름과 파일이 바뀌지 않게 한다.
3. **Typed parent references**: FormVersion의 질문/보기 slot, FormTemplate JSON의 질문/보기 slot, **ApprovalRequest.snapshot** 각각을 FK가 있는 참조로 고정한다. 단일 테이블이면 부모 FK exactly-one CHECK와 scope CHECK, 별도 테이블이면 동일한 불변·scope 보장을 둔다. JSON의 asset key 집합과 참조 집합을 같은 트랜잭션에서 검증한다.

승인 pin은 선택 사항이 아니다. `approvals.ts:29–51`은 현재 draft와 별개 JSON snapshot을 저장한다. 이후 같은 draft의 자료를 제거하면 FormVersion 참조만으로는 이전 승인 화면의 파일을 보존하지 못한다. 취소/대체된 승인도 기존 승인 이력 보존 기간 동안 pin을 유지한다.

참조 동기화는 **service sync + DEFERRABLE INITIALLY DEFERRED constraint trigger**를 권장한다. 서비스가 부모 JSON과 refs를 같은 트랜잭션에서 diff/update하고, DB는 커밋 시 최종 key 집합의 동등성·부모/asset scope·purpose·ready/scan 상태를 검증한다. `QuestionOption.optionImageKey`는 실제 asset FK를 가진다. SQL 자동 pin 생성과 혼합하여 숨은 이중 writer를 만들지 않는다. 부모 JSON·pin·asset의 어느 쪽을 직접 SQL로 변경해도 같은 검사와 기존 published/approval 불변 제약이 작동해야 한다. direct SQL 교차 tenant·질문 type·unsafe 상태 우회와 양방향 row-lock/fixed-snapshot 경합 시험을 필수로 둔다. deferred 검사만으로 잠금 직렬화가 자동 보장되지는 않으므로 위반 검사는 동일 부모/asset lock 프로토콜과 결합한다.

**물리 복제 대안**은 각 target에 새 storageKey와 bytes를 만들고 원본 size/hash를 확인하는 방식이다. 암호키/스토리지 격리가 필요할 때는 가능하지만, 이미 `useTemplate`과 `createForm`이 caller transaction 내부에 있고 기본 제한은 15초다. 매번 I/O·scan·대상 quota 예약·commit 후 보상·orphan 추적까지 추가해야 하므로 초기 구현은 더 크다. 권장안은 동일한 검증된 immutable blob을 공유하고 소유권/요금/참조만 원자적으로 새로 만든다.

## 3. 업로드·검사·이름의 최소 안전 경계

init은 현재 form/template write와 tenant/service를 확인한 뒤 quota와 durable Blob/Asset reservation을 기록한다. upload body I/O와 백신 검사는 긴 DB 잠금을 유지하지 않는 단계로 분리한다. complete 시 현재 권한·version·deadline·상태를 다시 잠가 검증한 뒤 ready로 바꾼다. 감사 실패 시 ready/bind는 rollback되며 이미 생성한 reservation은 cleanup 대상에 남는다. 재전송은 새 객체를 계속 만들지 않아야 한다.

신규 폼/템플릿 에디터에는 아직 parent ID가 없을 수 있다. 이 경우 쓰기 가능한 service와 발급 사용자에 묶인 미연결 reservation을 먼저 허용하고, create가 그 사용자의 ready asset만 같은 service에 원자적으로 bind하도록 제안한다. 생성 전 다른 사용자나 다른 service가 key를 가져다 붙일 수 없다. 기존 부모의 자산은 exact parent 가드를 유지한다. 저장하지 않고 나간 신규 에디터의 자산은 TTL로 정리하며, 새 폼을 먼저 강제 생성하여 빈 부모를 남기는 우회는 필요하지 않다.

`replacedS3Key`와 유사한 입력은 같은 draft slot의 교체 후보를 가리키는 힌트일 뿐이다. 새 업로드가 성공했다는 이유로 기존 게시/승인/템플릿 파일을 지우지 않는다. 부모 save가 성공한 뒤 refs를 교체한다. 취소·유형 변경 후 늦게 도착한 upload 응답은 부모에 자동 연결하지 않고 미사용 상태로 회수한다.

현재 body/storage/scanner의 10 MiB 상한은 5 MiB/1 MiB를 수용하므로 넓힐 필요가 없다. 자산별 더 작은 한도를 실제 bytes 수신 단계에서 검사한다.

- **DOCX**: ZIP의 압축/해제 크기·엔트리 수·비율·중복 경로·경로 이동을 bounded 검사하고 OOXML 필수 파트와 문서 content type을 확인한다. 암호화/손상/매크로 불일치는 거절한다. XML의 DOCTYPE/ENTITY를 거절하고 외부 엔티티나 URL을 resolve/fetch하지 않는다. 정상 문서의 external relationship 링크 자체는 일괄 금지하지 않는다. 문서를 실행하거나 서버에서 Office preview로 변환하지 않는다.
- **AI**: PDF-compatible 및 `%!PS` 계열을 둘 다 실제 fixture로 검사한다. 구조·크기·ClamAV를 확인하되 PostScript를 실행하지 않는다. 다운로드는 attachment만. 완전한 Illustrator parser를 구현했다고 주장하지 않는다.
- **PDF**: 현재 검증과 ClamAV를 기반으로 유효한 헤더/끝·크기/hash를 확인하고 attachment만 반환한다. 광범위 PDF semantic sanitization을 주장하지 않는다.
- **JPEG/PNG**: bounded decoder로 실제 decode, dimensions/pixel 수·truncation·형식 일치를 확인한다. SVG/GIF/HTML은 허용하지 않는다. **원본 bytes/hash와 EXIF는 보존**하며 임의 re-encode/metadata 제거를 하지 않는다. EXIF 방향이 있는 실제 샘플 표시도 수용 검증한다. 이미지 안전성은 임의 EXIF 제거와 같은 의미가 아니다.
- **의존성**: root 확인으로 fflate/sharp/pngjs가 로컬에 존재하지만 direct dependency가 아니다. 실제 선택한 것만 정확 설치 버전을 direct로 고정하고, parser의 자원상한·구현 세부는 공식 문서를 확인하여 결정한다. 현재 문서는 해당 라이브러리 안전성 검증을 완료했다는 주장이 아니다.

## 4. 템플릿과 복제: 허용 경로 유지

`templates.ts:51–65`는 현재 tenant의 private template 또는 tenant-null public template를 읽는다. private는 source service form.read를 요구하고 public은 tenant template writer가 수정할 수 없다. `useTemplate:126–135`는 쓰기 가능한 target service에 새 폼을 만든다. 다음을 유지한다.

| 경로 | 자산 처리 |
|---|---|
| 순수 revise/새 published version | 원본 부모 접근을 확인하고 같은 logical asset에 새 typed refs 생성 |
| 명시 copyForm/useTemplate, 같은 서비스 포함 | root 확정: 각 고유 source asset별 새 logical Asset ID와 논리 용량을 배정하고 immutable blob만 공유. 질문/보기 ID는 기존 copy 규칙대로 새로 배정 |
| createTemplate 등록 | root 확정: 발급자의 미연결 업로드 자산 또는 검증된 동일 서비스의 자산 key를 attach 가능. 등록과 명시 복사를 구분 |
| 같은 회사 다른 서비스 template use | 원본 template의 현재 접근과 target form.write를 둘 다 검사. 각 고유 원본 asset당 새 target asset ID를 만들고 내용의 key를 매핑. blob bytes는 공유하고 target 논리 quota는 새로 청구 |
| 공용 template → 임의 회사의 허용 서비스 | system-owned 원본 asset에서 target 회사·서비스 asset을 새로 생성. 원본 blob/scan/hash를 잠금으로 확인하고 새 refs와 quota를 caller transaction에서 함께 커밋 |
| 타 회사 private template | 현재처럼 접근 불가. 공용 template 경로와 혼동해 권한을 넓히지 않음 |

cross-service/cross-company 사용을 일괄 422로 막아 완료 범위를 축소하지 않는다. JSON key 재사용만으로 소유권을 넘기지 않는다. copy의 source auth와 version은 같은 트랜잭션에서 확인하고, target 사본은 이후 source 회사의 삭제/폐쇄/권한 회수와 독립적으로 생존한다. 안전하지 않은 blob 격리는 모든 사본을 차단할 수 있는 별도 보안 사건이다.

공용 template의 원본 자산은 명시적인 system owner에 둔다. 일반 사용자가 tenant-owned asset을 tenant-null JSON에 붙여 public으로 승격할 수 없다. 현재 runtime의 public template writer는 없으므로 **trusted seed/플랫폼 publisher 경로**를 함께 정하고 실제 public template 사용 fixture를 작성해야 한다. public source가 있다고 임의 asset UUID로 연결할 수 없으며 그 template의 실제 ref여야 한다.

blob의 스캔을 공유하는 것은 새로운 스캔을 실행한 것과 다르다. 기존 scan 증거를 보존하고 가짜 새 scannedAt을 쓰지 않는다. 새 정책에서 재검사가 필요하다면 blob 단위로 다시 검사하며, 동일 bytes/hash가 유지됨을 확인한다. 다운로드마다 복호화된 bytes/hash를 검증한다.

## 5. quota·트랜잭션·동시성

`files.ts:18–24` 및 `company-management.ts:133–138`은 현재 FileObject와 CompanyBusinessFile만 합산한다. 두 경로와 신규 자산 예약/복제 경로가 같은 계산을 사용해야 한다. charge는 **논리 asset당** size이며 같은 asset의 여러 refs는 중복 청구하지 않는다. 타 scope에 생성한 새 asset은 blob이 같아도 다시 청구한다. 아직 사용할 수 있는 reservation/ready/bound 및 삭제 재시도 상태를 포함하고 실제 quota release 시점을 일관되게 정한다. 시스템 자산은 별도 플랫폼 quota 정책이 필요하다.

기존 `withFormAccess`가 Company SHARE를 획득한 caller transaction 내부에서 `reserveQuota`의 Company UPDATE로 upgrade하면 두 요청이 교착할 수 있다. 계획만으로 안전하다고 간주하지 않는다. **원칙: outer idempotency/preflight부터 동일 lock order로 가장 강한 quota 잠금을 선점하고, 본문에서 잠금 upgrade를 하지 않는다.** 기존 writer도 같은 프로토콜을 사용해야 한다. 별도 quota row를 선택할 경우 세 종류 writer 모두 공통 row를 잠가야 하며 author writer만 바꾸면 직렬화되지 않는다.

부모 잠금은 현재 actor → Form/Template → Service 순서를 보존하고, 이후 관련 asset와 blob을 각각 정렬된 ID 순으로 잠근다. clone/source·target이 여러 개면 전체 관련 리소스 순서를 명시한다. GC는 Asset→Blob 순서를 따르며 Blob을 잡은 채 부모 잠금을 뒤늦게 잡지 않는다. 마지막 reference 확인·deleting 전이는 새 attach/clone과 같은 잠금으로 직렬화한다.

READ COMMITTED에서 quota 예약끼리, old ref 삭제 대 clone, template version 변경 대 use, ready complete 대 취소/GC의 **양방향 실제 row-lock 경합**을 시험한다. fixed snapshot은 안전성이 증명되지 않으면 명시적인 retryable 409로 거절한다. stale version/잠금실패/감사실패 뒤 부모 내용·refs·quota가 부분 저장되지 않아야 한다.

## 6. 접근·공개·정정·공유의 경계

작성자 파일은 폼 콘텐츠다. 제안 권한은 parent의 form.read/write이며 응답 첨부의 file.read를 일괄 요구하지 않는다. `permissions.ts:15,20`의 editor와 security approver는 form.read가 있지만 file.read가 없다. 이 사용자들이 자기 폼 작성/승인 자료를 읽되 응답 첨부 권한은 얻지 않는 시험이 필요하다.

- 관리자 preview: 현재 form/template/approval exact parent와 slot/ref, tenant/service, 세션/SSO/MFA/IP/password 정책을 확인한다. 임시 업로드 preview는 발급 사용자와 reservation proof에 제한한다.
- 일반 공개 폼: 현재 Publication token으로 확인한 **그 FormVersion**에 연결된 asset만 제공한다. raw asset key 하나로 다운로드할 수 없다. `lockPublicPublication`을 사용하고 응답 파일 init의 maxResponses gate와 혼동하지 않는다. 응답 개수 한도에 도달한 공개 페이지의 설명 자산 read는 현재 공개 상태가 유효하면 유지하는 안을 권장한다.
- 지난 공개본: superseded/revoked token은 기존처럼 종료된다. 인증된 과거 응답 상세·승인 화면은 해당 original version/snapshot의 pin으로 읽는다. 최신 draft 파일로 대체하지 않는다.
- 외부 공유: grant가 허용한 formVersion과 선택 질문에 실제 연결된 자산만 읽는다. 숨긴 질문 자산이나 다른 버전의 동일 key를 열 수 없다. `sharing.ts`의 명시 DTO와 `viewer.ts`의 grant/session/retention·issuer 검사를 새 자산 경로에도 적용한다.
- I/O/감사/캐시 이후 자연 만료를 다시 검사한다. revocation·삭제 상태를 우회하는 장기 signed URL은 발급하지 않는다. `private,no-store`, nosniff, sandbox, no-referrer를 유지한다. FILE은 attachment, 검증된 raster option 이미지만 inline이다.

`optionImageKey` 생략은 **현재** 논리 option에서만 병합한다. 옛 published option의 image를 삭제 후 되살리지 않는다. explicit null은 제거, 새 option ID는 상속하지 않는다. custom true/다른 유형으로 변경하면서 image가 있으면 생략을 묵시 삭제로 처리하지 않고 422 또는 명시 제거를 요구한다. 서버는 UI 확인 팝업에 의존하지 않는다.

## 7. 삭제·복구·GC·감사

ready인데 미연결인 자산은 제한 TTL 후 정리한다. bind된 자산은 응답 보유기간 때문에 만료되지 않는다. draft에서 제거하면 그 draft ref만 없애고 published/template/approval refs가 있으면 asset/blob을 유지한다. 이름·bytes가 불변이므로 과거 다운로드 증거도 유지된다. published/approval 이력이 있는 폼은 기존 완전삭제 거절을 유지한다.

draft purge/template delete는 자기 refs를 원자적으로 해제한다. 참조가 없는 logical asset만 삭제 상태로 전환하고, 마지막 asset/예약이 사라진 blob만 GC한다. 상태를 먼저 deleting으로 바꿔 접근을 차단한 뒤 물리삭제를 재시도한다. storage failure/worker crash/DB rollback에서 durable 추적이 남아야 한다. 이름/용량/토큰 tombstone 정책과 idempotency invalidation을 연결한다. 같은 blob을 사용하는 타 회사 asset이 있으면 원본 회사 삭제 worker가 bytes를 지울 수 없다.

`company-management.ts:78–97`은 폐쇄 **요청·취소**만 구현되어 있다. 요청을 최종삭제로 간주하지 않는다. 실제 closed 상태에서는 접근을 막되 복구를 위해 refs/bytes를 보존하는 안이며, 최종 법적 erasure 및 복구 API를 이 조사에서 이미 구현됐다고 주장하지 않는다. 요청취소 fixture와 closed/recovery 상태의 서버 gate 검증을 구분한다.

폼 감사 조회는 현재 file→FileObject.formVersionId만 추적한다. 새 author_asset 이벤트를 form/template/approval에 연결한다. 현재 refs만 join하면 제거 후 과거 audit가 사라지므로 이벤트 발생 시 불변 parent association을 남겨야 한다. 현재 tenant/service 감사 범위를 벗어난 source 회사 정보·blob ID·원시 storage key는 노출하지 않는다. `audit-resources.ts`, `form-audit-events.ts`, action 분류 및 CSV를 함께 점검한다.

## 8. 구현 순서와 완료 검증

1. 기존 계약/서버 경로만 호출하는 RED 작성: FILE union/optionImageKey가 아직 불가함을 재현. 신규 helper import 실패를 RED로 대체하지 않는다. root가 단독 실행·로그 보존.
2. additive DB 모델·nullable 옵션 컬럼·material FILE union·참조 불변/범위 제약. 이전 migration과 기존 행/DTO/hash를 바꾸지 않는다. root가 기존 테이블 및 frozen fixtures 보존→이관→fresh install→generate를 직렬 실행.
3. 전용 upload/validator/access/GC 모듈과 shared quota protocol. 실제 ClamAV clean/EICAR 및 I/O 실패 케이스.
4. forms/templates/approvals 저장·복사·개정·게시 및 refs 원자성. source/target 모든 허용 scope를 실제 통합시험.
5. 공개·관리·정정·외부공유 다운로드, 제한된 preview 및 audit/cache/worker 연결. root UI와 contract exports 협의.
6. 아래 수용 시나리오와 기존 FILE/DRAW/LINK/custom option/문서/CSV/PDF regression, production build·재시작을 root가 수행한 뒤에만 완료 판정.

필수 시험 묶음:

- strict union/3개·0기반순서/nullable·생략/현재-vs-이력 및 legacy DTO 지문.
- 이미지 20장/1 MiB, 자료 5 MiB 경계, 실제 PDF/DOCX/AI(PDF·PS)/JPEG/PNG, 긴 Unicode 이름과 안전 헤더.
- MIME·확장자·hash·size 위조, ZIP/이미지 자원폭탄·손상·암호화·ENTITY, 감염·검사불가·오래된 서명.
- 남의 회사/서비스/부모/질문 key 주입, pending/unsafe/ref없는 자산, raw storage 정보 비노출.
- 취소·늦은 업로드·중복 complete·미사용 TTL·감사 rollback. 부모 저장 전에 교체 원본을 삭제하지 않음.
- 같은 서비스라도 명시 copy/useTemplate는 새 asset ID/용량, revise는 같은 asset+새 pin, createTemplate 등록은 허가된 key attach. 타서비스/public template→회사 A/B 및 A 삭제 뒤 B bytes/hash 유지.
- 200/409, current role/service grant/SSO/MFA/IP/session/company 회수, I/O 뒤 만료 및 cache replay.
- 과거 게시본/취소·대체 승인/구응답 정정의 파일·이름 유지, 선택질문 공유와 token/grant 회수.
- 세 종류 파일의 quota 경합, clone/attach 대 GC, SQL FK/immutability, READ COMMITTED 양순서와 fixed snapshot 실패 정책.
- 응답파기가 작성자 자료를 지우지 않음, draft/template 참조 해제, orphan/GC crash 재시도, 회사 복구와 타회사 사본 생존.
- 일반 FILE/DRAW 다운로드 권한 유지. 작성자 자산을 답변 CSV나 새로운 동의 evidence에 추가하지 않고 기존 PDF/영수증 bytes/hash 보존.
- 실제 Ego에서 업로드·순서·교체·취소·유형 전환·게시·개정·모든 허용 템플릿 경로·다운로드·권한 회수·쿼터·재시작 수용.

우선 회귀 후보: `files.test.ts`, `file-access-gate.test.ts`, `question-drawing-types.test.ts`, `question-material-links.test.ts`, `question-custom-choice.test.ts`, `form-current-authority.test.ts`, `form-module-flow.test.ts`, `form-module-concurrency.test.ts`, `form-documents.test.ts`, `document-pdf.test.ts`, 공유/파기 관련 기존 시험. 실행 여부·통과 수는 이 보고서에서 주장하지 않는다.
