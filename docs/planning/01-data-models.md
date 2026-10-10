# 데이터 모델·수명주기 설계안

## P06-T06 공통 모델 구현 (2026-10-04, 진행 중)

서비스별 `VerificationIntegration`과 불변 `VerificationIntegrationRevision`, 게시 버전/브라우저 nonce/요청·문서 HMAC을 고정한 `VerificationAttempt`, 중복 공급자 이벤트 해시를 막는 `VerificationEvent`, 검증 사실과 제출을 연결하는 `VerificationReceipt`를 추가했다. 회사/서비스/폼/게시 버전은 복합 FK로 연결한다. 설정 이력과 이벤트 본문 해시는 수정할 수 없고, 설정 변경은 이전 세대의 미소비 요청과 생성 키 응답을 무효화한다.

운영 제출에는 production 증거만 연결할 수 있다. 같은 접수에 본인인증/전자서명 영수증을 각각 하나씩 연결할 수 있으며, 같은 종류의 중복 연결과 다른 문서/공급자/게시 버전/검증 이벤트 연결을 DB에서 거부한다. 이 제약의 합성 DB 시험은 실제 공급자 서명 검증이나 sandbox 성공의 증거가 아니다.

현재 고객 설정은 `pending`/`disabled`만 허용하며 삭제는 `deleted` 상태·새 세대로 기록한다. 실제 공급자 어댑터, raw callback 서명 검증, 공개 challenge·제출 영수증 소비와 인증 원문/임시 파일의 만료·파기 연결은 아직 구현 전이다. 설정 등록이나 모델 추가로 verify 폼 게시·접수 차단을 해제하지 않는다. 전체 작업 계획과 수용 조건은 [P06-T06 계획](../qa/P06-T06/PLAN.md)을 유지한다.

아래는 독립 백엔드의 설계 모델이며 원본 DB 스키마를 추출한 결과가 아니다. 구현된 모델의 정확한 필드·제약·삭제 규칙은 [P00-T03 계약 기준선](contracts/README.md), [Prisma schema](../../prisma/schema.prisma), migration SQL을 따른다. 아직 없는 모델은 아래 제안 상태를 유지한다.

## P11-T03 공급자와 외부 계정 참조 구현 (2026-10-06)

실제 모델은 `SsoProvider`, Better Auth `Account`, `SsoState`다. 아래 초기 설계의 IdentityProvider/ExternalIdentity/AuthAttempt 이름을 대신하며 동일한 공급자·신원·인증 시도 역할을 맡는다. `Account.providerId = sso:<공급자 UUID>`와 `Account.ssoProviderId`를 DB 트리거·CHECK로 일치시키고 FK RESTRICT로 고아 연결과 참조 중 공급자 ID 변경/직접 삭제를 막는다. 일반 인증 계정은 이 FK가 NULL이다. 공급자 소유 회사와 현재 Membership은 인증·조회·변경 시 서버에서 재검사한다.

기존 유효 계정은 migration으로 참조를 채운다. 기존 고아 계정이 있으면 migration 전체를 롤백하며 임의 삭제하지 않는다. 정상 공급자 삭제 API는 마지막 로그인 수단 보호 후 연결 계정·세션·대기 인증·감사를 같은 트랜잭션에서 정리한다. [구현과 검증](../qa/P11-T03/provider-reference/README.md).

## 공통 기준

- 모든 회사 소유 엔티티에 `tenantId`, `id(UUID)`, `createdAt`, `updatedAt`, 변경 가능한 엔티티에 `version`을 둔다. 조직 간 참조는 `(tenantId,id)` 복합 FK로 차단한다.
- 사용자·인증 공급자 식별은 전역이고 Membership이 회사 소속을 결정한다. 토큰이나 요청의 임의 tenantId만 믿지 않는다.
- 기본 복합 인덱스 `(tenantId,status,createdAt,id)` 및 실제 검색 키를 둔다. 유일성은 회사 범위를 명시한다.
- 시간 저장은 UTC, 표시·조회 경계는 Asia/Seoul 포함 사용자가 선택한 시간대. 금액은 최소 화폐 단위 정수와 currency. 부동소수점으로 합산하지 않는다.
- 삭제는 리소스마다 archive/revoke/purge를 구분한다. 소프트 삭제만으로 개인정보 파기가 완료됐다고 기록하지 않는다.
- 비밀번호·일회용 토큰은 해시, OTP secret·외부 API 비밀·민감 응답값은 키 버전을 포함해 암호화한다. 검색 필요 PII는 정규화된 별도 검색 인덱스/해시를 검토한다.
- 원문 응답·파일 URL·토큰·비밀번호를 로그/추적 필드에 기록하지 않는다.

## 엔티티와 제약

