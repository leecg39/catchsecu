import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
const database = new URL(env.DATABASE_URL);
assert(["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/catchsecu_dev", "로컬 개발 DB에서만 브라우저 fixture를 확인합니다.");
async function main() {
  const fixture = JSON.parse(await readFile(".local/p03-company-fixture.json", "utf8"));
  const company = await db.company.findUniqueOrThrow({ where: { id: fixture.companyId }, include: {
    memberships: { select: { role: true } }, policy: true,
    businessFiles: { select: { id: true, status: true, nameCipher: true, storageKey: true, size: true } },
    subscriptions: { select: { activationSource: true } },
  } });
  const service = await db.service.findUniqueOrThrow({ where: { id: fixture.managedServiceId } });
  assert.equal(company.name, "P03 회사 CRUD 20261003"); assert.equal(company.address, "서울시 수정 주소");
  assert.equal(company.billingContactName, "P03 수정 담당자"); assert.equal(company.billingContactPhone, "010-1234-5678");
  assert.equal(company.status, "active"); assert.equal(company.closureRequestedAt, null); assert.equal(company.closureReasonCipher, null);
  assert.equal(company.memberships[0].role, "owner"); assert(company.policy); assert.equal(company.subscriptions[0].activationSource, "trial");
  assert.equal(service.tenantId, company.id); assert.equal(service.name, "P03 서비스 수정"); assert.equal(service.status, "active"); assert.equal(service.version, 4);
  assert.equal(company.businessFiles.length, 2);
  assert(company.businessFiles.every(file => file.status === "deleted" && file.nameCipher === null && file.storageKey === null && file.size === 0));
  const events = await db.auditEvent.findMany({ where: { tenantId: company.id }, select: { action: true }, orderBy: { createdAt: "asc" } });
  for (const action of ["company.created", "company.updated", "company.closure_requested", "company.closure_cancelled", "company.business_file_uploaded", "company.business_file_removed", "service.archived"])
    assert(events.some(event => event.action === action), action + " 감사 이력이 없습니다.");
  const report = { checkedAt: new Date().toISOString(), companyId: company.id, version: company.version,
    address: company.address, billingContactName: company.billingContactName, billingContactPhone: company.billingContactPhone,
    status: company.status, closureCancelled: company.closureRequestedAt === null,
    ownerAndPolicyAndTrial: true, businessFilesErased: company.businessFiles.length,
    managedService: { id: service.id, name: service.name, status: service.status, version: service.version },
    referencedServicePurposes: await db.processingPurpose.count({ where: { tenantId: company.id, serviceId: fixture.serviceId } }),
    auditActions: events.map(event => event.action) };
  assert(report.referencedServicePurposes > 0);
  await writeFile("docs/qa/P03-T01/database.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: "passed", companyVersion: company.version, serviceVersion: service.version, businessFilesErased: company.businessFiles.length }));
}
main().finally(() => db.$disconnect()).catch(() => { console.error("합성 회사 브라우저 fixture 검증 실패"); process.exitCode = 1; });
