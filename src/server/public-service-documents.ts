import type { DocumentSnapshot } from "@/contracts/documents";
import type { Prisma } from "@/generated/prisma/client";
import { serviceDocumentQuery, type PublicServiceDocument, type ServiceDocumentQuery } from "@/contracts/public-service-documents";
import { db } from "./db";
import { decrypt } from "./crypto";
import { fail, rateLimit } from "./http";

function snapshotOf(value: unknown) { return value as DocumentSnapshot; }
function publishedFilters(query: ServiceDocumentQuery): Prisma.DocumentVersionWhereInput {
  const AND: Prisma.DocumentVersionWhereInput[] = [];
  if (query.view === "collection" || query.view === "overseas") AND.push({
    snapshot: { path: ["type"], equals: query.view === "collection" ? "consent" : "overseas_transfer" },
  });
  if (query.view === "recipients") AND.push({ NOT: { snapshot: { path: ["recipients"], equals: [] } } });
  if (query.view === "resident") AND.push({ snapshot: { path: ["purposes"], array_contains: [{ items: [{ kind: "unique_identifier" }] }] } });
  if (query.agreement === "required") AND.push({ snapshot: { path: ["purposes"], array_contains: [{ items: [{ required: true }] }] } });
  if (query.recipient) AND.push({ recipientSources: { some: { recipientId: query.recipient } } });
  if (query.country) AND.push({ snapshot: { path: ["recipients"], array_contains: [{ countryCode: query.country }] } });
  return { AND };
}
function matches(query: ServiceDocumentQuery, recipientIds: string[], snapshot: DocumentSnapshot) {
  const items = snapshot.purposes.flatMap(purpose => purpose.items);
  if (query.view === "collection" && snapshot.type !== "consent") return false;
  if (query.view === "overseas" && snapshot.type !== "overseas_transfer") return false;
  if (query.view === "recipients" && snapshot.recipients.length === 0) return false;
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
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], document: { status: "published" },
      documentVersion: publishedFilters(query) },
      include: { documentVersion: { include: { recipientSources: { select: { recipientId: true } } } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100 });
    const items = links.flatMap(link => {
      const snapshot = snapshotOf(link.documentVersion.snapshot);
      const recipientIds = link.documentVersion.recipientSources.map(item => item.recipientId);
      if (!matches(query, recipientIds, snapshot)) return [];
      const row: PublicServiceDocument = { title: snapshot.title, type: snapshot.type, number: link.documentVersion.number,
        effectiveDate: snapshot.effectiveDate, contentHash: link.documentVersion.contentHash, url: "/document/view/" + decrypt<string>(link.tokenCipher) };
      return [row];
    });
    return { serviceName: service.externalName, companyName: service.tenant.publicName, items };
  });
}
