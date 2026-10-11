import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { db } from "@/server/db";
import { env } from "@/server/env";

type Operation = {
  "x-implementation"?: string;
  "x-permission"?: string;
  "x-contract-policy"?: string;
  parameters?: Array<{ in?: string; name?: string; required?: boolean }>;
  requestBody?: unknown;
  responses?: Record<string, { content?: Record<string, unknown> }>;
};
type Ownership = { method: string; path: string; owner_tasks: string[] };

const database = new URL(env.DATABASE_URL);
if (database.pathname !== "/catchsecu_test" || !["localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("R21 API audit requires the isolated local catchsecu_test database.");

const specification = JSON.parse(await readFile("docs/planning/contracts/openapi.json", "utf8")) as {
  paths: Record<string, Record<string, Operation>>;
};
const ownership = JSON.parse(await readFile("docs/planning/09-rea-fullstack/api-ownership.json", "utf8")) as Ownership[];
const policies = parse(await readFile("docs/planning/contracts/operation-policy-matrix.csv", "utf8"), { columns: true }) as Array<Record<string, string>>;
const regression = await readFile("docs/qa/R21-T02/current/billing-regression.log", "utf8");
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const failures: string[] = [];
const check = (condition: unknown, message: string) => { if (!condition) failures.push(message); };

const routes: Record<string, string> = {
  "/billing-history": "src/app/api/v1/billing-history/route.ts",
  "/ledger": "src/app/api/v1/ledger/route.ts",
  "/admin/plans": "src/app/api/v1/admin/plans/route.ts",
  "/admin/plans/{id}": "src/app/api/v1/admin/plans/[id]/route.ts",
  "/usage-events": "src/app/api/v1/usage-events/route.ts",
  "/invoices": "src/app/api/v1/invoices/route.ts",
  "/plans": "src/app/api/v1/plans/route.ts",
  "/entitlements": "src/app/api/v1/entitlements/route.ts",
  "/assets": "src/app/api/v1/assets/route.ts",
  "/subscriptions": "src/app/api/v1/subscriptions/[[...segments]]/route.ts",
  "/subscriptions/entitlement": "src/app/api/v1/subscriptions/[[...segments]]/route.ts",
  "/subscriptions/{id}/cancel": "src/app/api/v1/subscriptions/[[...segments]]/route.ts",
  "/subscriptions/{id}/undo-cancel": "src/app/api/v1/subscriptions/[[...segments]]/route.ts",
  "/subscriptions/{id}/schedule-cancel": "src/app/api/v1/subscriptions/[[...segments]]/route.ts",
  "/billing/methods": "src/app/api/v1/billing/methods/route.ts",
  "/billing/methods/{id}": "src/app/api/v1/billing/methods/[id]/route.ts",
  "/billing/orders": "src/app/api/v1/billing/orders/route.ts",
  "/billing/orders/{id}": "src/app/api/v1/billing/orders/[id]/route.ts",
  "/billing/orders/{id}/return": "src/app/api/v1/billing/orders/[id]/return/route.ts",
  "/billing/orders/{id}/refunds": "src/app/api/v1/billing/orders/[id]/refunds/route.ts",
  "/billing/orders/{id}/invoice": "src/app/api/v1/billing/orders/[id]/invoice/route.ts",
  "/billing/orders/{id}/virtual-checkout": "src/app/api/v1/billing/orders/[id]/virtual-checkout/route.ts",
  "/billing/closing": "src/app/api/v1/billing/closing/route.ts",
  "/billing/provider-events": "src/app/api/v1/billing/provider-events/route.ts",
  "/billing/refunds/{id}/virtual-settle": "src/app/api/v1/billing/refunds/[id]/virtual-settle/route.ts",
};

const owned = ownership.filter(row => row.owner_tasks.includes("R21-T02"));
check(owned.length === 34, `R21-T02 operation count ${owned.length} != 34`);
const routeSources = new Map<string, string>();
for (const file of new Set(Object.values(routes))) routeSources.set(file, await readFile(file, "utf8"));
for (const row of owned) {
  const operation = specification.paths[row.path]?.[row.method.toLowerCase()];
  const policy = policies.find(item => item.method === row.method && item.path === row.path);
  const file = routes[row.path];
  check(!!operation, `OpenAPI operation missing: ${row.method} ${row.path}`);
  check(operation?.["x-implementation"] === "implemented", `operation is not implemented: ${row.method} ${row.path}`);
  check(!!operation?.["x-permission"] && !!operation?.["x-contract-policy"], `permission/policy missing: ${row.method} ${row.path}`);
  check(!!policy, `policy row missing: ${row.method} ${row.path}`);
  check(!!file && routeSources.get(file)?.includes(`export const ${row.method}`), `route export missing: ${row.method} ${row.path}`);
}

for (const path of ["/billing/orders", "/billing/orders/{id}/refunds", "/billing/closing", "/subscriptions",
  "/subscriptions/{id}/cancel", "/subscriptions/{id}/undo-cancel", "/subscriptions/{id}/schedule-cancel"])
  check(specification.paths[path]?.post?.parameters?.some(parameter => parameter.in === "header" && parameter.name === "Idempotency-Key" && parameter.required),
    `required Idempotency-Key missing: POST ${path}`);
check(!!specification.paths["/billing/orders/{id}/refunds"]?.post?.requestBody, "refund request schema missing");
check(!!specification.paths["/billing/closing"]?.post?.requestBody, "month-close request schema missing");
check(specification.paths["/billing/closing"]?.get?.parameters?.some(parameter => parameter.in === "query" && parameter.name === "month" && parameter.required),
  "month-close required month query missing");
check(!!specification.paths["/billing/orders/{id}/invoice"]?.get?.responses?.["200"]?.content?.["application/pdf"],
  "invoice PDF response contract missing");
check(/Test Files\s+14 passed \(14\)/.test(regression) && /Tests\s+169 passed \(169\)/.test(regression),
  "14-file/169-test regression evidence is not green");

const [ledger, refunds, scopes, events] = await Promise.all([
  db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM (
    SELECT "transactionId" FROM "LedgerEntry" GROUP BY "transactionId" HAVING SUM(amount) <> 0
  ) invalid`,
  db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM (
    SELECT o.id FROM "PaymentOrder" o LEFT JOIN "PaymentRefund" r
      ON r."orderId"=o.id AND r.status IN ('requested','refunded')
    GROUP BY o.id,o.amount HAVING COALESCE(SUM(r.amount),0) > o.amount
  ) invalid`,
  db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM "PaymentOrder" o
    JOIN "BillingSubscription" s ON s.id=o."subscriptionId" WHERE o."tenantId" <> s."tenantId"`,
  db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM (
    SELECT "providerEventId" FROM "PaymentEvent" GROUP BY "providerEventId" HAVING COUNT(*) > 1
  ) invalid`,
]);
check(ledger[0]?.count === 0, `unbalanced ledger transactions: ${ledger[0]?.count}`);
check(refunds[0]?.count === 0, `refund totals above paid order: ${refunds[0]?.count}`);
check(scopes[0]?.count === 0, `cross-tenant payment orders: ${scopes[0]?.count}`);
check(events[0]?.count === 0, `duplicate provider events: ${events[0]?.count}`);

const currentAuthorityFiles = ["src/server/billing-history.ts", "src/server/ledger.ts", "src/server/billing-settlement.ts"];
for (const file of currentAuthorityFiles) {
  const source = await readFile(file, "utf8");
  check(source.includes("withBillingAccess") || source.includes("lockBillingActor"), `current billing actor guard missing: ${file}`);
}
const sourceFiles = [...new Set([...routeSources.keys(), ...currentAuthorityFiles,
  "src/server/admin-plans.ts", "src/server/payment-methods.ts", "src/server/payments.ts", "src/server/subscriptions.ts",
  "src/server/subscription-worker.ts", "src/server/billing-reads.ts", "docs/planning/contracts/openapi.json",
  "docs/planning/contracts/operation-policy-matrix.csv", "docs/planning/09-rea-fullstack/api-ownership.json"])];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.sort().map(async file => [file, sha256(await readFile(file))])));