| 영역 | 모델과 핵심 필드 | 관계·제약·삭제 규칙 |
|---|---|---|
| 계정 | User(emailNormalized, passwordHash, name, department, jobTitle, phone, locale, status, verifiedAt); CredentialHistory(hash, changedAt); AccountClosure(userId, requestedAt, completedAt, reasonCipher) | email 유일; 직책은 선택 입력·100자 상한; 탈퇴는 Membership/자산 인계 후 closed 상태 변경·세션/인증 회수; 폐쇄 기록 불변·사유 암호화; 자격증명 재사용 규칙 검증 |
| 세션 | Session(userId, tokenHash, expiresAt, idleExpiresAt, revokedAt, ipHash, device); AuthChallenge(purpose, recipientHash, tokenHash, attempts, expiresAt, consumedAt) | 일회용 challenge의 원자적 소비; 로그아웃/암호 변경 후 세션 무효화 |
| 2FA | MfaFactor(userId,type,secretCipher,status); RecoveryCode(hash,usedAt) | 사용자·종류 유일; 활성화 전 challenge 확인; 복구코드 한 번만 사용 |
| 외부 인증 | IdentityProvider(tenantId,type,issuer,clientId,secretRef,metadata,enabled); ExternalIdentity(providerId,subject,userId); AuthAttempt(stateHash,nonce,returnTo,status) | provider+subject 유일; 임의 이메일 일치만으로 계정 자동 연결 금지; returnTo 허용목록 |
| 회사 | Company(name,publicName,businessFileId,address,taxContact,status); CompanyClosure(requesterId,status,reason) | 개인 사용자 DB와 조직 수명주기 분리; 마지막 owner 제거 금지; 청구/보존 상태 확인 후 폐쇄 |
| 소속·역할 | Membership(tenantId,userId,status,roleId); Role(name,scope); Permission(code); RolePermission; ServiceGrant(memberId,serviceId,capabilities) | tenant+user 유일; 서비스 범위별 역할 검사; owner 이동은 트랜잭션 |
| 초대·전문가 | Invitation(emailHash,roleId,serviceIds,tokenHash,expiresAt,status); ExpertAssignment(expertId,tenantId,scope,expiresAt) | 수락은 초대받은 검증 이메일만; 만료·회수 지원; 전문가 타 회사 열람도 명시적 배정 |
| 서비스 | Service(name,externalName,description,type,status); ServiceConsentDisplay(kind,mode,externalUrl,documentVersionId); Subprocessor(name,country,purpose,items,retention) | tenant 내 이름/slug 정책; 폐쇄된 서비스로 폼 게시/발송 금지; 재위탁 공지 이력 연결 |
| 정책 | CompanySecurityPolicy(passwordRules,sessionMinutes,approvalRules,destructionRules,revision); IpRule(cidr,description,enabled); PolicyChange(actorId,before,after) | 정책 변경 이후 로그인/게시/세션에 실제 적용; IP 설정 잠금 방지; 마지막 인증수단 제거 차단 |
| 양식 | Form(serviceId,title,status,publishedVersionId,ownerId); FormVersion(formId,number,body/bodyRich,sectionSchemaVersion,completionPage*,closedPage*,consentItemSchemaVersion,consentItems,settings,publishedAt); FormSection(formVersionId,pageKey,order,title,body/bodyRich,destination,allowBack) | form+number·버전+pageKey/order 유일; 페이지1~50개·첫 페이지 제목/본문 비움·기본 경로 종료; 새 저장본의 동의 항목은 문항 분류에서 순서·중복을 보존해 고정하고 기존 버전은 schema0/NULL 유지; draft만 편집 가능; published version/section 불변 |
| 질문 | Question(formVersionId,sectionId,stableKey,type,label,required,order,subjectRole,condition,matrixRows,selectionLimits); QuestionOption(questionId,value,label,order,branchDestinationKind,branchDestinationSectionId) | version+stableKey 유일; 페이지형 버전은 모든 질문이 같은 버전 section을 참조; 조건은 앞선 선택형 질문의 유효한 답변만 참조; 페이지당 항상 표시되는 객관식/드롭다운 질문 하나만 보기별 목적지를 가질 수 있고 기본·보기 간선은 같은 버전의 도달 가능 DAG; 게시 시 DB 재검증·게시본 불변; 독립 복제 시 질문·행·페이지 ID와 참조 치환 |
| 작성자 자산 | AuthorAsset(tenantId,serviceId,purpose,blobId,status,expiresAt); AuthorAssetReference(parentType,parentId,slot,questionKey?,documentKey?,nodeKey?,assetId) | 질문 참조는 questionKey, 폼/페이지/완료/마감 rich 문서는 slot+documentKey+nodeKey로 식별; 부모·tenant·service·목적·검사 완료·물리 blob 일치를 DB에서 검사; 같은 자산의 여러 노드는 독립 pin, 용량은 자산별 한 번 계산; 게시·승인·템플릿 이력 pin 보존; 복제는 새 자산 ID로 치환; pin과 GC는 같은 자산 잠금 순서 사용 |
| 템플릿·즐겨찾기 | FormTemplate(tenantId,serviceId,title,category,content,version,status); FormFavorite(memberId,formId) | 공용(tenantId/serviceId 모두 NULL)과 서비스 템플릿 분리; 회사+서비스 FK와 서비스 권한 검사; 복제 시 새 폼·질문 ID; favorite 복합 유일 |
| 게시·공유 | Publication(formVersionId,tokenHash,expiresAt,maxResponses,count,status); FixedUrl(slug,currentPublicationId,status); ApprovalRequest(formVersionId,status,reviewerId,reason) | 공개 토큰 원문 DB 저장 금지; 게시 승인 완료 전 token 비활성; 응답 한도 원자적 증가 |
| 응답 | Submission(formVersionId,publicationId,subjectId,status,submittedAt,retentionUntil,legalHold,pagePathVersion,visitedPageKeys,terminationKind); Answer(submissionId,questionId,valueCipher,valueType) | 같은 게시 버전 질문만 허용; 서버가 답변으로 방문 경로를 재계산해 처음 페이지·가능한 연속 간선·정상 종료를 저장하고 참여대상 제외 제출을 거부; 문자열·선택 배열·행 ID별 구조화한 행렬 답변을 검증 후 암호화; 방문·표시된 필수 질문만 검사하고 미방문/숨김 원문 주입 거부; 정정 시 경로에서 빠진 현재 값을 비우고 암호화된 변경 이력 보존; 중복 제출키 유일 |
| 정보주체·동의 | DataSubject(contactHash,contactCipher); ConsentReceipt(submissionId,documentVersionId,purpose,channel,grantedAt); ConsentEvent(receiptId,type,at,evidence); Correction(requestId,field,beforeHash,afterCipher) | 동의 당시 내용/버전 고정; 철회 새 이벤트; 동의 증거와 현재 상태 분리 |
| 마케팅 | MarketingPreference(subjectId,serviceId,channel,status,changedAt); Suppression(contactHash,channel,reason,sourceEventId) | tenant+subject+service+channel 유일; 발송 직전 suppression 재검사; 체크박스 변경 이력 보존 |
| 수집 목적·문서 | ProcessingPurpose(name,itemCategories,lawfulBasis,retentionRule); Recipient(name,country,purpose,items,transferMethod); Document(type,title,status); DocumentVersion(number,structuredBody,renderedContent,publishedAt) | 문서 타입 P/C/OC 정확한 의미는 P00 증거로 확정; 미확정 문서 공개 금지; 참조 버전 삭제 금지 |
| 공개 문서 | DocumentPublication(versionId,tokenHash,expiresAt,revokedAt); DocumentAccess(at,viewerScope) | 최신 alias와 고정 버전 링크 구분; 회수된 token 즉시 거부 |
| 업로드 | ImportJob(fileId,mapping,status,total,valid,errorCount,committedAt); ImportRow(rowNo,normalizedData,error,status) | dry-run→검증→명시적 반영; job+rowNo 유일; 재시도 중복 생성 금지; 실패 행 다운로드 |
| 파일 | FileObject(tenantId,ownerType,ownerId,storageKey,originalName,mime,size,hash,scanStatus,retentionUntil,status); FileGrant(fileId,granteeScope,expiresAt) | 저장 경로 사용자 입력 사용 금지; 확장자/MIME/내용·용량 검증; 검사 전 열람 차단; 객체와 DB 삭제 일관성 |
| 외부 열람 | ShareGrant(formId,fields,viewerEmailHash,tokenHash,expiresAt,revokedAt); ViewerSession(grantId,challengeId,expiresAt); SubjectSession(subjectId,tokenHash,scope,expiresAt) | 최소 필드·기한·횟수 제한; 인증 전 자료 없음; grant 회수 시 기존 세션·파일 URL 권한 재평가 |
| 발신자 | Sender(channel,addressNormalized,label,verificationStatus,verifiedAt,expiresAt,providerRef); SenderVerification(challengeId,status,evidenceFileId) | tenant+channel+address 유일; 발신자 확인되지 않으면 발송 금지; 번호 재인증 만료 처리 |
| 메시지 | MessageTemplate(channel,title,body,variables,status); Campaign(channel,senderId,content,status,scheduledAt,recipientQuery); CampaignDelivery(campaignId,contactHash,status,attempt); SmsReceipt(deliveryId,providerMessageId,status,errorCode) | draft만 내용 수정; snapshot 수신자+발송 직전 동의 확인; campaign+contactHash 유일; 발송 후 물리 삭제 금지 |
| 알림톡 | KakaoChannel(providerChannelId,name,status); KakaoTemplate(channelId,code,content,buttons,status,rejectionReason,version) | provider 승인 상태를 로컬에서 임의 변경 금지; 내용 변경 후 재심사; 버튼 URL 변수 검증 |
| 알림 연동 | Integration(serviceId,name,provider,endpointCipher,enabled); EventSubscription(integrationId,eventType,filter); NotificationAttempt(eventId,integrationId,status,attempts) | 외부 주소 SSRF 방어·리디렉션 제한; event+integration 유일; 비밀값 응답 마스킹 |
| 라이선스 | Plan(code,features,prices,version,status); Subscription(planVersionId,status,start,end,cancelAt); Entitlement(feature,limit,used) | 가격·할당량은 서버 계산; 과거 결제 당시 planVersion 고정; 개발 seed 무제한 권한도 실제 검사 경로 사용 |
| 결제 | PaymentMethod(tokenCipher,provider,kind,label,status); PaymentOrder(amount,currency,status,version); PaymentEvent(providerEventId,outcome); PaymentRefund(orderId,amount,status,reason); BillingMonthClose(month,currency,totals,digest) | PAN/CVV 저장 없음; success URL만으로 paid 금지; 환불 누계≤승인액, 중복 callback 차단. 청구·결제 이력은 주문·구독·월마감 원장에서 조회 |
| 원장·사용량 | LedgerEntry(accountId,currency,amount,direction,transactionId); UsageEvent(serviceId,feature,quantity,occurredAt,sourceKey); BillingMonthClose(month,currency,totals); ComplianceClose(serviceKey,month,snapshot) | transaction 균형 검증; sourceKey 유일; 금액/사용량 중복 차감 금지; 결제 마감과 준수 마감을 분리하고 마감 후 조정 이벤트로 처리 |
| 감사·파기 | AuditEvent(actor,action,resource,resourceId,at,redactedDiff,requestId); RetentionRule; DestructionJob; DestructionCertificate; ExportJob | 감사 사용자 수정/삭제 없음; 파기 보류 우선; export 범위 승인·만료·다운로드 로그 |
| 통계·준수 | AnalyticsSnapshot(serviceId,period,metrics,sourceWatermark); ComplianceCheck(ruleVersion,evidence,status,checkedAt) | 원천과 집계 일치; 모든 응답 0인 상태도 테스트; 준수 판정에 설명·증거 연결 |
| 공지·도움말 | Notice(title,category,body,status,publishedAt,authorId); NoticeAttachment(noticeId,status,fileName,mime,fileSize,fileSha256,storageKey); Guide(category,title,fileId,order,status); SupportTicket(tenantId,serviceId,authorId,kind,subjectCipher,bodyCipher,replyCipher,status,version) | 시스템 운영자만 공지/공통자료와 답변 변경; 고객은 조회/본인 문의·제안 작성; HTML sanitize, 첨부 검사·암호화 저장 및 문의 암호화 |
| 작업·수신 이벤트 | OutboxEvent(type,payloadRef,status); Job(type,dueAt,leaseUntil,attempts); ProviderEvent(provider,eventId,signatureStatus,processedAt); IdempotencyRecord(scope,key,requestHash,response) | eventId/key 복합 유일; worker lease·재시도·dead-letter·재처리; 트랜잭션 커밋과 outbox 생성 동시 수행 |

