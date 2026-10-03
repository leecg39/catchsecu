import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@/generated/prisma/client";
export const credentialScope = new AsyncLocalStorage<{ userId: string; client: Prisma.TransactionClient }>();
