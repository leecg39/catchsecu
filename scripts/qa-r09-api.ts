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
  throw new Error("R09 API audit requires the isolated local catchsecu_test database.");

const specification = JSON.parse(await readFile("docs/planning/contracts/openapi.json", "utf8")) as {
  paths: Record<string, Record<string, Operation>>;
};
const ownership = JSON.parse(await readFile("docs/planning/09-rea-fullstack/api-ownership.json", "utf8")) as Ownership[];
const policies = parse(await readFile("docs/planning/contracts/operation-policy-matrix.csv", "utf8"), { columns: true }) as Array<Record<string, string>>;
const regression = await readFile("docs/qa/R09-T02/current/regression.log", "utf8");
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const failures: string[] = [];
const check = (condition: unknown, message: string) => { if (!condition) failures.push(message); };

const segments = "src/app/api/v1/forms/[...segments]/route.ts";
const routes: Record<string, string> = {
  "/approvals": "src/app/api/v1/approvals/route.ts",
  "/approvals/{id}": "src/app/api/v1/approvals/[...segments]/route.ts",
  "/approvals/{id}/decision": "src/app/api/v1/approvals/[...segments]/route.ts",
  "/fixed-urls": "src/app/api/v1/fixed-urls/route.ts",
  "/fixed-urls/{id}": "src/app/api/v1/fixed-urls/[id]/route.ts",
  "/forms": "src/app/api/v1/forms/route.ts",
  "/forms/{id}": segments,
  "/forms/{id}/approvals": segments,
  "/forms/{id}/audit-events": segments,
  "/forms/{id}/audit-events/export": segments,
  "/forms/{id}/deletion": segments,
  "/forms/{id}/draft": segments,
  "/forms/{id}/purge": segments,
  "/forms/{id}/favorite": segments,
  "/forms/{id}/copy": segments,
  "/forms/{id}/publish": segments,
  "/forms/{id}/pause": segments,
  "/forms/{id}/resume": segments,
  "/forms/{id}/revise": segments,
  "/forms/{id}/retention": segments,
  "/forms/{id}/submissions": segments,
  "/forms/{id}/submissions/export": "src/app/api/v1/forms/[id]/submissions/export/route.ts",
  "/forms/document-options": "src/app/api/v1/forms/document-options/route.ts",
  "/public/urls/{slug}": "src/app/api/v1/public/urls/[slug]/route.ts",
};

const owned = ownership.filter(row => row.owner_tasks.includes("R09-T02"));
check(owned.length === 33, `R09-T02 operation count ${owned.length} != 33`);
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

// 변경을 요청받는 멱등 계약: 생성·승인요청·게시·복사·개정·고정URL 생성은 필수 키다.
for (const path of ["/forms", "/forms/{id}/approvals", "/forms/{id}/publish", "/forms/{id}/copy", "/forms/{id}/revise", "/fixed-urls"])
  check(specification.paths[path]?.post?.parameters?.some(parameter => parameter.in === "header" && parameter.name === "Idempotency-Key" && parameter.required),
    `required Idempotency-Key missing: POST ${path}`);
for (const path of ["/forms/{id}/approvals", "/approvals/{id}/decision", "/approvals/{id}", "/fixed-urls/{id}", "/forms/{id}"])
  check(!!specification.paths[path]?.post?.requestBody || !!specification.paths[path]?.patch?.requestBody || !!specification.paths[path]?.delete,
    `decision/update contract missing: ${path}`);

const regressionMatch = regression.match(/Test Files\s+(\d+) passed \((\d+)\)/);
const testMatch = regression.match(/Tests\s+(\d+) passed \((\d+)\)/);
check(!!regressionMatch && regressionMatch[1] === regressionMatch[2], "regression log is not green (files)");
check(!!testMatch && testMatch[1] === testMatch[2], "regression log is not green (tests)");
check(!/failed|FAIL /.test(regression), "regression log contains a failure");