## 핵심 상태 전이

응답 CSV 즉시 다운로드는 기존 Submission·Answer·게시 질문/행 정의·FileObject·AuditEvent를 사용한다. 비동기는 ExportJob(요청자/회사/서비스/폼·HMAC 키/입력·암호화 조건/layout·상태/version·진행/기한/lease), ExportChunk(100건 단위 암호화 CSV), ExportSource(원천 응답/순서/HMAC)를 사용한다. 같은 렌더러로 게시 버전·행렬 행 열과 현재 보유/파일 권한을 적용한다. 결과는 최대 24시간 또는 더 빠른 응답 보유 기한까지다. 정정/파기·권한/정책 변경의 DB trigger, 취소/삭제/실패/만료는 결과·조건·hash를 제거하고 요청 키 tombstone을 남긴다. 원문 CSV 디스크 파일은 보관하지 않는다. [구현 범위와 증거](../qa/P06-T02/exports/README.md)를 적용한다.

- Form: draft → pendingApproval → published → paused → archived. 수정은 새 draft/version; 응답 보존 여부에 따라 purge 제한.
- Submission: submitted → corrected/withdrawn → pendingDestruction → destroying → destroyed. legalHold가 있으면 파기 시작을 막는다. 시작 전 취소·반려는 이전 상태로 돌아가며, destroying 이후 원복을 허용하지 않는다.
- ImportJob: uploaded → validated → committing → completed/partialFailed/failed. 같은 job 재실행은 중복 반영 없음.
- Campaign: draft → scheduled → dispatching → completed/partialFailed/failed. 예약 상태만 cancel; 접수된 delivery 취소 가능 여부는 서비스사 계약 확인.
- Payment: pending → authorized/paid → partiallyRefunded/refunded; 실패·취소는 별도. 분할 환불과 웹훅 순서 역전을 검증.
- ShareGrant/Publication: active → expired/revoked. 만료된 토큰으로 공개 문서·첨부 접근도 금지.
- Job: queued → leased → done/retry/dead. worker 중단 후 lease 회수, idempotency로 중복 부작용 방지.

## 최소 seed·fixture

회사 A/B, A의 owner/admin/editor/viewer/billing/security 역할, B 사용자, 정지 사용자, 외부 열람자, 전문가 배정/미배정. 서비스 A1/A2/B1, 권한 허용/거부 계정, 모든 기능 허용 라이선스/제한 라이선스. 빈 목록·11개 이상 목록·100개 경계, 초안/공개/마감/회수 폼, 파일 정상/격리/만료, token 정상/만료/소비/타회사, 발송 성공/실패/지연/중복, 결제 성공/실패/부분 환불을 가상 데이터로 생성한다.

## 추가 참조 모델

