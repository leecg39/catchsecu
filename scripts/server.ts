import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import next from "next";
import { proxyNetworks, stampClientIp } from "../src/server/client-ip";
const dev = process.argv.includes("--dev");
Object.assign(process.env, { NODE_ENV: dev ? "development" : "production" });
const key = randomBytes(32).toString("hex"); process.env.APP_IP_SIGNING_KEY = key;
nextEnv.loadEnvConfig(process.cwd(), dev);
const port = Number(process.env.APP_PORT ?? "3100"), hostname = process.env.APP_BIND_ADDRESS ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid APP_PORT");
const trusted = proxyNetworks(process.env.APP_TRUSTED_PROXY_CIDRS ?? "");
const server = createServer((request, response) => {
  stampClientIp(request, key, trusted);
  void handle(request, response).catch(() => {
    if (!response.headersSent) { response.statusCode = 500; response.end("Internal Server Error"); }
    else response.destroy();
  });
});
const app = next({ dev, hostname, port, httpServer: server });
const handle = app.getRequestHandler();
await app.prepare();
server.listen(port, hostname, () => console.log(JSON.stringify({ event: "ready", port, hostname, trustedProxyNetworks: trusted.length, clientIp: "socket-with-signed-attestation" })));
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  const timeout = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000); timeout.unref();
  server.closeIdleConnections();
  server.close(() => { void app.close().finally(() => process.exit(0)); });
}
process.on("SIGTERM", () => void stop()); process.on("SIGINT", () => void stop());
