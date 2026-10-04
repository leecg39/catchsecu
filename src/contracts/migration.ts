import { z } from "zod";
export const LEGACY_SECTIONS = ["profile", "company"] as const;
export type LegacySection = (typeof LEGACY_SECTIONS)[number];
export const legacyImportInput = z.object({
  dryRun: z.boolean(),
  sections: z.record(z.string(), z.record(z.string(), z.unknown())),
}).strict();
export const legacyFieldPlan = z.object({ field: z.string(), from: z.string().nullable(), to: z.string() });
export const legacyQuarantine = z.object({ field: z.string(), reason: z.string() });
export const legacySectionPlan = z.object({
  status: z.enum(["ready", "skipped"]),
  skippedReason: z.string().optional(),
  changes: z.array(legacyFieldPlan),
  unchanged: z.array(z.string()),
  quarantined: z.array(legacyQuarantine),
});
export const legacyImportResult = z.object({
  dryRun: z.boolean(),
  applied: z.boolean(),
  profile: legacySectionPlan.optional(),
  company: legacySectionPlan.optional(),
  rejectedSecrets: z.array(z.object({ section: z.string(), field: z.string() })),
  unknownSections: z.array(z.string()),
});
export type LegacyImportInput = z.infer<typeof legacyImportInput>;
export type LegacyImportResult = z.infer<typeof legacyImportResult>;

export type LegacySectionPlan = z.infer<typeof legacySectionPlan>;
