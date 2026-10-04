import type { DocumentSnapshot } from "@/contracts/documents";
import { serviceDocumentQuery, type PublicServiceDocument, type ServiceDocumentQuery } from "@/contracts/public-service-documents";
import { db } from "./db";
import { decrypt } from "./crypto";
import { fail, rateLimit } from "./http";

function snapshotOf(value: unknown) { return value as DocumentSnapshot; }
function matches(query: ServiceDocumentQuery, type: string, recipientIds: string[], snapshot: DocumentSnapshot) {
  const items = snapshot.purposes.flatMap(purpose => purpose.items);
  if (query.view === "collection" && type !== "consent") return false;
  if (query.view === "overseas" && type !== "overseas_transfer") return false;
  if (query.view === "recipients" && recipientIds.length === 0) return false;
  if (query.view === "resident" && !items.some(item => item.kind === "unique_identifier")) return false;
  if (query.agreement === "required" && !items.some(item => item.required)) return false;
  if (query.recipient && !recipientIds.includes(query.recipient)) return false;
  if (query.country && !snapshot.recipients.some(recipient => recipient.countryCode === query.country)) return false;
  return true;
}
export async function listPublicServiceDocuments(serviceId: string, raw: Record<string, string>): Promise<{ serviceName: string; companyName: string; items: PublicServiceDocument[] }> {
  await rateLimit("public-service-documents:" + serviceId, 60);
  const query = serviceDocumentQuery.parse(raw);
  return db.$transaction(async tx => {
    const service = await tx.service.findFirst({ where: { id: serviceId, status: "active", tenant: { status: "active" } }, include: { tenant: { select: { publicName: true } } } });
    if (!service) fail(404, "NOT_FOUND", "공개 중인 서비스를 찾을 수 없습니다.");
    const links = await tx.documentPublication.findMany({ where: { tenantId: service.tenantId, serviceId, status: "active",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], document: { status: "published" } },
      include: { document: { select: { type: true, recipients: { select: { recipientId: true } } } }, documentVersion: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100 });
    const items = links.flatMap(link => {
      const snapshot = snapshotOf(link.documentVersion.snapshot);
      const recipientIds = link.document.recipients.map(item => item.recipientId);
      if (!matches(query, link.document.type, recipientIds, snapshot)) return [];
      const row: PublicServiceDocument = { title: snapshot.title, type: snapshot.type, number: link.documentVersion.number,
        effectiveDate: snapshot.effectiveDate, contentHash: link.documentVersion.contentHash, url: "/document/view/" + decrypt<string>(link.tokenCipher) };
      return [row];
    });
    return { serviceName: service.externalName, companyName: service.tenant.publicName, items };
  });
}
