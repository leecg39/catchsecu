import { createServer } from "node:https";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, X509Certificate } from "node:crypto";
import assert from "node:assert/strict";

const output = "docs/qa/R07-T02/outbound";
await mkdir(".local/rea-fullstack/sso/outbound", { recursive: true, mode: 0o700 });
await mkdir(output, { recursive: true });
const directory = await mkdtemp(resolve(".local/rea-fullstack/sso/outbound/tls-"));
await mkdir(directory + "/certs");
await writeFile(directory + "/index.txt", ""); await writeFile(directory + "/serial", "1000\n");
const config = directory + "/openssl.cnf";
await writeFile(config, [
  "[req]", "distinguished_name=dn", "x509_extensions=ca_ext", "[dn]", "[ca_ext]",
  "basicConstraints=critical,CA:TRUE", "keyUsage=critical,keyCertSign,cRLSign", "subjectKeyIdentifier=hash",
  "[ca]", "default_ca=local_ca", "[local_ca]", "database=" + directory + "/index.txt", "serial=" + directory + "/serial",
  "new_certs_dir=" + directory + "/certs", "certificate=" + directory + "/ca.pem", "private_key=" + directory + "/ca-key.pem",
  "default_days=2", "default_md=sha256", "policy=policy", "unique_subject=no",
  "[policy]", "commonName=supplied", "[server_ext]", "basicConstraints=critical,CA:FALSE",
  "keyUsage=critical,digitalSignature,keyEncipherment", "extendedKeyUsage=serverAuth", "subjectAltName=DNS:localhost",
].join("\n") + "\n");
const openssl = (args: string[]) => execFileSync("openssl", args, { stdio: ["ignore", "pipe", "pipe"] });
openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "3", "-config", config,
  "-subj", "/CN=Catchsecu isolated QA CA", "-keyout", directory + "/ca-key.pem", "-out", directory + "/ca.pem"]);
openssl(["req", "-newkey", "rsa:2048", "-nodes", "-sha256", "-subj", "/CN=localhost",
  "-keyout", directory + "/server-key.pem", "-out", directory + "/server.csr"]);
openssl(["ca", "-batch", "-config", config, "-extensions", "server_ext", "-in", directory + "/server.csr", "-out", directory + "/server.pem"]);
openssl(["ca", "-batch", "-config", config, "-extensions", "server_ext", "-in", directory + "/server.csr",
  "-startdate", "20200101000000Z", "-enddate", "20200102000000Z", "-out", directory + "/expired.pem"]);