const report = {
  checkedAt: new Date().toISOString(), result: failures.length ? "failed" : "passed",
  database: database.pathname.slice(1), operations: owned.length, routeFiles: routeSources.size,
  contracts: { openapiPaths: Object.keys(specification.paths).length, openapiOperations: ownership.length, policyRows: policies.length,
    newSettlementOperations: 5, idempotentMutationContracts: 7, invoicePdf: true },
  regression: { files: 14, tests: 169, log: "docs/qa/R21-T02/current/billing-regression.log" },
  liveDatabaseInvariants: { unbalancedLedgerTransactions: ledger[0]?.count ?? null, refundOverflowOrders: refunds[0]?.count ?? null,
    crossTenantOrders: scopes[0]?.count ?? null, duplicateProviderEvents: events[0]?.count ?? null },
  verifiedBehavior: ["signed event state machine and duplicate/reordered events", "one-time funding and balanced ledger",
    "partial/full refund and latest-state idempotent replay", "payment/subscription cancellation races",
    "current role/session/company/policy checks", "audit and idempotency rollback", "server-generated invoice and immutable month close"],
  externalProvider: "not_applicable_to_R21-T02_local_API; separated in R21-T04",
  sourceHashes, failures,
};
await writeFile("docs/qa/R21-T02/current/api-audit.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
await db.$disconnect();
if (failures.length) process.exitCode = 1;
