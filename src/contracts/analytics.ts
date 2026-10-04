import { z } from "zod";
import type { ComplianceEvidence } from "./compliance-evidence";

export const analyticsQuery = z.object({
  serviceId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
}).strict().refine(value => !value.from || !value.to || new Date(value.from) < new Date(value.to),
  { path: ["to"], message: "종료 시각은 시작 시각 이후여야 합니다." });

export type AnalyticsQuery = z.infer<typeof analyticsQuery>;

export const collectDestructionQuery = z.object({
  serviceId: z.uuid().optional(),
  sourceId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  searchField: z.enum(["source", "service", "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
}).strict().refine(value => !value.from || !value.to || new Date(value.from) < new Date(value.to),
  { path: ["to"], message: "종료 시각은 시작 시각 이후여야 합니다." });
export type CollectDestructionQuery = z.infer<typeof collectDestructionQuery>;
export type CollectDestructionSource = {
  id: string; name: string; kind: "form" | "import"; serviceId: string; serviceName: string;
};
export type CollectDestructionRow = {
  date: string; serviceId: string; serviceName: string;
  sourceId: string; sourceName: string; sourceKind: "form" | "import";
  collectedTotal: number; collected: number; destroyed: number; remaining: number;
};
export type CollectDestructionTotals = { collectedTotal: number; collected: number; destroyed: number; remaining: number };
export type CollectDestructionList = {
  page: number; pageSize: number; total: number;
  totals: CollectDestructionTotals;
  sources: CollectDestructionSource[];
  rows: CollectDestructionRow[];
};

export const complianceCloseInput = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  serviceId: z.uuid().optional(),
}).strict();
export type ComplianceCloseRecord = {
  id: string; month: string; serviceId: string | null; createdAt: string;
  verdict: "not_assessed";
  period: { from: string; to: string };
  totals: AnalyticsDashboard["totals"];
  evidence?: ComplianceEvidence;
};
export type AnalyticsDashboard = {
  asOf: string;
  period: { from: string; to: string };
  serviceId: string | null;
  totals: {
    services: number; forms: number; consentDocuments: number; policyDocuments: number;
    retainedSubmissions: number; periodSubmissions: number; periodDestructions: number;
  };
  services: {
    id: string; name: string; createdAt: string; forms: number;
    retainedSubmissions: number; periodSubmissions: number;
  }[];
  topForms: {
    id: string; title: string; serviceId: string; serviceName: string; createdAt: string;
    retainedSubmissions: number;
  }[];
};
