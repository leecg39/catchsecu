import { isIP } from "node:net";
type Address = { value: bigint; bits: 32 | 128; address: string };
function render(value: bigint, bits: 32 | 128): string {
  if (bits === 32) return [BigInt(24), BigInt(16), BigInt(8), BigInt(0)].map(n => Number((value >> n) & BigInt(255))).join(".");
  const groups = Array.from({ length: 8 }, (_, i) => Number((value >> BigInt((7 - i) * 16)) & BigInt(65535)).toString(16));
  let start = -1, length = 0;
  for (let i = 0; i < 8;) {
    if (groups[i] !== "0") { i++; continue; }
    let end = i; while (end < 8 && groups[end] === "0") end++;
    if (end - i > length) { start = i; length = end - i; } i = end;
  }
  if (length < 2) return groups.join(":");
  return groups.slice(0, start).join(":") + "::" + groups.slice(start + length).join(":");
}
export function parseAddress(input: string): Address | null {
  if (!input || input !== input.trim() || input.includes("%")) return null;
  const family = isIP(input);
  if (family === 4) {
    const value = input.split(".").reduce((v, n) => (v << BigInt(8)) | BigInt(n), BigInt(0));
    return { value, bits: 32, address: render(value, 32) };
  }
  if (family !== 6) return null;
  let source = input.toLowerCase();
  if (source.includes(".")) {
    const pos = source.lastIndexOf(":"), tail = parseAddress(source.slice(pos + 1));
    if (!tail || tail.bits !== 32) return null;
    source = source.slice(0, pos + 1) + (tail.value >> BigInt(16)).toString(16) + ":" + (tail.value & BigInt(65535)).toString(16);
  }
  const halves = source.split("::"), left = halves[0] ? halves[0].split(":") : [], right = halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const value = groups.reduce((v, n) => (v << BigInt(16)) | BigInt("0x" + n), BigInt(0));
  if (value >> BigInt(32) === BigInt(65535)) return { value: value & BigInt(4294967295), bits: 32, address: render(value & BigInt(4294967295), 32) };
  return { value, bits: 128, address: render(value, 128) };
}
export function parseNetwork(input: string) {
  if (input !== input.trim() || input.length > 80) return null;
  const parts = input.split("/"); if (parts.length > 2) return null;
  const ip = parseAddress(parts[0]); if (!ip) return null;
  if (parts[1] !== undefined && !/^(0|[1-9][0-9]{0,2})$/.test(parts[1])) return null;
  let prefix = parts[1] === undefined ? ip.bits : Number(parts[1]);
  // Normalize IPv4-mapped IPv6 networks to IPv4; reject an ambiguous wider mapped range.
  if (isIP(parts[0]) === 6 && ip.bits === 32 && parts[1] !== undefined) {
    if (prefix < 96 || prefix > 128) return null; prefix -= 96;
  }
  if (prefix < 0 || prefix > ip.bits) return null;
  const shift = BigInt(ip.bits - prefix), network = (ip.value >> shift) << shift;
  return { bits: ip.bits, prefix, network, cidr: render(network, ip.bits) + "/" + prefix };
}
export function containsAddress(cidr: string, address: string) {
  const network = parseNetwork(cidr), ip = parseAddress(address);
  return !!network && !!ip && network.bits === ip.bits && (ip.value >> BigInt(ip.bits - network.prefix)) === (network.network >> BigInt(ip.bits - network.prefix));
}
