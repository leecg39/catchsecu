import { createHash } from "node:crypto";
import { complianceEvidenceBody, type ComplianceEvidence } from "@/contracts/compliance-evidence";
import type { Transaction } from "./db";

export function complianceEvidenceHash(evidence: Omit<ComplianceEvidence, "hash">) {
  return createHash("sha256").update(JSON.stringify(complianceEvidenceBody.parse(evidence))).digest("hex");
}

// Caller supplies only authorized active service IDs and the monthly close's
// repeatable-read transaction. No answer, token, email, or security secret is read.
export async function collectComplianceEvidence(tx: Transaction, tenantId: string, serviceIds: string[], checkedAt: Date, companyWide: boolean): Promise<ComplianceEvidence> {
  const serviceWhere = { tenantId, serviceId: { in: serviceIds } };
  const purposes = await tx.processingPurpose.groupBy({ by: ["serviceId"], where: { ...serviceWhere, status: "active" }, _count: { _all: true } });
  const policies = await tx.documentPublication.groupBy({ by: ["serviceId"], where: { ...serviceWhere, status: "active", revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: checkedAt } }], document: { type: "privacy_policy", status: "published" } }, _count: { _all: true } });
  const submissions = { tenantId, formVersion: { form: { tenantId, serviceId: { in: serviceIds } } }, status: { not: "destroyed" } };
  const unpurgedSubmissions = await tx.submission.count({ where: submissions });
  const overdueSubmissions = await tx.submission.count({ where: { ...submissions, legalHold: false, retentionUntil: { lte: checkedAt } } });
  const heldSubmissions = await tx.submission.count({ where: { ...submissions, legalHold: true } });
  let companyMfa: ComplianceEvidence["facts"]["companyMfa"] = null;
  if (companyWide) {
    const members = { tenantId, status: "active", accessKind: "direct", user: { status: "active", emailVerified: true } };
    const total = await tx.membership.count({ where: members });
    const enrolled = await tx.membership.count({ where: { ...members, user: { ...members.user, twoFactorEnabled: true, twoFactors: { some: { verified: true } } } } });
    const policy = await tx.securityPolicy.findUnique({ where: { tenantId }, select: { requireMfa: true } });
    companyMfa = { required: policy?.requireMfa ?? null, members: total, enrolled };
  }
  const body = { version: 1 as const, checkedAt: checkedAt.toISOString(), serviceIds: [...serviceIds].sort(), facts: {
    services: serviceIds.length, purposeServices: purposes.length, activePurposes: purposes.reduce((n, p) => n + p._count._all, 0),
    policyServices: policies.length, livePolicyPublications: policies.reduce((n, p) => n + p._count._all, 0),
    unpurgedSubmissions, overdueSubmissions, heldSubmissions, companyMfa,
  } };
  return { ...body, hash: complianceEvidenceHash(body) };
}