- AccessRequest(tenantId,userId,serviceId,reason,status,reviewedBy): 조직 소속·대상 확인, pending 중복 방지.
- IdentityVerification(tenantId,subjectRef,provider,challengeId,status,verifiedAt,evidenceHash): 공급자 검증 후 verified. 불필요한 원문식별번호 저장 금지.
- SignatureEvidence(tenantId,submissionId,documentVersionId,providerRef,documentHash,signedAt,status): 당시 문서와 검증결과. UI 그림만으로 검증 성공 표시 금지.
- UseCaseView(publicationId,presentationConfig,status): customer-use-case 경로 의미를 확인한 뒤 필요할 때 도입. 개인정보 응답 임의 공개 금지.
- LocalePreference(userId,locale): 언어 선택. 소개 화면의 locale 계약은 P00에서 확인.
- ClauseTemplate(tenantId 또는 platformScope,type,title,structuredBody,version,status): 동의문구 재사용·개정·사용자입력 무해화.

전역 사용자/공통공지/가이드/상품 카탈로그와 회사 소유 데이터를 구분한다. tenant 규칙을 전역 데이터에 기계적으로 적용하지 않는다.

## 가이드 자료 구현 (2026-10-03)

Guide는 회사별 자료가 아닌 전역 공통 자료다. 분류와 분류 순서, 제목과 문서 순서, draft/published/archived 상태, PDF 파일 이름·크기·SHA-256, 초기 자산 키 또는 암호화 저장 키, 게시 시각과 낙관적 버전을 저장한다. 초기 자산 키는 로컬 원본 35건에만 사용하고 운영자 교체 파일은 비공개 암호화 저장소로 이동한다. 게시 상태는 파일 메타데이터와 시각을 필수로 하는 DB 제약을 둔다. [실제 PDF 검증](../qa/guides/README.md).

## 승인 증거 구현 (2026-10-02)

ApprovalRequest는 tenant/form/version/requester/reviewer를 복합 FK로 묶는다. formRevision, policyRevision, snapshot, contentHash, 암호화된 요청/결정 내용을 보존한다. pending→approved/rejected/cancelled/superseded, approved→consumed/superseded만 허용한다. DB 트리거가 검토본 변경, terminal 결정 변경, 삭제를 거부한다. Publication.approvalId는 동일 tenant/form/version의 승인 하나에 연결되며 재사용을 unique로 제한한다. SecurityPolicy의 승인 revision은 승인 관련 설정 변경 때만 증가한다.

## 비밀번호 정책 구현 (2026-10-02)

User.passwordChangedAt은 credential 갱신과 함께 기록한다. PasswordHistory는 현재 해시를 제외한 과거 해시 최대 9개를 보관한다. Account의 credential 공급자는 사용자당 하나로 제한한다. PasswordDeferral은 tenant/member/user 복합 FK, 암호 변경 시각, passwordRevision, 세션 또는 기간, 만료 시각을 저장한다. 정책 변경과 암호 변경으로 이전 유예를 무효화한다.

SecurityPolicy의 minPassword/passwordMonths/passwordReuse/passwordDeferral은 DB check와 API 계약이 동일한 범위를 검사한다. 변경/재설정은 사용자별 PostgreSQL advisory lock과 같은 DB 트랜잭션 안에서 수행한다. 암호 이력·변경 시각·세션·링크 회수·감사를 DB 트리거로 묶는다. migration 9/10, UTC 저장과 과거 데이터 보정 근거는 [검증 기록](../qa/password-policy/README.md)에 있다.

## 첨부파일 구현 (2026-10-02)

FileObject는 tenant/service, ownerKind/member, publication/formVersion/question, submission을 복합 FK와 트리거로 검증한다. nameCipher는 암호화 파일명이고 storageKey는 서버가 발급한 UUID이다. 상태는 pending→uploaded→ready→attached 또는 rejected/deleting/deleted로 이동하며 버전을 증가시킨다. ready/attached는 clean 검사와 엔진·검사시각이 필수이다. 바이트·소유권·질문 연결은 변경할 수 없다.

공개 업로드는 uploadTokenHash와 1시간 만료를 가지며 제출 트랜잭션에서 응답에 연결하고 권한을 회수한다. 정정 전 파일은 이전 답변의 증거로 보존한다. 임시 파일의 실제 삭제는 deleting→객체 제거→deleted 순서로 수행하며 실패하면 재처리한다. 제출된 증거의 실제 파기는 아래 후속 모델에 연결했다. [첨부 검증과 범위](../qa/files/README.md).

## 보존·파기 구현 (2026-10-02)

Submission.originalRetentionUntil은 원래 동의한 기한이며 변경할 수 없다. retentionUntil은 그 기한을 넘지 못하고, API에서는 만료 후 연장·보존 조치 중 변경·파기 진행 중 변경을 거부한다. retentionVersion은 자동 파기 접수의 중복을 구분한다.

DestructionRequest는 tenant/service/submission과 requester/approver를 복합 FK로 연결한다. source, previousStatus, dueAt, retentionKey, 암호화 사유, version, attempts/maxAttempts, leaseOwner/leaseUntil, nextAttemptAt을 가진다. 활성 요청은 응답당 하나이다. pending→scheduled→running→completed이며 retry/failed, 실행 전 cancelled/rejected를 지원한다. 일정 변경은 pending으로 돌아가 승인을 초기화한다. 취소된 만료 접수는 같은 retentionVersion에서 다시 만들지 않는다.

worker가 running 요청과 Submission.destroying을 함께 확정하면 DB 트리거는 새 원문 쓰기와 원복을 거부한다. 파일을 제거한 다음 답변·메모·정정·동의 증거를 삭제한다. 증명서가 있고 원문이 없으며 파일이 모두 deleted인 경우에만 destroyed 상태로 변경한다. 원래 불변이던 동의·정정 기록 삭제도 실행 중인 파기에서만 허용한다.

DestructionCertificate는 응답·요청마다 하나이며 수정·삭제를 금지한다. 수량, 실행 시각, 현재 DB/저장소 범위, 처리 방식과 정렬된 필드의 HMAC을 저장한다. 원문을 지운 뒤에도 감사와 최소 식별자·파일 객체 키는 남긴다. WAL·백업·외부 사본은 증명 대상에 포함하지 않는다.

IdempotencyRecord는 tenantId/resourceType/resourceId로 응답 또는 파일에 연결한다. 파기 시작 또는 24시간 만료 시 responseCipher/requestHash를 비우고 invalidatedAt과 재실행 방지 표식만 유지한다. 이전 버전의 소속 없는 캐시는 migration에서 일괄 무효화한다. SecurityPolicy.automaticDestruction과 allowRetentionAdjustment는 기본 false이다. 자세한 상태·업그레이드·검증 범위는 [파기 검증 기록](../qa/destruction/README.md)에 있다.

## 수집 목적·제공/수탁자 구현 계약 (2026-10-02)

