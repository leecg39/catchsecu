import { createHash, createHmac, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { MAX_FILE_BYTES } from "../src/contracts/files";
import { createS3FileStorage } from "../src/server/s3-storage";

const secret = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
const accessKey = randomUUID().replaceAll("-", "");
const region = "us-east-1", bucket = "catchsecu-private";
const objects = new Map<string, Buffer>();
let requests = 0;
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value, "utf8").digest();
function signingKey(date: string) { return hmac(hmac(hmac(hmac("AWS4" + secret, date), region), "s3"), "aws4_request"); }
function authorized(request: IncomingMessage, body: Buffer) {
  const header = request.headers.authorization ?? "";
  const match = header.match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/);
  if (!match || match[1] !== accessKey || match[3] !== region) return false;
  const names = match[4].split(";"), payloadHash = sha256(body);
  if (request.headers["x-amz-content-sha256"] !== payloadHash) return false;
  const canonicalHeaders = names.map(name => {
    const value = request.headers[name];
    return name + ":" + (Array.isArray(value) ? value.join(",") : value ?? "").trim() + "\n";
  }).join("");
  const canonical = [request.method, new URL(request.url ?? "/", "http://localhost").pathname, "", canonicalHeaders, names.join(";"), payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", request.headers["x-amz-date"], match[2] + "/" + region + "/s3/aws4_request", sha256(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(match[2])).update(stringToSign).digest("hex");
  return signature === match[5];
}
async function bodyOf(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
const server = createServer(async (request, response: ServerResponse) => {
  const body = await bodyOf(request);
  if (!authorized(request, body)) { response.writeHead(403).end(); return; }
  requests += 1;
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method === "PUT") { objects.set(path, body); response.writeHead(200).end(); return; }
  if (request.method === "GET") {
    const found = objects.get(path);
    if (!found) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-length": String(found.length) }).end(found); return;
  }
  if (request.method === "DELETE") { objects.delete(path); response.writeHead(204).end(); return; }
  response.writeHead(405).end();
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("S3 시험 서버 주소를 확인할 수 없습니다.");
const storage = createS3FileStorage({ endpoint: "http://127.0.0.1:" + address.port, region, bucket, accessKeyId: accessKey, secretAccessKey: secret });
const failures: string[] = [];
const plaintext = Buffer.from("s3 private roundtrip " + randomUUID());
const id = randomUUID();
try {
  await storage.write(id, plaintext);
  const stored = [...objects.values()][0];
  if (!stored?.subarray(0, 4).equals(Buffer.from("CSF1")) || stored.includes(plaintext)) failures.push("S3 객체가 평문으로 저장되었습니다.");
  const read = await storage.read(id);
  if (!read.equals(plaintext)) failures.push("S3 왕복 바이트가 다릅니다.");
  const other = randomUUID();
  objects.set("/" + bucket + "/objects/" + other + ".enc", stored);
  await storage.read(other).then(() => failures.push("다른 키로 옮긴 암호문이 복호화되었습니다."), () => undefined);
  const before = requests;
  await storage.write("../etc/passwd", Buffer.from("x")).then(() => failures.push("경로 탈출이 허용되었습니다."), () => undefined);
  await storage.write(id, Buffer.alloc(MAX_FILE_BYTES + 1)).then(() => failures.push("초과 용량이 허용되었습니다."), () => undefined);
  if (requests !== before) failures.push("거부된 요청이 S3에 전달되었습니다.");
  await storage.remove(id);
  await storage.read(id).then(() => failures.push("삭제 후 객체를 읽었습니다."), () => undefined);
} finally { server.close(); }
const report = { checkedAt: new Date().toISOString(), result: failures.length ? "failed" : "passed", requests, objects: objects.size, failures };
await mkdir("docs/qa/P01-T03", { recursive: true });
await writeFile("docs/qa/P01-T03/s3-roundtrip.json", JSON.stringify(report, null, 2) + "\n");
if (failures.length) throw new Error(failures.join("\n"));
console.log(JSON.stringify({ result: report.result, requests }));
