import assert from "node:assert/strict";
import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { decrypt } from "../src/server/crypto";
import { GET, POST } from "../src/app/api/v1/viewer/[...segments]/route";

// Refresh only the expiring viewer cookie; preserve owner, routes and existing data.
const url = new URL(env.DATABASE_URL);
assert.equal(url.pathname, "/catchsecu_mock_admin");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
assert.equal(env.MAIL_TRANSPORT, "local");
const path = ".local/mock-page-fixtures.json", fixture = JSON.parse(await readFile(path, "utf8"));
assert.equal(fixture.origin, "http://catchsecu-mock.localhost:3189");
assert.equal(resolve(env.PRIVATE_STORAGE_DIR), resolve(fixture.storage));
const request = (path: string, body: object, cookie = "") => new Request(fixture.origin + "/api/v1" + path,
  { method: "POST", headers: { origin: fixture.origin, "content-type": "application/json", cookie }, body: JSON.stringify(body) });
try {
  const grant = await db.shareGrant.findFirstOrThrow({ where: { tenantId: fixture.companyId, formId: fixture.formId,
    revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "asc" } });
  const mail = await db.job.findUniqueOrThrow({ where: { dedupeKey: `mail:share:${grant.id}:invite:${grant.version}` } });
  assert.ok(mail.payloadCipher && !mail.payloadErasedAt);
  const invitationCode = /열람자 인증코드: ([A-Za-z0-9_-]{43})/.exec(decrypt<{ text: string }>(mail.payloadCipher).text)?.[1];
  assert.ok(invitationCode);
  const challengeResponse = await POST(request("/viewer/challenges", { formCode: fixture.formId,
    invitationCode, email: decrypt<string>(grant.emailCipher), consent: true }));
  assert.equal(challengeResponse.status, 202);
  const challenge = await challengeResponse.json();
  const challengeCookie = challengeResponse.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
  const codeMail = await db.job.findUniqueOrThrow({ where: { dedupeKey: `mail:share:${grant.id}:challenge:${challenge.id}` } });
  const code = /인증코드: (\d{6})/.exec(decrypt<{ text: string }>(codeMail.payloadCipher).text)?.[1]; assert.ok(code);
  const verified = await POST(request(`/viewer/challenges/${challenge.id}/verify`, { code }, challengeCookie));
  assert.equal(verified.status, 200);
  const cookie = verified.headers.getSetCookie().find(v => v.startsWith("cs_viewer="))?.split(";")[0]; assert.ok(cookie);
  const body = await verified.json();
  const read = await GET(new Request(fixture.origin + "/api/v1/viewer/submissions", { headers: { cookie } }));
  assert.equal(read.status, 200); assert.ok((await read.json()).items.length > 0);
  fixture.viewer = { expiresAt: body.expiresAt, cookies: [{ name: "cs_viewer", value: cookie.slice("cs_viewer=".length),
    path: "/api/v1/viewer", httpOnly: true, sameSite: "Strict" }] };
  await writeFile(path + ".tmp", JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 }); await rename(path + ".tmp", path);
  console.log(JSON.stringify({ viewerRefreshed: true, existingOwnerAndRoutesPreserved: true, checks: 3 }));
} finally { await db.$disconnect(); }
