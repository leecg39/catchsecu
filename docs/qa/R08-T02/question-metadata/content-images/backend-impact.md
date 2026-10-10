# 문항 설명 이미지·폼 본문 이미지: 백엔드 영향 지도

작성 범위는 현재 저장소 소스의 읽기 검토와 이 문서 한 파일이다. QA 회사/fixture, DB, HTTP, 브라우저, 시험, 빌드, 생성기는 열거나 실행하지 않았다. 현재 19개 frozen fixture 보존은 root의 완료 상태를 전제로 하는 후속 구현 요구이며, 이 조사에서 독립 재검증했다고 주장하지 않는다. 아래 S/T 식별자는 마지막 표의 실제 파일·기준 행·SHA-256을 가리킨다. 각 절의 행 범위는 해당 해시의 소스 기준이다.

## 1. 계획 전에 고정할 경계

현재 작성자 자산의 업로드·검사·소유권·pin·복제·공개 권한 구조는 재사용할 수 있다. 그러나 **문항 이미지 필드 추가와 폼 본문 HTML 이미지 도입은 다른 변경 단위**다. 현재 pin은 질문에 종속되고, 폼 본문은 평문이면서 동의영수증 증거에 이미 들어간다. 본문 이미지까지 질문 배열에 억지로 넣거나 외부 img URL을 그대로 저장하면 기존 참조·권한·영수증 계약을 우회하게 된다.

원본 조사 담당 bundle_analysis의 중간 전달에는 문항 단일 questionImageKey / QUESTION_IMAGE, 추가 설명과 별도, 본문 form.description→mainText rich HTML 및 page.pageContent rich HTML이 나온다. 전달된 문항 1 MiB JPEG/JPG/PNG 및 본문 adapter 14 MiB JPEG/JPG/PNG, FORM_CONTENT_IMAGE/PAGE_CONTENT_IMAGE는 **이 에이전트가 원본 파일을 직접 재검증한 값이 아니다**. 같은 폴더 source-review.json의 최종 발췌와 root 결정 전에는 wire·MIME·개수·상한을 구현 계약으로 확정하지 않는다. 특히 본문 개수 상한과 페이지 모델은 미확정이다.

권장 분할:

1. 원본 단일 문항 이미지 계약이 확정되면 기존 Question nullable metadata + 질문 pin 구조를 확장한다. additionalExplanation 평문은 그대로 둔다.
2. 본문/페이지 HTML은 rich-content 계약, 루트·페이지 pin 모델, 이미지 URL의 로컬 ID 표현, 공유 열람 정책, 영수증 표현 및 업로드 상한을 먼저 결정한다. 단순 이미지 배열만 붙이고 원본 rich HTML 전체가 구현됐다고 판정하지 않는다.
3. 두 단위 모두 기존 AuthorAssetBlob/AuthorAsset을 재사용하고, 실제 원본 바이트·해시·검사 기록과 새 복제 소유 ID 원칙을 유지한다.

## 2. 모델과 SQL에서 실제로 막히는 지점

