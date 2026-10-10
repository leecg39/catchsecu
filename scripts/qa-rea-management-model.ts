import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
assert.ok(["/catchsecu_dev", "/catchsecu_test"].includes(database.pathname));
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
const tables = ["Company", "Service", "Membership", "ServiceGrant", "AccessRequest", "CompanyBusinessFile"];
const requiredColumns: Record<string, string[]> = {
  Company: ["id", "name", "publicName", "status", "version", "closureRequestedAt", "closureReasonCipher", "closureRequestedById"],
  Service: ["id", "tenantId", "name", "externalName", "description", "type", "status", "version", "createdAt", "updatedAt"],
  Membership: ["id", "tenantId", "userId", "role", "status", "version", "accessKind", "expertAssignmentId"],
  ServiceGrant: ["id", "tenantId", "memberId", "serviceId", "capabilities", "createdAt"],
  AccessRequest: ["id", "tenantId", "requesterId", "serviceId", "reason", "status", "version", "reviewerId", "decisionNote", "resolvedAt"],
  CompanyBusinessFile: ["id", "tenantId", "nameCipher", "mime", "size", "sha256", "storageKey", "status", "scanEngine", "scannedAt"],
};
try {
  const columns = await db.$queryRaw<{ table: string; column: string; type: string; nullable: string }[]>`
    SELECT table_name AS "table", column_name AS "column", data_type AS type, is_nullable AS nullable
    FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY(${tables}::text[])
    ORDER BY table_name, ordinal_position`;
  const constraints = await db.$queryRaw<{ table: string; name: string; definition: string }[]>`
    SELECT c.relname AS "table", k.conname AS name, pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(${tables}::text[]) ORDER BY c.relname,k.conname`;
  const indexes = await db.$queryRaw<{ table: string; name: string; definition: string }[]>`
    SELECT tablename AS "table", indexname AS name, indexdef AS definition
    FROM pg_indexes WHERE schemaname='public' AND tablename=ANY(${tables}::text[]) ORDER BY tablename,indexname`;
  for (const table of tables) {
    assert.ok(columns.some(column => column.table === table), table);
    const actual = new Set(columns.filter(column => column.table === table).map(column => column.column));
    for (const column of requiredColumns[table]) assert.ok(actual.has(column), `${table}.${column}`);
  }
  const constraint = (name: string) => constraints.find(item => item.name === name)?.definition ?? "";
  assert.match(constraint("Company_status_check"), /active/);
  assert.match(constraint("Company_status_check"), /closed/);
  assert.match(constraint("Company_closure_request_check"), /closureRequestedAt/);
  assert.match(constraint("Company_closure_request_check"), /closureRequestedById/);
  assert.match(constraint("Company_closure_requested_by_fkey"), /Membership/);
  assert.match(constraint("Company_closure_requested_by_fkey"), /ON DELETE RESTRICT/);
  assert.match(constraint("Membership_status_check"), /revoked/);
  assert.match(constraint("Service_status_check"), /archived/);
  assert.match(constraint("Service_tenantId_fkey"), /Company/);
  assert.match(constraint("Service_tenantId_fkey"), /ON DELETE RESTRICT/);
  assert.match(constraint("Membership_tenantId_fkey"), /Company/);
  assert.match(constraint("Membership_tenantId_fkey"), /ON DELETE RESTRICT/);
  assert.match(constraint("ServiceGrant_tenantId_memberId_fkey"), /Membership/);
  assert.match(constraint("ServiceGrant_tenantId_serviceId_fkey"), /Service/);
  assert.match(constraint("CompanyBusinessFile_tenantId_fkey"), /Company/);
  assert.match(constraint("CompanyBusinessFile_tenantId_fkey"), /ON DELETE RESTRICT/);
  assert.match(constraint("CompanyBusinessFile_status_check"), /deleting/);
  assert.match(constraint("CompanyBusinessFile_status_check"), /deleted/);
  assert.match(constraint("CompanyBusinessFile_check"), /storageKey/);
  const pending = indexes.find(index => index.name === "AccessRequest_one_pending_key");
  assert.ok(pending?.definition.includes("UNIQUE") && pending.definition.includes("pending"));
  for (const kind of ["requester", "service", "reviewer"]) {
    const key = constraints.find(item => item.name === "AccessRequest_" + kind + "_fkey");
    assert.ok(key?.definition.includes('"tenantId"') && key.definition.includes("ON DELETE RESTRICT"));
  }
  assert.ok(constraints.some(item => item.name === "AccessRequest_state_check" && item.definition.includes("resolvedAt")));
  assert.ok(indexes.some(item => item.table === "Service" && item.definition.includes("UNIQUE") && item.definition.includes('"tenantId", name')));
  assert.ok(indexes.some(item => item.table === "ServiceGrant" && item.definition.includes("UNIQUE") && item.definition.includes('"tenantId", "memberId", "serviceId"')));
  assert.ok(indexes.some(item => item.name === "CompanyBusinessFile_active_tenant_key" && item.definition.includes("UNIQUE") && item.definition.includes("status = 'active'")));
  const files = ["prisma/schema.prisma", "prisma/migrations/20261003140000_service_access_requests/migration.sql",
    "src/server/company-management.ts", "src/server/service-management.ts", "src/server/access-requests.ts", "src/contracts/access-requests.ts"];
  const sourceFingerprints = Object.fromEntries(await Promise.all(files.map(async file =>
    [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
  const report = { result: "passed", database: database.pathname.slice(1), checkedAt: new Date().toISOString(),
    scope: "six management models; required fields, tenant ownership, optimistic company/service/request versions, state transitions, uniqueness, retention and delete boundaries",
    versionOwnership: { company: "Company.version", service: "Service.version", accessRequest: "AccessRequest.version",
      businessFileMutation: "Company.version serializes upload, replacement and deletion; CompanyBusinessFile keeps immutable file evidence rows" },
    lifecycleSeparation: { companyClosure: "Company.status and closureRequested*", memberWithdrawal: "Membership.status=revoked" },
    tables, columns, constraints, indexes, sourceFingerprints };
  await mkdir("docs/qa/R03-T01/model-audit", { recursive: true });
  await writeFile("docs/qa/R03-T01/model-audit/" + database.pathname.slice(1) + ".json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, database: report.database, tables: tables.length, columns: columns.length, constraints: constraints.length, indexes: indexes.length }));
} finally { await db.$disconnect(); }
