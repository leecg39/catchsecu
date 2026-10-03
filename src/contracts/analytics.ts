import { z } from "zod";

export const analyticsQuery = z.object({
  serviceId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
}).strict().refine(value => !value.from || !value.to || new Date(value.from) < new Date(value.to),
  { path: ["to"], message: "종료 시각은 시작 시각 이후여야 합니다." });

export type AnalyticsQuery = z.infer<typeof analyticsQuery>;
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
