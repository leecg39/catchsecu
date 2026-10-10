import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, randomBytes, randomUUID, sign, X509Certificate } from "node:crypto";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type ServerOptions } from "node:https";
import type { IncomingMessage } from "node:http";
import { resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { SignedXml } from "xml-crypto";

// Isolated test infrastructure, never imported by the application.
const directory = resolve(".local/rea-fullstack/sso/https");
const output = "docs/qa/R07-T04/https-flow";
const manifestFile = directory + "/environment.json";
const mode = process.argv[2];
const appOrigin = "https://localhost:3443", idpOrigin = "https://127.0.0.1:3444";
const digest = (v: string) => createHash("sha256").update(v).digest("base64url");
const escape = (v: string) => v.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
type Manifest = { directory: string; appOrigin: string; idpOrigin: string; email: string; password: string; clientId: string; clientSecret: string; samlClientId: string; subject: string };

if (mode === "init") {
  assert(!await access(manifestFile).then(() => true, () => false), "Existing environment cannot be overwritten");
  await mkdir(directory, { recursive: true, mode: 0o700 }); await mkdir(output, { recursive: true });
  await writeFile(directory + "/openssl.cnf", ["[req]", "distinguished_name=dn", "x509_extensions=ca_ext", "[dn]", "[ca_ext]",
    "basicConstraints=critical,CA:TRUE,pathlen:0", "keyUsage=critical,keyCertSign,cRLSign", "subjectKeyIdentifier=hash", "[server_ext]",
    "basicConstraints=critical,CA:FALSE", "keyUsage=critical,digitalSignature,keyEncipherment", "extendedKeyUsage=serverAuth",
    "subjectAltName=DNS:localhost,IP:127.0.0.1"].join("\n") + "\n");
  const openssl = (args: string[]) => execFileSync("openssl", args, { stdio: ["ignore", "pipe", "pipe"] });
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "3", "-config", directory + "/openssl.cnf",
    "-subj", "/CN=Catchsecu HTTPS flow QA CA", "-keyout", directory + "/ca-key.pem", "-out", directory + "/ca.pem"]);
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-sha256", "-subj", "/CN=localhost",
    "-keyout", directory + "/server-key.pem", "-out", directory + "/server.csr"]);
  openssl(["x509", "-req", "-in", directory + "/server.csr", "-CA", directory + "/ca.pem", "-CAkey", directory + "/ca-key.pem",
    "-CAcreateserial", "-days", "2", "-sha256", "-extfile", directory + "/openssl.cnf", "-extensions", "server_ext", "-out", directory + "/server.pem"]);
  openssl(["x509", "-in", directory + "/ca.pem", "-outform", "DER", "-out", directory + "/ca.cer"]);
  await chmod(directory + "/server-key.pem", 0o600); await chmod(directory + "/ca-key.pem", 0o600);
  const id = randomUUID();
  const manifest: Manifest = { directory, appOrigin, idpOrigin, email: "https-" + id + "@example.test", password: "Https-QA!" + randomUUID(),
    clientId: "qa-https-oidc-" + id, clientSecret: randomBytes(32).toString("base64url"), samlClientId: "qa-https-saml-" + id, subject: "qa-https-" + id };
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  const ca = new X509Certificate(await readFile(directory + "/ca.pem")), cert = new X509Certificate(await readFile(directory + "/server.pem"));
  await writeFile(output + "/certificate.json", JSON.stringify({ checkedAt: new Date().toISOString(), appOrigin, idpOrigin,
    caFingerprint256: ca.fingerprint256, caValidTo: ca.validTo, serverFingerprint256: cert.fingerprint256,
    subjectAltName: cert.subjectAltName, validFrom: cert.validFrom, validTo: cert.validTo,
    systemTrustModified: false, verificationDisabled: false }, null, 2) + "\n");
  console.log(JSON.stringify({ initialized: true, directory, appOrigin, idpOrigin }));
} else {
  const fixture = JSON.parse(await readFile(manifestFile, "utf8")) as Manifest;
  assert.equal(fixture.appOrigin, appOrigin); assert.equal(fixture.idpOrigin, idpOrigin);
  const tls: ServerOptions = { key: await readFile(directory + "/server-key.pem"), cert: await readFile(directory + "/server.pem"), minVersion: "TLSv1.2" };
  if (mode === "app") {
    assert.equal(process.env.BETTER_AUTH_URL, appOrigin);
    assert.equal(process.env.NODE_EXTRA_CA_CERTS, directory + "/ca.pem");
    assert.equal(process.env.ALLOW_LOCAL_SSO, "1");
    assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
    const database = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(database.pathname, "/catchsecu_dev"); assert(["127.0.0.1", "localhost"].includes(database.hostname));
    Object.assign(process.env, { NODE_ENV: "development", CATCHSECU_BUILD_DIR: ".next-rea-sso-https", CATCHSECU_TSCONFIG: "tsconfig.rea-sso-https.json" });
    const signingKey = randomBytes(32).toString("hex"); process.env.APP_IP_SIGNING_KEY = signingKey;
    const { stampClientIp } = await import("../src/server/client-ip");
    const { default: next } = await import("next");
    const server = createServer(tls, (request, response) => {
      stampClientIp(request, signingKey, []);
      void handle(request, response).catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
    });
    const app = next({ dev: true, hostname: "localhost", port: 3443, httpServer: server });
    const handle = app.getRequestHandler(); await app.prepare();
    server.listen(3443, "127.0.0.1", () => console.log(JSON.stringify({ ready: true, mode, appOrigin })));
    let stopping = false;
    const stop = () => { if (stopping) return; stopping = true; server.closeIdleConnections();
      const timeout = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000); timeout.unref();
      server.close(() => void app.close().finally(() => process.exit(0))); };
    process.on("SIGTERM", stop); process.on("SIGINT", stop);
  } else if (mode === "idp") {
    const key = await readFile(directory + "/server-key.pem", "utf8");
    const jwk = { ...createPublicKey(key).export({ format: "jwk" }), kid: "https-flow-key", alg: "RS256", use: "sig" };
    type Flow = { nonce: string; challenge: string; redirect: string; expires: number; scenario: string };
    const pending = new Map<string, Flow>(), codes = new Map<string, Flow>();
    const events: { action: string; scenario?: string; passed?: boolean }[] = [];
    const record = async (action: string, scenario?: string, passed?: boolean) => {
      events.push({ action, scenario, passed });
      await writeFile(output + "/idp-events.json", JSON.stringify({ checkedAt: new Date().toISOString(), events }, null, 2) + "\n");
    };
    const readForm = async (request: IncomingMessage) => { const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; assert(bytes <= 262144); chunks.push(chunk); }
      return new URLSearchParams(Buffer.concat(chunks).toString("utf8")); };
    const html = (action: string, fields: Record<string, string>, protocol: string) => '<!doctype html><html lang="ko"><meta charset="utf-8"><title>로컬 HTTPS 시험 IdP</title>'
      + '<style>body{font:18px system-ui;max-width:640px;margin:80px auto;padding:24px}button{padding:14px 24px}</style><h1>' + protocol + ' 시험 인증</h1>'
      + '<p>캐치시큐 로컬 검증용 합성 계정입니다. 외부 기관의 인증 결과가 아닙니다.</p><form method="post" action="' + escape(action) + '">'
      + Object.entries(fields).map(([name, value]) => '<input type="hidden" name="' + name + '" value="' + escape(value) + '">').join("")
      + '<button type="submit">합성 계정으로 계속</button></form></html>';
    const server = createServer(tls, async (request, response) => {
      response.setHeader("cache-control", "no-store"); response.setHeader("referrer-policy", "no-referrer");
      response.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' " + appOrigin + "; frame-ancestors 'none'");
      try {
        assert.equal(request.headers.host, "127.0.0.1:3444");
        const url = new URL(request.url ?? "/", idpOrigin);
        for (const map of [pending, codes]) for (const [id, flow] of map) if (flow.expires < Date.now()) map.delete(id);
        if (url.pathname === "/jwks" && request.method === "GET") {
          await record("jwks"); response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ keys: [jwk] }));
        } else if (url.pathname === "/authorize" && request.method === "GET") {
          const p = url.searchParams;
          assert.equal(p.get("client_id"), fixture.clientId); assert.equal(p.get("redirect_uri"), appOrigin + "/api/v1/auth/sso/callback");
          assert.equal(p.get("response_type"), "code"); assert.equal(p.get("code_challenge_method"), "S256");
          assert(p.get("nonce") && p.get("state") && p.get("code_challenge"));
          const ticket = randomBytes(24).toString("base64url"), target = new URL(p.get("redirect_uri")!); target.searchParams.set("state", p.get("state")!);
          pending.set(ticket, { nonce: p.get("nonce")!, challenge: p.get("code_challenge")!, redirect: target.href, expires: Date.now() + 120000, scenario: p.get("qa_case") ?? "valid" });
          await record("authorize", p.get("qa_case") ?? "valid"); response.setHeader("content-type", "text/html; charset=utf-8");
          response.end(html(idpOrigin + "/approve", { ticket }, "OIDC"));
        } else if (url.pathname === "/approve" && request.method === "POST") {
          const form = await readForm(request), ticket = form.get("ticket") ?? "", flow = pending.get(ticket); assert(flow); pending.delete(ticket);
          const code = randomBytes(24).toString("base64url"); codes.set(code, flow); const target = new URL(flow.redirect); target.searchParams.set("code", code);
          await record("approve", flow.scenario); response.writeHead(303, { location: target.href }); response.end();
        } else if (url.pathname === "/token" && request.method === "POST") {
          const form = await readForm(request), code = form.get("code") ?? "", flow = codes.get(code);
          const valid = !!flow && request.headers.authorization === "Basic " + Buffer.from(fixture.clientId + ":" + fixture.clientSecret).toString("base64")
            && form.get("client_id") === fixture.clientId && form.get("grant_type") === "authorization_code"
            && form.get("redirect_uri") === appOrigin + "/api/v1/auth/sso/callback" && digest(form.get("code_verifier") ?? "") === flow.challenge;
          await record("token", flow?.scenario, valid); response.setHeader("content-type", "application/json");
          if (!valid || !flow) { response.writeHead(400); response.end('{"error":"invalid_grant"}'); return; }
          codes.delete(code); const now = Math.floor(Date.now() / 1000), scenario = flow.scenario;
          const claims = { iss: scenario === "issuer" ? idpOrigin + "/wrong" : idpOrigin, aud: scenario === "audience" ? "wrong" : fixture.clientId,
            sub: fixture.subject, nonce: scenario === "nonce" ? "wrong-nonce" : flow.nonce, exp: now + (scenario === "expired" ? -120 : 120), iat: now,
            email: fixture.email, email_verified: true, name: "HTTPS 시험 사용자" };
          const input = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid, typ: "JWT" })).toString("base64url") + "." + Buffer.from(JSON.stringify(claims)).toString("base64url");
          const signature = sign("sha256", Buffer.from(input), key);
          if (scenario === "signature") signature[0] ^= 1;
          response.end(JSON.stringify({ token_type: "Bearer", id_token: input + "." + signature.toString("base64url") }));
        } else if (url.pathname === "/saml" && request.method === "GET") {
          const requestXml = inflateRawSync(Buffer.from(url.searchParams.get("SAMLRequest") ?? "", "base64"), { maxOutputLength: 100000 }).toString("utf8");
          const requestId = /\bID="([^"]+)"/.exec(requestXml)?.[1], relay = url.searchParams.get("RelayState");
          assert(requestId && relay); assert(requestXml.includes(appOrigin + "/api/v1/auth/sso/saml"));
          const now = new Date().toISOString(), scenario = url.searchParams.get("qa_case") ?? "valid";
          const until = new Date(Date.now() + (scenario === "expired" ? -120000 : 120000)).toISOString();
          const issuer = scenario === "issuer" ? idpOrigin + "/wrong" : idpOrigin;
          const acs = appOrigin + "/api/v1/auth/sso/saml", recipient = scenario === "recipient" ? appOrigin + "/wrong" : acs, id = "_" + randomUUID();
          const xml = '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="' + id + '" Version="2.0" IssueInstant="' + now + '" Destination="' + acs + '" InResponseTo="' + escape(requestId) + '">'
            + '<saml:Issuer>' + issuer + '</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_' + randomUUID() + '" Version="2.0" IssueInstant="' + now + '"><saml:Issuer>' + issuer + '</saml:Issuer>'
            + '<saml:Subject><saml:NameID>' + fixture.subject + '</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="' + escape(requestId) + '" NotOnOrAfter="' + until + '" Recipient="' + recipient + '"/></saml:SubjectConfirmation></saml:Subject>'
            + '<saml:Conditions NotBefore="' + new Date(Date.now() - 180000).toISOString() + '" NotOnOrAfter="' + until + '"><saml:AudienceRestriction><saml:Audience>' + (scenario === "audience" ? "wrong" : fixture.samlClientId) + '</saml:Audience></saml:AudienceRestriction></saml:Conditions>'
            + '<saml:AuthnStatement AuthnInstant="' + now + '"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>'
            + '<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>' + fixture.email + '</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion></samlp:Response>';
          const signer = new SignedXml({ privateKey: key, signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#" });
          signer.addReference({ xpath: "//*[local-name(.)='Response']", uri: "#" + id, digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256", transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"] });
          signer.computeSignature(xml, { location: { reference: "//*[local-name(.)='Response']/*[local-name(.)='Issuer']", action: "after" } });
          let signed = signer.getSignedXml(); if (scenario === "signature") signed = signed.replace(fixture.subject, "tampered-subject");
          await record("saml", scenario); response.setHeader("content-type", "text/html; charset=utf-8"); response.end(html(acs, { SAMLResponse: Buffer.from(signed).toString("base64"), RelayState: relay }, "SAML"));
        } else { response.writeHead(404); response.end("Not found"); }
      } catch { if (!response.headersSent) response.writeHead(400); response.end("Invalid isolated QA request"); }
    });
    server.listen(3444, "127.0.0.1", () => console.log(JSON.stringify({ ready: true, mode, idpOrigin })));
    let stopping = false; const stop = () => { if (stopping) return; stopping = true; server.closeAllConnections(); server.close(() => process.exit(0)); };
    process.on("SIGTERM", stop); process.on("SIGINT", stop);
  } else throw new Error("Use init, app or idp");
}
