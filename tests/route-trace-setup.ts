import { subscribe } from "node:diagnostics_channel";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { RouteTraceEvent } from "@/server/route-trace";

const destination = process.env.CATCHSECU_ROUTE_TRACE_FILE;
const marker = Symbol.for("catchsecu.route-trace.subscribed");
const state = globalThis as typeof globalThis & { [marker]?: boolean };

if (destination && !state[marker]) {
  const file = resolve(destination);
  mkdirSync(dirname(file), { recursive: true });
  subscribe("catchsecu.api.route", message => {
    const event = message as RouteTraceEvent;
    if (!event || typeof event.method !== "string" || typeof event.pathname !== "string" || !Number.isInteger(event.status)) return;
    appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
  });
  state[marker] = true;
}
