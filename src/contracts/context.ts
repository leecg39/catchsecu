import { z } from "zod";

export const contextSelectionInput = z.union([
  z.object({ companyId: z.uuid() }).strict(),
  z.object({ serviceId: z.uuid() }).strict(),
]);
