// DATA_ENCRYPTION_KEY 회전의 마지막 단계: 이전 키로 복호 가능한 암호문을 현재 키로 재암호화한다.
// 사용: DATA_ENCRYPTION_KEY=<신규> DATA_ENCRYPTION_KEY_PREVIOUS=<기존> ROTATION_DATABASE_URL=<슈퍼유저 DSN> tsx scripts/rotate-data-key.ts [--dry-run]
// 재암호화는 순수 암호화 재작성이므로 도메인 트리거(불변성·마케팅 원본무효화 등)를 우회해야 한다.
// ROTATION_DATABASE_URL 지정 시 전량 session_replication_role='replica' 트랜잭션으로 처리하고,
// 미지정 시 앱 역할로 시도하되 트리거 차단·부작용 가능 행은 failed로 남는다.
// 모든 컬럼 변환 확인 후 DATA_ENCRYPTION_KEY_PREVIOUS를 제거하면 회전이 완료된다.
import { db } from "../src/server/db";
import { reencrypt } from "../src/server/crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const dryRun = process.argv.includes("--dry-run");
const admin = process.env.ROTATION_DATABASE_URL
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.ROTATION_DATABASE_URL, options: "-c timezone=UTC" }), log: [] })
  : null;
// [테이블, cipher 컬럼, PK 컬럼들]
const columns: [string, string, string[]][] = [
  ["AccountClosure", "reasonCipher", ["id"]],
  ["SupportTicket", "subjectCipher", ["id"]], ["SupportTicket", "bodyCipher", ["id"]], ["SupportTicket", "replyCipher", ["id"]],
  ["Company", "closureReasonCipher", ["id"]],
  ["CompanyBusinessFile", "nameCipher", ["id"]],
  ["PaymentMethod", "tokenCipher", ["id"]],
  ["Subprocessor", "emailCipher", ["id"]],
  ["SubprocessorNotice", "bodyCipher", ["id"]],
  ["ComplianceExportJob", "resultCipher", ["id"]],
  ["SsoProvider", "clientSecretCipher", ["id"]],
  ["SsoState", "verifierCipher", ["id"]],
  ["MfaException", "reasonCipher", ["id"]],
  ["FileObject", "nameCipher", ["id"]],
  ["Sender", "addressCipher", ["id"]],
  ["SenderVerification", "valueCipher", ["id"]],
  ["Job", "payloadCipher", ["id"]],
  ["IdempotencyRecord", "responseCipher", ["id"]],
  ["ApprovalRequest", "requestCipher", ["id"]], ["ApprovalRequest", "decisionCipher", ["id"]],
  ["Publication", "tokenCipher", ["id"]],
  ["Answer", "valueCipher", ["id"]],
  ["ConsentReceipt", "evidenceCipher", ["id"]], ["ConsentReceipt", "pdfCipher", ["id"]],
  ["CorrectionPayload", "beforeCipher", ["id"]], ["CorrectionPayload", "afterCipher", ["id"]],
  ["SubmissionNote", "textCipher", ["id"]],
  ["DestructionRequest", "reasonCipher", ["id"]], ["DestructionRequest", "decisionCipher", ["id"]],
  ["ImportJob", "headersCipher", ["id"]], ["ImportJob", "mappingCipher", ["id"]], ["ImportJob", "snapshotCipher", ["id"]],
  ["ImportRow", "payloadCipher", ["id"]],
  ["ImportEvidence", "payloadCipher", ["submissionId"]],
  ["DocumentPublication", "tokenCipher", ["id"]],
  ["ShareGrant", "emailCipher", ["id"]],
  ["DataSubject", "contactCipher", ["id"]],
  ["MarketingPreference", "contactCipher", ["id"]], ["MarketingPreference", "evidenceCipher", ["id"]],
  ["Campaign", "contentCipher", ["id"]],
  ["CampaignDelivery", "contactCipher", ["id"]],
  ["MessageTemplate", "contentCipher", ["id"]],
  ["MessageTemplateRevision", "contentCipher", ["templateId", "version"]],
  ["NotificationIntegration", "endpointCipher", ["id"]],
  ["ExportJob", "filtersCipher", ["id"]], ["ExportJob", "layoutCipher", ["id"]],
  ["ExportChunk", "contentCipher", ["id"]],
  ["VerificationAttempt", "providerRequestCipher", ["id"]],
  ["ActivityReviewMessage", "bodyCipher", ["id"]],
];
const pkWhere = (pk: string[]) => pk.map((c, i) => `"${c}"=$${i + 2}`).join(" AND ");
async function privilegedUpdate(table: string, column: string, pk: string[], pkValues: unknown[], value: string) {
  if (!admin) throw new Error("ROTATION_DATABASE_URL 미지정");
  await admin.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role='replica'");
    await tx.$executeRawUnsafe(`UPDATE "${table}" SET "${column}"=$1 WHERE ${pkWhere(pk)}`, value, ...pkValues);
  });
}
const summary: { table: string; column: string; scanned: number; rotated: number; failed: number }[] = [];
for (const [table, column, pk] of columns) {
  let scanned = 0, rotated = 0, failed = 0, firstError = "";
  let rows: Record<string, unknown>[];
  try {
    rows = await db.$queryRawUnsafe(`SELECT ${pk.map(c => `"${c}"`).join(",")}, "${column}" AS cipher FROM "${table}" WHERE "${column}" IS NOT NULL`);
  } catch { summary.push({ table, column, scanned: -1, rotated: -1, failed: -1 }); continue; }
  for (const row of rows) {
    scanned++;
    const pkValues = pk.map(c => row[c]);
    try {
      const next = reencrypt(row.cipher as string);
      if (!dryRun) {
        if (admin) await privilegedUpdate(table, column, pk, pkValues, next);
        else await db.$executeRawUnsafe(`UPDATE "${table}" SET "${column}"=$1 WHERE ${pkWhere(pk)}`, next, ...pkValues);
      }
      rotated++;
    } catch (error) { failed++; if (!firstError) firstError = error instanceof Error ? error.message.slice(-200) : String(error); }
  }
  summary.push({ table, column, scanned, rotated, failed });
  if (firstError) console.log(JSON.stringify({ table, column, firstError }));
}
console.log(JSON.stringify({ dryRun, summary: summary.filter(s => s.scanned !== 0) }));
await db.$disconnect();
await admin?.$disconnect();