- `ProcessingPurpose`는 회사·서비스, 이름, 처리 목적, 수집 근거 및 설명, 항목별 이름·일반/민감/고유식별 분류·필수 여부, 보유 기준, 상태·version을 저장한다. 비동의 근거는 구체적인 설명을 요구한다.
- `Recipient`는 같은 범위의 제3자 제공·처리 위탁·원자료 제공자, 국가·지역, 처리 목적·항목, 보유 기준, 연락처 및 국외 처리 방법·시기·거부 안내를 저장한다. 국내 이외 제공/수탁에는 네 안내 필드를 모두 요구한다. 원자료 제공자 기록은 국외이전 동의 증명으로 취급하지 않는다.
- `PurposeRecipient`는 회사·서비스·목적·제공자의 복합 FK를 사용한다. 같은 서비스의 사용 중인 제공자만 연결할 수 있다. 활성 목적에 연결된 제공자는 보관할 수 없다. 보관된 제공자가 남은 목적은 먼저 제공자를 복원한 뒤 복원한다.
- 보유 유형은 `days`(1~36500일), `until_purpose`, `statutory`이다. 후자 둘은 일수를 NULL로 두고 종료/보존 기준을 입력한다. 이 자료만으로 실제 응답의 보유 기한을 자동 변경하지 않는다.
- 이름은 NFKC·앞뒤/연속 공백·대소문자를 정규화해 사용 중인 자료의 중복을 차단한다. 제공자는 유형별 이름 범위를 갖는다. 개인정보 항목 이름도 중복을 허용하지 않는다. 국가·지역은 고정 Unicode CLDR regular 코드 257개를 사용한다.
- 수정·보관·복원은 version을 하나 올리고 `PurposeRevision`/`RecipientRevision`을 같은 트랜잭션에 추가한다. 수집 목적의 개정본은 연결된 제공자의 당시 전체 설정도 보존한다. 이후 제공자 수정은 과거 목적 개정본을 바꾸지 않는다.
- 개정본은 수정·삭제할 수 없다. DB 제약은 개정본 없는 본문 변경과 개정본에 반영되지 않은 연결 변경도 거부한다. 보관은 이력을 유지하는 설정 자료 삭제 방식이다.
- 구현: migration 15~17, `src/server/processing-catalog.ts`. CSV 반영은 아래 수집 모델에 연결했다. 문서 생성·게시는 아래 문서 모델에 연결했다.

## CSV 수집 구현 (2026-10-02)

- ImportJob은 회사·서비스·생성자·반영자·FileObject·ProcessingPurpose·원자료 Recipient·내부 FormVersion을 복합 FK로 연결한다. 설정·헤더·당시 근거를 암호화하며 변경마다 version을 올린다. 반영 이후 근거와 양식은 바꿀 수 없다.
- ImportRow는 CSV 논리 행 번호·물리 줄 번호·검증 오류·파일 안의 중복 원행·암호화 임시 원문을 저장한다. 같은 job/row 응답은 unique이고, 반영된 행의 임시 원문은 비운다. 중복 행은 원행 Submission에 연결해 응답 파기 때 함께 제거한다.
- CSV 응답의 publicationId는 null이고 importJobId/importRowNo가 필수다. 공개 제출과 CSV 수집은 정확히 한 출처만 가진다. 공개 링크를 만들 수 없는 sourceType=import 양식을 사용하며 기존 조회·정정·보존·파기 절차에 연결한다.
- ImportEvidence는 당시 목적·제공자·수집일·근거 설명·형식 검증 규칙을 암호화한다. 동의 컬럼이 검증된 경우에만 imported 유형의 동의 기록을 남긴다. 공개 폼의 직접 동의와 구별한다. 증거는 수정할 수 없고 승인된 실제 파기 중에만 삭제할 수 있다.
- 작업 처리기는 먼저 원본 암호화 객체를 실제 삭제한 뒤 50행씩 반영한다. 삭제 실패·권한 회수·프로세스 중단은 retry/failed와 임대 회수로 처리한다. staging은 최대 24시간이며 취소·보관·만료 때 삭제한다. 파기 증명서는 importEvidence/importRows 제거도 확인한다.
- 구현: migration 18, `src/server/imports.ts`, `src/server/import-worker.ts`. [검증 자료](../qa/imports/README.md).

## 구현 계약 — 문서·게시·서비스 표시 (2026-10-03)

- migration 19: Document의 version/draftRevision, DocumentPurpose/Recipient 서비스 범위 FK, DocumentVersion의 불변 snapshot/renderedText/SHA-256, DocumentPublication의 암호화 token·만료·회수.
- 문서 보관/비공개 시 전체 링크 회수. 복원 후 이전 token 재활성화 금지. 게시본·token·문서 범위 변경과 삭제를 DB에서 차단한다.
- ClauseTemplate의 복사 적용은 원본 템플릿 변경과 독립적이다. ServiceConsentDisplay는 collection/third_party별 version과 문구·HTTPS 외부 주소 또는 같은 서비스의 게시 처리방침을 참조한다. 연결된 처리방침 회수는 차단한다.
- 독립 공개 경로는 /document/view/:token이다. P/C/OC 코드의 원본 의미는 여전히 미확정이다. 폼 동의 당시 문서·PDF 연결은 아래 migration 21 계약으로 구현했다. [증거](../qa/documents/README.md).

## 구현 계약 — 게시 문서 PDF (2026-10-03)

DocumentPdf(migration 20)는 DocumentVersion당 한 개의 서버 생성 PDF 바이트·SHA-256·본문 해시·글꼴/렌더러 버전·페이지 수를 보존한다. 회사/서비스/문서 복합 FK, PDF 시그니처와 실제 바이트 해시 CHECK, 불변 트리거를 적용한다. 폼 동의 영수증은 아래 별도 암호화 모델로 연결했다. [증거](../qa/document-pdf/README.md).

## 구현 계약 — 폼 문서와 동의 영수증 (2026-10-03)

- migration 21: FormVersion.consentDisplay/receiptEvidenceVersion, FormDocumentBinding, ConsentReceipt.evidenceVersion/evidenceCipher/pdfCipher/pdfHash.
- FormDocumentBinding은 FormVersion·DocumentVersion과 회사/서비스 복합 FK로 연결한다. 버전당 문서/순서 유일, 최대 10개, 게시 후 INSERT/UPDATE/DELETE 금지. 초안 변경 시 연결을 교체한다.
- 문서 유형은 consent/overseas_transfer만 허용한다. 동의 문서는 같은 서비스의 공개 중인 버전이며, 일수형 목적 보유 기간보다 폼이 더 오래 보관할 수 없다. 처리방침은 안내에 복사하고 별도 동의 항목으로 취급하지 않는다.
- 초안에 표시 문구·공개명·내부 처리방침 본문/해시를 고정한다. 승인 스냅샷·해시에 포함하고 재저장 시 기존 승인을 무효화한다. 문서 공개 회수와 폼 게시는 Service 잠금으로 직렬화한다. 게시된 폼의 사본은 원문 링크 회수 이후에도 유지된다.
- 새 직접 동의 기록은 evidenceVersion=1이며 당시 수락 문서만 포함한 JSON과 실제 PDF를 암호화한다. canonical 증거 SHA-256과 파일 SHA-256을 보존한다. version=0 기존/CSV 기록에는 후대 증거를 붙이지 않는다.
- 철회는 ConsentEvent를 추가하며 원래 증거를 바꾸지 않는다. 파기 처리 시 기존 subject_write_barrier를 적용하여 영수증 행과 이벤트를 완전히 삭제한다. [검증](../qa/form-documents/README.md).