await chmod(directory + "/ca-key.pem", 0o600); await chmod(directory + "/server-key.pem", 0o600);
const key = await readFile(directory + "/server-key.pem"), certificate = await readFile(directory + "/server.pem"), expired = await readFile(directory + "/expired.pem");
const received: { host?: string; path?: string; authorizationPresent: boolean; bodyBytes: number }[] = [];
const sni: string[] = [];
const validServer = createServer({ key, cert: certificate }, (request, response) => {
  let bytes = 0; request.on("data", chunk => { bytes += chunk.length; });
  request.on("end", () => {
    received.push({ host: request.headers.host, path: request.url, authorizationPresent: !!request.headers.authorization, bodyBytes: bytes });
    response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ accepted: true }));
  });
});
validServer.on("secureConnection", socket => { sni.push((socket as typeof socket & { servername?: string }).servername ?? ""); });
const expiredServer = createServer({ key, cert: expired }, (_request, response) => { response.end("{}"); });
await new Promise<void>(done => validServer.listen(0, "127.0.0.1", done));
await new Promise<void>(done => expiredServer.listen(0, "127.0.0.1", done));
const port = (validServer.address() as { port: number }).port, expiredPort = (expiredServer.address() as { port: number }).port;
async function client(url: string, trust = true, production = false, post = false) {
  const source = [
    'import { requestSsoJson } from "./src/server/sso-transport.ts";',
    "try { const result = await requestSsoJson(process.argv[1], " + (post ? '{method:"POST",authorization:"Basic synthetic-qa",body:new URLSearchParams({code:"qa",code_verifier:"qa-verifier"})}' : "{}") + ");",
    'console.log(JSON.stringify({ok:true,status:result.status,accepted:result.body.accepted}));',
    '} catch(error) { console.log(JSON.stringify({ok:false,code:error.code ?? "UNEXPECTED"})); }',
  ].join("\n");
  const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: production ? "production" : "test", ALLOW_LOCAL_SSO: "1", ALLOW_LOCAL_MAIL: "1", ALLOW_LOCAL_PAYMENT: "1" };
  delete childEnv.NODE_TLS_REJECT_UNAUTHORIZED; delete childEnv.NODE_EXTRA_CA_CERTS;
  if (trust) childEnv.NODE_EXTRA_CA_CERTS = directory + "/ca.pem";
  return new Promise<{ ok: boolean; code?: string; status?: number; accepted?: boolean }>((resolveResult, reject) => {
    const child = spawn(process.execPath, ["--env-file=.env.test.local", "--import", "tsx", "--input-type=module", "-e", source, url], { env: childEnv });
    let stdout = "", stderr = ""; const timeout = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("TLS client exceeded deadline")); }, 15000);
    child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject);
    child.on("close", code => {
      clearTimeout(timeout);
      if (code !== 0) { reject(new Error("TLS child process failed; stderr bytes=" + Buffer.byteLength(stderr))); return; }
      try { resolveResult(JSON.parse(stdout.trim())); } catch { reject(new Error("Invalid child result")); }
    });
  });
}
const checks: { action: string; result: Awaited<ReturnType<typeof client>> }[] = [];
try {
  for (const [action, url, trust, production, post, expected] of [
    ["trusted CA + hostname GET", "https://localhost:" + port + "/jwks", true, false, false, true],
    ["trusted CA + hostname token POST", "https://localhost:" + port + "/token", true, false, true, true],
    ["untrusted CA rejected", "https://localhost:" + port + "/untrusted", false, false, false, false],
    ["SAN mismatch rejected", "https://127.0.0.1:" + port + "/wrong-san", true, false, false, false],
    ["expired server certificate rejected", "https://localhost:" + expiredPort + "/expired", true, false, false, false],
    ["production localhost blocked despite explicit local flag", "https://localhost:" + port + "/production", true, true, false, false],
  ] as const) {
    const result = await client(url, trust, production, post); checks.push({ action, result });
    assert.equal(result.ok, expected, action);
    if (expected) assert.equal(result.accepted, true);
    else assert.equal(result.code, production ? "UNSAFE_DNS" : "CONNECTION_FAILED");
  }
  assert.equal(received.length, 2); assert.equal(received[1].authorizationPresent, true);
  assert.ok(sni.includes("localhost")); assert.deepEqual(received.map(r => r.path), ["/jwks", "/token"]);
  const cert = new X509Certificate(certificate), old = new X509Certificate(expired);
  const report = { checkedAt: new Date().toISOString(), actualTlsChecks: checks.length, checks, received, sni,
    certificate: { fingerprint256: cert.fingerprint256, subjectAltName: cert.subjectAltName, validFrom: cert.validFrom, validTo: cert.validTo },
    expiredValidTo: old.validTo, caSha256: createHash("sha256").update(await readFile(directory + "/ca.pem")).digest("hex"),
    isolation: "Fresh private QA CA, NODE_EXTRA_CA_CERTS only in child clients, no system trust changes, TLS verification never disabled.",
    scope: "Actual SSO transport HTTPS requests. No complete OIDC/SAML browser flow or external provider acceptance." };
  await writeFile(output + "/tls.json", JSON.stringify(report, null, 2) + "\n");
  await writeFile(".local/rea-fullstack/sso/outbound/latest.json", JSON.stringify({ directory, checkedAt: report.checkedAt }), { mode: 0o600 });
  console.log(JSON.stringify({ actualTlsChecks: checks.length, passed: true, httpRequestsReceived: received.length }));
} catch (error) {
  await writeFile(output + "/tls-failed.json", JSON.stringify({ checks, message: error instanceof Error ? error.message : "failed" }, null, 2) + "\n"); throw error;
} finally {
  validServer.closeAllConnections(); expiredServer.closeAllConnections();
  await Promise.all([new Promise<void>(done => validServer.close(() => done())), new Promise<void>(done => expiredServer.close(() => done()))]);
}
