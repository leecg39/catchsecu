/** Local synthetic DNS protocol fixture. Never accepts external zones or grants live verification. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { localSenderDns } from "../tests/helpers/sender-dns";
const url = new URL(env.DATABASE_URL);
assert.equal(url.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(url.hostname)); assert.equal(env.MAIL_TRANSPORT, "local");
const records = new Map<string, string>(), server = await localSenderDns(records);
await writeFile(".local/sender-dns.json", JSON.stringify({ server: server.server, mode: "local-only .test fixture" }), { mode: 0o600 });
let running = false;
const timer = setInterval(async () => {
  if (running) return; running = true;
  try {
    const rows = await db.senderVerification.findMany({ where: { method: "dns", status: { in: ["pending", "verified"] }, valueCipher: { not: null }, sender: { tenantId: "1cf0bbc4-be6a-48c5-976a-9edfe2e093dc", serviceId: "08e5858c-6d69-451d-b509-7facf4e1867f", label: { startsWith: "발신자 브라우저 QA" }, domain: { endsWith: ".test" }, status: { not: "deleted" } } }, include: { sender: true } });
    records.clear(); for (const row of rows) if (row.generation === row.sender.generation) records.set("_catchsecu-sender." + row.sender.domain, decrypt<string>(row.valueCipher!));
  } finally { running = false; }
}, 250);
async function stop() { clearInterval(timer); await server.close(); await db.$disconnect(); }
process.on("SIGTERM", () => { void stop(); }); process.on("SIGINT", () => { void stop(); });
console.info("합성 .test 도메인의 로컬 DNS 프로토콜 검증 준비 완료");
