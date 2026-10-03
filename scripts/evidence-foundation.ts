import { writeFile, stat } from "node:fs/promises";
import { db } from "../src/server/db";
const browserFixture = "1abdb0f3-8385-4898-86a9-290cb7cb63f5";
async function main() {
  const runtime = await db.$queryRaw`SELECT current_database() AS database, current_user AS role, version() AS postgres`;
  const service = await db.service.findUniqueOrThrow({ where: { id: browserFixture },
    select: { id: true, tenantId: true, name: true, description: true, status: true, version: true } });
  const events = await db.auditEvent.findMany({ where: { resourceId: browserFixture }, select: { action: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  const health = await fetch("http://localhost:3100/api/v1/health");
  const unauthenticated = await fetch("http://localhost:3100/dashboard", { redirect: "manual" });
  const report = { checkedAt: new Date().toISOString(), node: process.version, runtime,
    browserFixture: service, auditEvents: events, health: { status: health.status, body: await health.json() },
    unauthenticatedPage: { status: unauthenticated.status, location: unauthenticated.headers.get("location") },
    envFileMode: ((await stat(".env.local")).mode & 0o777).toString(8) };
  if (service.status !== "archived" || service.version !== 3 || events.length !== 3 || health.status !== 200 || unauthenticated.status !== 307) {
    throw new Error("Foundation evidence conditions did not match.");
  }
  await writeFile("docs/qa/P00-T02/runtime-and-db.json", JSON.stringify(report, null, 2) + "\n");
  console.log("Foundation browser/DB evidence verified.");
  await db.$disconnect();
}
main().catch(() => { console.error("Foundation evidence check failed."); process.exitCode = 1; });
