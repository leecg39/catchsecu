import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { capabilities, roleCapabilities } from "@/server/permissions";

type Task = {
  id: string;
  status: "planned" | "in_progress" | "completed";
  stage: string;
  legacy_tasks: string[];
  completion_evidence: string[];
  local_status: string;
  external_status: string;
  source_fidelity_status: string;
  verification_status: Record<"database" | "api" | "ui" | "external", string>;
};

const readJson = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;
const exists = async (path: string) => readFile(path).then(() => true, () => false);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const active = await readJson<Record<string, string>>("docs/planning/active-plan.json");
const tasks = await readJson<Task[]>(active.tasks);
const legacy = await readJson<Array<{ id: string; status: string; evidence?: string }>>(active.legacyTasks);
const legacyMap = await readJson<{ records: Array<{ legacyTask: string; legacyStatus: string; currentTasks: Array<{ id: string; status: string; stage: string }> }> }>(active.legacyTaskMap);
const sourceRoutes = await readJson<Array<{ path: string }>>(active.sourceRoutes);
const routeMatrix = await readJson<Array<{ path: string; backend_verified: boolean; browser_verified: boolean; external_verified: boolean }>>(active.routeMatrix);
const additionalRoutes = await readJson<Array<{ path: string; task: string; gate: string }>>(active.additionalRoutes);
const statusContract = await readJson<{ surfaceStatus: Record<string, string> }>(active.statusContract);
const roleContract = await readJson<{ tenantRoles: Record<string, string[]>; scopeRules: Record<string, string> }>(active.roleContract);
const modelMap = await readJson<{ mappings: Array<{ legacy: string; current: string[] }> }>(active.modelNameMap);
const openapi = await readJson<{ paths: Record<string, Record<string, unknown>> }>("docs/planning/contracts/openapi.json");
const policyCsv = await readFile("docs/planning/contracts/operation-policy-matrix.csv", "utf8");
const schema = await readFile("prisma/schema.prisma", "utf8");
const modelNames = new Set([...schema.matchAll(/^model\s+(\w+)/gm)].map(match => match[1]));
const failures: string[] = [];
const check = (condition: unknown, message: string) => { if (!condition) failures.push(message); };

const taskById = new Map(tasks.map(task => [task.id, task]));
const legacyById = new Map(legacy.map(task => [task.id, task]));
check(tasks.length === 107, `active task count ${tasks.length} != 107`);
check(legacy.length === 72, `legacy task count ${legacy.length} != 72`);
check(sourceRoutes.length === 186, `source route count ${sourceRoutes.length} != 186`);
check(additionalRoutes.length === 21, `additional route count ${additionalRoutes.length} != 21`);
check(new Set(sourceRoutes.map(row => row.path)).size === 186, "source routes are not unique");
check(new Set(additionalRoutes.map(row => row.path)).size === 21, "additional routes are not unique");
check(additionalRoutes.every(row => !sourceRoutes.some(source => source.path === row.path)), "source/additional routes overlap");
check(routeMatrix.length === sourceRoutes.length, "route matrix does not cover all source routes");
check(routeMatrix.every(row => typeof row.backend_verified === "boolean" && typeof row.browser_verified === "boolean" && typeof row.external_verified === "boolean"), "route matrix verification surfaces are not separated");
check(additionalRoutes.every(row => taskById.has(row.task) && taskById.has(row.gate)), "additional route has unknown owner task");

const linkedLegacy = new Set(tasks.flatMap(task => task.legacy_tasks));
check(linkedLegacy.size === legacy.length && [...legacyById.keys()].every(id => linkedLegacy.has(id)), "legacy task mapping is incomplete");
check(legacyMap.records.length === legacy.length, "legacy-task-map row count mismatch");
for (const row of legacyMap.records) {
  const source = legacyById.get(row.legacyTask);
  check(!!source, `legacy-task-map contains unknown ${row.legacyTask}`);
  check(source?.status === row.legacyStatus, `legacy status drift for ${row.legacyTask}`);
  const expected = tasks.filter(task => task.legacy_tasks.includes(row.legacyTask)).map(task => `${task.id}:${task.status}:${task.stage}`).sort();
  const actual = row.currentTasks.map(task => `${task.id}:${task.status}:${task.stage}`).sort();
  check(JSON.stringify(actual) === JSON.stringify(expected), `current mapping drift for ${row.legacyTask}`);
}

