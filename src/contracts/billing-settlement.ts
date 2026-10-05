import { z } from "zod";

export const refundRequest = z.object({
  amount: z.number().int().min(1).max(1000000000000),
  reason: z.string().trim().min(1).max(500),
}).strict();
export const closeMonthRequest = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).strict();
export const monthQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  currency: z.string().regex(/^[A-Z]{3}$/).default("KRW"),
}).strict();

export type RefundRecord = {
  id: string; orderId: string; amount: number; currency: string; reason: string;
  status: "requested" | "refunded" | "rejected"; version: number; createdAt: string;
};
export type ServiceUsageEntry = { serviceId: string; serviceName: string | null; captured: string; released: string };
export type MonthCloseRecord = {
  month: string; currency: string; closed: boolean; closedAt: string | null;
  totals: { funded: string; refunded: string; reservedNet: string; captured: string; released: string };
  services: ServiceUsageEntry[];
  postCloseAdjustments: number;
};
export type RefundRequest = z.infer<typeof refundRequest>;
