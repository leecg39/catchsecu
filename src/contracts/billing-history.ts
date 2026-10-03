import { z } from "zod";

const month = z.string().regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/);
export const billingHistoryQuery = z.object({
  fromMonth: month.optional(),
  toMonth: month.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
}).strict();

export type BillingHistoryQuery = z.infer<typeof billingHistoryQuery>;
export type BillingHistoryRecord = {
  id: string;
  occurredAt: string;
  kind: "trial_started";
  status: "trialing" | "expired";
  method: "none";
  amountKrw: 0;
  planName: string;
  periodStart: string;
  periodEnd: string;
};
export type BillingHistoryList = {
  items: BillingHistoryRecord[];
  total: number;
  page: number;
  pageSize: number;
};
