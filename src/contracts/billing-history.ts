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
  kind: "trial_started" | "payment" | "refund";
  status: "trialing" | "expired" | "paid" | "requested" | "refunded" | "rejected" | "pending" | "failed" | "cancelled";
  method: "none" | "card" | "transfer";
  amountKrw: number;
  planName: string;
  periodStart: string;
  periodEnd: string;
  orderId?: string;
  reason?: string;
};
export type BillingHistoryList = {
  items: BillingHistoryRecord[];
  total: number;
  page: number;
  pageSize: number;
};
