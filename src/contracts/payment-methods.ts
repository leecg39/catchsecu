import { z } from "zod";

export const paymentMethodToken = z.string().regex(/^pm_[A-Za-z0-9_-]{8,64}$/, "PG가 발급한 결제수단 토큰만 등록할 수 있습니다.");
export const paymentMethodCreate = z.object({
  token: paymentMethodToken,
  kind: z.enum(["card", "transfer"]),
  label: z.string().trim().min(1).max(40),
  setDefault: z.boolean().default(false),
}).strict();
export const paymentMethodUpdate = z.object({
  version: z.number().int().min(1),
  label: z.string().trim().min(1).max(40).optional(),
  setDefault: z.boolean().optional(),
}).strict();
export const paymentMethodRemove = z.object({ version: z.number().int().min(1) }).strict();
export const paymentMethodListQuery = z.object({ includeRevoked: z.enum(["true", "false"]).optional().transform(v => v === "true") }).strict();

export type PaymentMethodListQuery = z.infer<typeof paymentMethodListQuery>;
export type PaymentMethodCreate = z.infer<typeof paymentMethodCreate>;
export type PaymentMethodUpdate = z.infer<typeof paymentMethodUpdate>;
export type PaymentMethodRecord = {
  id: string;
  provider: string;
  kind: "card" | "transfer";
  label: string;
  isDefault: boolean;
  status: "active" | "revoked";
  version: number;
  createdAt: string;
};