| 현재 코드 근거 | 확인된 구조 | 필요한 변경/위험 |
| --- | --- | --- |
| S01:1279–1342 | FormVersion.body는 String, Question.additionalExplanation은 nullable String. 이미지 필드·페이지 모델 없음 | 문항 이미지 nullable 필드와 폼 rich-content 버전/별도 표현은 additive로 설계. 기존 평문 body를 자동 HTML로 재해석하지 않음 |
| S01:1404–1427, S02:38–62 | 모든 pin의 questionKey는 NOT NULL UUID. version pin은 questionId가 반드시 있고 질문의 복합 FK를 참조. 슬롯은 material/option만 가능 | 본문용 pin에는 질문이 없으므로 현재 모델 사용 불가. 루트/페이지 슬롯만 questionKey·questionId가 null일 수 있도록 분기 CHECK 및 FK/unique 설계 필요. 가짜 질문 UUID나 고정 sentinel로 우회하지 않음 |
| S02:61–62 | unique index가 questionKey를 그대로 사용 | questionKey nullable 확장 시 PostgreSQL NULL 중복 때문에 본문 pin 중복이 생기지 않도록 해당 슬롯 전용 partial unique 또는 일관한 coalesce index 필요. 페이지가 있으면 부모 내 stable page key도 인덱스/검증에 포함 |
| S02:101–135 | author_asset_expected는 content.questions만 순회하고 version_content도 Question/QuestionOption만 합성 | 문항·본문·페이지를 하나의 canonical projection으로 추출. questions가 없는 content의 루트 키가 early return으로 누락되지 않게 순서 수정. 버전 row/템플릿 JSON/승인 snapshot 모두 같은 집합 |
| S02:243–279 | 기대 JSON과 실제 pin 집합 동등성, tenant/service/ownerKind, 슬롯→purpose, 물리 질문 관계 검증 | 새 슬롯별 purpose 분기를 명시하고 루트는 물리 질문 관계 대신 정확한 FormVersion/Template/Approval 부모를 검증. existing ELSE=OPTION_IMAGE를 그대로 두면 새 위치가 보기 이미지로 오인됨 |
| S02:296–337 | 질문·보기·템플릿·승인 BEFORE lock trigger. FormVersion에는 BEFORE content lock이 없음 | 본문 필드가 FormVersion에 생기면 기존/신규 키 합집합을 잠그는 FormVersion BEFORE 경계 필요. deferred 검증만으로 GC/attach 경합을 해결했다고 주장할 수 없음 |
| S02:339–383 | service sync + DEFERRABLE INITIALLY DEFERRED consistency. FormVersion AFTER 검사는 이미 있음 | 새 projection을 반영하되 두 방식(자동 pin 생성+service sync)을 혼합하지 않음. JSON→pin, pin→JSON 양 순서 commit 검증 유지 |
| S02:215–241, S45:328–370, S46:80–96 | 게시본과 승인 snapshot 및 pin은 불변 | 기존 함수/trigger의 보호를 완화하거나 기존 게시 row를 UPDATE하지 않음. 새 이미지가 승인 hash에 들어가야 하고 승인이후 편집은 기존 방식대로 superseded |
| S02:93–98, S03:5–40 | READ COMMITTED 변이만 허용, expiry millisecond 정밀도·소유 메타데이터 불변 | 새 migration에서 함수를 대체할 때 적용된 123의 timestamp(3) 수정 및 기존 상태전이/삭제보호를 다시 누락하지 않음 |

원본 단일 questionImageKey가 확정되면 Question에 nullable FK를 두는 선택지가 현재 optionImageKey와 일관된다. 그러나 FK만으로 tenant/service/purpose/scan/snapshot pin을 검증할 수 없으므로 projection+pin consistency도 반드시 함께 필요하다. 본문 HTML 속 img를 단순 URL 문자열로만 저장하는 경우 DB expected 집합을 만들 수 없으므로, HTML과 검증된 로컬 asset ID 목록/노드 사이의 완전 일치를 서버와 DB가 검증할 표현을 먼저 선택해야 한다. PostgreSQL 정규식만으로 HTML의 모든 img/src 변형을 안전하게 추출하는 설계는 권장하지 않는다.

## 3. purpose, 용량, 실제 이미지 검사 및 저장소

S04:3–38은 QUESTION_MATERIAL/OPTION_IMAGE 두 용도만 정의하며 byteLimit은 material이 아니면 image, mimeForName은 OPTION_IMAGE가 아니면 document 분기다. S13:330–346도 OPTION_IMAGE만 이미지 decoder로 보낸다. 새 문자열만 enum에 추가하면 확장자가 잘못 분류되거나 실제 이미지 decode를 건너뛸 수 있다. purpose→MIME→파일 상한→이미지 처리→inline 여부를 명시적 전체 매핑으로 변경하는 편이 안전하다.

S13:308–327의 PNG/JPEG 구조 검사 + sharp 실제 bounded decode, 8192 변 길이·8M pixels·4channels·한 페이지·3초·동시 2개 상한은 재사용 후보다. 이 값은 원본 관측이 아닌 독립 처리 예산이다. 새 큰 이미지 업로드가 승인되면 바이트 상한과 decoded pixel 상한을 별도로 설명하고 정상 표본으로 확인한다. 기존 해시와 바이트는 보존하고 자동 리사이즈/EXIF 제거를 묵시 도입하지 않는다.

본문 원본 상한이 최종적으로 14 MiB이면 다음 모든 층을 함께 바꿔야 한다. 현재 값만 보고 새 UI 상한을 1 MiB 또는 5 MiB로 임의 축소하지 않는다.

- S02:9–12 Blob size 최대 5 MiB, S02:29–32 Asset 최대 5 MiB 및 보기만 1 MiB CHECK.
- S04:34의 init size 최대 5 MiB, purpose별 limits와 서버 validation(S13:333–334).
- S25:30–47 readFileBody 스트림 상한, S26:39–40 scanFile 입력 상한: S27:4의 공통 10 MiB.
- S24:20–34 암호화 write 및 복호화 read의 10 MiB 상한. 업로드·scan만 늘리면 저장 또는 나중 다운로드가 실패한다.
- 새 purpose 전용 상한을 전달하거나 transport/storage의 절대 최대와 기존 FILE/DRAW/사업자등록증 제품 상한을 분리한다. 공통 MAX_FILE_BYTES만 올려 기존 응답 첨부의 허용량까지 바꾸지 않는다. 큰 요청의 메모리·암호화 복사·백신 시간 및 배포 body 제한도 후속 검증 대상이다.