## 구현 계약 — 외부 공유 (2026-10-03)

- migration 22: ShareGrant는 회사·서비스·폼·게시 버전·생성 구성원과 복합 FK로 연결한다. 이메일은 암호화와 조회 HMAC, 초대코드는 HMAC으로 저장한다. 최대 90일의 기한과 version, revokedAt을 가진다.
- ShareField는 같은 게시 버전 Question과 복합 FK로 묶는다. 버전 고정과 현재 Answer 기준으로 열람하며 다른 게시본·과거 정정 첨부는 범위 밖이다.
- ViewerChallenge는 grantVersion, clientHash, codeHash, attempts(0~5), expiresAt, consumedAt을 가진다. ViewerSession은 해당 challenge/grant 복합 FK, tokenHash, grantVersion, expiresAt, revokedAt을 가진다. 동시 검증은 하나의 세션만 만든다.
- 변경/재발송/회수는 grant UPDATE 잠금 아래 모든 기존 인증을 무효화한다. 열람·다운로드는 현재 회사/발급 구성원/서비스 권한→폼→grant→session→응답→파일 SHARE 잠금으로 검사한다. 철회·파기 요청·기한 종료 응답은 보존 조치 여부와 관계없이 외부 열람에서 제외한다.
- 원문·토큰을 감사 로그에 넣지 않는다. 회수는 소프트 삭제다. 외부 열람자 이메일·인증/로그의 운영 보존·정리 정책은 후속 게이트다. [검증](../qa/sharing/README.md).

## 구현 계약 — 정보주체 조회·동의 철회 (2026-10-03)

- migration 23: Question.subjectRole(name/email/null), Submission.subjectId, DataSubject. 지정 역할은 필수 단문형이며 게시본당 이름·이메일 각각 하나만 허용한다. 회사·서비스·정규화 이름/이메일 조합 HMAC은 유일하며 연락처는 암호화한다. 기존 게시 질문은 소급 분류하지 않는다.
- 응답 생성·CSV 반영 때 명시적 두 항목으로 연결한다. 정정은 응답 잠금→기존/신규 식별 HMAC의 정렬된 advisory lock→연결 변경 순서다. 마지막 연결이 사라지면 DataSubject와 그 인증 범위를 삭제한다. DataSubject 자체는 수정하지 않는다.
- migration 24: SubjectAccessRequest(tokenHash/browserHash/expiresAt/consumedAt), SubjectAccessScope(requestId,tenantId,subjectId), SubjectSession(requestId/tokenHash/expiresAt/revokedAt). 본인 조회는 단일 subjectId 추정 대신 요청 당시의 명시적 범위 목록으로 제한한다. 인증 후 범위 추가·변경은 DB 트리거로 금지한다.
- SubjectWithdrawal은 같은 세션·회사·응답에 묶이며 requested→completed/cancelled만 허용한다. 진행 중인 요청은 세션·응답당 하나다. 완료 중복 확인은 상태를 재변경하지 않는다. 다른 세션·정정된 버전·보유 종료 응답은 거부한다.
- Suppression은 회사·서비스·이메일 HMAC·channel=email 유일 키와 원인 응답·이유를 가진다. 실제 철회된 응답의 서비스/연락처와 맞아야 생성할 수 있다. 일반 수집 동의로 마케팅 수신 동의를 생성하지 않는다. 문자·마케팅 수신 동의 관리 모델은 후속 단계다.
- migration 25: 파기 증명서 생성 전 subjectId 해제를 검사하고 subjectBindings/dataSubjects 삭제 건수를 허용한다. 파기 후에도 이메일 발송 차단 HMAC은 유지한다. 원문·비밀 토큰을 감사 로그에 쓰지 않는다.
- 인증 요청 만료 후 24시간이 지나면 worker가 세션·범위·임시 철회 요청과 해당 인증 메일 작업 원문/로컬 파일을 정리한다. Suppression과 외부 공급자/백업의 운영 보존 기간은 후속 정책 게이트다. [검증](../qa/subjects/README.md).

## 구현 계약 — 마케팅 동의 (2026-10-03)

- migration 26~28. MarketingPreference는 회사·서비스·채널·정규화 연락처 HMAC 유일 키와 원본 Submission을 가진다. 전화번호 동의를 이메일 DataSubject로 만들지 않으므로 초기 표의 subjectId 대신 sourceSubmissionId를 사용한다. 연락처·근거는 암호화하고 검색 이름은 별도 HMAC이다.
- granted/withdrawn/erased, excluded, 동의/철회 시각, 원본 질문 ID, version. 모든 변경에 같은 버전의 불변 MarketingEvent가 필요하다. 재동의는 더 새로운 시각·근거를 요구하며 제외 상태를 유지한다.
- 게시 FormVersion.marketing의 목적과 질문 연결은 불변이다. 템플릿 복제는 새 질문 ID로 연결한다. 일반 동의와 기존 boolean은 마케팅 opt-in으로 해석하지 않는다.
- Job의 marketingPreferenceId/marketingSubmissionId는 당시 근거를 고정한다. payloadErasedAt 이후 원문·실행 상태 복원을 막는다. 삭제·정정·파기·만료는 큐 원문과 실제 로컬 메일 파일도 제거한다.
- 원본 응답 잠금 후 채널 연락처 잠금으로 발송·철회·정정·파기를 직렬화한다. 이메일은 기존 Suppression과 같은 키다. 파기 대기는 일시 차단이며 취소 시 기존 동의를 보존한다. [검증](../qa/marketing/README.md).

## 구현 계약 — 발신자 (2026-10-03)

