/** Local synthetic DNS protocol fixture. Never accepts external zones or grants live verification. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { localSenderDns } from "../tests/helpers/sender-dns";
import { readFile as readCheckpoint } from "node:fs/promises";
const url = new URL(env.DATABASE_URL);
assert.equal(url.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(url.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
// QA_TENANT/QA_LABEL로 대상을 고정한다(기본: 과거 브라우저 fixture). checkpoint 경유 시 합성 회사의 .test만 서빙.
const scopeTenant = process.env.QA_DNS_TENANT ?? "1cf0bbc4-be6a-48c5-976a-9edfe2e093dc";
const scopeService = process.env.QA_DNS_SERVICE ?? "08e5858c-6d69-451d-b509-7facf4e1867f";
const scopeLabel = process.env.QA_DNS_LABEL ?? "발신자 브라우저 QA";
const checkpointPath = process.env.QA_DNS_CHECKPOINT;
const loadCheckpoint = async () => { try { return checkpointPath ? JSON.parse(await readCheckpoint(checkpointPath, "utf8")) : null; } catch { return null; } };
const records = new Map<string, string>(), server = await localSenderDns(records);
await writeFile(".local/sender-dns.json", JSON.stringify({ server: server.server, mode: "local-only .test fixture" }), { mode: 0o600 });
let running = false;
const timer = setInterval(async () => {
  if (running) return; running = true;
  try {
    const cp = await loadCheckpoint();
    const scope = cp
      ? { tenantId: cp.companyId as string, serviceId: cp.serviceId as string, domain: { endsWith: ".test" }, status: { not: "deleted" } }
      : { tenantId: scopeTenant, serviceId: scopeService, label: { startsWith: scopeLabel }, domain: { endsWith: ".test" }, status: { not: "deleted" } };
    const rows = await db.senderVerification.findMany({ where: { method: "dns", status: { in: ["pending", "verified"] }, valueCipher: { not: null }, sender: scope }, include: { sender: true } });
    records.clear(); for (const row of rows) if (row.generation === row.sender.generation) records.set("_catchsecu-sender." + row.sender.domain, decrypt<string>(row.valueCipher!));
  } finally { running = false; }
}, 250);
async function stop() { clearInterval(timer); await server.close(); await db.$disconnect(); }
process.on("SIGTERM", () => { void stop(); }); process.on("SIGINT", () => { void stop(); });
console.info("합성 .test 도메인의 로컬 DNS 프로토콜 검증 준비 완료");