S12:57–75의 durable reservation, quota lock, idempotent 현재 상태/만료 최종 검사, S12:90–138의 실제 bytes→storage→scan 단계는 유지한다. 신규 이미지도 pending/uploaded/rejected에서 공개되면 안 된다. S12:145–151은 Content-Disposition을 OPTION_IMAGE만 inline으로 선택하므로 새 이미지 purpose에 맞는 응답 분기와 보안 header를 검증한다. key는 소유 Asset UUID이고 storageKey/임의 S3 URL을 받거나 노출하지 않는다.

## 4. 쓰기 경계, 복사와 템플릿/승인

S07:20–28의 authorAssetSlots, :78–112의 withAuthorAssetReferences, :116–121의 게시 검사가 questions만 받는다. S08:150–160은 FormVersion을 먼저 생성하고 질문 쓰기만 pin wrapper로 감싼다. :270–275는 FormVersion settings를 먼저 갱신하고 그 뒤 질문 pin을 갱신한다. **본문 자산을 추가할 때는 wrapper 입력을 전체 content/typed slots로 확장하고, 기존·새 자산 잠금 후 FormVersion 본문과 질문을 같은 callback에서 저장**하도록 재배치해야 한다. 단순히 questions를 유지한 채 body 필드만 저장하면 본문 자산이 copy/approval/publish/GC 검증에서 모두 빠진다.

- 문항 이미지 저장: S08:175–213 row diff/create와 equality 비교에 새 nullable 필드를 포함. 기존 질문의 제목만 수정하거나 logical ID가 유지되면 key가 보존되어야 한다. refs는 삭제할 physical Question보다 먼저 제거한다.
- 생략과 제거: S08:249–268처럼 잠긴 **현재** draft/published source의 같은 logical question만 병합한다. 생략=현재값 보존, 명시 null=제거를 후보로 삼고 원본/계약 확정 뒤 고정한다. 과거 버전의 이미지를 부활시키거나 새 logical question에 상속하지 않는다. 본문 omission도 같은 현재 content 버전에서 처리한다.
- revise/publish: S08:421–432는 source content를 새 version으로 복제한다. 같은 logical Asset + 새 pin을 유지하되 새 pin/게시 시 최신 clean 상태가 필요하다. S07:84–90은 기존 동일 pin의 quarantine 유지와 신규 attach 검사를 구분한다. 새 이미지도 같은 규칙이다.
- explicit copy: S07:129–147은 고유 source Asset당 새 소유 ID 1개 + 같은 immutable Blob + 논리 quota 1회. 현재 두 위치만 치환하므로 문항 이미지, HTML/본문/page 노드의 모든 key도 같은 mapping으로 바꿔야 한다. 정규식으로 부분 URL만 치환하여 이전 회사 key가 남지 않게 한다. S11:4–22가 바꾸는 question/option/row ID와 새 page/노드 ID의 독립성도 결정한다.
- createTemplate/update/delete/use: S09:92–142의 저장 JSON 정규화·현재값 병합·pin wrapper·purge·복제 경로 모두 확장한다. 공용 template의 system null scope는 유지한다. 다른 서비스 template use를 일괄 거부하는 것으로 기능을 축소하지 않는다.
- approval: S10:38–52의 contentDto/fingerprint/snapshot과 독립 pin 모두 새 위치를 포함해야 한다. 편집 초안에서 이미지를 없애도 구 승인 snapshot/pin은 남는다. S08:85–91의 기존 optionSchemaVersion=0 보정 및 nullable 새 field 생략으로 구 hash를 보존한다.
- 삭제: S08:403–418의 purge와 S09:121–128은 빈 questions로 refs를 정리한다. 전체 content slots로 바뀌면 본문/page refs도 반드시 제거한 뒤 부모 삭제한다. 마지막 pin 제거 시 1시간 유예(S07:53–60), 게시/승인 참조가 남으면 임의 DELETE 금지.
- quota/잠금: S23:6–20은 모든 purpose의 AuthorAsset를 이미 집계한다. 이미지 개수나 pin 수마다 중복 용량을 부과하지 않는다. copy/useTemplate의 Company UPDATE→actor SHARE→parent→정렬 Asset→정렬 Blob 순서(S08:435–440, S09:131–138, S07:30–39)를 유지한다. 일반 저장/삭제와 역순 경합, 409 및 audit rollback을 함께 검사한다.

## 5. 읽기 권한과 외부 공개/공유의 분리

