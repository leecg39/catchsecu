import { z } from "zod";

const common = {
  orderId: z.uuid(),
  eventId: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/),
};
// Refund identity is part of the event, including when replaying an accepted event.
export const paymentProviderEvent = z.discriminatedUnion("outcome", [
  z.object({ ...common, outcome: z.literal("paid") }).strict(),
  z.object({ ...common, outcome: z.literal("failed") }).strict(),
  z.object({ ...common, outcome: z.literal("refunded"), refundId: z.uuid() }).strict(),
  z.object({ ...common, outcome: z.literal("refund_rejected"), refundId: z.uuid() }).strict(),
]);
export type PaymentProviderEvent = z.infer<typeof paymentProviderEvent>;
