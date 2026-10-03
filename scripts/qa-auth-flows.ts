import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { auth } from "../src/server/auth";
import { decrypt } from "../src/server/crypto";
import { runOneJob } from "../src/server/jobs";
import { roleCapabilities } from "../src/server/permissions";

const database = new URL(env.DATABASE_URL);
assert(["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/catchsecu_dev", "로컬 개발 DB에서만 브라우저 fixture를 준비합니다.");
assert.equal(env.MAIL_TRANSPORT, "local", "이 검증은 로컬 메일함만 사용합니다.");
const path = ".local/p02-auth-fixture.json";
type Fixture = { email: string; password: string; newPassword: string; companyId: string; serviceId: string; secret?: string; otp?: string; backupCodes?: string[]; verificationLink?: string; resetLink?: string };
const command = process.argv[2];
async function save(value: Fixture) { await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 }); }
async function main() {
  await mkdir(".local", { recursive: true, mode: 0o700 });
  if (command === "prepare") {
    const fixture: Fixture = { email: "p02-browser-" + randomUUID().slice(0, 8) + "@catchsecu.local.test", password: randomBytes(24).toString("base64url") + "!1aA", newPassword: randomBytes(24).toString("base64url") + "!1aA", companyId: randomUUID(), serviceId: randomUUID() };
    await save(fixture); console.log(JSON.stringify({ prepared: true, email: fixture.email })); return;
  }
  const fixture: Fixture = JSON.parse(await readFile(path, "utf8"));
  const user = await db.user.findUniqueOrThrow({ where: { email: fixture.email } });
  if (command === "attach") {
    await db.company.create({ data: { id: fixture.companyId, name: "P02 인증 브라우저 회사 A", publicName: "P02 인증 회사 A", policy: { create: {} } } });
    await db.service.create({ data: { id: fixture.serviceId, tenantId: fixture.companyId, name: "P02 인증 서비스", externalName: "P02 인증 서비스" } });
    const member = await db.membership.create({ data: { tenantId: fixture.companyId, userId: user.id, role: "owner" } });
    await db.serviceGrant.create({ data: { tenantId: fixture.companyId, memberId: member.id, serviceId: fixture.serviceId, capabilities: [...roleCapabilities("owner")] } });
    console.log(JSON.stringify({ attached: true, verified: user.emailVerified }));
  } else if (command === "mail") {
    const subject = process.argv[3] === "reset" ? "비밀번호 재설정" : process.argv[3] === "otp" ? "로그인 인증코드" : "이메일 인증";
    const all = await db.job.findMany({ where: { type: "mail" }, orderBy: { createdAt: "desc" } });
    const job = all.find(row => { const mail = decrypt<{ to: string; subject: string }>(row.payloadCipher); return mail.to === fixture.email && mail.subject === subject; });
    assert(job, "인증 메일 작업이 없습니다.");
    // Do not dispatch other users' queued work while checking a synthetic fixture.
    const due = await db.job.findMany({ where: { status: { in: ["queued", "retry"] }, dueAt: { lte: new Date() } } });
    assert(due.every(row => row.type === "mail" && decrypt<{ to: string }>(row.payloadCipher).to === fixture.email), "다른 작업이 대기 중입니다. 이 검증이 다른 사용자의 작업을 처리하지 않습니다.");
    for (let attempt = 0; attempt < 30 && (await db.job.findUniqueOrThrow({ where: { id: job.id } })).status !== "done"; attempt++)
      assert(await runOneJob("p02-auth-browser"), "메일 작업이 처리되지 않았습니다.");
    assert.equal((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status, "done");
    const mail = JSON.parse(await readFile(resolve(env.LOCAL_MAIL_DIR, job.id + ".json"), "utf8"));
    assert.equal(mail.to, fixture.email);
    if (subject === "로그인 인증코드") fixture.otp = mail.text.match(/인증코드: ([0-9]{6})/)?.[1];
    else if (subject === "비밀번호 재설정") fixture.resetLink = mail.text.match(/https?:\/\/\S+/)?.[0];
    else fixture.verificationLink = mail.text.match(/https?:\/\/\S+/)?.[0];
    await save(fixture); console.log(JSON.stringify({ delivered: true, subject }));
  } else if (command === "otp") {
    assert(fixture.secret, "브라우저에서 받은 등록 키가 없습니다.");
    const secret = new TextDecoder().decode(base32.decode(fixture.secret));
    fixture.otp = await createOTP(secret, { digits: 6, period: 30 }).totp();
    await save(fixture); console.log(JSON.stringify({ generated: true }));
  } else if (command === "require-mfa") {
    await db.securityPolicy.update({ where: { tenantId: fixture.companyId }, data: { requireMfa: true } });
    console.log(JSON.stringify({ required: true }));
  } else if (command === "expire-reset") {
    await db.verification.updateMany({ where: { value: user.id }, data: { expiresAt: new Date(Date.now() - 60000) } });
    console.log(JSON.stringify({ expired: true }));
  } else if (command === "state") {
    const account = await db.account.findFirstOrThrow({ where: { userId: user.id, providerId: "credential" } });
    const context = await auth.$context;
    const report = { checkedAt: new Date().toISOString(), email: fixture.email, emailVerified: user.emailVerified, twoFactorEnabled: user.twoFactorEnabled,
      initialPasswordValid: await context.password.verify({ hash: account.password!, password: fixture.password }),
      resetPasswordValid: await context.password.verify({ hash: account.password!, password: fixture.newPassword }),
      sessions: await db.session.count({ where: { userId: user.id } }),
      memberships: await db.membership.count({ where: { userId: user.id, tenantId: fixture.companyId, status: "active" } }) };
    await mkdir("docs/qa/P02-T04", { recursive: true });
    await writeFile("docs/qa/P02-T04/database.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } else throw new Error("prepare, attach, mail, otp, require-mfa, expire-reset, state 중 하나를 사용하세요.");
}
main().finally(() => db.$disconnect()).catch(() => { console.error("브라우저 인증 fixture 확인 실패. 비밀 값은 출력하지 않습니다."); process.exitCode = 1; });