const surfaceValues = new Set(Object.keys(statusContract.surfaceStatus));
for (const task of tasks) {
  check(Object.keys(task.verification_status).sort().join(",") === "api,database,external,ui", `surface fields missing for ${task.id}`);
  for (const [surface, value] of Object.entries(task.verification_status))
    check(surfaceValues.has(value), `invalid ${surface} status ${value} for ${task.id}`);
  check(task.verification_status.external === task.external_status || task.verification_status.external === "not_applicable", `external status drift for ${task.id}`);
  if (task.status === "completed") {
    check(task.completion_evidence.length > 0, `completed task lacks evidence: ${task.id}`);
    check(task.verification_status.external !== "external_pending", `completed task still external_pending: ${task.id}`);
    for (const evidence of task.completion_evidence) check(await exists(evidence), `missing completion evidence ${evidence}`);
  }
}

const roleNames = ["owner", "admin", "editor", "viewer", "privacy", "sender", "billing", "security", "auditor"] as const;
check(Object.keys(roleContract.tenantRoles).sort().join(",") === [...roleNames].sort().join(","), "role contract role set mismatch");
for (const role of roleNames)
  check(JSON.stringify(roleContract.tenantRoles[role]) === JSON.stringify(roleCapabilities(role)), `capability drift for ${role}`);
check(roleContract.tenantRoles.owner.length === capabilities.length, "owner does not include every capability");
check(Object.keys(roleContract.scopeRules).sort().join(",") === "expert,externalActors,license,platformAdmin,serviceGrant,tenantMembership", "role scope rules incomplete");

for (const mapping of modelMap.mappings) {
  check(!modelNames.has(mapping.legacy), `obsolete model unexpectedly exists: ${mapping.legacy}`);
  for (const current of mapping.current) check(modelNames.has(current), `mapped current model missing: ${current}`);
}
const currentModelDoc = await readFile("docs/planning/01-data-models.md", "utf8");
check(!/\bDelivery\(/.test(currentModelDoc), "data model contract still uses Delivery");
check(!/\bMonthlyClose\(/.test(currentModelDoc), "data model contract still uses MonthlyClose");
check(!/\bPurchase\(/.test(currentModelDoc), "data model contract still uses Purchase");
const rootTasks = await readFile("TASKS.md", "utf8");
const objectives = await readFile(".Codex/goals/objectives.md", "utf8");
check(rootTasks.includes("원본 선언 186개 경로") && rootTasks.includes("부가 경로 21개"), "root TASKS lacks active 186+21 scope");
check(objectives.includes("경로 매핑: 원본 선언 186/186 + 부가 경로 21/21"), "goal metrics still use the legacy route baseline");

const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const operationCount = Object.values(openapi.paths).reduce((count, value) => count + Object.keys(value).filter(method => methods.has(method)).length, 0);
const policyRows = policyCsv.trimEnd().split(/\r?\n/).length - 1;
check(operationCount === 466, `OpenAPI operation count ${operationCount} != 466`);
check(policyRows === operationCount, `policy rows ${policyRows} != OpenAPI operations ${operationCount}`);

const report = {
  checkedAt: new Date().toISOString(), result: failures.length ? "failed" : "passed",
  scope: "R00-T03 active/legacy task, route, verification-surface, role, model-name and API policy integration",
  activeTasks: tasks.length, legacyTasks: legacy.length, legacyTasksMapped: linkedLegacy.size,
  sourceRoutes: sourceRoutes.length, additionalRoutes: additionalRoutes.length,
  taskStatuses: Object.fromEntries(["completed", "in_progress", "planned"].map(status => [status, tasks.filter(task => task.status === status).length])),
  verificationSurfaceFields: ["database", "api", "ui", "external"],
  tenantRoles: roleNames.length, capabilities: capabilities.length,
  prismaModels: modelNames.size, obsoleteModelMappings: modelMap.mappings.length,
  openapiPaths: Object.keys(openapi.paths).length, openapiOperations: operationCount, policyRows,
  inputHashes: Object.fromEntries(await Promise.all([active.tasks, active.legacyTasks, active.legacyTaskMap, active.statusContract, active.roleContract, active.modelNameMap]
    .map(async path => [path, sha256(await readFile(path, "utf8"))]))),
  failures,
};
await mkdir("docs/qa/R00-T03", { recursive: true });
await writeFile("docs/qa/R00-T03/integration-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
if (failures.length) process.exitCode = 1;