| 경로 | 현재 근거와 영향 |
| --- | --- |
| 회원 form/template/approval/submission | S14:40–88은 정확한 부모와 최신 권한/버전·응답 기한을 검사한 뒤 pin을 조회. 새 슬롯은 동일 parent에 연결하면 query 구조를 재사용할 수 있으나 manifest DTO purpose와 이미지 URL 출력은 확장 필요 |
| 일반 공개·고정 URL | S17:38–45는 contentDto를 받아 분류만 제거. 문항 이미지 새 DTO는 자동 포함될 가능성이 있으므로 공개 필드 whitelist 검토. S14:91–102는 actual publication.formVersionId의 pin만 사용하고 종료 시 상태 재확인. S43:17–18의 회사/서비스/게시 상태 검사 유지. root/page도 이 버전에 pin되어야 함 |
| 과거 응답·정정 | S18:39–69는 응답의 원래 formVersion.questions를 반환하나 본문은 반환하지 않음. 문항 이미지는 DTO 확장으로 연결; 본문 표시를 요구하면 optional content projection을 새로 정의해야 함. S18:72–102의 answers 정정은 이미지 metadata를 편집하는 경로가 아니며 FILE/DRAW attachments로 받아서는 안 됨 |
| 외부 viewer | S15:212–218은 grant의 선택 질문 stableKey로 pin을 필터링. S16:21–24 및 S44:23은 SharedQuestion 수동 projection. 문항 이미지는 선택된 질문에만 포함하도록 양쪽 확장. 현재 추가 설명도 이 projection에는 없음을 명확히 하고 목적 없이 전체 질문 DTO를 넘기지 않음 |
| 폼 본문·페이지의 viewer 공개 | questionKey=null pin은 현 questionKeys 필터에서 제외됨. 본문을 모든 viewer에게 자동 추가하면 선택하지 않은 질문 또는 민감한 안내 이미지를 열 수 있다. root 결정 전 기본 정책은 기존과 같이 제외하는 후보이며, 전체 본문 공개를 원하면 grant 계약/표시 항목을 명시해야 함. null을 필터에 무조건 OR로 추가하는 변경 금지 |
| 회사 폐쇄·복구·저장소 정리 | 회원/공개 gate는 기존 회사/서비스 상태를 재사용. 다운로드를 static public URL로 바꾸면 회수/폐쇄 gate가 사라짐. S12:160–218의 마지막 live owner 확인 후 Blob 삭제 및 worker(S42:39)는 purpose에 독립적이므로 재사용. 원회사 삭제만으로 다른 회사 template copy의 공유 bytes를 삭제하면 안 됨 |

S14:22–38의 pin→Asset SHARE→Blob SHARE→재조회→현재 clean 검사와 bytes 무결성 확인, viewer 작업 종료의 grant/session/응답 deadline 재검사를 보존한다. 처음 200으로 받은 브라우저 메모리/캐시 표시와 다음 네트워크 다운로드의 회수 보장은 구분한다.

프런트 연결 누락도 서버 수용 범위에 영향을 준다. S32:57–58 hasAuthorAssets는 material/option만 본다. S33:65,81,174,181은 서비스 전환 차단·사용 중 key·provider enable을 질문 자산에만 적용한다. S34:28, S35:124, S36:73, S37:72, S38:21의 provider도 같은 helper를 쓰므로 문항 이미지 또는 본문 이미지만 있는 폼에서 manifest가 아예 안 불릴 위험이 있다. S39 provider의 scoped URL 모델은 재사용하고 새 key의 모든 표시 면을 연결한다.

## 6. 본문 HTML·영수증·CSV의 호환성

현재 추가 설명은 명시적인 literal text이다(S31:3–21). HTML처럼 보이는 문자열도 원문으로 보존한다. 문항 이미지 때문에 이를 HTML sanitizer에 통과시키거나 trim하면 기존 저장값/승인지문이 바뀐다. 문항 이미지는 별도 key로 연결한다.

본문도 S06:12의 plain string, S33:191의 textarea, S34:133/S37:72/S38:21의 React text 렌더다. 본문 rich HTML 도입에는 legacy plain-text 식별과 새 명시적 format/version이 필요하다. 기존 '<img ...>' 또는 '<b>' 텍스트를 갑자기 실행 가능한 HTML로 해석하지 않는다. 새 표현을 bodyHtml/typed content 등 어디에 저장할지는 원본 wire adapter와 함께 root가 결정해야 한다. 이전 client의 omission 보존과 구 DTO field 부재를 구현해야 한다.

