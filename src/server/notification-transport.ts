import dns from "node:dns/promises";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { mkdir, open, link, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { NotificationProvider } from "@/contracts/notifications";
import { env } from "./env";
import { fail } from "./http";

export function notificationEndpoint(provider: NotificationProvider, input: string) {
  const invalid = () => fail(422, "INVALID_WEBHOOK_URL", "해당 메신저에서 발급한 HTTPS Webhook URL을 입력해주세요.");
  if (input !== input.trim() || /[\s\\\u0000-\u001f\u007f]/.test(input)) invalid();
  let url: URL; try { url = new URL(input); } catch { return invalid(); }
  if (url.protocol !== "https:" || url.port && url.port !== "443" || url.username || url.password || url.hash || isIP(url.hostname)) invalid();
  if (provider === "slack") {
    if (url.hostname !== "hooks.slack.com" || !/^\/services\/[A-Za-z0-9]{2,30}\/[A-Za-z0-9]{2,30}\/[A-Za-z0-9]{10,100}$/.test(url.pathname) || url.search) invalid();
  } else {
    const modern = /^(?:[a-z0-9-]+\.){1,3}environment\.api\.powerplatform\.com$/.test(url.hostname);
    const legacy = /^[a-z0-9-]+\.[a-z0-9-]+\.logic\.azure\.com$/.test(url.hostname);
    const prefix = modern ? "/powerautomate/automations/direct" : "";
    if (!modern && !legacy || !new RegExp("^" + prefix + "/workflows/[a-f0-9-]{32,36}/triggers/manual/paths/invoke/?$", "i").test(url.pathname)) invalid();
    const params = [...url.searchParams.entries()];
    if (params.length !== 4 || new Set(params.map(([key]) => key)).size !== 4 || params.some(([key]) => !["api-version", "sp", "sv", "sig"].includes(key)) ||
      !["1", "2016-10-01"].includes(url.searchParams.get("api-version") ?? "") || url.searchParams.get("sv") !== "1.0" ||
      url.searchParams.get("sp") !== "/triggers/manual/run" || !/^[A-Za-z0-9_+\-/=]{16,512}$/.test(url.searchParams.get("sig") ?? "")) invalid();
  }
  return url;
}
const denied = new BlockList();
for (const [ip, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) denied.addSubnet(ip, prefix, "ipv4");
const public6 = new BlockList(); public6.addSubnet("2000::", 3, "ipv6");
for (const [ip, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) denied.addSubnet(ip, prefix, "ipv6");
export function publicNotificationAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !denied.check(address, "ipv4") : family === 6 && public6.check(address, "ipv6") && !denied.check(address, "ipv6");
}
export type NotificationResult = { kind: "success" | "retry" | "failed" | "unknown"; outcome?: "local_delivered" | "accepted"; code?: string; httpStatus?: number; retrySeconds?: number };
export function notificationPayload(provider: NotificationProvider, text: string) {
  return provider === "slack" ? { text, mrkdwn: false, unfurl_links: false, unfurl_media: false } :
    { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: { "$schema": "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.2", body: [{ type: "TextBlock", text, wrap: true }] } }] };
}
async function localDelivery(id: string, provider: NotificationProvider, payload: object): Promise<NotificationResult> {
  const dir = resolve(env.LOCAL_NOTIFICATION_DIR), temp = resolve(dir, id + "." + randomUUID() + ".tmp");
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = await open(temp, "wx", 0o600);
    try { await file.writeFile(JSON.stringify({ id, provider, payload, deliveredAt: new Date().toISOString() }, null, 2)); await file.sync(); }
    finally { await file.close(); }
    await link(temp, resolve(dir, id + ".json"));
    return { kind: "success", outcome: "local_delivered" };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EEXIST" ? { kind: "success", outcome: "local_delivered" } : { kind: "retry", code: "LOCAL_WRITE_FAILED", retrySeconds: 5 };
  } finally { await unlink(temp).catch(() => {}); }
}
export async function deliverNotification(input: { id: string; provider: NotificationProvider; transport: string; endpoint: string; text: string }): Promise<NotificationResult> {
  let url: URL; try { url = notificationEndpoint(input.provider, input.endpoint); } catch { return { kind: "failed", code: "INVALID_WEBHOOK_URL" }; }
  if (input.transport !== env.NOTIFICATION_TRANSPORT) return { kind: "failed", code: "TRANSPORT_CHANGED" };
  const payload = notificationPayload(input.provider, input.text);
  if (input.transport === "local") return localDelivery(input.id, input.provider, payload);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let addresses: Awaited<ReturnType<typeof dns.lookup>>[];
  try {
    addresses = await Promise.race([dns.lookup(url.hostname, { all: true }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS_TIMEOUT")), 3000); })]);
  } catch { return { kind: "failed", code: "DNS_UNAVAILABLE" }; }
  finally { clearTimeout(timer); }
  if (!addresses.length || addresses.some(a => !publicNotificationAddress(a.address))) return { kind: "failed", code: "UNSAFE_DNS" };
  const target = addresses.find(a => a.family === 4);
  if (!target) return { kind: "failed", code: "IPV4_REQUIRED" };
  const bytes = Buffer.from(JSON.stringify(payload));
  return new Promise(resolveResult => {
    let settled = false, finishedWriting = false;
    const finish = (result: NotificationResult) => { if (settled) return; settled = true; clearTimeout(totalTimeout); resolveResult(result); };
    const totalTimeout = setTimeout(() => { finish({ kind: "unknown", code: "DELIVERY_TIMEOUT" }); request.destroy(); }, 8000);
    const request = https.request({ protocol: "https:", hostname: url.hostname, port: 443, path: url.pathname + url.search, method: "POST", servername: url.hostname, rejectUnauthorized: true, agent: false,
      lookup: (_host, _options, callback) => callback(null, target.address, 4),
      headers: { "content-type": "application/json", "content-length": bytes.length, "user-agent": "CatchsecuNotifications/1" } }, response => {
      const status = response.statusCode ?? 0; let received = 0; const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => { received += chunk.length; if (received > 16384) { finish({ kind: "unknown", code: "RESPONSE_TOO_LARGE", httpStatus: status }); response.destroy(); } else chunks.push(chunk); });
      response.on("error", () => finish({ kind: "unknown", code: "RESPONSE_INTERRUPTED", httpStatus: status || undefined }));
      response.on("end", () => {
        if (status === 429) {
          const value = Number(response.headers["retry-after"]);
          finish({ kind: "retry", code: "RATE_LIMITED", httpStatus: status, retrySeconds: Number.isFinite(value) && value > 0 ? Math.min(900, Math.max(1, Math.ceil(value))) : 60 });
        } else if (status >= 200 && status < 300 && (input.provider === "teams" || Buffer.concat(chunks).toString("utf8").trim() === "ok")) finish({ kind: "success", outcome: "accepted", httpStatus: status });
        else if (status >= 300 && status < 500) finish({ kind: "failed", code: status < 400 ? "REDIRECT_BLOCKED" : "PROVIDER_REJECTED", httpStatus: status });
        else finish({ kind: "unknown", code: "PROVIDER_UNCERTAIN", httpStatus: status || undefined });
      });
    });
    request.on("finish", () => { finishedWriting = true; });
    request.on("error", () => finish({ kind: finishedWriting ? "unknown" : "failed", code: finishedWriting ? "CONNECTION_INTERRUPTED" : "CONNECTION_FAILED" }));
    request.end(bytes);
  });
}
