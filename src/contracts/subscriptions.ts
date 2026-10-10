import { z } from "zod";
import type { SecurityEntitlements } from "./feature-entitlements";

export const purchaseRequest = z.object({ planVersionId: z.string().min(1).max(100) }).strict();
export const cancelRequest = z.object({ version: z.number().int().positive() }).strict();
export const scheduleTrialCancelRequest = cancelRequest.extend({ effectiveAt: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(1).max(300).optional() }).strict();

export type PlanRecord = {
  id: string; name: string; description: string;
  versions: { id: string; number: number; cycle: string; priceKrw: number | null; currency: string;
    serviceLimit: number | null; memberLimit: number | null; subjectLimit: number | null; formLimit: number | null;
    capabilities: string[]; orderable: boolean; effectiveFrom: string; effectiveTo: string | null }[];
};
export type SubscriptionRecord = {
  id: string; planId: string; planName: string; planVersionId: string; status: string;
  periodStart: string | null; periodEnd: string | null; priceKrw: number | null;
  cancelAt: string | null; currency: string; version: number; createdAt: string;
};
export type EntitlementRecord = {
  active: boolean; status: string; periodEnd: string | null; security: SecurityEntitlements;
  limits: { services: number | null; members: number | null; subjects: number | null; forms: number | null };
  usage: { services: number; members: number; subjects: number; forms: number };
};
export type BillingOverview = { subscriptions: SubscriptionRecord[]; entitlement: EntitlementRecord };
export type AssetOverview = {
  entitlement: EntitlementRecord;
  services: { id: string; name: string; status: string; forms: number; subjects: number }[];
};