- migration 29~31. Sender는 회사·서비스에 속한다. 활성 자료의 서비스·채널·정규화 주소 HMAC이 유일하며 주소는 암호화한다. 초기 회사 단위 제안 대신 서비스별 인증을 사용한다. 생성자·범위는 변경 불가다.
- pending/verified/expired/disabled/deleted, 인증 generation, verifiedAt/expiresAt/environment, isDefault, version. 실제 기한이 지난 verified 행은 조회와 발송 판정에서 expired로 처리한다. 서비스·채널마다 대표는 하나다.
- SenderVerification은 같은 회사·발신자·현재 세대에 연결한다. 이메일 코드 10분·5회, DNS 확인값 24시간, 성공 근거 최대 90일. 이메일은 email+dns, 문자는 회사별 SOLAPI 계정의 활성 번호 결과가 필요하다. 소비한 인증의 근거·기한을 바꾸지 못하며 재인증은 원문을 지우고 superseded 처리한다.
- 모든 Sender 변경은 version+1과 같은 버전의 불변 SenderEvent를 요구한다. 삭제는 주소/도메인/이름/설명·인증 원문을 제거한 tombstone이며 복원·물리 삭제를 금지한다. 이미 전달된 메일의 보관 기록은 수신 근거의 수명주기를 따른다.
- FileObject.senderId는 회사·서비스·문자 발신자에 묶인다. 증빙은 검사 후 ready→attached, 삭제는 deleting→실제 파일 제거→deleted다. 남은 증빙이 있으면 번호 변경이 불가하며, 발신자 삭제는 증빙도 정리한다.
- Job.senderId는 변경 불가다. 발신자 지정/인증 작업은 mail.sender.v1을 사용하고 DB에서 이전 유형으로 바꿀 수 없다. 예약과 실제 전달 모두 현재 발신자 버전·환경·기한 및 수신 근거를 검사한다. 예약/처리 중에는 발신자 삭제를 금지한다. [검증](../qa/senders/README.md).

## 구현 계약 — 캠페인 (2026-10-03)

- migration 32~33. Campaign은 회사·서비스·생성자·실제 발송 요청자·채널·대상 출처를 가진다. 내용은 암호화하며 생성 후 최대 30일 보관한다. 초안만 내용/대상을 수정하거나 삭제할 수 있다. 요청 이후에는 예약 변경·취소·종료 후 보관을 사용한다.
- CampaignDelivery는 캠페인 내 연락처 HMAC이 유일하다. 암호화 연락처/이름, 동의·응답 ID와 버전, 상태·시도·접수 시각을 보관한다. 범위를 복합 FK로 검사하며 대상은 최대 1,000명이다. CampaignEvent는 캠페인 버전별 불변 이벤트다.
- 발송 요청은 내용·발신자 버전·동의 버전·실제 요청자를 고정한다. Job의 mail.campaign.v1 유형과 `campaign:<deliveryId>:<attempt>` 키를 DB에서 검사하며 payload에는 식별자·시도·전송 환경만 들어간다.
- worker는 현재 권한·서비스·동의·원본·발신자를 다시 확인한다. sending을 먼저 커밋하고 local_delivered/accepted/unknown을 구분한다. 불확실한 외부 접수는 자동 재발송하지 않는다. 이전 실패 작업은 새 시도 상태를 변경할 수 없다.
- 동의/응답 파기와 만료는 초안 사본·연락처·작업 payload·로컬 메일 파일을 지운다. sending의 중단은 unknown을 보존한다. 증명서에 campaignRecipients를 추가했다. [검증](../qa/campaigns/README.md).
## 이메일 내용·템플릿·첨부 실제 모델 (2026-10-03)

이 절은 migration 34~37로 구현한 계약이다. 원본 유료 작성기 관찰 결과와 구분한다.

- MessageTemplate은 회사·서비스·채널·생성자·이름·암호화 내용·해시·상태·version을 저장한다. MessageTemplateRevision은 `(templateId, version)`별 불변 사본이다. 삭제는 현재/과거 이름·원문을 지운다.
- Campaign의 messageTemplateId/version은 같은 범위의 정확한 개정본을 참조하며 내용은 별도 사본이다. mailProtocol은 새 캠페인 `mail.campaign.v2`, 기존 작업 `v1`을 구분한다. 요청 후 프로토콜과 첨부 snapshot은 불변이다.
- FileObject.campaignId와 첨부 소유권을 추가했다. 부모 초안·이메일·업로더/서비스 일치, 최대5개/20MB, 검사 완료를 DB와 서버에서 확인한다. attachmentSnapshotJson에는 ID·SHA-256·크기·MIME만 고정한다. 삭제는 tombstone을 보존하고 실제 바이트는 지운다.
- 수신자별 메일 사본의 첨부와 캠페인 공통 원본의 소유권/기한을 구분한다. [실제 검증](../qa/email-content/README.md), [결정 기록](../qa/email-content/DECISIONS.md).

## 구현 계약 — 이메일 수신 결과·차단 (2026-10-03)

- migration 38. EmailFeedback은 relay:eventId 또는 recipient:jobId 유일 키, 회사·서비스·Job·CampaignDelivery 복합 범위, 연락처 HMAC·종류·출처·발생 시각·본문 해시를 저장한다. 원문 주소·토큰·공급자 자유 텍스트는 저장하지 않으며 UPDATE/DELETE를 금지한다.
- EmailSuppression은 회사·서비스·연락처 해시·사유별 유일 키와 원인 이벤트 FK를 가진다. 수신거부/영구 반송/신고 또는 7일 내 미전달 작업 3개의 일시 반송만 생성할 수 있다. 이벤트와 차단의 범위·사유·불변성을 DB에서도 검사한다.
- 기존 SMTP 접수/로컬 전달/불확실 상태를 사후 수신 이벤트로 덮어쓰지 않는다. 원문 삭제 후 최소 해시 차단을 유지하고 재동의·늦은 전달로 해제하지 않는다.
- 새 Campaign.mailProtocol은 mail.campaign.v3다. v1/v2와 함께 처리하되 기존 worker와 프로토콜 강등으로 수신거부 정책을 우회할 수 없다. [검증 및 남은 정책](../qa/email-feedback/README.md).

## 구현 계약 — Slack·Teams 알림 (2026-10-03)

- migration 39. NotificationIntegration은 회사·서비스·작성자·Slack/Teams 종류·암호화 URL·호스트·local/webhook 환경·사용여부·version/generation을 가진다. NotificationSubscription은 이벤트 종류별 전체 또는 같은 서비스의 특정 폼/CSV 작업을 가리킨다.
- NotificationEvent는 실제 공개 응답 제출과 CSV 완료 트랜잭션에서 생성된다. NotificationDelivery는 이벤트+연결별 유일하며 당시 설정 세대를 고정한다. NotificationAttempt는 전송 시도 결과와 시각을 불변으로 보존한다. 직접 SQL 범위 변경·이벤트 위조·불법 상태 전이는 FK/check/trigger로 거부한다.
- 연결 변경·중지·삭제는 대기 작업을 취소한다. worker는 현재 권한·서비스·구독·세대를 다시 확인하고 외부 I/O 전 전송 의도를 커밋한다. 중단 후 불확실한 전송은 자동 재시도하지 않는다. 삭제 시 URL과 이름을 지운 tombstone만 남긴다. [DB·Ego 검증](../qa/notifications/README.md).

## 구현 계약 — 서비스 접근 요청 (2026-10-03)

