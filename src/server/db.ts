import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { env } from "./env";
import { credentialScope } from "./credential-scope";

const globalDb = globalThis as unknown as { catchsecuDb?: PrismaClient };
const client = globalDb.catchsecuDb ?? new PrismaClient({
  // Prisma DateTime columns store UTC without an offset. PostgreSQL defaults and
  // raw queue/lease queries must use the same zone as JavaScript timestamps.
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 10, options: "-c timezone=UTC" }), log: [],
});
if (process.env.NODE_ENV !== "production") globalDb.catchsecuDb = client;
export type Transaction = Prisma.TransactionClient;
// A credential operation binds every adapter/hook query to one real PostgreSQL
// transaction. Outside that narrowly scoped operation, use the ordinary client.
export const db = new Proxy(client, {
  get(target, property) {
    const current = credentialScope.getStore()?.client ?? target;
    const value = Reflect.get(current, property);
    return typeof value === "function" ? value.bind(current) : value;
  },
});