기존 sanitize-html 의존성과 S29:6–25/S30:12–16의 allowlist 패턴은 재사용 가능하지만 해당 정책 자체는 img를 제거하며 메시지 변수/이메일 링크 의미도 섞여 있다. 기존 전역 sanitizer를 완화하지 말고 폼 전용 서버 정책을 설계한다. 새 body/page HTML의 이미지 노드는 로컬 소유 Asset ID로 검증되고 parent scope URL로만 resolve해야 한다. javascript/data/blob/protocol-relative/임의 외부 origin/srcset/style URL/onerror/svg 등 우회, HTML entity/중첩/동일키 반복, 제거된 이미지와 pin 불일치를 후속 시험한다. 외부 URL 서버 fetch를 추가하지 않는다. 이미지의 정상 링크/정렬/크기 등 원본 지원 범위는 원본 발췌 확인 후 고정한다.

**영수증 결정이 필수다.** S19:20–49와 S20:16–17은 schemaVersion=1 evidence.formBody=version.body를 canonical hash 및 text PDF에 포함한다. S21:22의 PdfSource도 text만 지원한다. 문항 설명/참고자료처럼 본문 이미지도 영수증에 영향을 전혀 주지 않는다고 단정할 수 없다.

- 문항 이미지만 추가하는 단위는 기존 receipt evidence/PDF에 새 법률 증거 필드를 묵시 추가하지 않는다. 기존 영수증 암호문/hash/bytes 그대로 유지 시험.
- 새 rich HTML을 body string에 덮어쓰면 PDF에 태그 또는 내부 asset URL이 그대로 인쇄되고 documentHash 의미도 바뀐다. HTML→plain projection만 적용하면 이미지에 쓰인 정보를 영수증이 담지 못한다. 어느 의미를 지원하는지 root가 결정해야 한다.
- 영수증에 이미지 증거까지 포함할 경우 새 evidence version·immutable asset hash/본문 snapshot·필요 pin 수명·이미지 PDF renderer 및 역호환 reader가 별도 단위다. 기존 schemaVersion 1과 저장된 pdfCipher를 재생성하지 않는다. 기존 v1/v2 text renderer 바이트 회귀도 유지한다.
- 영수증은 현재 텍스트 범위를 유지하고 이미지를 version 자산으로만 보존하는 선택을 한다면 그 한계를 UI/증거 범위에 명시하고, 이미지 동의 내용이 보존됐다고 주장하지 않는다.

S22:21–58 CSV는 질문/답변 전용이며 body·설명·작성자 자산을 답변으로 내보내지 않는다. 새 설명 이미지 때문에 기존 CSV 열·값이나 첨부 FILE 권한을 바꿀 이유가 없다. 별도 요구가 없다면 CSV 결과는 그대로이며 구 응답 정정/공유/receipt를 함께 검증한다.

## 7. additive 적용과 기존 19 fixture 보존

적용된 122/123 및 그 이전 migration은 수정하지 않는다. 새 migration은 nullable field/새 슬롯 CHECK·FK·function 교체만 추가하고 기존 Question/FormVersion/Template/Approval/Answer/receipt/asset/pin row를 backfill하지 않는다. 기존 published row/approval snapshot에는 새 null 키도 넣지 않는다. contentDto는 DB null을 생략하고 legacy fingerprint의 JSON 필드 순서/형식을 그대로 유지한다.

기존 19 fixture는 현재 접근 금지 대상이므로 이번 조사에서는 파일의 비밀값이나 DB를 열지 않았다. root가 후속 보존 검사를 허용하는 시점에는 기존 공통 컬럼 hash·19개 baseline hash·stored PDF/answer ciphertext·기존 asset bytes/pin·quota/idempotency 상태가 변하지 않았음을 별도로 확인한다. ORM snapshot이 nullable 컬럼 추가로만 달라지면 **새 컬럼의 null만 한정 제외**하고 DB 전부 null 및 구 DTO field 부재를 별도 검증한다. fixture를 새 구현 기준으로 다시 freeze하여 회귀를 숨기지 않는다. 새 실험은 새 tenant/fixture에서 수행하고, 현재 frozen fixture에서 GET download나 verify helper까지 실행하지 않는다.

## 8. 후속 RED/수용 필수 항목

아래는 아직 실행하지 않은 후속 시험 목록이다. 기존 소스 시험의 재사용 위치는 마지막 T 표에 고정했다.

