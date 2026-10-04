// 전체 Cipher 컬럼을 현재 env 키로 복호해 복호 불가 행을 식별한다(회전 리허설의 전수 감사).
import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
const cols: [string, string][] = [["AccountClosure","reasonCipher"],["SupportTicket","subjectCipher"],["SupportTicket","bodyCipher"],["SupportTicket","replyCipher"],["Company","closureReasonCipher"],["CompanyBusinessFile","nameCipher"],["PaymentMethod","tokenCipher"],["Subprocessor","emailCipher"],["SubprocessorNotice","bodyCipher"],["ComplianceExportJob","resultCipher"],["SsoProvider","clientSecretCipher"],["SsoState","verifierCipher"],["MfaException","reasonCipher"],["FileObject","nameCipher"],["Sender","addressCipher"],["SenderVerification","valueCipher"],["Job","payloadCipher"],["IdempotencyRecord","responseCipher"],["ApprovalRequest","requestCipher"],["ApprovalRequest","decisionCipher"],["Publication","tokenCipher"],["Answer","valueCipher"],["ConsentReceipt","evidenceCipher"],["ConsentReceipt","pdfCipher"],["CorrectionPayload","beforeCipher"],["CorrectionPayload","afterCipher"],["SubmissionNote","textCipher"],["DestructionRequest","reasonCipher"],["DestructionRequest","decisionCipher"],["ImportJob","headersCipher"],["ImportJob","mappingCipher"],["ImportJob","snapshotCipher"],["ImportRow","payloadCipher"],["ImportEvidence","payloadCipher"],["DocumentPublication","tokenCipher"],["ShareGrant","emailCipher"],["DataSubject","contactCipher"],["MarketingPreference","contactCipher"],["MarketingPreference","evidenceCipher"],["Campaign","contentCipher"],["CampaignDelivery","contactCipher"],["MessageTemplate","contentCipher"],["MessageTemplateRevision","contentCipher"],["NotificationIntegration","endpointCipher"],["ExportJob","filtersCipher"],["ExportJob","layoutCipher"],["ExportChunk","contentCipher"],["VerificationAttempt","providerRequestCipher"],["ActivityReviewMessage","bodyCipher"]];
let total = 0, bad = 0;
for (const [table, col] of cols) {
  try {
    const rows = await db.$queryRawUnsafe<{ c: string }[]>(`SELECT "${col}" AS c FROM "${table}" WHERE "${col}" IS NOT NULL`);
    let local = 0;
    for (const r of rows) { total++; try { decrypt(r.c); } catch { local++; bad++; } }
    if (local) console.log(table, col, "복호불가:", local, "/", rows.length);
  } catch { /* 테이블 부재 */ }
}
console.log(JSON.stringify({ total, undecryptable: bad }));
await db.$disconnect();
