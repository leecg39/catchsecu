import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { containsAddress, parseAddress, parseNetwork } from "./ip-network";
const names = ["x-catchsecu-client-ip", "x-catchsecu-ip-proof", "x-forwarded-for", "x-real-ip", "forwarded"];
export function proxyNetworks(input: string) {
  if (!input.trim()) return [];
  const rows = input.split(",").map(v => parseNetwork(v.trim()));
  if (rows.length > 32 || rows.some(v => !v || v.prefix === 0)) throw new Error("APP_TRUSTED_PROXY_CIDRS must contain specific valid networks");
  return rows.map(v => v!.cidr);
}
export function resolvePeerIp(peer: string | undefined, forwarded: string | string[] | undefined, trusted: string[]) {
  const address = peer && parseAddress(peer); if (!address) return null;
  if (!trusted.some(cidr => containsAddress(cidr, address.address))) return address.address;
  if (!forwarded || Array.isArray(forwarded) || forwarded.length > 2048) return null;
  const chain = forwarded.split(",").map(value => parseAddress(value.trim()));
  if (chain.length > 32 || chain.some(ip => !ip)) return null;
  let current = address.address;
  for (let i = chain.length - 1; i >= 0 && trusted.some(cidr => containsAddress(cidr, current)); i--) current = chain[i]!.address;
  return current;
}
export function signClientIp(ip: string, key: string, now = Date.now()) {
  const value = ip + "|" + now + "|" + randomBytes(16).toString("hex");
  return value + "|" + createHmac("sha256", key).update(value).digest("hex");
}
export function trustedClientIp(headers: Headers) {
  const key = process.env.APP_IP_SIGNING_KEY, proof = headers.get("x-catchsecu-ip-proof"), ip = headers.get("x-catchsecu-client-ip");
  if (!key || !/^[a-f0-9]{64}$/.test(key) || !proof || !ip || proof.length > 300 || parseAddress(ip)?.address !== ip) return null;
  const fields = proof.split("|");
  if (fields.length !== 4 || fields[0] !== ip || !/^\d{13}$/.test(fields[1]) || !/^[a-f0-9]{32}$/.test(fields[2]) || !/^[a-f0-9]{64}$/.test(fields[3])) return null;
  const age = Date.now() - Number(fields[1]); if (age < -5000 || age > 120000) return null;
  const expected = createHmac("sha256", key).update(fields.slice(0, 3).join("|")).digest();
  return timingSafeEqual(expected, Buffer.from(fields[3], "hex")) ? ip : null;
}
export function stampClientIp(request: IncomingMessage, key: string, trusted: string[]) {
  const ip = resolvePeerIp(request.socket.remoteAddress, request.headers["x-forwarded-for"], trusted);
  for (const name of names) delete request.headers[name];
  const raw: string[] = [];
  for (let i = 0; i < request.rawHeaders.length; i += 2)
    if (!names.includes(request.rawHeaders[i].toLowerCase())) raw.push(request.rawHeaders[i], request.rawHeaders[i + 1]);
  if (ip) {
    const proof = signClientIp(ip, key);
    Object.assign(request.headers, { "x-catchsecu-client-ip": ip, "x-catchsecu-ip-proof": proof, "x-forwarded-for": ip, "x-real-ip": ip });
    raw.push("x-catchsecu-client-ip", ip, "x-catchsecu-ip-proof", proof, "x-forwarded-for", ip, "x-real-ip", ip);
  }
  request.rawHeaders = raw; return ip;
}
