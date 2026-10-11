/** Local-only synthetic IdP: real RSA/JWKS, single-use authorization codes and PKCE. */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const issuer = "http://127.0.0.1:3123", callback = "http://localhost:3121/api/v1/auth/sso/callback";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "r07-signup-qa", use: "sig", alg: "RS256" };
type Entry = { nonce: string; challenge: string; subject: { sub: string; email: string; name: string }; expires: number };
const codes = new Map<string, Entry>();
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", issuer);
    if (url.pathname === "/jwks") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ keys: [jwk] })); return; }
    if (url.pathname === "/authorize") {
      assert.equal(url.searchParams.get("client_id"), "r07-signup-qa");
      assert.equal(url.searchParams.get("redirect_uri"), callback);
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      const subject = JSON.parse(await readFile(".local/rea-fullstack/r07-signup/identity.json", "utf8"));
      const code = randomUUID();
      for (const [key, entry] of codes) if (entry.expires <= Date.now()) codes.delete(key);
      codes.set(code, { nonce: url.searchParams.get("nonce")!, challenge: url.searchParams.get("code_challenge")!, subject, expires: Date.now() + 60000 });
      const destination = new URL(callback); destination.searchParams.set("code", code); destination.searchParams.set("state", url.searchParams.get("state")!);
      response.writeHead(302, { location: destination.toString() }); response.end(); return;
    }
    if (url.pathname === "/token" && request.method === "POST") {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; assert.ok(size < 16384); chunks.push(chunk); }
      const form = new URLSearchParams(Buffer.concat(chunks).toString()), code = form.get("code")!, entry = codes.get(code);
      codes.delete(code); assert.ok(entry && entry.expires > Date.now());
      assert.equal(form.get("client_id"), "r07-signup-qa"); assert.equal(form.get("redirect_uri"), callback);
      assert.equal(createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url"), entry.challenge);
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const body = encode({ alg: "RS256", kid: jwk.kid, typ: "JWT" }) + "." + encode({ ...entry.subject, email_verified: true,
        iss: issuer, aud: "r07-signup-qa", nonce: entry.nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 });
      response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ id_token: body + "." + sign("sha256", Buffer.from(body), pair.privateKey).toString("base64url") })); return;
    }
    response.writeHead(404); response.end();
  } catch { response.writeHead(400, { "content-type": "application/json" }); response.end(JSON.stringify({ error: "invalid_request" })); }
});
server.listen(3123, "127.0.0.1", () => console.log("R07 synthetic OIDC IdP ready on loopback:3123; no official provider verification"));
process.on("SIGTERM", () => server.close());