1. 계약: 원본 확정 key/purpose/count/MIME, null/생략/잘못된UUID/임의URL/추가키·잘못된Unicode, standalone 문항 이미지와 설명 문자열 독립성. body plain legacy와 새 HTML 명시 format 구분.
2. migration: 기존 컬럼/게시/승인/답변/receipt/asset/pin 값 불변; 새 nullable 전부 null. direct SQL 새 purpose/size/MIME, 정확 부모/tenant/service/system null-scope, physical question 또는 root/page 분기, nullable unique 중복 검증.
3. graph: JSON만/핀만/틀린 key/purpose/잘못된 parent/중복 위치 거절. content→pin 및 pin→content 양 순서 commit 성공. RR·Serializable 변이 거절. root 이미지 단독 content에서도 projection이 작동.
4. 경합: 본문 교체와 final-owner GC 양 승자 순서, 미저장 upload attach/expiry 경합, Company quota upgrade 교착 방지, 정렬 assets/blob, 200/409 및 attach/detach/copy audit 실패의 전체 rollback.
5. 편집: 현재 동일 논리 질문/본문 omission 보존, null 제거, 새 질문 상속 금지, 삭제 후 과거 값 부활 금지, 질문 삭제·타입 변경과 pin, 본문 이미지 reorder/중복 사용의 quota 1회, 이미지뿐인 폼의 저장·서비스 전환 차단·dirty/지연 업로드 취소.
6. 수명: 처음 저장 expiry 해제, 마지막 pin 해제 1h, pinned 삭제 409, quarantine 된 동일 pin 유지/다운로드 차단/새 pin·copy·publish 거절. preview/stream/complete/replay 종료 직전 자연 만료 재검사.
7. 복사·템플릿: same-service copy, cross-service use, system public template→서로 다른 회사, 매핑이 body/page HTML와 질문 이미지 전부 치환, source logical ID 미노출, 새 owner quota, immutable blob/원본 bytes 동일. 원 source 삭제/템플릿 삭제가 복제본을 깨지 않음.
8. 승인·게시: 이미지 교체가 fingerprint 바꾸고 옛 승인 사용 거절, 승인 snapshot 독립 pin, publish/revise의 구 pin/이미지 그대로 유지. 새 큰 이미지의 preflight/receipt 정책 확인.
9. 접근: anonymous member401, 현재 scope version409, mixed/duplicate query422, public unbound404, pause/revoke/회사폐쇄/응답기한/viewer회수 후 새 다운로드 차단, grant 선택 질문 외 이미지 비노출. root/page viewer 정책은 허용·거절 양쪽을 확정해 시험.
10. bytes: 실제 PNG/JPEG/ClamAV clean·EICAR/실제 손상·MIME/hash/size, decoder 자원 상한. 새 본문 최대가 10MiB를 넘으면 init/PUT/scan/encrypt/read/download 전 단계의 정상경계·초과거절, 기존 FILE/DRAW 10MiB 제한 불변.
11. HTML: 서버/브라우저 중복정제의 안정성, img 속성 우회/외부 추적/HTML entity/SSR/client 재해석, raw storageKey·token이 snapshot/HTML/로그에 남지 않음. 이미지 key 추출과 sanitized persisted content의 정확한 동일성.
12. 역사: 구 응답 정정은 원래 버전 이미지, CSV 불변, 구 receipt evidence/PDF bytes/hash 불변. 신규 영수증 정책은 별도 assertion. 재시작 뒤 새 fixture/이미지 bytes 및 19 frozen baseline은 허가된 별도 read-only 점검에서 보존 확인.

현재 조사만으로 확정할 수 없는 항목: 본문/페이지의 원본 개수 제한, HTML 허용 태그/속성, page wire/model, 이미지의 동의영수증 포함 원본 의미, body/page viewer 공개 범위, 업로드 상한 전파 후 처리 예산. 이 항목은 구현 전에 source-review와 root PLAN에서 결정해야 한다.

## 9. 파일 근거와 SHA-256

표의 해시는 이 문서를 작성할 때 디스크의 소스 bytes를 SHA-256으로 계산한 것이다. 제품 모듈을 import하거나 실행하지 않았다. 이후 다른 작업자의 편집으로 행/해시가 달라질 수 있으므로 이 표는 이 조사 시점의 근거 핀이다.

