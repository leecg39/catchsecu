import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { env } from "./env";
import { credentialScope } from "./credential-scope";
import { authMutationScope } from "./auth-mutation-scope";

const globalDb = globalThis as unknown as { catchsecuDb?: PrismaClient };
const client = globalDb.catchsecuDb ?? new PrismaClient({
  // Prisma DateTime columns store UTC without an offset. PostgreSQL defaults and
  // raw queue/lease queries must use the same zone as JavaScript timestamps.
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 10, options: "-c timezone=UTC" }), log: [],
});
if (process.env.NODE_ENV !== "production") globalDb.catchsecuDb = client;
export type Transaction = Prisma.TransactionClient;
export function outsideAuthTransaction<T>(operation: () => T): T {
  return authMutationScope.exit(() => credentialScope.exit(operation));
}
// Credential and factor mutations bind adapter/hook queries to the same real
// transaction. Request rate limits survive failed authentication rollbacks.
export const db = new Proxy(client, {
  get(target, property) {
    const current = credentialScope.getStore()?.client ?? authMutationScope.getStore()?.client ?? target;
    const value = Reflect.get(current, property);
    return typeof value === "function" ? value.bind(current) : value;
  },
});
