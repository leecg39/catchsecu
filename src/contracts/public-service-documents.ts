import { z } from "zod";
import regionCodes from "@/data/region-codes.json";

export const serviceDocumentViews = ["collection", "recipients", "overseas", "resident"] as const;
export const serviceDocumentQuery = z.object({
  view: z.enum(serviceDocumentViews),
  category: z.enum(["items"]).optional(),
  agreement: z.enum(["required"]).optional(),
  domestic: z.enum(["domestic"]).optional(),
  recipient: z.uuid().optional(),
  country: z.string().refine(value => regionCodes.includes(value), "유효한 국가·지역을 선택해주세요.").optional(),
}).strict();
export type ServiceDocumentQuery = z.infer<typeof serviceDocumentQuery>;
export type PublicServiceDocument = { title: string; type: string; number: number; effectiveDate: string; contentHash: string; url: string };

const uuid = z.uuid();
export function parseServiceDocumentPath(path: string): { serviceId: string; query: Record<string, string> } | null {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "services" || !uuid.safeParse(parts[1]).success) return null;
  const serviceId = parts[1], rest = parts.slice(2).join("/");
  const category = rest.match(/^catchforms\/category\/([^/]+)\/agree\/([^/]+)$/);
  if (category) return { serviceId, query: { view: "collection", category: category[1], agreement: category[2] } };
  const recipientsAgree = rest.match(/^catchforms\/recipients\/agree\/([^/]+)$/);
  if (recipientsAgree) return { serviceId, query: { view: "recipients", agreement: recipientsAgree[1] } };
  if (rest === "catchforms/recipients") return { serviceId, query: { view: "recipients" } };
  const overseasAgree = rest.match(/^oversea\/catchforms\/agree\/([^/]+)$/);
  if (overseasAgree) return { serviceId, query: { view: "overseas", agreement: overseasAgree[1] } };
  if (rest === "oversea/catchforms") return { serviceId, query: { view: "overseas" } };
  const resident = rest.match(/^catchforms\/([^/]+)\/resident\/agree\/([^/]+)$/);
  if (resident) return { serviceId, query: { view: "resident", domestic: resident[1], agreement: resident[2] } };
  if (rest === "catchforms") return { serviceId, query: { view: "collection" } };
  return null;
}
