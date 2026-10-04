import { z } from "zod";

export const ledgerQuery = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).default("KRW"),
  serviceId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export type LedgerQuery = z.infer<typeof ledgerQuery>;
export type LedgerOverview = {
  asOf: string;
  currency: string;
  available: string;
  held: string;
  items: {
    id: string; serviceId: string | null; serviceName: string | null;
    kind: "funding" | "reserve" | "capture" | "release" | "refund";
    amount: string; createdAt: string;
  }[];
  total: number; page: number; pageSize: number;
};