| ID | 실제 파일과 기준 행 | SHA-256 |
| --- | --- | --- |
| S01 | [prisma/schema.prisma](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/schema.prisma:1279) | 77c14bc98df7fd463593b7ba45b9e8101b995c0387cf4688897486c4cf12f039 |
| S02 | [prisma/migrations/20261025012000_author_assets/migration.sql](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261025012000_author_assets/migration.sql:38) | 059e740f4de7e93da25ab997610d041c6ce581e1860af456197fcf6aff5e005e |
| S03 | [prisma/migrations/20261025013000_author_assets_expiry_precision/migration.sql](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261025013000_author_assets_expiry_precision/migration.sql:5) | af90851ed0a690711627d2b4d05fd9479d6a13b85b3e59ece1fe3590b8ef4269 |
| S04 | [src/contracts/author-assets.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/author-assets.ts:3) | 7717b3a6398b363f25cee54f297b10dce2e75f52057a8c2d4c7cfe5d008db067 |
| S05 | [src/contracts/questions.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/questions.ts:14) | f45709c0aef93c4df78c7de12f64bcac4ff6b3f23fb5c042a92b51e01325e1ed |
| S06 | [src/contracts/domains.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/domains.ts:10) | c1a51de6cf042c32fbe7ed888ccac4584b2ef93fbeb1b7ab1c570bcbac389a9b |
| S07 | [src/server/author-asset-references.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-references.ts:20) | b7bdc5b2b3487b12cece179cb43fd0e4236a0edfb48d47ac60331dc7a8d78168 |
| S08 | [src/server/forms.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/forms.ts:45) | 810727925b9ff96c7b0e84cedf08ec74dc1127381b9bae1d497dbbdd9afeb648 |
| S09 | [src/server/templates.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/templates.ts:92) | d205d700fef293443f1b5238cf4d3df23261f420bc9539a05b6251bb73642c6a |
| S10 | [src/server/approvals.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/approvals.ts:30) | d550157b8b187054e9bd84f1b44c8dc66be487d32fbb0a2716fa1fbcb671681a |
| S11 | [src/contracts/form-copy.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/form-copy.ts:4) | f7116f6021716937822e1eb5074d8ec1b21323e7d24fe558829ea99c7074f260 |
| S12 | [src/server/author-asset-uploads.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-uploads.ts:28) | dee12fea8568226d0527cb2d517524cab867f5b0580f5fcf8f5d935447b024aa |
| S13 | [src/server/author-asset-validation.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-validation.ts:308) | 4473492b9b980d614ef3adf6d0b465f49a7a27052d077861878be369d2d0eae8 |
| S14 | [src/server/author-asset-reads.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-reads.ts:18) | eb8f37c0e7bf4d54ae932c4316d359485f358c4bf4dedd165e676e225d0dd03e |
| S15 | [src/server/viewer.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/viewer.ts:212) | ee6e63a7d97a7c952df1af20036e125113f8d17d323cfdaa813c451d5a98b59e |
| S16 | [src/server/sharing.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/sharing.ts:18) | 68c7c34211d59353ef46c2cef4e3f05387c16e9353711f8a381dc5e57f4be0e4 |
| S17 | [src/server/submissions.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/submissions.ts:38) | e199495671ee028ee30e85bc1e81ed9f7534de6920d5cf329671681fa87ee02a |
| S18 | [src/server/submission-management.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/submission-management.ts:39) | bc2239963ee6bdf368dcf5495133223497daed2047d8d011e5f3905b1d9aa788 |
| S19 | [src/server/consent-receipts.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/consent-receipts.ts:20) | 8fd52962540ba0c9d10b4fc5e5d373512a14dfc2dc8cf82486f2bc5616741a00 |
| S20 | [src/contracts/form-documents.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/form-documents.ts:16) | 0e9e5ce72c7a8539ccf358096f1a2274fc3f2b0b4fb057150686b25893161af6 |
| S21 | [src/server/pdf-renderer.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/pdf-renderer.ts:22) | 64769537b279db6a46e6709699a57ca2bceb0029226fac8c3a8e574254dc21e5 |
| S22 | [src/server/export-renderer.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/export-renderer.ts:21) | d17362c1baa2315a065b103d4164c4ad4413eff2b362ff9bcfb5de72d6091eef |
| S23 | [src/server/file-quota.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-quota.ts:6) | 48b8aba7fdf6db82e34b48d70621f4f7b22677a17140aca9268d9e53375bc423 |
| S24 | [src/server/file-storage.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-storage.ts:20) | c170df25a5ef48b73cea4470895768185244ec6d690461f955baed5f102c3da7 |
| S25 | [src/server/file-validation.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-validation.ts:30) | 98738853c605eb95fc53acea63ac72ef8d13a790e0a9d00b0ab08a01fa402b9c |
| S26 | [src/server/file-scanner.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/file-scanner.ts:39) | 2d09f1f2f7be3c3fce7dce442b0ddcc6791a6324978269a709dd390795b4431e |
| S27 | [src/contracts/files.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/files.ts:4) | fed0f280c4b41468f8e9eafa4a6792568d9da55b99e1965254201234c937c0cd |
| S28 | [src/server/author-asset-system-import.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/author-asset-system-import.ts:11) | 0bd09bc9162c614bc1f510b6d9a84e465de413e72604e60b3844c0fa4755f1c4 |
| S29 | [src/server/message-content.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/message-content.ts:6) | d9bc962cab3a45de379cf83c4f0ca4690a8e75cdaba09176ae97b56179d15f4c |
| S30 | [src/server/notices.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/notices.ts:12) | bc146cd4945cbaff1e53c21594ac513e19009910e675d06b9f6a2649aa5f8683 |
| S31 | [src/contracts/question-explanations.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/question-explanations.ts:3) | 82cc8ca19d0314a03745c01051e2aa78ab6c262433e87d6db5032727e46403fd |
| S32 | [src/lib/author-assets.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/lib/author-assets.ts:57) | 7e6d781e466f640e9edbe041f56c169901e1941bdca7a417e7904900997f8387 |
| S33 | [src/components/forms/FormEditor.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/FormEditor.tsx:65) | bec7f8868722fefe689077b9d49009b6a4c82f6e9271626ee5dc2c70fde60b33 |
| S34 | [src/components/forms/PublicForm.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/PublicForm.tsx:133) | 3eaf57faa78df0423f75f42fa4dec28db9e0ec68394b3ecb11a6b5f079e0b528 |
| S35 | [src/components/forms/SubmissionDetail.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/SubmissionDetail.tsx:124) | 0d748571754c4d5cbccc9a18afe5d06a2cd3ee89d1edf9067fff34a8b7561a3b |
| S36 | [src/components/forms/SharedPrivacy.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/SharedPrivacy.tsx:73) | 7f7ac6722a9ef6dba16812d7ac097c4785fd6357b0f6ae9628f9f1b3eef16b29 |
| S37 | [src/components/forms/Approvals.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/Approvals.tsx:72) | c7547b9d8736b6193e4ee8e18beb7bc76d9f1545eba38f3058fe534642418a27 |
| S38 | [src/components/forms/TemplateGallery.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/TemplateGallery.tsx:21) | 1108c9942f787cdb097c6b1abb5ed2d5e2db952b3dd76ba7be2a83fa4c274987 |
| S39 | [src/components/forms/AuthorAssetProvider.tsx](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/components/forms/AuthorAssetProvider.tsx:9) | e783756457f48c58bfdc4db666d17aac7057b034ade1791ef8d6a83e7df3971d |
| S40 | [src/server/audit-resources.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/audit-resources.ts:10) | 13d90aa37d1591a222e23b4661f1e4a4f225ae00a254eaa9680dfabe58cdb920 |
| S41 | [src/server/form-audit-events.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/form-audit-events.ts:31) | fd2af4524fbf880aa773ca644b8f48d253d08efb432953955b34694c378f8a3b |
| S42 | [scripts/worker.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/scripts/worker.ts:39) | 0732ca4acb5bbbd6971d922611a4c84acc910fd0bf3c630860d2c916d547b015 |
| S43 | [src/server/public-publication.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/server/public-publication.ts:6) | 599a4b65169b0af465c572bbf00a779768eb57ddbbcb6ef110139eaeac4f034c |
| S44 | [src/contracts/sharing.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/src/contracts/sharing.ts:23) | 2fe96fd9246e22d3400a52614785540fbf732455255e61f968a482e3b4c092e3 |
| S45 | [prisma/migrations/20261002094000_forms/migration.sql](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261002094000_forms/migration.sql:328) | df2545e63def70b8c0ee8c3fd334368253ce5c3c77fea6c976a722ec76ca9025 |
| S46 | [prisma/migrations/20261002120000_policy_approvals/migration.sql](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/prisma/migrations/20261002120000_policy_approvals/migration.sql:80) | 12499fb8e53fc8634e078d927d6d32a1bb92a2e788338c1616e625584ea71691 |
| T01 | [tests/server/author-asset-database.test.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-database.test.ts:114) | f5405118bcbb7a17de9a6719877b2600725b9c6ce21e75ba39f51eeb421eafde |
| T02 | [tests/server/author-asset-references.test.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-references.test.ts:78) | ccd94e220bdc1175efc0a77cd6c9138aeb012c267838e3b0d01776a85d4a252a |
| T03 | [tests/server/author-asset-reads.test.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-reads.test.ts:73) | 830efa188929273225f5c27ebcb88d34cee43424f33b48beef5d3576008383f4 |
| T04 | [tests/server/author-asset-uploads.test.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-uploads.test.ts:57) | c356907aad1fd0ea66eac6529a204989923386adc09597c3322871ad7352aa28 |
| T05 | [tests/server/author-asset-validation.test.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/author-asset-validation.test.ts:1) | dacaa31b8d17aec3447c501d7ec5d72f9dabe8792ff7be03c55ba91549993689 |
| T06 | [tests/server/question-explanations.test.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/question-explanations.test.ts:1) | d5e6579b05ac6087318f1b9d19334e7b8de2a69039c1d6fe648adc97fcd0ebe7 |
| T07 | [tests/server/question-material-links.test.ts](/Users/user01/Desktop/캐쳐시큐/catchsecu-clone/tests/server/question-material-links.test.ts:1) | 32d7e582497e0ac1039139c3c4573062202eee02376182a257c7683c42e32a51 |