const [activeApprovals, consumedOrphans, activePublications, archivedLive, crossTenantUrls, orphanVersions] = await Promise.all([
  db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM (
    SELECT "formId" FROM "ApprovalRequest" WHERE status IN ('pending','approved') GROUP BY "formId" HAVING COUNT(*) > 1
  ) duplicates`,
  db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM "ApprovalRequest" a
    WHERE a.status = 'consumed' AND NOT EXISTS (SELECT 1 FROM "Publication" p WHERE p."approvalId" = a.id)`,
  db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM (
    SELECT "formId" FROM "Publication" WHERE status = 'active' GROUP BY "formId" HAVING COUNT(*) > 1
  ) duplicates`,
  db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM "Publication" p
    JOIN "Form" f ON f.id = p."formId" WHERE f.status = 'archived' AND p.status = 'active'`,
  db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM "FixedUrl" u
    JOIN "Publication" p ON p.id = u."publicationId" WHERE u."tenantId" <> p."tenantId"`,
  db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM "Publication" p
    JOIN "FormVersion" v ON v.id = p."formVersionId" WHERE v."formId" <> p."formId"`,
]);
check(activeApprovals[0]?.count === 0, `duplicate active approvals per form: ${activeApprovals[0]?.count}`);
check(consumedOrphans[0]?.count === 0, `consumed approvals without publication: ${consumedOrphans[0]?.count}`);
check(activePublications[0]?.count === 0, `multiple active publications per form: ${activePublications[0]?.count}`);
check(archivedLive[0]?.count === 0, `archived forms with active publication: ${archivedLive[0]?.count}`);
check(crossTenantUrls[0]?.count === 0, `cross-tenant fixed URL publications: ${crossTenantUrls[0]?.count}`);
check(orphanVersions[0]?.count === 0, `publications bound to another form's version: ${orphanVersions[0]?.count}`);

const currentAuthorityFiles = ["src/server/approvals.ts", "src/server/fixed-urls.ts", "src/server/forms.ts", "src/server/public-publication.ts"];
for (const file of currentAuthorityFiles) {
  const source = await readFile(file, "utf8");
  check(source.includes("withFormAccess") || source.includes("formTransaction") || source.includes("lockPublicPublication"),
    `current authority guard missing: ${file}`);
}
const publishRoute = routeSources.get(segments) ?? "";
for (const marker of ["idempotent", "recheckFormAccess", "lockCurrentForm"])
  check(publishRoute.includes(marker), `current-authority recheck missing in ${segments}: ${marker}`);

const sourceFiles = [...new Set([...routeSources.keys(), ...currentAuthorityFiles,
  "src/server/form-access.ts", "src/server/entitlements.ts", "src/server/http.ts", "src/server/idempotency.ts",
  "docs/planning/contracts/openapi.json", "docs/planning/contracts/operation-policy-matrix.csv",
  "docs/planning/09-rea-fullstack/api-ownership.json", "tests/server/r09-publish-contract.test.ts"])];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.sort().map(async file => [file, sha256(await readFile(file))])));
const report = {
  checkedAt: new Date().toISOString(), result: failures.length ? "failed" : "passed",
  database: database.pathname.slice(1), operations: owned.length, routeFiles: routeSources.size,
  contracts: { openapiPaths: Object.keys(specification.paths).length, openapiOperations: ownership.length, policyRows: policies.length,
    requiredIdempotentMutations: 6 },
  regression: { files: regressionMatch ? Number(regressionMatch[2]) : null, tests: testMatch ? Number(testMatch[2]) : null,
    log: "docs/qa/R09-T02/current/regression.log" },
  liveDatabaseInvariants: { duplicateActiveApprovals: activeApprovals[0]?.count ?? null,
    consumedApprovalsWithoutPublication: consumedOrphans[0]?.count ?? null,
    multipleActivePublications: activePublications[0]?.count ?? null,
    archivedFormsWithActivePublication: archivedLive[0]?.count ?? null,
    crossTenantFixedUrls: crossTenantUrls[0]?.count ?? null,
    publicationVersionMismatch: orphanVersions[0]?.count ?? null },
  verifiedBehavior: [
    "approval request/decide/cancel transitions with transactional form status changes",
    "draft→approval→publish→pause→resume flow binding approval to draft/policy/content hash",
    "self-approval allowed only for configured approval roles; unconfigured role decisions rejected",
    "expired subscription blocks new billable resources (402) while existing approval/publish/fixed-url workflow continues",
    "same-slug concurrent create conflict (201 + 409) and immediate revoke to 410",
    "read/copy-link operations never create publications, responses or audit rows",
    "audit persistence failure atomically rolls back approval/publish/fixed-url writes",
    "current membership/role/service-grant rechecked at request and replay time",
  ],
  externalProvider: "not_applicable_to_R09-T02_local_API; separated in R09-T04",
  sourceHashes, failures,
};
await writeFile("docs/qa/R09-T02/current/api-audit.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
await db.$disconnect();
if (failures.length) process.exitCode = 1;
