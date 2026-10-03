import { createHash, createHmac } from "node:crypto";
import { MAX_FILE_BYTES } from "@/contracts/files";
import { type PrivateFileStorage, decryptStoredObject, encryptStoredObject, storageObjectName } from "./file-storage";

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value, "utf8").digest();
export function s3SigningKey(secret: string, date: string, region: string) {
  return hmac(hmac(hmac(hmac("AWS4" + secret, date), region), "s3"), "aws4_request");
}
export function authorizeS3(config: Pick<S3StorageConfig, "region" | "accessKeyId" | "secretAccessKey">, request: {
  method: string; canonicalUri: string; host: string; amzDate: string; payloadHash: string; contentType?: string;
}) {
  const headers: Record<string, string> = { host: request.host, "x-amz-content-sha256": request.payloadHash, "x-amz-date": request.amzDate };
  if (request.contentType) headers["content-type"] = request.contentType;
  const names = Object.keys(headers).sort();
  const canonical = [request.method, request.canonicalUri, "", names.map(name => name + ":" + headers[name] + "\n").join(""), names.join(";"), request.payloadHash].join("\n");
  const date = request.amzDate.slice(0, 8), scope = date + "/" + config.region + "/s3/aws4_request";
  const signature = createHmac("sha256", s3SigningKey(config.secretAccessKey, date, config.region))
    .update(["AWS4-HMAC-SHA256", request.amzDate, scope, sha256(canonical)].join("\n")).digest("hex");
  return { signature, authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`, payloadHash: request.payloadHash };
}
function objectUri(bucket: string, name: string) {
  return "/" + [bucket, "objects", storageObjectName(name)].map(encodeURIComponent).join("/");
}
export function createS3FileStorage(config: S3StorageConfig): PrivateFileStorage {
  const endpoint = new URL(config.endpoint);
  if (!["https:", "http:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== "/")
    throw new Error("S3 endpoint must be an origin");
  async function call(method: "PUT" | "GET" | "DELETE", name: string, body?: Buffer) {
    const payload = body ?? Buffer.alloc(0), amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
    const canonicalUri = objectUri(config.bucket, name);
    const signed = authorizeS3(config, { method, canonicalUri, host: endpoint.host, amzDate, payloadHash: sha256(payload),
      ...(method === "PUT" ? { contentType: "application/octet-stream" } : {}) });
    const response = await fetch(endpoint.origin + canonicalUri, { method, body: method === "PUT" ? new Uint8Array(payload) : undefined, headers: {
      authorization: signed.authorization, "x-amz-content-sha256": signed.payloadHash, "x-amz-date": amzDate,
      ...(method === "PUT" ? { "content-type": "application/octet-stream", "content-length": String(payload.length) } : {}),
    } });
    if (!response.ok) throw Object.assign(new Error("S3 " + method + " failed: " + response.status), { status: response.status });
    return Buffer.from(await response.arrayBuffer());
  }
  return {
    async write(name, bytes) {
      if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error("Invalid file size");
      await call("PUT", name, encryptStoredObject(name, bytes));
    },
    async read(name) { return decryptStoredObject(name, await call("GET", name)); },
    async remove(name) {
      try { await call("DELETE", name); }
      catch (error) { if ((error as { status?: number }).status !== 404) throw error; }
    },
  };
}
