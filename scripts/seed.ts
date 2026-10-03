import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hashPassword } from "better-auth/crypto";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { roleCapabilities } from "../src/server/permissions";
import type { Role } from "../src/generated/prisma/client";
import sourceNotices from "../src/data/notices.json";
import sourceNoticeDetails from "../src/data/notice-details.json";
import sourceGuides from "../src/data/help-docs.json";
import { sha256 } from "../src/server/file-validation";

const url = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !["/catchsecu_dev", "/catchsecu_test"].includes(url.pathname)) {
  throw new Error("Seed는 프로젝트의 로컬 dev/test DB에서만 실행할 수 있습니다.");
}
export const fixtureIds = {
  companyA: "10000000-0000-4000-8000-000000000001",
  companyB: "10000000-0000-4000-8000-000000000002",
  serviceA: "20000000-0000-4000-8000-000000000001",
  serviceA2: "20000000-0000-4000-8000-000000000002",
  serviceB: "20000000-0000-4000-8000-000000000003",
};
async function main() {
  await mkdir(".local", { recursive: true, mode: 0o700 });
  const credentialFile = ".local/" + url.pathname.slice(1) + "-accounts.json";
  let passwords: Record<string, string> = {};
  try { passwords = JSON.parse(await readFile(credentialFile, "utf8")); } catch {}
  const roles: Role[] = ["owner", "admin", "editor", "viewer", "privacy", "sender", "billing", "security", "auditor"];
  for (const [id, name] of [[fixtureIds.companyA, "캐치시큐 테스트 회사 A"], [fixtureIds.companyB, "캐치시큐 테스트 회사 B"]]) {
    await db.company.upsert({ where: { id }, update: {}, create: { id, name, publicName: name, policy: { create: {} } } });
  }
  for (const [id, tenantId, name] of [
    [fixtureIds.serviceA, fixtureIds.companyA, "기본 서비스"],
    [fixtureIds.serviceA2, fixtureIds.companyA, "제한 서비스"],
    [fixtureIds.serviceB, fixtureIds.companyB, "회사 B 서비스"],
  ]) await db.service.upsert({ where: { id }, update: {}, create: { id, tenantId, name, externalName: name } });
  for (const [index, role] of [...roles, "owner" as Role].entries()) {
    const tenantId = index < roles.length ? fixtureIds.companyA : fixtureIds.companyB;
    const email = index < roles.length ? role + "@catchsecu.local.test" : "owner-b@catchsecu.local.test";
    const id = "30000000-0000-4000-8000-" + String(index + 1).padStart(12, "0");
    passwords[email] ??= randomBytes(18).toString("base64url") + "!1aA";
    const hash = await hashPassword(passwords[email]);
    await db.user.upsert({ where: { id }, update: {}, create: { id, name: role + (index < roles.length ? " A" : " B"), email, emailVerified: true,
      accounts: { create: { id: crypto.randomUUID(), providerId: "credential", accountId: id, password: hash } } } });
    const member = await db.membership.upsert({ where: { tenantId_userId: { tenantId, userId: id } },
      update: {}, create: { tenantId, userId: id, role } });
    const serviceId = tenantId === fixtureIds.companyA ? fixtureIds.serviceA : fixtureIds.serviceB;
    await db.serviceGrant.upsert({ where: { tenantId_memberId_serviceId: { tenantId, memberId: member.id, serviceId } },
      update: {}, create: { tenantId, memberId: member.id, serviceId, capabilities: [...roleCapabilities(role)] } });
  }
  const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  for (const [index, row] of sourceNotices.entries()) {
    const detail = sourceNoticeDetails[index];
    if (!detail?.id || !detail.content?.trim()) continue;
    await db.notice.upsert({ where: { id: detail.id }, update: {}, create: {
      id: detail.id, category: row[1], title: row[2],
      bodyHtml: escapeHtml(detail.content.trim()).replaceAll("\n", "<br>"),
      status: "published", sortOrder: sourceNotices.length - index, authorName: row[4],
      publishedAt: new Date(row[3].replace(" ", "T") + "+09:00"),
    } });
  }
  for (const [categoryOrder, group] of sourceGuides.entries()) {
    for (const [sortOrder, fileName] of group.files.entries()) {
      const assetKey = `${categoryOrder}-${sortOrder}`;
      const bytes = await readFile(`assets/help-pdfs/${assetKey}.pdf`);
      if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-" || !bytes.subarray(-1024).includes(Buffer.from("%%EOF")))
        throw new Error(`가이드 PDF 형식을 확인할 수 없습니다: ${assetKey}`);
      await db.guide.upsert({ where: { id: `guide-${assetKey}` }, update: {}, create: {
        id: `guide-${assetKey}`, category: group.title, categoryOrder, title: fileName.normalize("NFC"), sortOrder,
        status: "published", fileName: fileName.normalize("NFC"), fileSize: bytes.length, fileSha256: sha256(bytes),
        assetKey, publishedAt: new Date(),
      } });
    }
  }
  await writeFile(credentialFile, JSON.stringify(passwords, null, 2), { mode: 0o600 });
  console.info("회사 A/B, 서비스 3개, 역할별 10개 계정과 원본 공지·가이드 fixture 생성. 계정 정보: " + credentialFile);
  await db.$disconnect();
}
main().catch(() => { console.error("로컬 seed 실패. 환경 설정과 migration 상태를 확인하세요."); process.exitCode = 1; });
