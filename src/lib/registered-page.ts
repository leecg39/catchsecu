import manifest from "@/data/route-manifest.json";

// Wildcards in the reverse-engineered inventory describe fallback behavior.
// They must never turn the server's page allowlist into an unrestricted match.
const patterns = manifest.filter(route => !route.path.includes("*")).map(route =>
  new RegExp("^" + route.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[^/]+/g, "[^/]+") + "/?$"));

export function isRegisteredPage(path: string) {
  return patterns.some(pattern => pattern.test(path));
}