- migration 48. AccessRequest는 회사·요청 구성원·대상 서비스의 복합 FK와 현재 상태, 버전, 사유, 검토 구성원·답변·처리 시각을 가진다. 대기 중인 같은 회사·구성원·서비스 요청은 부분 유일 인덱스로 한 건만 허용한다.
- 상태는 pending→approved/rejected/cancelled만 사용한다. 승인·거절에는 검토자와 처리 시각, 취소에는 처리 시각이 필요하며 DB 제약이 이를 검증한다. 과거 요청은 감사·이력으로 유지하고 재요청은 새 행을 만든다.
- 회사 행 잠금 아래 대기 요청·현재 구성원 역할·서비스 상태·기존 grant를 다시 확인한다. 승인은 현재 역할의 capability로 ServiceGrant를 추가하며 요청 상태·구성원 버전·감사를 같은 트랜잭션에서 변경한다. [부분 검증](../qa/P13-T02/README.md).

## 구현 계약 — 전문가 회사 배정 (2026-10-03)

- migration 49. ExpertAssignment는 회사·기존 활성 계정·운영자·만료일·회수 상태·version을 가진다. 한 회사/계정에 하나의 배정 행을 두고 만료/회수 후 재배정 시 version을 올린다. ExpertAssignmentService는 회사/서비스 복합 FK로 명시적 범위를 저장한다.
- 전문가 Membership은 accessKind=expert, viewer 역할, ExpertAssignment와 동일한 회사/사용자 복합 FK를 가진다. DB CHECK로 다른 역할과 직접 구성원/전문가 연결 혼용을 거부한다. 기존 일반 구성원은 expert 배정으로 변환하지 않는다.
- 회사 선택과 매 API 요청에서 현재 배정 상태·만료를 확인한다. ServiceGrant와 ExpertAssignmentService를 교집합으로 검사하므로 다른 경로에서 grant가 추가돼도 범위 밖 서비스에 접근할 수 없다. 회수/만료는 구성원 상태·grant·세션 회사 선택을 정리한다. 원본의 배정 상태 화면은 미관찰이어서 viewer 범위는 독립 구현 정책이다. [부분 검증](../qa/P03-T02/README.md).


## P07-T03 연결된 인증 원문 파기 (2026-10-04)

VerificationReceipt는 본인인증·전자서명 증거를 정확한 Submission에 연결한다. migration 62는 파기 중/완료/기한 종료 응답과 원래 동의 기한을 넘는 영수증 연결을 거절한다. 연결된 영수증 삭제는 Submission.destroying과 현재 실행 중인 파기 lease가 필요하다. AFTER DELETE 트리거가 연결 이벤트·인증 시도와 providerRequestCipher를 삭제한다. 증명서는 연결 영수증이 없어야 생성되며 verificationReceipts/verificationEvents/verificationAttempts 건수를 기록한다. 아직 응답에 연결되지 않은 시도의 만료와 실제 공급자 검증은 P06-T06에 남는다.

DestructionRequest.attempts는 leaseOwner와 별도로 실행 세대를 구분한다. 갱신·완료·실패 처리는 현재 세대와 만료되지 않은 lease를 요구한다. 목록·작업은 현재 권한과 최종 기한을 다시 검사한다. [P07-T03 검증](../qa/P07-T03/README.md).

## P07-T01 실행 번호와 CSV 보관 기한 보완 (2026-10-04)

`ImportJob.leaseGeneration`은 최초 0이며 작업을 맡을 때마다 1씩 증가한다. 재시도 횟수 초기화와 별도로 유지한다. 현재 실행 번호·작업자·임대 기한이 일치할 때만 처리 결과를 저장한다. 새 DB 트리거는 유효한 임대 없는 응답/행 반영, 실행 번호 건너뛰기와 임의 임대 연장을 거절한다. 기한을 줄여 안전하게 실행을 회수할 수 있다.

임시 원문/파일명은 보관 기한이 지난 뒤 조회하지 않는다. 반영 직전 원본 파일을 실제 삭제하며, 실패한 경우 삭제된 원본을 복원하지 않고 남은 검증 행에서 재개한다. [현재 검증](../qa/P07-T01/README.md).


## P07-T02 로컬 발송 사본 정리

Job.localCopyErasedAt과 payloadErasedAt 인덱스, 확정된 원문 삭제 뒤 물리 사본 정리 상태를 추가했다. 정리 실패는 빈 timestamp로 남아 재시도한다. native CHECK와 불변 timestamp, 연결 사본 정리 전 증명서 차단 trigger를 64번째 migration에 추가했다. 이전 63개 SQL을 보존했다.

## 회사 2FA 임시 예외 (2026-10-04)

MfaException은 tenantId/memberId로 회사 구성원에 연결하고 createdById도 같은 회사의 구성원을 참조한다. 사유는 암호화하며 최초 생성부터 24시간 상한·불변 scope·증가 version을 DB에서 검사한다. 마지막 인증 owner의 Membership/User 변경도 보호한다. SecurityPolicy.requireMfa를 기존 개인 2FA와 함께 집행한다.


## 개인정보 활동 검토 (2026-10-04, 부분 구현)

ActivityReview는 감사 사건·회사·서비스·처리자를 composite FK로 연결하고 requester/recipient를 같은 회사 Membership으로 제한한다. 열린 사건은 partial unique, 상태/version 전이는 trigger로 보호한다. ActivityReviewMessage는 회사/요청/작성자 FK와 암호화 본문을 가진 추가 전용 메시지이며 UPDATE/DELETE가 거부된다. AuditEvent에 nullable 회사/서비스/actor를 포함한 복합 unique를 추가했으며 기존 개인 감사 자료를 보존했다. Migration75와119모델. 화면 및 보유/파기 정책의 전체 수용은 남아 있다.

2026-10-04 검토 알림: 기존 Job에 mail.activity-review.v1 형식으로 version별 유일 접수, 암호화 수신주소/발급자/대상자/전송환경을 고정했다. API/worker의 현재 권한과 마지막 기한 확인, 로컬 전달/SMTP 접수 분리를 구현했다. 모델119/migration75 유지. [알림 검증](../qa/P03-T03/revalidation/activity-mail-README.md).


## P12-T03 월마감 출력 (2026-10-04, 진행 중)

`ComplianceExportJob`은 `(tenantId,closeId)`로 불변 마감, `(tenantId,memberId,requesterId)`로 발급 구성원과 사용자에 연결한다. 형식·원천 해시·요청 키·기한은 변경 불가이며 상태 전이는 version+1을 요구한다. ready만 결과 암호문/해시를 보유한다. 만료·취소·삭제 시 암호문/해시를 제거한다. leaseOwner/leaseUntil/attempts와 동일 version을 확인해 오래된 worker 게시를 차단한다. `ComplianceClose`는 기존 자료를 보존하고 DB UPDATE/DELETE를 거부한다. migration76/model120. [검증](../qa/P12-T03/revalidation/exports/README.md).
